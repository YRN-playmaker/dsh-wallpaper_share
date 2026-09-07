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
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync, readdirSync, rmSync, openSync, closeSync, writeSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, dirname, extname, basename, normalize as pathNormalize, sep } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { openZipMap, CryptZipError, hasZipTrailer } from './crypt-zip.ts'
import { fallbackCardPng } from './png.ts'

export interface FetchLike {
  ok: boolean
  status: number
  headers: { get(name: string): string | null }
  arrayBuffer(): Promise<ArrayBuffer>
  /** 真实 fetch 才有的流式 body（大文件落盘用；测试假响应可省略） */
  body?: unknown
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

const MAX_DOWNLOAD_BYTES = 4 * 1024 * 1024 * 1024 // 4GiB 硬上限
const MAX_ZIP_ENTRIES = 20000
const MAX_ZIP_UNPACKED = 6 * 1024 * 1024 * 1024 // 6GiB
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
  readonly root: string
  /** 可替换的下载实现（测试注入假响应） */
  fetchFn: (url: string) => Promise<FetchLike>
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
    try { rmSync(join(this.root, rec.slug), { recursive: true, force: true }) } catch { /* 目录已不在 */ }
  }

  // ── 下载 ───────────────────────────────────────────────────────────

  /** 下载直链：仅 http(s)，大小上限双查（Content-Length + 实收）。
   *  已知边界：139 CDN 偶发返回让 Node HTTP 解析器崩溃的头（如 Content-Length 与
   *  Transfer-Encoding 冲突，undici 报 "Parse Error … invalid content-length"，
   *  面板只能看到笼统的「不合法的 length」）。这类错误对同 URL 的重试往往自愈，
   *  故命中特征时自动带 Range 头重试一次；Range（206）响应不含 Content-Length，
   *  解析器不会再踩同一个坑。Range 重试也失败才把真实错误链抛给上层。 */
  async download(url: string): Promise<{ bytes: Uint8Array; fileName: string }> {
    let parsed: URL
    try { parsed = new URL(url) } catch { throw new LauncherError(`URL 非法: ${url}`) }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new LauncherError(`仅支持 http(s) 直链: ${parsed.protocol}`)
    let res: FetchLike
    let lastErrText = ''
    try {
      res = await this.fetchFn(url)
    } catch (e) {
      lastErrText = fetchCauseText(e)
      // HTTP 头解析类错误（invalid content-length 等）：带 Range 头重试一次
      if (isHttpHeaderParseError(lastErrText)) {
        try {
          res = await this.fetchFn(url, { headers: { Range: 'bytes=0-' } })
        } catch (e2) {
          throw new LauncherError(`下载请求失败（含 Range 重试）: ${fetchCauseText(e2)}`)
        }
      } else {
        throw new LauncherError(`下载请求失败: ${lastErrText}`)
      }
    }
    if (!res.ok) throw new LauncherError(`下载失败: HTTP ${res.status}`)
    const cl = res.headers.get('content-length')
    if (cl !== null && cl !== '') {
      const declared = Number(cl)
      if (Number.isFinite(declared) && declared > MAX_DOWNLOAD_BYTES) {
        throw new LauncherError(`文件超过大小上限 (${Math.round(MAX_DOWNLOAD_BYTES / 1048576)} MiB): ${declared}`)
      }
    }
    let buf: ArrayBuffer
    try {
      buf = await res.arrayBuffer()
    } catch (e) {
      throw new LauncherError(`下载中断: ${fetchCauseText(e)}`)
    }
    if (buf.byteLength > MAX_DOWNLOAD_BYTES) {
      throw new LauncherError(`文件超过大小上限 (${Math.round(MAX_DOWNLOAD_BYTES / 1048576)} MiB): ${buf.byteLength}`)
    }
    if (buf.byteLength === 0) throw new LauncherError('下载内容为空')
    const fileName = fileNameFromUrl(url, res.headers.get('content-disposition'))
    return { bytes: new Uint8Array(buf), fileName }
  }

  // ── 解包 / 落盘 ─────────────────────────────────────────────────────

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
  settleNested(dir: string, files: string[], password?: string): string[] {
    let current = files
    for (let depth = 0; depth < 3; depth++) {
      if (this.detectEntryCandidates(current).length > 0) return current
      const archives = current.filter((f) => /\.(zip|7z)$/i.test(f))
      if (archives.length !== 1) return current
      const inner = archives[0]!
      const innerPath = join(dir, ...inner.split('/'))
      let bytes: Uint8Array
      try { bytes = new Uint8Array(readFileSync(innerPath)) } catch { return current }
      // 先删包体再解包：内层若含同名文件（自嵌套），解包直接覆盖而不被随后的删除误伤
      try { rmSync(innerPath, { force: true }) } catch { /* ignore */ }
      if (this.is7zBytes(bytes)) this.extract7z(bytes, dir, password)
      else this.unzipToDir(bytes, dir, password)
      current = this.listFiles(dir)
    }
    return current
  }

  // ── 封装 ───────────────────────────────────────────────────────────

  /** 标题/文件名 → 文件系统安全目录名。 */
  slugify(text: string): string {
    const s = text.trim().toLowerCase()
      .replace(/[\u0000-\u001f<>:"/\\|?*]+/g, '')
      .replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
    return s === '' ? 'app' : s.slice(0, 64)
  }

  /** 生成类 WE project.json + 预览图，写 installed.json。返回记录。 */
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
  }): InstalledAppRecord {
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
    this.upsert(rec)
    return rec
  }

  /** 多候选时用户选定入口：更新记录 + 重写 project.json 的 file 字段。 */
  setEntry(id: string, file: string): InstalledAppRecord {
    const rec = this.get(id)
    if (rec === undefined) throw new LauncherError(`未安装: ${id}`)
    const dir = join(this.root, rec.slug)
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
    const dir = join(this.root, rec.slug)
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
