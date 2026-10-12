/**
 * launcher installer：直链下载 → 解包 → exe 入口探测 → 类 WE app 封装 → 入库。
 * 目标形态（与 WE workshop application 条目同构，保持与现有 scanApps 零改动兼容）：
 *   <root>/<slug>/
 *     project.json  { title, type:"application", file:"<入口相对路径>", preview:"preview.png",
 *                     general.properties.schemecolor…（与 WE 对齐的占位）,
 *                     source:{ url, fileName, size, sha512, installedAt } }
 *     preview.png   客户端 canvas 卡回传优先；缺省服务端 fallbackCardPng
 *     <软件本体>
 * 安全边界：仅接受 http(s) 直链；Content-Length 与实收字节数双查，超限即弃；
 * sha512 记账（可选传入期望值，不符即拒装）；解包条目数/总字节/路径穿越全防。
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync, readdirSync, rmSync, openSync, closeSync, writeSync, renameSync, cpSync, realpathSync, createReadStream, createWriteStream, lstatSync, readSync } from 'node:fs'
import { randomBytes, createHash } from 'node:crypto'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { spawnSync, spawn } from 'node:child_process'
import { join, dirname, extname, basename, normalize as pathNormalize, resolve, sep } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { openZipMap, CryptZipError, hasZipTrailer } from './crypt-zip.ts'
import { fallbackCardPng } from './png.ts'

export interface FetchLike {
  ok: boolean
  status: number
  headers: { get(name: string): string | null }
  /** 必须使用流；禁止回退到整包 arrayBuffer。 */
  body?: ReadableStream<Uint8Array> | AsyncIterable<Uint8Array> | null
}

/** fetch 可选 init（下载层只用 headers；旧测试注入的 fetchFn 只收 url 也兼容） */
export interface FetchInitLike { headers?: Record<string, string> }

/** 从 fetch 抛出的错误里挖真实原因（undici 把解析错误藏在 cause 里）。 */
function fetchCauseText(e: unknown): string {
  const err = e as { message?: unknown; cause?: { message?: unknown; code?: unknown } }
  const parts = [typeof err.message === 'string' ? err.message : String(e)]
  const cause = err.cause
  if (cause !== undefined && cause !== null) {
    parts.push(typeof cause.message === 'string' ? cause.message : String(cause))
    if (cause.code !== undefined) parts.push(String(cause.code))
  }
  return parts.filter((s) => s !== '').join(' ← ')
}

/** CDN 返回了 HTTP 解析器无法容忍的头（如 Content-Length 非法 / 与 Transfer-Encoding 冲突）。 */
function isHttpHeaderParseError(text: string): boolean {
  return /content-length|invalid header|parse error|hpe_/i.test(text)
}

/** Node fs.writeSync 的 length 是 int32：单次写上限 2 GiB-1。 */
const MAX_WRITE_CHUNK = 0x7fffffff

/** 分块写整块字节（writeFileSync 对 >2GiB 的 Uint8Array 直接 RangeError——Node fs.writeSync 的 length 是 int32）。
 *  chunkSize 仅供测试注入小分块验证多块路径。 */
export function writeBytesSafe(target: string, bytes: Uint8Array, chunkSize = MAX_WRITE_CHUNK): void {
  if (bytes.length <= chunkSize) {
    writeFileSync(target, bytes)
    return
  }
  const fd = openSync(target, 'w')
  try {
    for (let off = 0; off < bytes.length; off += chunkSize) {
      writeSync(fd, bytes, off, Math.min(chunkSize, bytes.length - off))
    }
  } finally { closeSync(fd) }
}

/** 在大文件字节里找 7z 段起点（37 7A BC AF 27 1C）：头部命中 → 0；否则 1MB 之后全量扫
 *  （Buffer.indexOf 走原生 memmem、视图共享零拷贝，GB 级文件亚秒级）；非 7z → -1。
 *  场景：「视频垫底 + 7z 追加」复合文件——头部是媒体数据，7z 签名埋在文件中部。 */
function find7zOffset(bytes: Uint8Array): number {
  if (bytes.length > 6 && bytes[0] === 0x37 && bytes[1] === 0x7A && bytes[2] === 0xBC
    && bytes[3] === 0xAF && bytes[4] === 0x27 && bytes[5] === 0x1C) return 0
  if (bytes.length < 1048576) return -1 // 小文件头部即全部，无需扫描
  const view = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const idx = view.indexOf(SEVEN_ZIP_SIG, 1024)
  return idx >= 0 ? idx : -1
}

const SEVEN_ZIP_SIG = Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])

/** 两家解压器的命令行参数风格（纯函数，测试可直接断言）。 */
export function buildArchiveArgs(kind: '7z' | 'bandizip', tmpArchive: string, destDir: string, password?: string): string[] {
  if (kind === 'bandizip') {
    // Bandizip bz.exe：`bz x -y -o:<dir> -p:<pwd> <archive>`（冒号风格；无密码时省略 -p）
    const args = ['x', '-y', '-o:' + destDir]
    if (password !== undefined && password !== '') args.push('-p:' + password)
    args.push(tmpArchive)
    return args
  }
  // 7-Zip：`7z x -y -p<pwd> -o<dir> <archive>`（连写；空密码也要 -p 触发 Enter password 提示路径）
  return ['x', '-y', '-p' + (password ?? ''), '-o' + destDir, tmpArchive]
}

/** 解压器输出是否指向密码问题（7z/Bandizip 实测输出 + 中文 UI 都覆盖）。 */
export function isPasswordErrorOutput(out: string, password?: string): boolean {
  const pwdEmpty = password === undefined || password === ''
  if (/wrong password|invalid password|incorrect password|password required|enter password/i.test(out)) return true
  // 中文输出（Bandizip 跟随 UI 语言）：空密码问「需要密码」，有密码问「密码错误」
  return pwdEmpty ? /密码/.test(out) : /密码错误|密码不正确|密码不符/.test(out)
}

export interface LauncherDeps {
  /** 安装根目录（每个 app 一个子目录） */
  root: string
  /** 下载注入（Node 测试喂假响应）；默认 globalThis.fetch。带 init 的真实 fetch 也兼容 */
  fetchFn?: (url: string, init?: FetchInitLike) => Promise<FetchLike>
  /** 7z/7za.exe 路径（CONFIG.launcherSevenZipPath）；缺省走自动探测 */
  sevenZipPath?: string
  now?: () => string
}

export interface InstalledAppRecord {
  id: string
  title: string
  /** 相对 root 的目录名 */
  slug: string
  /** 相对 app 目录的入口文件路径（posix 分隔） */
  file: string
  /** 相对 app 目录的预览图文件名 */
  preview: string
  sourceUrl: string
  sourceName: string
  size: number
  sha512: string
  installedAt: string
}

export class LauncherError extends Error {
  constructor(msg: string) { super(msg); this.name = 'LauncherError' }
}

const MAX_DOWNLOAD_BYTES = 64 * 1024 * 1024 * 1024 // 流式写盘，最多 64 GiB
const MEMORY_ZIP_BYTES = 32 * 1024 * 1024 // 仅小 ZIP 使用内置读取器

export interface DownloadedFile {
  path: string
  fileName: string
  size: number
  sha512: string
  /** 调用方在安装结束（成功或失败）后必须释放。 */
  cleanup(): void
}
const MAX_ZIP_ENTRIES = 20000
const MAX_ZIP_UNPACKED = 128 * 1024 * 1024 * 1024 // 每层最多展开 128 GiB
const PREVIEW_EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' }
const EXECUTABLE_EXTS = new Set(['.exe', '.bat', '.cmd'])
/** zip 常见噪声目录 */
const NOISE_DIRS = new Set(['__MACOSX', '.git', 'node_modules'])

/** 拒绝盘符/绝对路径/路径穿越，返回规范化后的相对路径（posix 分隔）。 */
function assertSafeRelPath(rel: string): string {
  if (/^[a-zA-Z]:/.test(rel) || rel.startsWith('/') || rel.startsWith('\\') || rel.split(/[\\/]/).includes('..')) {
    throw new LauncherError(`zip 条目路径可疑，拒绝解包: ${rel}`)
  }
  return pathNormalize(rel).replace(/\\/g, '/')
}

/** 目标路径必须落在 destDir 内（防 join 后逃逸）。 */
function assertInside(destDir: string, target: string): void {
  const normDest = pathNormalize(destDir)
  const normTarget = pathNormalize(target)
  if (normTarget !== normDest && !normTarget.startsWith(normDest + sep)) {
    throw new LauncherError(`落盘目标逃逸: ${target}`)
  }
}

/** 同上两个：导出给 node 半的启动路由与测试用（同一套判据，别在别处再写一遍字符串前缀比较）。 */
export { assertSafeRelPath, assertInside }

/**
 * 安装根下的"内部目录名"判定：暂存（`.staging-<随机>`）与替换备份（`<原名>.backup-<时间>`）。
 * 这两类目录里都**带着 project.json**（备份就是改名前的正式目录），而安装根本身通常在
 * 用户自定义壁纸目录里（见 index.ts 的 appDirs）—— 不跳过就会以「重名应用」的形态混进本地列表。
 * 所有"把某个目录的子目录当壁纸列举"的地方都应先过这个判据。
 */
export function isLauncherInternalDir(name: string): boolean {
  return name.startsWith('.') || name.includes('.backup-')
}

/**
 * 应用入口的解析与包含性校验（启动路由用）。
 * 为什么不能用「拼接后 startsWith(dir + '/')」：那只做字符串前缀比较，`../x.exe` 能轻松通过，
 * 于是"防逃逸"形同虚设（2026-09-10 复核确认）。这里改为**词法解析 + 目录包含判定**：
 * 入口先按 zip 同款规则净化（拒绝绝对路径与 `..` 段），再断言解析结果严格位于应用目录内；
 * 若文件真实存在，再用 realpath 复核一次（拦符号链接 / junction 指到目录外）。
 * @param dir 应用目录（已 normalized，正斜杠）
 * @param file project.json 里的入口相对路径
 * @returns 可执行文件的规范路径；不合法时抛 LauncherError
 */
export function resolveEntryInside(dir: string, file: string): string {
  const rel = assertSafeRelPath(file)
  if (rel === '' || rel === '.') throw new LauncherError(`入口路径非法: ${file}`)
  const target = join(dir, ...rel.split('/'))
  assertInside(dir, target)
  try {
    const realDir = pathNormalize(realpathSync.native(dir))
    const realTarget = pathNormalize(realpathSync.native(target))
    assertInside(realDir, realTarget)
  } catch (e) {
    // realpath 失败通常意味着入口不存在 —— 交给调用方按"文件不存在"处理；
    // 但"越界"这类判据错误必须原样抛出，不能被吞掉。
    if (e instanceof LauncherError) throw e
  }
  return target.replace(/\\/g, '/')
}

/** 两个路径是否指向同一位置：词法解析 +（存在时）realpath 解别名，Windows 下大小写不敏感。
 *  用途：迁移时"同一个目录的不同写法"（末尾多一个 `/`、盘符大小写不同、8.3 短名等）必须识别为同一目录，
 *  否则会先删目标（其实是源）导致应用被删掉。 */
export function samePath(a: string, b: string): boolean {
  const norm = (p: string): string => {
    let s = pathNormalize(resolve(p))
    try { s = pathNormalize(realpathSync.native(p)) } catch { /* 不存在：用词法结果 */ }
    return process.platform === 'win32' ? s.toLowerCase() : s
  }
  return norm(a) === norm(b)
}

/** 安装根规范化：去引号/空白，必须绝对路径（盘符或 UNC 或 / 开头），尾部去分隔符。 */
function normalizeRoot(next: string): string {
  const trimmed = next.trim().replace(/^["']|["']$/g, '')
  if (trimmed === '') throw new LauncherError('安装位置不能为空')
  if (!/^[a-zA-Z]:[\\/]/.test(trimmed) && !trimmed.startsWith('//') && !trimmed.startsWith('/')) {
    throw new LauncherError(`安装位置必须是绝对路径（如 D:\\Games\\WeApps）: ${trimmed}`)
  }
  return pathNormalize(trimmed).replace(/[\\/]+$/, '')
}

interface EntryPair { orig: string; safe: string }

/** 去掉 zip 常见的单一顶层包装目录（"My Game v1.2/game.exe" → 直接展开到根）。
 *  仅当所有条目都在同一个顶层目录下（无根级散文件）时才扁平化；保持与 orig 的配对。 */
function stripTopWrapper(pairs: EntryPair[]): EntryPair[] {
  const tops = new Set(pairs.map((p) => (p.safe.includes('/') ? p.safe.slice(0, p.safe.indexOf('/')) : '')))
  if (tops.size !== 1) return pairs
  const top = [...tops][0]!
  if (top === '') return pairs
  return pairs
    .map((p) => ({ orig: p.orig, safe: p.safe.slice(top.length + 1) }))
    .filter((p) => p.safe !== '')
}

export class LauncherInstaller {
  /** 安装根（面板可运行时更换；每个 app 一个子目录） */
  root: string
  /** 可替换的下载实现（测试注入假响应）；带 init 的真实 fetch 兼容 */
  fetchFn: (url: string, init?: FetchInitLike) => Promise<FetchLike>
  /** 7z/7za.exe 显式路径（CONFIG 注入）；空 = 自动探测 */
  sevenZipPath: string
  private now: () => string
  /** 30s 内存索引缓存（与 index.ts appsCache 同风格） */
  private indexCache: { at: number; list: InstalledAppRecord[] } | null = null

  constructor(deps: LauncherDeps) {
    this.root = deps.root
    this.fetchFn = deps.fetchFn ?? (async (url, init) => await fetch(url, init))
    this.sevenZipPath = deps.sevenZipPath ?? ''
    this.now = deps.now ?? (() => new Date().toISOString())
  }

  /** 运行时更换安装根（面板「安装位置」）。目录自动创建；索引缓存失效（旧根的记录全部失效）。
   *  记录不迁移——旧根原样保留，想迁移由上层调 moveToRoot。 */
  setRoot(next: string): void {
    const root = normalizeRoot(next)
    if (root === this.root) return
    mkdirSync(root, { recursive: true })
    this.root = root
    this.indexCache = null
  }

  /** 移动已装应用到新根（按记录的 slug 整目录搬；目标同名先删——安装语义本就是覆盖）。
   *  跨盘 rename 会 EXDEV → 回落 cpSync 复制后删源。迁移成功后把记录的 sha512 清掉吗？不——
   *  sha512 是安装时记账值，与位置无关，保留。记录本身随新根 installed.json 重建。
   *  返回成功迁移的记录数；失败的应用跳过并在结果里报告。 */
  moveToRoot(next: string): { moved: number; failed: string[] } {
    const oldRoot = this.root
    const list = this.list()
    this.setRoot(next)
    const failed: string[] = []
    const kept: InstalledAppRecord[] = []
    let moved = 0
    for (const rec of list) {
      let from: string
      let to: string
      try {
        // 记录里的 slug 也当不可信输入：越界直接跳过（绝不碰盘）
        const rel = assertSafeRelPath(rec.slug)
        from = join(oldRoot, rel); assertInside(oldRoot, from)
        to = join(this.root, rel); assertInside(this.root, to)
      } catch { failed.push(rec.title || rec.slug); continue }
      if (!existsSync(from)) { continue }
      // 同一个目录的不同写法（末尾多一个 `/`、盘符大小写、8.3 短名、软链别名）：直接当已就位。
      // 少了这一步会走到"目标同名先删"，而目标其实就是源 —— 原应用当场消失。
      if (samePath(from, to)) { moved++; kept.push(rec); continue }
      try {
        if (existsSync(to)) rmSync(to, { recursive: true, force: true })
        mkdirSync(dirname(to), { recursive: true })
        try {
          renameSync(from, to)
        } catch {
          // 跨盘（EXDEV）或文件被占用：整树复制后删源
          cpSync(from, to, { recursive: true })
          rmSync(from, { recursive: true, force: true })
        }
        moved++
        kept.push(rec)
      } catch { failed.push(rec.title || rec.slug) }
    }
    // 记录随迁：新根 installed.json 只保留迁移成功的（失败/已损坏的留在旧根，可重装）
    try { writeFileSync(this.indexFile(), JSON.stringify(kept, null, 2) + '\n', 'utf8') } catch { /* ignore */ }
    this.indexCache = null
    return { moved, failed }
  }

  // ── 索引 ───────────────────────────────────────────────────────────

  private indexFile(): string { return join(this.root, 'installed.json') }

  list(): InstalledAppRecord[] {
    if (this.indexCache !== null && Date.now() - this.indexCache.at < 30000) return this.indexCache.list
    let list: InstalledAppRecord[] = []
    try {
      const parsed = JSON.parse(readFileSync(this.indexFile(), 'utf8')) as unknown
      if (Array.isArray(parsed)) {
        list = parsed.filter((x): x is InstalledAppRecord =>
          x !== null && typeof x === 'object' && typeof (x as InstalledAppRecord).id === 'string' && typeof (x as InstalledAppRecord).slug === 'string')
      }
    } catch { /* 无索引文件 */ }
    this.indexCache = { at: Date.now(), list }
    return list
  }

  get(id: string): InstalledAppRecord | undefined {
    return this.list().find((r) => r.id === id)
  }

  has(id: string): boolean {
    return this.get(id) !== undefined
  }

  private saveIndex(list: InstalledAppRecord[]): void {
    mkdirSync(this.root, { recursive: true })
    writeFileSync(this.indexFile(), JSON.stringify(list, null, 2) + '\n', 'utf8')
    this.indexCache = null
  }

  private upsert(rec: InstalledAppRecord): void {
    this.saveIndex(this.list().filter((r) => r.id !== rec.id).concat(rec))
  }

  remove(id: string): void {
    const rec = this.get(id)
    if (rec === undefined) return
    this.saveIndex(this.list().filter((r) => r.id !== id))
    try { rmSync(this.appDir(rec.slug), { recursive: true, force: true }) } catch { /* 目录已不在 / slug 非法 */ }
  }

  // ── 下载 ───────────────────────────────────────────────────────────

  /** 下载直链：仅 http(s)，大小上限双查（Content-Length + 实收）。
   *  已知边界：139 CDN 偶发返回让 Node HTTP 解析器崩溃的头（如 Content-Length 与
   *  Transfer-Encoding 冲突，undici 报 "Parse Error … invalid content-length"，
   *  面板只能看到笼统的「不合法的 length」）。这类错误对同 URL 的重试往往自愈，
   *  故命中特征时自动带 Range 头重试一次；Range（206）响应不含 Content-Length，
   *  解析器不会再踩同一个坑。Range 重试也失败才把真实错误链抛给上层。
   *  `init.headers` 可注入自定义下载头（与内部 Range 重试头合并）。 */
  async download(url: string, init?: FetchInitLike): Promise<DownloadedFile> {
    let parsed: URL
    try { parsed = new URL(url) } catch { throw new LauncherError(`URL 非法: ${url}`) }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new LauncherError(`仅支持 http(s) 直链: ${parsed.protocol}`)
    let res: FetchLike
    let lastErrText = ''
    try {
      res = await this.fetchFn(url, init)
    } catch (e) {
      lastErrText = fetchCauseText(e)
      // HTTP 头解析类错误（invalid content-length 等）：带 Range 头重试一次
      if (isHttpHeaderParseError(lastErrText)) {
        try {
          res = await this.fetchFn(url, { ...(init ?? {}), headers: { ...(init?.headers ?? {}), Range: 'bytes=0-' } })
        } catch (e2) {
          throw new LauncherError(`下载请求失败（含 Range 重试）: ${fetchCauseText(e2)}`)
        }
      } else {
        throw new LauncherError(`下载请求失败: ${lastErrText}`)
      }
    }
    const cancelBody = async (): Promise<void> => {
      if (res.body && 'cancel' in res.body) await res.body.cancel().catch(() => {})
    }
    if (!res.ok) {
      await cancelBody()
      throw new LauncherError(`下载失败: HTTP ${res.status}`)
    }
    // Range 头解析重试也必须得到完整文件，不能把某一段误装成整个包。
    const contentRange = res.headers.get('content-range')
    if (res.status === 206) {
      const match = /^bytes 0-(\d+)\/(\d+)$/.exec(contentRange ?? '')
      if (!match || Number(match[1]) + 1 !== Number(match[2])) {
        await cancelBody()
        throw new LauncherError('下载响应仅包含部分文件，拒绝安装')
      }
    }
    const cl = res.headers.get('content-length')
    if (cl !== null && cl !== '') {
      const declared = Number(cl)
      if (Number.isFinite(declared) && declared > MAX_DOWNLOAD_BYTES) {
        await cancelBody()
        throw new LauncherError(`文件超过大小上限 (${Math.round(MAX_DOWNLOAD_BYTES / 1048576)} MiB): ${declared}`)
      }
    }
    if (!res.body) throw new LauncherError('下载响应缺少数据流')
    // 放在安装盘上：同盘移动单文件无需再复制 GB 级数据。
    const temp = this.createStagingDir()
    const target = join(temp, 'download.part')
    let size = 0
    const hash = createHash('sha512')
    const source = 'getReader' in res.body
      ? Readable.fromWeb(res.body as import('node:stream/web').ReadableStream<Uint8Array>)
      : Readable.from(res.body)
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        size += chunk.length
        if (size > MAX_DOWNLOAD_BYTES) {
          callback(new LauncherError(`文件超过大小上限 (4096 MiB): ${size}`))
          return
        }
        hash.update(chunk)
        callback(null, chunk)
      },
    })
    try {
      await pipeline(source, meter, createWriteStream(target, { flags: 'wx' }))
      if (size === 0) throw new LauncherError('下载内容为空')
      // fetch 自动解压传输编码，压缩传输不能拿压缩长度与解压后字节比较。
      const declared = Number(cl)
      const encoding = res.headers.get('content-encoding')
      if ((!encoding || encoding === 'identity') && cl && Number.isFinite(declared) && size !== declared) {
        throw new LauncherError(`下载不完整: 预期 ${declared} 字节，实际 ${size} 字节`)
      }
      if (res.status === 206 && size !== Number(contentRange!.split('/')[1])) {
        throw new LauncherError('下载不完整: 实收大小与 Content-Range 不符')
      }
    } catch (e) {
      rmSync(temp, { recursive: true, force: true })
      if (e instanceof LauncherError) throw e
      throw new LauncherError(`下载中断: ${fetchCauseText(e)}`)
    }
    const fileName = fileNameFromUrl(url, res.headers.get('content-disposition'))
    return { path: target, fileName, size, sha512: 'sha512-' + hash.digest('base64'),
      cleanup: () => rmSync(temp, { recursive: true, force: true }) }
  }

  // ── 解包 / 落盘 ─────────────────────────────────────────────────────

  /** 从磁盘读取有限的 ZIP 中央目录（包括 ZIP64），不读取包体。 */
  zipFileInfo(path: string): { expanded: number; zip64: boolean } {
    const fd = openSync(path, 'r')
    const size = statSync(path).size
    const read = (position: number, length: number): Buffer => {
      if (position < 0 || position + length > size) throw new LauncherError('ZIP 目录越界或包已截断')
      const data = Buffer.alloc(length)
      let off = 0
      while (off < length) {
        const n = readSync(fd, data, off, length - off, position + off)
        if (!n) throw new LauncherError('ZIP 目录读取不完整')
        off += n
      }
      return data
    }
    const safeNumber = (value: bigint): number => {
      if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new LauncherError('ZIP64 尺寸超限')
      return Number(value)
    }
    try {
      const tail = read(Math.max(0, size - 65557), Math.min(size, 65557))
      let eocd = -1
      for (let i = tail.length - 22; i >= 0; i--) {
        if (tail.readUInt32LE(i) === 0x06054b50 && i + 22 + tail.readUInt16LE(i + 20) === tail.length) { eocd = i; break }
      }
      if (eocd < 0) throw new LauncherError('不是合法 ZIP：找不到 EOCD')
      if (tail.readUInt16LE(eocd + 4) || tail.readUInt16LE(eocd + 6)) throw new LauncherError('不支持分卷 ZIP')
      let count = tail.readUInt16LE(eocd + 10)
      let cdSize = tail.readUInt32LE(eocd + 12)
      let cdEnd = size - tail.length + eocd
      let zip64 = count === 0xffff || cdSize === 0xffffffff || tail.readUInt32LE(eocd + 16) === 0xffffffff
      if (zip64) {
        // ZIP64 EOCD 位于 locator 前，标准固定部分为 56 字节。
        const locator = read(cdEnd - 20, 20)
        if (locator.readUInt32LE(0) !== 0x07064b50 || locator.readUInt32LE(4) !== 0 || locator.readUInt32LE(16) !== 1) throw new LauncherError('ZIP64 locator 非法或分卷')
        const record = read(cdEnd - 20 - 56, 56)
        if (record.readUInt32LE(0) !== 0x06064b50 || record.readBigUInt64LE(4) !== 44n || record.readUInt32LE(16) || record.readUInt32LE(20)) throw new LauncherError('不支持此 ZIP64 目录格式')
        count = safeNumber(record.readBigUInt64LE(32))
        cdSize = safeNumber(record.readBigUInt64LE(40))
        cdEnd -= 76
      }
      if (count > MAX_ZIP_ENTRIES || cdSize > 16 * 1024 * 1024) throw new LauncherError('ZIP 条目数或目录大小超限')
      const central = read(cdEnd - cdSize, cdSize)
      let p = 0
      let expanded = 0
      for (let n = 0; n < count; n++) {
        if (p + 46 > central.length || central.readUInt32LE(p) !== 0x02014b50) throw new LauncherError('ZIP 中央目录损坏')
        const nameLen = central.readUInt16LE(p + 28)
        const extraLen = central.readUInt16LE(p + 30)
        const end = p + 46 + nameLen + extraLen + central.readUInt16LE(p + 32)
        if (end > central.length) throw new LauncherError('ZIP 目录条目截断')
        assertSafeRelPath(central.subarray(p + 46, p + 46 + nameLen).toString('utf8'))
        const unixMode = central.readUInt32LE(p + 38) >>> 16
        if ((unixMode & 0xf000) === 0xa000) throw new LauncherError('ZIP 包含符号链接，拒绝解包')
        let unpacked = central.readUInt32LE(p + 24)
        zip64 ||= unpacked === 0xffffffff || central.readUInt32LE(p + 20) === 0xffffffff || central.readUInt32LE(p + 42) === 0xffffffff
        if (unpacked === 0xffffffff) {
          let found = false
          for (let q = p + 46 + nameLen; q + 4 <= p + 46 + nameLen + extraLen;) {
            const length = central.readUInt16LE(q + 2)
            if (q + 4 + length > p + 46 + nameLen + extraLen) throw new LauncherError('ZIP extra 截断')
            if (central.readUInt16LE(q) === 1 && length >= 8) { unpacked = safeNumber(central.readBigUInt64LE(q + 4)); found = true; break }
            q += 4 + length
          }
          if (!found) throw new LauncherError('ZIP64 条目缺少尺寸')
        }
        expanded += unpacked
        if (expanded > MAX_ZIP_UNPACKED) throw new LauncherError('ZIP 解包总量超限')
        p = end
      }
      return { expanded, zip64 }
    } finally { closeSync(fd) }
  }

  /** 文件识别只读头尾；7z 中部签名扫描保留 5 字节重叠，避免跨块漏检。 */
  async inspectFile(path: string): Promise<{ zip: boolean; sevenZipOffset: number }> {
    const size = statSync(path).size
    const fd = openSync(path, 'r')
    let zip = false
    let head: Buffer
    try {
      head = Buffer.alloc(Math.min(size, 6))
      readSync(fd, head, 0, head.length, 0)
      zip = head.length >= 2 && head[0] === 0x50 && head[1] === 0x4b
      const tail = Buffer.alloc(Math.min(size, 65557))
      readSync(fd, tail, 0, tail.length, size - tail.length)
      for (let i = tail.length - 22; i >= 0 && !zip; i--) {
        if (tail.readUInt32LE(i) !== 0x06054b50 || i + 22 + tail.readUInt16LE(i + 20) !== tail.length) continue
        const cdAt = size - tail.length + i - tail.readUInt32LE(i + 12)
        if (cdAt < 0) continue
        const sig = Buffer.alloc(4)
        if (readSync(fd, sig, 0, 4, cdAt) === 4 && sig.readUInt32LE(0) === 0x02014b50) zip = true
      }
    } finally { closeSync(fd) }
    if (head.equals(SEVEN_ZIP_SIG)) return { zip, sevenZipOffset: 0 }
    if (size < 1048576 || zip) return { zip, sevenZipOffset: -1 }
    let carry = Buffer.alloc(0)
    let position = 1024
    for await (const chunk of createReadStream(path, { start: position, highWaterMark: 1024 * 1024 })) {
      const data = Buffer.concat([carry, chunk as Buffer])
      const index = data.indexOf(SEVEN_ZIP_SIG)
      if (index >= 0) return { zip, sevenZipOffset: position - carry.length + index }
      position += chunk.length
      carry = Buffer.from(data.subarray(Math.max(0, data.length - 5)))
    }
    return { zip, sevenZipOffset: -1 }
  }

  /** 大包始终由文件解压；小 ZIP 的压缩+声明解压总量也必须满足内存预算。 */
  async unpackFile(path: string, destDir: string, fileName: string, password?: string): Promise<string[]> {
    const kind = await this.inspectFile(path)
    if (kind.sevenZipOffset >= 0) {
      let archive = path
      let sliced: string | undefined
      try {
        if (kind.sevenZipOffset > 0) {
          sliced = join(dirname(path), 'segment-' + randomBytes(6).toString('hex') + '.7z')
          await pipeline(createReadStream(path, { start: kind.sevenZipOffset }), createWriteStream(sliced, { flags: 'wx' }))
          archive = sliced
        }
        return await this.extractArchiveFile(archive, destDir, password)
      } finally { if (sliced) rmSync(sliced, { force: true }) }
    }
    if (kind.zip || /\.zip$/i.test(fileName)) {
      const info = this.zipFileInfo(path)
      if (!info.zip64 && statSync(path).size + info.expanded <= MEMORY_ZIP_BYTES) {
        const bytes = readFileSync(path)
        return this.unzipToDir(bytes, destDir, password)
      }
      return this.extractArchiveFile(path, destDir, password)
    }
    const safe = assertSafeRelPath(fileName)
    const target = join(destDir, ...safe.split('/'))
    assertInside(destDir, target)
    mkdirSync(dirname(target), { recursive: true })
    // 下载与安装暂存在同一盘，直接改名避免重复复制 GB 级单文件。
    renameSync(path, target)
    return [safe]
  }

  /** 外部解压器先列清单校验路径、链接、条目数与展开量，再从磁盘解压。 */
  async extractArchiveFile(path: string, destDir: string, password?: string): Promise<string[]> {
    if ((await this.inspectFile(path)).zip) this.zipFileInfo(path)
    const tool = this.resolveSevenZip() ?? this.resolveBandizip()
    if (!tool) {
      throw new LauncherError('未找到 7z 或 Bandizip：此压缩包需要从磁盘解压，请安装 7-Zip 或 Bandizip，或配置 launcherSevenZipPath（无需整包载入内存）')
    }
    const bandizip = /bz(\.exe)?$/i.test(tool)
    const run = async (args: string[]): Promise<string> => {
      const result = await new Promise<{ status: number | null; output: string; error?: Error }>((resolve) => {
        const child = spawn(tool, args, { timeout: 10 * 60 * 1000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
        const chunks: Buffer[] = []
        let size = 0
        let error: Error | undefined
        const collect = (chunk: Buffer): void => {
          size += chunk.length
          if (size > 16 * 1024 * 1024) {
            error = new Error('解压器输出过大')
            child.kill()
          } else chunks.push(chunk)
        }
        child.stdout.on('data', collect)
        child.stderr.on('data', collect)
        child.on('error', (e) => { error = e })
        child.on('close', (status) => resolve({ status, output: Buffer.concat(chunks).toString('utf8'), error }))
      })
      const output = result.output
      if (result.status !== 0 || result.error) {
        if (isPasswordErrorOutput(output, password)) throw new CryptZipError(password ? 'wrong_password' : 'password_required', password ? '密码错误（解压器报告密码不符）' : '压缩包已加密，需要解压密码')
        throw new LauncherError(`7z 解压失败: ${result.error?.message ?? output.slice(-300)}`)
      }
      return output
    }
    const listing = bandizip
      ? await run(['l', '-list:s', '-consolemode:utf8', ...(password ? ['-p:' + password] : []), path])
      : await run(['l', '-slt', '-ba', '-sccUTF-8', '-p' + (password ?? ''), '--', path])
    const blocks = listing.trim().split(/\r?\n\r?\n/)
    let total = 0
    let entries = 0
    for (const block of bandizip ? [] : blocks) {
      const name = /^Path = (.+)$/m.exec(block)?.[1]?.trimEnd()
      if (!name) continue
      entries++
      assertSafeRelPath(name)
      if (/^(Symbolic Link|Hard Link) = /m.test(block) || /^Attributes = .*\bl[rwx-]{9}/m.test(block)) throw new LauncherError(`压缩包包含链接，拒绝解包: ${name}`)
      const size = Number(/^Size = (\d+)$/m.exec(block)?.[1] ?? 0)
      total += size
      if (entries > MAX_ZIP_ENTRIES || total > MAX_ZIP_UNPACKED) throw new LauncherError('压缩包条目数或解包总量超限')
    }
    if (bandizip) {
      const names = listing.split(/\r?\n/).filter((line) => line !== '')
      for (const name of names) assertSafeRelPath(name)
      entries = names.length
      // -list:v 的尺寸/Unix Mode 列固定在行首；名字由 -list:s 单独读取。
      const details = await run(['l', '-list:v', '-consolemode:utf8', ...(password ? ['-p:' + password] : []), path])
      const rows = [...details.matchAll(/^\d{4}-\d{2}-\d{2}[ \t]+\d{2}:\d{2}:\d{2}[ \t]+([A-Za-z_]{4})[ \t]+(\d+)[ \t]+\d+[ \t]+([^\r\n]*)/gm)]
      if (rows.length !== entries) throw new LauncherError('无法识别 Bandizip 文件清单，请配置 7-Zip 解压器')
      for (const row of rows) {
        total += Number(row[2])
        const unixMode = details.includes('Unix Mode') ? /^\S+[ \t]+\S+[ \t]+(\S+)/.exec(row[3]!)?.[1] : undefined
        if (unixMode?.startsWith('l') || row[1]!.includes('L')) throw new LauncherError('压缩包包含链接，拒绝解包')
      }
      if (entries > MAX_ZIP_ENTRIES || total > MAX_ZIP_UNPACKED) throw new LauncherError('压缩包条目数或解包总量超限')
    }
    if (!entries && listing.trim()) throw new LauncherError('无法识别解压器文件清单')
    const extracted = this.createStagingDir()
    try {
      await run(bandizip ? [...buildArchiveArgs('bandizip', path, extracted, password).slice(0, -1), '-consolemode:utf8', path]
        : ['x', '-y', '-sccUTF-8', '-p' + (password ?? ''), '-o' + extracted, '--', path])
      // 不跟随解压产生的符号链接 / junction，避免递归逃逸。
      const walk = (dir: string): void => {
        for (const name of readdirSync(dir)) {
          const target = join(dir, name)
          const st = lstatSync(target)
          if (st.isSymbolicLink()) throw new LauncherError('解压产物包含链接，拒绝安装')
          assertInside(realpathSync(extracted), realpathSync(target))
          if (st.isDirectory()) walk(target)
        }
      }
      walk(extracted)
      const files = this.listFiles(extracted)
      let actual = 0
      for (const file of files) actual += statSync(join(extracted, file)).size
      if (files.length > MAX_ZIP_ENTRIES || actual > MAX_ZIP_UNPACKED) throw new LauncherError('解压产物超限')
      // 与内置 ZIP 一致，去掉唯一的顶层包装目录。
      const flat = stripTopWrapper(files.map((file) => ({ orig: file, safe: file })))
      for (const p of flat) {
        const target = join(destDir, p.safe)
        assertInside(destDir, target)
        mkdirSync(dirname(target), { recursive: true })
        renameSync(join(extracted, p.orig), target)
      }
      return flat.map((p) => p.safe)
    } finally { rmSync(extracted, { recursive: true, force: true }) }
  }

  /** zip → 目录。路径穿越/条目数/总字节三防；单一顶层包装目录自动扁平化；密码包走 crypt-zip 解密。返回写入的相对路径列表。 */
  unzipToDir(bytes: Uint8Array, destDir: string, password?: string): string[] {
    const map = openZipMap(bytes, password)
    const names = [...map.keys()]
      .filter((n) => !n.endsWith('/'))
      .filter((n) => !n.split('/').some((seg) => NOISE_DIRS.has(seg)))
    if (names.length > MAX_ZIP_ENTRIES) throw new LauncherError(`zip 条目数过多: ${names.length}`)
    // 先整体校验（穿越 + 总量），再统一落盘
    const pairs: EntryPair[] = names.map((n) => ({ orig: n, safe: assertSafeRelPath(n) }))
    let total = 0
    for (const p of pairs) {
      total += map.get(p.orig)!.length
      if (total > MAX_ZIP_UNPACKED) throw new LauncherError(`zip 解包总量超限: ${total}`)
    }
    const flat = stripTopWrapper(pairs)
    const written: string[] = []
    for (const p of flat) {
      if (p.safe === '') continue
      const target = join(destDir, ...p.safe.split('/'))
      assertInside(destDir, target)
      const data = map.get(p.orig)!
      mkdirSync(dirname(target), { recursive: true })
      writeBytesSafe(target, data)
      written.push(p.safe)
    }
    return written
  }

  /** 单文件直落（exe/安装包）。返回写入的相对路径。 */
  writeFileToDir(bytes: Uint8Array, destDir: string, fileName: string): string {
    const safe = assertSafeRelPath(fileName)
    const target = join(destDir, ...safe.split('/'))
    assertInside(destDir, target)
    mkdirSync(dirname(target), { recursive: true })
    writeBytesSafe(target, bytes)
    return safe
  }

  // ── 7z（7za/7z.exe 外部解压器）─────────────────────────────────────

  /** 7z 魔数：37 7A BC AF 27 1C。 */
  is7zBytes(bytes: Uint8Array): boolean {
    return bytes.length > 6 && bytes[0] === 0x37 && bytes[1] === 0x7A && bytes[2] === 0xBC
      && bytes[3] === 0xAF && bytes[4] === 0x27 && bytes[5] === 0x1C
  }

  /** 7z 段起点（含「视频垫底 + 7z 追加」复合文件的中部签名）：0=头部，>0=偏移，-1=非 7z。 */
  find7zStart(bytes: Uint8Array): number {
    return find7zOffset(bytes)
  }

  /** zip 识别：扩展名之外，兼容「视频+zip 复合文件」（zip 数据垫在媒体数据后，头部非 PK）。 */
  isZipBytes(bytes: Uint8Array): boolean {
    return (bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4B) || hasZipTrailer(bytes)
  }

  /** 7z/7za.exe 探测链：CONFIG → 插件 bin/ → Program Files。 */
  resolveSevenZip(): string | null {
    const candidates = [
      this.sevenZipPath,
      fileURLToPath(new URL('../../bin/7za.exe', import.meta.url)),
      fileURLToPath(new URL('../bin/7za.exe', import.meta.url)),
      'C:/Program Files/7-Zip/7z.exe',
      'C:/Program Files (x86)/7-Zip/7z.exe',
    ].filter((p) => p !== '')
    for (const p of candidates) {
      try { if (existsSync(p)) return p } catch { /* ignore */ }
    }
    return null
  }

  /** Bandizip bz.exe 探测：标准安装路径（Bandizip 7+ 自带命令行版 bz.exe）。 */
  resolveBandizip(): string | null {
    const candidates = [
      'C:/Program Files/Bandizip/bz.exe',
      'C:/Program Files (x86)/Bandizip/bz.exe',
      join(homedir(), 'AppData/Local/Programs/Bandizip/bz.exe'),
    ]
    for (const p of candidates) {
      try { if (existsSync(p)) return p } catch { /* ignore */ }
    }
    return null
  }

  /**
   * .7z（含加密 7z）解包：依次尝试 7-Zip（7z.exe/7za.exe）→ Bandizip（bz.exe），
   * 谁在用谁。参数风格两家不同：7z 用 `-p<pwd>` / `-o<dir>` 连写；Bandizip 用
   * `-p:<pwd>` / `-o:<dir>` 冒号风格。密码经命令行传递——均无 stdin 密码通道；
   * 本机单用户场景下进程列表短暂可见属可接受妥协（文档已注明）。
   */
  extract7z(bytes: Uint8Array, destDir: string, password?: string, offset = 0): string[] {
    const tools: Array<{ exe: string; kind: '7z' | 'bandizip' }> = []
    const sevenZip = this.resolveSevenZip()
    if (sevenZip !== null) tools.push({ exe: sevenZip, kind: '7z' })
    const bandizip = this.resolveBandizip()
    if (bandizip !== null) tools.push({ exe: bandizip, kind: 'bandizip' })
    // CONFIG 指定路径按可执行文件名判定参数风格（bz.exe → Bandizip 风格）
    if (tools.length === 0 && this.sevenZipPath !== '') {
      const kind = /bz(\.exe)?$/i.test(this.sevenZipPath) ? 'bandizip' : '7z'
      tools.push({ exe: this.sevenZipPath, kind })
    }
    if (tools.length === 0) {
      throw new LauncherError('未找到 7z/7za 或 Bandizip（bz.exe）：请安装 7-Zip 或 Bandizip，或将 7za.exe 放入插件 bin/ 目录（CONFIG.launcherSevenZipPath 可指定路径）')
    }
    mkdirSync(destDir, { recursive: true })
    // 复合文件（视频垫底+7z）：只把 7z 段写成临时包，解压器不认前面的媒体数据
    const tmpArchive = join(destDir, '__archive__.7z')
    writeBytesSafe(tmpArchive, offset > 0 ? bytes.subarray(offset) : bytes)
    try {
      let lastOutput = ''
      for (const tool of tools) {
        const args = buildArchiveArgs(tool.kind, tmpArchive, destDir, password)
        const r = spawnSync(tool.exe, args, { timeout: 10 * 60 * 1000, windowsHide: true })
        if (r.status === 0) return this.listFiles(destDir)
        lastOutput = Buffer.concat([
          Buffer.from(r.stdout ?? Buffer.alloc(0)),
          Buffer.from(r.stderr ?? Buffer.alloc(0)),
        ]).toString('utf-8')
        if (isPasswordErrorOutput(lastOutput, password)) {
          const pwdEmpty = password === undefined || password === ''
          throw new CryptZipError(pwdEmpty ? 'password_required' : 'wrong_password',
            pwdEmpty ? '压缩包已加密，需要解压密码' : '密码错误（解压器报告密码不符）')
        }
        // 输出为空（如 GUI 版被误配）且没产出任何文件 → 换下一个解压器
        if (lastOutput.trim() !== '' && r.error === undefined) break
      }
      throw new LauncherError(`7z 解压失败: ${lastOutput.slice(-300) || '(无输出)'}`)
    } finally {
      try { rmSync(tmpArchive, { force: true }) } catch { /* ignore */ }
    }
  }

  // ── 探测 ───────────────────────────────────────────────────────────

  /** 递归列出 app 目录内全部文件（相对路径，posix 分隔）。 */
  listFiles(dir: string, rel = ''): string[] {
    const out: string[] = []
    let entries: string[]
    try { entries = readdirSync(dir) } catch { return out }
    for (const name of entries) {
      if (NOISE_DIRS.has(name)) continue
      const abs = join(dir, name)
      const relPath = rel === '' ? name : rel + '/' + name
      let st
      try { st = statSync(abs) } catch { continue }
      if (st.isDirectory()) out.push(...this.listFiles(abs, relPath))
      else out.push(relPath)
    }
    return out
  }

  /** 从解包产物中探测可执行入口候选：浅层优先、根目录加分、安装器噪声名降权。首个为默认选中项。 */
  detectEntryCandidates(files: string[]): string[] {
    const exes = files.filter((f) => EXECUTABLE_EXTS.has(extname(f).toLowerCase()))
    const score = (p: string): number => {
      const d = p.split('/').length
      const base = basename(p).toLowerCase()
      let s = 100 - d * 10
      if (d === 1) s += 20
      // 名字带安装器/运行库/卸载语义的强降权
      if (/setup|install|update|dxsetup|vcredist|dotnet|redist/.test(base)) s -= 40
      if (base.startsWith('un')) s -= 30
      return s
    }
    return exes.sort((a, b) => score(b) - score(a))
  }

  /**
   * 嵌套压缩包处理（分享圈常见「视频+zip → 内含 .7z 安装包」的套娃结构）：
   * 解包产物没有可执行入口、且恰好只有一个内层压缩包（.zip/.7z）时，解开它并删除包体，
   * 重新列目录；最多递归 3 层。密码透传给内层（提取码/解压密码复用密码框同值）。
   */
  async settleNested(dir: string, files: string[], password?: string): Promise<string[]> {
    let current = files
    for (let depth = 0; depth < 3; depth++) {
      if (this.detectEntryCandidates(current).length > 0) return current
      const archives = current.filter((f) => /\.(zip|7z)$/i.test(f))
      if (archives.length !== 1) return current
      const inner = archives[0]!
      const innerPath = join(dir, ...inner.split('/'))
      // 先改名到独立暂存再解包，防自嵌套同名文件覆盖输入；全程不读整包。
      const temp = this.createStagingDir()
      const archive = join(temp, 'nested' + extname(inner))
      try {
        renameSync(innerPath, archive)
        await this.unpackFile(archive, dir, inner, password)
      } finally { rmSync(temp, { recursive: true, force: true }) }
      current = this.listFiles(dir)
    }
    return current
  }

  // ── 封装 ───────────────────────────────────────────────────────────

  /** 标题/文件名 → 文件系统安全目录名。
   *  除了剔非法字符，还必须挡掉两个曾经能穿透的坑（2026-09-10 复核确认）：
   *  ① `.` / `..` —— 拼出来就是安装根本身或它的上一级，配合"重装先删旧目录"会删掉别的存储；
   *  ② Windows 保留设备名（CON/PRN/AUX/NUL/COM1..9/LPT1..9）与结尾的点/空格（Windows 会悄悄吃掉，
   *     造成两个名字指向同一目录）。 */
  slugify(text: string): string {
    const s = text.trim().toLowerCase()
      .replace(/[\u0000-\u001f<>:"/\\|?*]+/g, '')
      .replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
      .replace(/[. ]+$/g, '')
    if (s === '' || /^\.+$/.test(s)) return 'app'
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(s)) return s + '-app'
    return s.slice(0, 64)
  }

  /**
   * slug → 安装目录绝对路径，并断言它严格位于安装根之下。
   * **所有**按 slug 拼路径的地方（安装 / 卸载 / 入口 / 预览 / 迁移）都必须走这里，
   * 因为 slug 的来源不止 slugify：installed.json 可能被手改过，旧记录也可能带着历史脏值；
   * 只要有一次 rmSync 作用在越界路径上，代价就是删掉用户别的数据。
   */
  appDir(slug: string): string {
    const safe = assertSafeRelPath(slug)
    const dir = join(this.root, safe)
    assertInside(this.root, dir)
    if (samePath(dir, this.root)) throw new LauncherError(`非法应用目录名（指向安装根自身）: ${slug}`)
    return dir
  }

  /**
   * 建一个安装暂存目录（`<root>/.staging-<随机>`）。
   * 解压、嵌套展开、入口探测全部在这里完成，**全部通过后**才由 commitStaging 替换正式目录——
   * 这样"新包损坏 / 密码错误 / 没有可执行入口"只会清掉暂存，旧应用与它的存档分毫不动。
   */
  createStagingDir(): string {
    mkdirSync(this.root, { recursive: true })
    const dir = join(this.root, '.staging-' + randomBytes(6).toString('hex'))
    mkdirSync(dir, { recursive: true })
    return dir
  }

  /**
   * 暂存目录 → 正式目录的原子替换：旧目录先**改名**为备份，再把暂存目录 rename 就位，
   * 最后尽力删除备份。任何一步失败都回滚（把备份改回来），保证"要么旧的、要么新的"，绝不两者皆无。
   * 备份残留（删不掉，例如被杀软占用）不影响正确性：名字带 `.backup-`，会被列表扫描忽略。
   */
  commitStaging(staging: string, dir: string): void {
    assertInside(this.root, staging)
    assertInside(this.root, dir)
    const backup = dir + '.backup-' + Date.now().toString(36)
    const hadOld = existsSync(dir)
    if (hadOld) renameSync(dir, backup)
    try {
      renameSync(staging, dir)
    } catch (e) {
      if (hadOld) { try { renameSync(backup, dir) } catch { /* 回滚失败：至少不静默 */ } }
      throw e
    }
    if (hadOld) { try { rmSync(backup, { recursive: true, force: true }) } catch { /* 备份残留无害 */ } }
  }

  /** 生成类 WE project.json + 预览图，写 installed.json。返回记录。
   *  `commitTo` 给定时：文件先写在 `dir`（暂存目录），写完后原子替换到 `commitTo`（正式目录），
   *  最后才 upsert 索引 —— 于是"替换失败"时盘上是旧的、索引也没动，不会出现"记录说装了、文件却没了"。 */
  finalize(opts: {
    url: string
    fileName: string
    slug: string
    title: string
    dir: string
    entry: string
    size: number
    sha512: string
    previewBytes?: Uint8Array
    previewMime?: string
    commitTo?: string
  }): InstalledAppRecord {
    assertInside(this.root, opts.dir)
    if (opts.commitTo !== undefined) assertInside(this.root, opts.commitTo)
    const rec: InstalledAppRecord = {
      id: opts.slug,
      title: opts.title,
      slug: opts.slug,
      file: opts.entry,
      preview: 'preview.png',
      sourceUrl: opts.url,
      sourceName: opts.fileName,
      size: opts.size,
      sha512: opts.sha512,
      installedAt: this.now(),
    }
    // 预览：客户端回传 > 服务端兜底卡
    const pvExt = PREVIEW_EXT[opts.previewMime ?? '']
    const pv = opts.previewBytes !== undefined && pvExt !== undefined ? opts.previewBytes : fallbackCardPng(opts.title)
    if (pvExt !== undefined) rec.preview = 'preview.' + pvExt
    writeFileSync(join(opts.dir, rec.preview), pv)
    // project.json：与 WE application 条目同构 + source 溯源段
    const project = {
      title: opts.title,
      type: 'application',
      file: opts.entry,
      preview: rec.preview,
      general: { properties: { schemecolor: { order: 0, text: 'ui_browse_properties_scheme_color', type: 'color', value: '0.5 0.5 0.5' } } },
      source: { url: opts.url, fileName: opts.fileName, size: opts.size, sha512: opts.sha512, installedAt: rec.installedAt },
    }
    writeFileSync(join(opts.dir, 'project.json'), JSON.stringify(project, null, 2) + '\n', 'utf8')
    if (opts.commitTo !== undefined) this.commitStaging(opts.dir, opts.commitTo)
    this.upsert(rec)
    return rec
  }

  /** 多候选时用户选定入口：更新记录 + 重写 project.json 的 file 字段。 */
  setEntry(id: string, file: string): InstalledAppRecord {
    const rec = this.get(id)
    if (rec === undefined) throw new LauncherError(`未安装: ${id}`)
    const dir = this.appDir(rec.slug)
    const target = join(dir, ...file.split('/'))
    if (!existsSync(target)) throw new LauncherError(`入口不存在: ${file}`)
    const updated: InstalledAppRecord = { ...rec, file }
    this.rewriteProject(dir, (p) => { p.file = file })
    this.upsert(updated)
    return updated
  }

  /** 用客户端回传的图片更新预览（按 mime 定扩展名，同步 project.json 与记录）。 */
  writePreview(id: string, bytes: Uint8Array, mime: string): void {
    const rec = this.get(id)
    if (rec === undefined) throw new LauncherError(`未安装: ${id}`)
    const ext = PREVIEW_EXT[mime]
    if (ext === undefined) throw new LauncherError(`不支持的预览类型: ${mime}`)
    const dir = this.appDir(rec.slug)
    const name = 'preview.' + ext
    if (rec.preview !== name) {
      try { rmSync(join(dir, rec.preview), { force: true }) } catch { /* ignore */ }
    }
    writeFileSync(join(dir, name), bytes)
    const updated: InstalledAppRecord = { ...rec, preview: name }
    this.rewriteProject(dir, (p) => { p.preview = name })
    this.upsert(updated)
  }

  /** 局部重写 app 目录下的 project.json（损坏时静默跳过，索引仍更新）。 */
  private rewriteProject(dir: string, mutate: (p: Record<string, unknown>) => void): void {
    const pp = join(dir, 'project.json')
    try {
      const project = JSON.parse(readFileSync(pp, 'utf8')) as Record<string, unknown>
      mutate(project)
      writeFileSync(pp, JSON.stringify(project, null, 2) + '\n', 'utf8')
    } catch { /* project.json 缺失/损坏：保持索引为准 */ }
  }
}

function fileNameFromUrl(url: string, contentDisposition: string | null): string {
  if (contentDisposition !== null && contentDisposition !== '') {
    const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(contentDisposition)
    if (m !== null && m[1] !== undefined && m[1] !== '') {
      try { return decodeURIComponent(m[1]) } catch { return m[1] }
    }
  }
  const path = new URL(url).pathname
  const last = path.slice(path.lastIndexOf('/') + 1)
  try { return decodeURIComponent(last) } catch { return last }
}
