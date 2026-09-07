/**
 * 中国移动云盘（139）分享链接适配器 v2 —— 契约经真实流量逆向验证（2026-09）。
 *
 * 链接形态：https://yun.139.com/shareweb/#/w/i/<linkID>
 * API 网关：https://share-kd-njs.yun.139.com/yun-share/richlifeApp/devapp/IOutLink/*
 * 传输加密：请求/响应整体 AES-128-CBC（密钥 PVGDwmcvfs1uV3d1，随机 16B IV 前置，
 *           PKCS7，base64；响应可能 gzip）——契约与 Alist/OpenList 139 驱动一致。
 *
 * 实测结论（真实分享链接验证）：
 *  - getOutLinkInfoV6（元数据）：匿名可调，带提取码 passwd 字段；无/错提取码 → resultCode 9188
 *  - dlFromOutLinkV3（原始文件直链）：必须登录态——Authorization: Basic b64("<pre>:<手机号>:<token>")
 *    + account=手机号；无登录态 → 200000401「IP鉴权失败、用户账号鉴权失败」
 * 登录态由用户从浏览器 F12 复制一次，存 ~/.dsh/storages/we-sync-139-auth.json（与 Alist 同款做法）。
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import { readFileSync, writeFileSync } from 'node:fs'
import { LauncherError } from './installer.ts'

const GATEWAY = 'https://share-kd-njs.yun.139.com'
const CRYPTO_KEY = Buffer.from('PVGDwmcvfs1uV3d1', 'utf-8')
const UA = 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0'
const DEVICE_INFO = '||9|12.27.0|firefox|140.0|12b780037221ab547c682223327dc9cd||linux unknow|1920X526|zh-CN|||'

export function parse139ShareUrl(url: string): string | null {
  const m = /yun\.139\.com\/shareweb\/#\/w\/i\/([A-Za-z0-9]+)/.exec(url.trim())
  return m !== null ? m[1]! : null
}

export class Yun139Error extends LauncherError {
  readonly code: 'share_passcode_required' | 'share_passcode_wrong' | 'share_auth_required' | 'share_api_error' | 'share_not_file'
  constructor(code: Yun139Error['code'], msg: string) {
    super(msg)
    this.name = 'Yun139Error'
    this.code = code
  }
}

export interface Yun139Meta {
  downloadUrl: string
  fileName?: string
  size?: number
}

// ── 信封加解密（AES-128-CBC，IV 前置，PKCS7，base64；响应可能 gzip）──────

function envelopeEncrypt(obj: unknown): string {
  const data = Buffer.from(JSON.stringify(obj), 'utf-8')
  const pad = 16 - (data.length % 16)
  const padded = Buffer.concat([data, Buffer.alloc(pad, pad)])
  const iv = randomBytes(16)
  const cipher = createCipheriv('aes-128-cbc', CRYPTO_KEY, iv)
  return Buffer.concat([iv, cipher.update(padded), cipher.final()]).toString('base64')
}

function envelopeDecrypt(b64: string): string {
  const raw = Buffer.from(String(b64).replace(/\s+/g, ''), 'base64')
  if (raw.length <= 16) throw new Yun139Error('share_api_error', '139 响应过短，解密失败')
  const decipher = createDecipheriv('aes-128-cbc', CRYPTO_KEY, raw.subarray(0, 16))
  let out = Buffer.concat([decipher.update(raw.subarray(16)), decipher.final()])
  if (out.length > 2 && out[0] === 0x1f && out[1] === 0x8b) {
    try { out = gunzipSync(out) } catch { /* 非 gzip 按原文 */ }
  }
  // 防御性 PKCS7 剥除（final() 已剥时末字节为 '}' 等可见字符，守卫防误伤）
  const pad = out[out.length - 1]!
  if (pad >= 1 && pad <= 16 && pad < out.length) {
    let valid = true
    for (let i = out.length - pad; i < out.length; i++) { if (out[i] !== pad) { valid = false; break } }
    if (valid) out = out.subarray(0, out.length - pad)
  }
  return out.toString('utf-8')
}

/**
 * 登录态解析：接受「Basic <b64>」/ 裸 b64 / 已解码 "<pre>:<手机号>:<token>" 三种形态。
 * 返回 { header, account }：header 是可直接放进 Authorization 的完整值。
 */
export function normalize139Authorization(raw: string): { header: string; account: string } {
  let s = raw.trim()
  if (s === '') throw new Yun139Error('share_auth_required', '139 登录态为空')
  if (/^basic\s/i.test(s)) s = s.replace(/^basic\s+/i, '')
  // cookie 直传场景可能出现 URL 编码（%20/%3D），先解一层
  if (s.includes('%')) {
    try {
      const urlDecoded = decodeURIComponent(s)
      if (urlDecoded !== s) s = urlDecoded
    } catch { /* 保留原值 */ }
    if (/^basic\s/i.test(s)) s = s.replace(/^basic\s+/i, '')
  }
  let decoded = ''
  try {
    decoded = Buffer.from(s, 'base64').toString('utf-8')
    // 解出来必须形如 xxx:手机号:token，否则说明输入本身就是明文三元组
    if (!/^\w+:[^:]*:.+/.test(decoded)) decoded = s
  } catch { decoded = s }
  // 严格三元组判定（防混入 URL 等杂讯，如 Kaspersky 注入的同名 cookie）
  const splits = decoded.split(':')
  const ok = splits.length === 3
    && /^\w{1,32}$/.test(splits[0]!)
    && splits[1]!.length >= 4
    && /^[\d@.a-zA-Z_-]+$/.test(splits[1]!)
    && splits[2]!.length > 0
  if (!ok) {
    throw new Yun139Error('share_auth_required', '不是有效的 139 登录态（应形如 Basic b64("basic:手机号:token")）')
  }
  const header = 'Basic ' + Buffer.from(decoded, 'utf-8').toString('base64')
  return { header, account: splits[1]! }
}

// ── 登录态存取（~/.dsh/storages/we-sync-139-auth.json）──────────────────

export interface CredStore { read(): string; write(v: string): void }

export function fileCredStore(path: string): CredStore {
  return {
    read(): string {
      try {
        const j = JSON.parse(readFileSync(path, 'utf8')) as { authorization?: string }
        return typeof j.authorization === 'string' ? j.authorization : ''
      } catch { return '' }
    },
    write(v: string): void {
      writeFileSync(path, JSON.stringify({ authorization: v }, null, 2), 'utf8')
    },
  }
}

// ── 客户端 ─────────────────────────────────────────────────────────────

export interface Yun139FetchInit { method: string; headers: Record<string, string>; body: string }
interface ApiBody { [k: string]: unknown }

export class Yun139Client {
  fetchFn: (url: string, init?: Yun139FetchInit) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>
  /** 登录态来源（每请求实时读，改完即生效）；空 = 匿名（只能解析元数据） */
  getAuth: () => string

  constructor(opts: { fetchFn?: Yun139Client['fetchFn']; getAuth?: () => string } = {}) {
    this.fetchFn = opts.fetchFn ?? (async (u, init) => await fetch(u, init))
    this.getAuth = opts.getAuth ?? (() => '')
  }

  private headers(auth?: string): Record<string, string> {
    return {
      'User-Agent': UA,
      'Accept': 'application/json, text/plain, */*',
      'Content-Type': 'application/json;charset=UTF-8',
      'X-Deviceinfo': DEVICE_INFO,
      'hcy-cool-flag': '1',
      'CMS-DEVICE': 'default',
      'x-m4c-caller': 'PC',
      'X-Yun-Api-Version': 'v1',
      'Origin': 'https://yun.139.com',
      'Referer': 'https://yun.139.com/',
      ...(auth !== undefined ? { Authorization: auth } : {}),
    }
  }

  /** 加密 POST → 解密响应 → 业务码校验。失败错误信息带 resultCode/desc 原文。 */
  private async post(path: string, body: ApiBody, auth?: string): Promise<Record<string, unknown>> {
    const res = await this.fetchFn(GATEWAY + path, { method: 'POST', headers: this.headers(auth), body: envelopeEncrypt(body) })
    const text = await res.text()
    if (!res.ok) throw new Yun139Error('share_api_error', `139 API ${path} HTTP ${res.status}: ${text.slice(0, 200)}`)
    let plain: string
    try { plain = envelopeDecrypt(text) } catch {
      throw new Yun139Error('share_api_error', `139 API ${path} 响应解密失败: ${text.slice(0, 160)}`)
    }
    let parsed: { resultCode?: unknown; desc?: unknown; data?: unknown }
    try { parsed = JSON.parse(plain) } catch {
      throw new Yun139Error('share_api_error', `139 API ${path} 解密后非 JSON: ${plain.slice(0, 160)}`)
    }
    const code = typeof parsed.resultCode === 'string' ? parsed.resultCode : String(parsed.resultCode ?? '')
    if (code !== '0') {
      const desc = typeof parsed.desc === 'string' ? parsed.desc : ''
      if (code === '9188') throw new Yun139Error('share_passcode_wrong', `提取码错误（9188 ${desc}）`)
      if (code === '200000401') throw new Yun139Error('share_auth_required', `需要 139 登录态（200000401 ${desc}）`)
      throw new Yun139Error('share_api_error', `139 API ${path} code=${code}: ${desc || plain.slice(0, 160)}`)
    }
    return (parsed.data !== null && typeof parsed.data === 'object' ? parsed.data : {}) as Record<string, unknown>
  }

  /** 元数据（匿名 + 提取码）。返回文件条目列表（含文件夹）。 */
  async listOutLink(linkID: string, passwd?: string): Promise<{ folders: Array<{ id: string; name: string }>; files: Array<{ id: string; name: string; size: number }> }> {
    const data = await this.post('/yun-share/richlifeApp/devapp/IOutLink/getOutLinkInfoV6', {
      getOutLinkInfoReq: { account: '', linkID, pCaID: 'root', ...(passwd !== undefined && passwd !== '' ? { passwd } : {}) },
    })
    const ca = Array.isArray(data.caLst) ? data.caLst as Array<Record<string, unknown>> : []
    const co = Array.isArray(data.coLst) ? data.coLst as Array<Record<string, unknown>> : []
    return {
      folders: ca.filter((x) => typeof x.caID === 'string').map((x) => ({ id: String(x.caID), name: String(x.caName ?? '?') })),
      files: co.filter((x) => typeof x.coID === 'string').map((x) => ({
        id: String(x.coID),
        name: String(x.coName ?? '?'),
        size: typeof x.coSize === 'number' ? x.coSize : 0,
      })),
    }
  }

  /** 原始文件下载直链（必须登录态）。 */
  async getDownloadUrl(linkID: string, coID: string): Promise<string> {
    const auth = this.getAuth()
    if (auth === '') {
      throw new Yun139Error('share_auth_required', '139 原始文件下载需要登录态：请在面板「139 登录态」里粘贴 Authorization，或安装登录态同步助手（打开 yun.139.com 自动同步）')
    }
    let norm: { header: string; account: string }
    try {
      norm = normalize139Authorization(auth)
    } catch (e) {
      // 已配置但格式无效（例如被 Kaspersky 同名 cookie 污染）→ 给出针对性指引
      throw new Yun139Error('share_auth_required', `已配置的 139 登录态无效，请重装/更新登录态同步助手后打开 yun.139.com 重新同步（详情：${(e as Error).message}）`)
    }
    let data: Record<string, unknown>
    try {
      data = await this.post('/yun-share/richlifeApp/devapp/IOutLink/dlFromOutLinkV3', {
        dlFromOutLinkReqV3: {
          linkID,
          account: norm.account,
          coIDLst: { item: [coID] },
        },
      }, norm.header)
    } catch (e) {
      if (e instanceof Yun139Error && e.code === 'share_auth_required') {
        throw new Yun139Error('share_auth_required', '已配置的 139 登录态被服务端拒绝（可能已过期）：重新登录 yun.139.com 后助手会自动同步，或在面板手动重新粘贴')
      }
      throw e
    }
    const ext = (data.extInfo !== null && typeof data.extInfo === 'object' ? data.extInfo : {}) as Record<string, unknown>
    const url = typeof data.downloadURL === 'string' && data.downloadURL !== '' ? data.downloadURL
      : typeof data.redrUrl === 'string' && data.redrUrl !== '' ? data.redrUrl
        : typeof ext.cdnDownloadUrl === 'string' && ext.cdnDownloadUrl !== '' ? ext.cdnDownloadUrl : ''
    if (url === '') throw new Yun139Error('share_api_error', `139 下载响应无直链: ${JSON.stringify(data).slice(0, 200)}`)
    return url
  }

  /** 分享链接 → 直链 + 元数据（提取码即用户在密码框输入的值）。 */
  async resolve(shareUrl: string, passcode?: string): Promise<Yun139Meta> {
    const linkID = parse139ShareUrl(shareUrl)
    if (linkID === null) throw new Yun139Error('share_api_error', `无法解析 139 分享链接: ${shareUrl}`)
    let entries: Awaited<ReturnType<typeof this.listOutLink>>
    try {
      entries = await this.listOutLink(linkID, passcode)
    } catch (e) {
      if (e instanceof Yun139Error && e.code === 'share_passcode_wrong' && (passcode === undefined || passcode === '')) {
        throw new Yun139Error('share_passcode_required', '该分享需要提取码：请在密码框填入提取码重试')
      }
      throw e
    }
    if (entries.folders.length > 0 || entries.files.length > 1) {
      const names = [...entries.folders.map((f) => f.name), ...entries.files.map((f) => f.name)].slice(0, 5).join(', ')
      throw new Yun139Error('share_not_file', `139 分享根目录不是单个文件（暂不支持文件夹分享）: ${names}`)
    }
    if (entries.files.length === 0) throw new Yun139Error('share_not_file', '139 分享内容为空')
    const file = entries.files[0]!
    const downloadUrl = await this.getDownloadUrl(linkID, file.id)
    return { downloadUrl, fileName: file.name, size: file.size }
  }
}
