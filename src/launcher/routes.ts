/**
 * launcher 的 HTTP 路由（node 半）：注册到 share 的 WebServer，与 market/routes.ts 同契约。
 * 控制面 API（localhost）：
 *   GET  <base>/installed                 → 已装应用列表
 *   POST <base>/install   JSON{url,title?,password?,integrity?,previewDataUrl?}
 *                                         → 下载→解包（zip 含加密 / 7z 含加密）→探测→封装→入库
 *                                           （422 = 无入口；422 code=password_required/wrong_password）
 *                                           url 为 139 分享页时先经 yun139 适配器换直链
 *   POST <base>/entry     JSON{id,file}   → 多候选时用户选定入口（重写 project.json + 索引）
 *   POST <base>/preview   JSON{id,dataUrl}→ 用客户端 canvas 卡更新预览图
 *   GET  <base>/uninstall?id=<id>         → 卸载（删目录 + 索引）
 * 纯 handler，Node 用 EventEmitter 假 req 可测。
 */
import { existsSync, rmSync, readFileSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { LauncherInstaller, LauncherError, type InstalledAppRecord } from './installer.ts'
import { CryptZipError } from './crypt-zip.ts'
import { parse139ShareUrl, Yun139Client, Yun139Error, normalize139Authorization } from './yun139.ts'
import { HELPER_139_SCRIPT, HELPER_139_URL } from './helper139.ts'
import { integrityOf, verifyIntegrity } from '../market/integrity.ts'

export interface Req { url?: string; method?: string; headers?: Record<string, string | string[] | undefined> }
export interface Res { statusCode: number; setHeader(name: string, v: string): void; end(body?: unknown): void }
export interface Route { kind: 'exact' | 'prefix'; path: string; handler(req: Req, res: Res): void | Promise<void> }

/** 139 分享解析的最小结构（测试注入假实现）。 */
export interface Yun139Resolver {
  resolve(shareUrl: string, passcode?: string): Promise<{ downloadUrl: string; fileName?: string; size?: number }>
}

export interface LauncherRoutesDeps {
  installer: LauncherInstaller
  base?: string // 默认 /we-sync/launcher
  /** 139 分享适配器；缺省 new Yun139Client() */
  yun139?: Yun139Resolver
  /** 139 登录态存储（缺省内存态，不落盘） */
  cred139?: { read(): string; write(v: string): void }
}

const MAX_BODY_BYTES = 4 * 1024 * 1024 // 安装请求体（含 base64 预览卡）上限

interface BodyReq extends Req {
  on(event: string, cb: (chunk: Buffer) => void): unknown
  once?(event: string, cb: () => void): unknown
}

function query(req: Req): URLSearchParams {
  const u = new URL(req.url ?? '/', 'http://localhost')
  return u.searchParams
}

function json(res: Res, code: number, body: unknown): void {
  res.statusCode = code
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}

/** 读取请求体（raw 字节），超限即弃。 */
function readBody(req: Req): Promise<Uint8Array> {
  const stream = req as BodyReq
  if (typeof stream.on !== 'function') return Promise.resolve(new Uint8Array(0))
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    let settled = false
    const done = (fn: () => void): void => { if (!settled) { settled = true; fn() } }
    stream.on('data', (c) => {
      size += c.length
      if (size > MAX_BODY_BYTES) { done(() => reject(new Error(`请求体超过上限 (${Math.round(MAX_BODY_BYTES / 1024)} KiB)`))); return }
      chunks.push(c)
    })
    stream.on('end', () => done(() => resolve(new Uint8Array(Buffer.concat(chunks)))))
    stream.on('error', (e) => done(() => reject(e)))
  })
}

/** dataURL → 字节（仅 data:image/*;base64,）。非法返回 null。 */
export function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; mime: string } | null {
  const m = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl.trim())
  if (m === null) return null
  try {
    const buf = Buffer.from(m[2]!.replace(/\s+/g, ''), 'base64')
    if (buf.length === 0) return null
    return { bytes: new Uint8Array(buf), mime: m[1]! }
  } catch { return null }
}

export function createLauncherRoutes(deps: LauncherRoutesDeps): Route[] {
  const base = deps.base ?? '/we-sync/launcher'
  const installer = deps.installer
  const yun139: Yun139Resolver = deps.yun139 ?? new Yun139Client()
  const cred139 = deps.cred139 ?? { read: () => '', write: () => {} }

  const installed: Route = { kind: 'exact', path: base + '/installed', handler: (_req, res) => {
    json(res, 200, { installed: installer.list() })
  } }

  const install: Route = { kind: 'exact', path: base + '/install', handler: async (req, res) => {
    let body: unknown
    try {
      const raw = await readBody(req)
      body = JSON.parse(new TextDecoder().decode(raw)) as unknown
    } catch (e) { return json(res, 400, { error: `请求体非法: ${(e as Error).message ?? e}` }) }
    const opts = body as { url?: unknown; title?: unknown; password?: unknown; passcode?: unknown; integrity?: unknown; previewDataUrl?: unknown }
    if (typeof opts.url !== 'string' || opts.url.trim() === '') return json(res, 400, { error: '缺 url' })
    const title = typeof opts.title === 'string' && opts.title.trim() !== '' ? opts.title.trim() : undefined
    // 解压密码与 139 提取码分离：密码只用于压缩包解密，提取码只用于分享链接校验。
    // 未显式传 passcode 时回落 password（旧客户端兼容）。两者都只在本次安装内存里使用，不落盘。
    const password = typeof opts.password === 'string' && opts.password !== '' ? opts.password : undefined
    const passcode = typeof opts.passcode === 'string' && opts.passcode !== ''
      ? opts.passcode
      : password
    const integrity = typeof opts.integrity === 'string' && opts.integrity.trim() !== '' ? opts.integrity.trim() : undefined
    let previewBytes: Uint8Array | undefined
    let previewMime: string | undefined
    if (typeof opts.previewDataUrl === 'string' && opts.previewDataUrl !== '') {
      const pv = dataUrlToBytes(opts.previewDataUrl)
      if (pv === null) return json(res, 400, { error: 'previewDataUrl 非法（仅支持 data:image/*;base64）' })
      previewBytes = pv.bytes
      previewMime = pv.mime
    }
    try {
      // 1) 下载（139 分享页链接 → 适配器换直链再下；提取码走 passcode 字段）
      let url = opts.url
      let shareFileName: string | undefined
      if (parse139ShareUrl(url) !== null) {
        try {
          const meta = await yun139.resolve(url, passcode)
          url = meta.downloadUrl
          shareFileName = meta.fileName
        } catch (e) {
          if (e instanceof Yun139Error) {
            return json(res, 422, { error: e.message, code: e.code })
          }
          throw e
        }
      }
      const dl = await installer.download(url)
      const bytes = dl.bytes
      const fileName = shareFileName ?? dl.fileName
      // 2) 可选完整性校验
      if (integrity !== undefined && !verifyIntegrity(bytes, integrity)) {
        return json(res, 400, { error: '完整性校验失败: sha512 不匹配（包被篡改或损坏）' })
      }
      // 3) 落位：同 slug 重装先清旧目录（幂等覆盖）
      //    标题默认取文件名去扩展名（CoolTool.zip → CoolTool）
      const baseName = fileName.replace(/\.(zip|exe|bat|cmd|7z|rar|tar|gz)$/i, '')
      const name = title ?? baseName
      const slug = installer.slugify(name)
      const dir = join(installer.root, slug)
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
      // zip 识别：扩展名 / PK 头魔数 / 尾部 EOCD（视频+zip 复合文件，头部是媒体数据）
      const isZip = /\.zip$/i.test(fileName) || installer.isZipBytes(bytes)
      const is7z = /\.7z$/i.test(fileName) || installer.is7zBytes(bytes)
      let files: string[]
      try {
        if (is7z) {
          files = installer.extract7z(bytes, dir, password)
        } else if (isZip) {
          files = installer.unzipToDir(bytes, dir, password)
        } else {
          const rel = installer.writeFileToDir(bytes, dir, fileName)
          files = [rel]
        }
        // 嵌套包：外层是媒体复合 zip、内层还有 .7z/.zip 安装包 → 逐层解到出现可执行入口
        files = installer.settleNested(dir, files, password)
      } catch (e) {
        if (e instanceof CryptZipError) {
          // 密码语义错误统一 422 + code，客户端据 code 给针对性提示
          try { rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
          return json(res, 422, { error: e.message, code: e.code })
        }
        throw e
      }
      // 4) 入口探测
      const candidates = installer.detectEntryCandidates(files)
      if (candidates.length === 0) {
        try { rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
        return json(res, 422, { error: '包内未找到可执行入口（.exe/.bat/.cmd）', files: files.slice(0, 50) })
      }
      // 5) 封装入库
      const rec = installer.finalize({
        url: opts.url, fileName, slug, title: name, dir, entry: candidates[0]!,
        size: bytes.length, sha512: integrityOf(bytes), previewBytes, previewMime,
      })
      json(res, 200, { ok: true, record: rec, candidates })
    } catch (e) {
      const err = e as Error
      // 安装失败永久落日志（无密码/凭据，只有错误名+消息+栈），供事后诊断——
      // 面板错误条会超时消失，用户常常来不及抄，这里是唯一的完整现场
      try {
        appendFileSync(join(installer.root, '..', 'we-sync-install-errors.log'),
          `[${new Date().toISOString()}] url=${opts.url as string ?? '?'}\n${err.name}: ${err.message}\n${err.stack ?? ''}\n\n`, 'utf8')
      } catch { /* 日志写不进不阻断主流程 */ }
      const msg = e instanceof LauncherError ? e.message : `${err.name}: ${err.message}`
      json(res, e instanceof LauncherError ? 400 : 500, { error: msg })
    }
  } }

  const entry: Route = { kind: 'exact', path: base + '/entry', handler: async (req, res) => {
    let body: unknown
    try {
      const raw = await readBody(req)
      body = JSON.parse(new TextDecoder().decode(raw)) as unknown
    } catch (e) { return json(res, 400, { error: `请求体非法: ${(e as Error).message ?? e}` }) }
    const opts = body as { id?: unknown; file?: unknown }
    if (typeof opts.id !== 'string' || typeof opts.file !== 'string' || opts.file === '') {
      return json(res, 400, { error: '缺 id / file' })
    }
    const rec = installer.get(opts.id)
    if (rec === undefined) return json(res, 404, { error: `未安装: ${opts.id}` })
    const files = installer.listFiles(join(installer.root, rec.slug))
    if (!files.includes(opts.file)) return json(res, 400, { error: `入口不在包内: ${opts.file}` })
    try {
      const updated = installer.setEntry(rec.id, opts.file)
      json(res, 200, { ok: true, record: updated })
    } catch (e) { json(res, 500, { error: String((e as Error).message ?? e) }) }
  } }

  const preview: Route = { kind: 'exact', path: base + '/preview', handler: async (req, res) => {
    let body: unknown
    try {
      const raw = await readBody(req)
      body = JSON.parse(new TextDecoder().decode(raw)) as unknown
    } catch (e) { return json(res, 400, { error: `请求体非法: ${(e as Error).message ?? e}` }) }
    const opts = body as { id?: unknown; dataUrl?: unknown }
    if (typeof opts.id !== 'string' || typeof opts.dataUrl !== 'string') return json(res, 400, { error: '缺 id / dataUrl' })
    const rec = installer.get(opts.id)
    if (rec === undefined) return json(res, 404, { error: `未安装: ${opts.id}` })
    const pv = dataUrlToBytes(opts.dataUrl)
    if (pv === null) return json(res, 400, { error: 'dataUrl 非法（仅支持 data:image/*;base64）' })
    try {
      installer.writePreview(rec.id, pv.bytes, pv.mime)
      json(res, 200, { ok: true })
    } catch (e) { json(res, 500, { error: String((e as Error).message ?? e) }) }
  } }

  const uninstall: Route = { kind: 'exact', path: base + '/uninstall', handler: (req, res) => {
    const id = query(req).get('id')
    if (!id) return json(res, 400, { error: '缺 id' })
    if (!installer.has(id)) return json(res, 404, { error: `未安装: ${id}` })
    installer.remove(id)
    json(res, 200, { ok: true })
  } }

  /** launcher 标签页的缩略图：按 id 取 app 目录内的预览图文件。 */
  const previewFile: Route = { kind: 'exact', path: base + '/preview-file', handler: (req, res) => {
    const id = query(req).get('id')
    if (id === null || id === '') return json(res, 400, { error: '缺 id' })
    const rec = installer.get(id)
    if (rec === undefined) { res.statusCode = 404; res.end(); return }
    const mime = rec.preview.endsWith('.png') ? 'image/png'
      : rec.preview.endsWith('.gif') ? 'image/gif'
        : rec.preview.endsWith('.webp') ? 'image/webp' : 'image/jpeg'
    try {
      const bytes = readFileSync(join(installer.root, rec.slug, rec.preview))
      res.statusCode = 200
      res.setHeader('Content-Type', mime)
      res.end(new Uint8Array(bytes))
    } catch {
      res.statusCode = 404
      res.end()
    }
  } }

  /** 139 登录态：POST {authorization} 保存（空串清除）；GET 查是否已配置（只回布尔与掩码）。 */
  const auth139: Route = { kind: 'exact', path: base + '/139auth', handler: async (req, res) => {
    if (req.method === 'GET') {
      const v = cred139.read()
      const mask = v === '' ? '' : (() => {
        try {
          const s = v.replace(/^basic\s+/i, '')
          const dec = Buffer.from(s, 'base64').toString('utf-8').split(':')
          const acct = dec[1] ?? '?'
          return acct.length > 4 ? acct.slice(0, 3) + '****' + acct.slice(-2) : acct
        } catch { return '已配置' }
      })()
      return json(res, 200, { present: v !== '', account: mask })
    }
    let body: unknown
    try {
      const raw = await readBody(req)
      body = JSON.parse(new TextDecoder().decode(raw)) as unknown
    } catch (e) { return json(res, 400, { error: `请求体非法: ${(e as Error).message ?? e}` }) }
    const opts = body as { authorization?: unknown }
    if (typeof opts.authorization !== 'string') return json(res, 400, { error: '缺 authorization' })
    const v = opts.authorization.trim()
    if (v !== '') {
      // 入库前校验：拒收 URL 等杂讯（如 Kaspersky 注入的同名 authorization cookie）
      try { normalize139Authorization(v) } catch (e) {
        return json(res, 422, { error: `拒绝保存，不是有效的 139 登录态：${(e as Error).message}` })
      }
    }
    cred139.write(v)
    json(res, 200, { ok: true, present: v !== '' })
  } }

  /** 139 登录态同步助手（Tampermonkey 脚本）：浏览器装一次，之后访问 yun.139.com 自动同步登录态到本机。 */
  const helper139: Route = { kind: 'exact', path: HELPER_139_URL, handler: (_req, res) => {
    res.statusCode = 200
    res.setHeader('Content-Type', 'text/javascript; charset=utf-8')
    res.end(HELPER_139_SCRIPT)
  } }

  return [installed, install, entry, preview, uninstall, previewFile, auth139, helper139]
}

/** 供 index.ts 类型引用（避免直接 import installer 内部类型绕路）。 */
export type { InstalledAppRecord }
