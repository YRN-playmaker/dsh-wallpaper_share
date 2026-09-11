/**
 * 百度网盘（pan.baidu.com）分享链接适配器 —— 自研实现，参考 syhyz1990/baiduyun 等公开项目
 * 解决的问题与端点（事实层面），**未复制任何 AGPL 代码**；契约经真实流量探测（2026-09）。
 *
 * 链接形态：https://pan.baidu.com/s/1<sfid>（可选 ?pwd=提取码）；带提取码的分享会 302 到
 *   /share/init?surl=<sfid>，init 页面（匿名可取）含 share_uk / shareid / csrf / servertime。
 *
 * 端点契约（探测确认，errno 见各分支）：
 *  - GET  /share/wxlist?channel=weixin&version=2.9.6&clienttype=25&web=1&shorturl=<surl>&root=1[&pwd=]
 *         → 文件列表（含 fs_id / server_filename / size）；无提取码 → errno 9019 "need verify"
 *  - POST /share/verify?surl=<surl>&t=<ms>&channel=chunlei&web=1&app_id=250528&clienttype=0
 *         body pwd=<提取码> → errno 0 + Set-Cookie: BDCLND=…（放行内容页/列表）
 *  - 直链 dlink（wxlist 条目自带，或内容页 yunData.sign + /api/download 换取）——
 *         下载需带用户 Cookie（BDUSS…）且 User-Agent: netdisk，否则返回 HTML 而非文件流
 * 登录态由用户在面板粘贴 BDUSS Cookie（与 139 Authorization 同款做法），
 * 存 ~/.dsh/storages/we-sync-baidu-auth.json。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { LauncherError } from './installer.ts'

const HOST = 'https://pan.baidu.com'
const UA_BROWSER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
/** dlink 下载专用 UA：非 netdisk UA 会拿到 302/HTML 而不是文件流 */
export const BAIDU_DOWNLOAD_UA = 'netdisk'

export interface BaiduShareRef { surl: string; pwd?: string }

/** 识别百度网盘分享链接：/s/1<id>（可选 ?pwd=）或 /share/init?surl=<id>。非百度链接返回 null。 */
export function parseBaiduShareUrl(url: string): BaiduShareRef | null {
  const text = url.trim()
  if (!/pan\.baidu\.com\//i.test(text)) return null
  let surl: string | undefined
  let pwd: string | undefined
  const share = /[?&/]s\/1([A-Za-z0-9_-]+)/i.exec(text) ?? /\/s\/1([A-Za-z0-9_-]+)/i.exec(text)
  if (share !== null) surl = share[1]!
  const init = /[?&]surl=1?([A-Za-z0-9_-]+)/i.exec(text)
  if (init !== null) surl = init[1]!
  if (surl === undefined) return null
  const pm = /[?&]pwd=([A-Za-z0-9]+)/i.exec(text)
  if (pm !== null) pwd = pm[1]!
  return { surl, ...(pwd !== undefined ? { pwd } : {}) }
}

export class BaiduError extends LauncherError {
  readonly code: 'share_passcode_required' | 'share_passcode_wrong' | 'share_auth_required' | 'share_api_error' | 'share_not_file'
  constructor(code: BaiduError['code'], msg: string) {
    super(msg)
    this.name = 'BaiduError'
    this.code = code
  }
}

/** errno → 语义。常见：9019=need verify；-12/-9=提取码错；-62/-64/-70=尝试过多/风控。 */
function errnoToError(errno: number, where: string): BaiduError | null {
  if (errno === 0) return null
  if (errno === 9019) return new BaiduError('share_passcode_required', '该百度网盘分享需要提取码（9019 need verify）')
  if (errno === -12 || errno === -9 || errno === -17) return new BaiduError('share_passcode_wrong', `百度提取码错误（errno ${errno}）`)
  if (errno === -62 || errno === -64 || errno === -70) return new BaiduError('share_api_error', `百度风控/尝试过多（errno ${errno}），请稍后再试或换网络`)
  return new BaiduError('share_api_error', `百度 API ${where} errno=${errno}`)
}

/**
 * 登录态归一：接受三种形态 —— ① F12「请求标头」复制的整行 `Cookie: BDUSS=xxx; STOKEN=yyy; …`
 * ② 应用面板复制的裸 BDUSS 值 ③ 油猴助手自动同步的键值对。
 * 现行 BDUSS 为 192 位（2026 实测口径，上限放宽到 300 兼容后续扩位）；
 * 只保留 BDUSS/STOKEN 两键（拦 Kaspersky 注入等杂讯），剥引号与值内折行空白。
 */
export function normalizeBaiduCookie(raw: string): string {
  let s = raw.trim()
  if (s === '') throw new BaiduError('share_auth_required', '百度网盘登录态为空')
  // F12 请求标头复制出来的是整行 Cookie: …——剥掉标签再按对解析
  s = s.replace(/^cookie\s*:\s*/i, '')
  if (s.includes('%')) {
    try {
      const dec = decodeURIComponent(s)
      if (dec !== s) s = dec
    } catch { /* 保留原值 */ }
  }
  // 裸值 → 补键名（剥掉复制时混入的折行空白）；带键名 → 逐对解析
  const pairs = s.includes('=')
    ? s.split(';').map((p) => p.trim()).filter((p) => p !== '')
    : [`BDUSS=${s.replace(/\s+/g, '')}`]
  const kept: string[] = []
  for (const p of pairs) {
    const eq = p.indexOf('=')
    if (eq <= 0) continue
    const k = p.slice(0, eq).trim()
    let v = p.slice(eq + 1).trim()
    if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1) // F12 偶见引号包裹值
    v = v.replace(/\s+/g, '')
    if (k !== 'BDUSS' && k !== 'STOKEN') continue
    if (!/^[A-Za-z0-9~_%-]{10,300}$/.test(v)) continue
    kept.push(`${k}=${v}`)
  }
  if (!kept.some((p) => p.startsWith('BDUSS='))) {
    throw new BaiduError(
      'share_auth_required',
      '不是有效的百度网盘登录态（需要 BDUSS）。任选其一：① 装「百度登录态同步助手」油猴脚本，登录 pan.baidu.com 后自动同步（面板可一键打开）② F12 → 网络 → 刷新 → 点任一 pan.baidu.com 请求 → 请求标头 → 复制整行 Cookie: 粘贴到这里 ③ F12 → 应用 → Cookie → pan.baidu.com → 复制 BDUSS 的值直接粘贴',
    )
  }
  return kept.join('; ')
}

/** 从登录态串里挖 BDUSS 值（掩码展示用）。 */
export function bdussOf(cookie: string): string {
  const m = /BDUSS=([A-Za-z0-9~_-]+)/.exec(normalizeBaiduCookie(cookie))
  return m !== null ? m[1]! : ''
}

// ── 登录态存取（~/.dsh/storages/we-sync-baidu-auth.json；与 139 同款结构）──

export interface CredStore { read(): string; write(v: string): void }

export function baiduFileCredStore(path: string): CredStore {
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

export interface BaiduFetchInit { method?: string; headers?: Record<string, string>; body?: string }
export interface BaiduFetchRes { ok: boolean; status: number; headers: { get(name: string): string | null }; text(): Promise<string> }

export interface BaiduMeta {
  downloadUrl: string
  /** 下载 dlink 必须携带的请求头（UA=netdisk + 用户 Cookie，可能含 BDCLND） */
  headers: Record<string, string>
  fileName?: string
  size?: number
}

interface WxEntry { fsId: string; name: string; size: number; isDir: boolean; dlink?: string }

export class BaiduClient {
  fetchFn: (url: string, init?: BaiduFetchInit) => Promise<BaiduFetchRes>
  /** 登录态来源（每请求实时读）；空 = 未配置（直接报错指引） */
  getAuth: () => string

  constructor(opts: { fetchFn?: BaiduClient['fetchFn']; getAuth?: () => string } = {}) {
    this.fetchFn = opts.fetchFn ?? (async (u, init) => await fetch(u, init))
    this.getAuth = opts.getAuth ?? (() => '')
  }

  private baseHeaders(cookie: string): Record<string, string> {
    return {
      'User-Agent': UA_BROWSER,
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'zh-CN,zh;q=0.9',
      'Referer': HOST + '/',
      ...(cookie !== '' ? { Cookie: cookie } : {}),
    }
  }

  private async getJson(name: string, url: string, cookie: string): Promise<Record<string, unknown>> {
    const res = await this.fetchFn(url, { headers: this.baseHeaders(cookie) })
    const text = await res.text()
    if (!res.ok) throw new BaiduError('share_api_error', `百度 API ${name} HTTP ${res.status}: ${text.slice(0, 160)}`)
    try {
      return JSON.parse(text) as Record<string, unknown>
    } catch {
      throw new BaiduError('share_api_error', `百度 API ${name} 响应非 JSON: ${text.slice(0, 160)}`)
    }
  }

  /** 文件列表。needVerify=true 表示要先过提取码（wxlist errno 9019）。 */
  private async listRoot(surl: string, pwd: string | undefined, cookie: string): Promise<{ needVerify: boolean; files: WxEntry[] }> {
    const qs = new URLSearchParams({
      channel: 'weixin', version: '2.9.6', clienttype: '25', web: '1',
      shorturl: surl, root: '1',
      ...(pwd !== undefined && pwd !== '' ? { pwd } : {}),
    })
    const j = await this.getJson('wxlist', `${HOST}/share/wxlist?${qs.toString()}`, cookie)
    const errno = typeof j.errno === 'number' ? j.errno : Number(j.errno ?? -1)
    if (errno === 9019) return { needVerify: true, files: [] }
    const err = errnoToError(errno, 'wxlist')
    if (err !== null) throw err
    const list = Array.isArray(j.list) ? j.list as Array<Record<string, unknown>> : []
    return {
      needVerify: false,
      files: list.map((e) => ({
        fsId: String(e.fs_id ?? ''),
        name: String(e.server_filename ?? e.file_name ?? e.filename ?? e.name ?? '?'),
        size: typeof e.size === 'number' ? e.size : Number(e.size ?? 0) || 0,
        isDir: e.isdir === 1 || e.isdir === true || e.isdir === '1',
        ...(typeof e.dlink === 'string' && e.dlink !== '' ? { dlink: e.dlink } : {}),
      })),
    }
  }

  /** 提取码验证：成功返回 BDCLND Cookie 值（可能为空串）。 */
  private async verifyPwd(surl: string, pwd: string, cookie: string): Promise<string> {
    const qs = new URLSearchParams({
      surl, t: String(Date.now()), channel: 'chunlei', web: '1', app_id: '250528', clienttype: '0',
    })
    const res = await this.fetchFn(`${HOST}/share/verify?${qs.toString()}`, {
      method: 'POST',
      headers: { ...this.baseHeaders(cookie), 'Content-Type': 'application/x-www-form-urlencoded', Origin: HOST },
      body: 'pwd=' + encodeURIComponent(pwd),
    })
    const text = await res.text()
    let j: Record<string, unknown> = {}
    try { j = JSON.parse(text) as Record<string, unknown> } catch { /* 非 JSON 按失败处理 */ }
    const errno = typeof j.errno === 'number' ? j.errno : Number(j.errno ?? -1)
    // 实测（2026-09，匿名探测）：错误提取码 verify 返回 errno 2（而非老文档的 -12）——
    // 对用户而言 actionable 提示都是「核对提取码」，其余 errno 走通用映射
    if (errno === 2) throw new BaiduError('share_passcode_wrong', '百度提取码错误或验证未通过（errno 2）')
    const err = errnoToError(errno, 'verify')
    if (err !== null) throw err
    // BDCLND 在 Set-Cookie 里；跨域 fetch 下 Node 的 headers.get 只拿得到合并值。
    // 值原样回传（服务端给的是已编码形态，解了再送反而破坏）
    const sc = res.headers.get('set-cookie') ?? ''
    const m = /BDCLND=([^;]+)/.exec(sc)
    return m !== null ? m[1]! : ''
  }

  /**
   * 内容页兜底：wxlist 没给 dlink 时，带 Cookie 开内容页解析 yunData 的 sign/timestamp/shareid/uk
   * 与文件 fs_id，再 POST /api/download 换 dlink。
   */
  private async dlinkViaContentPage(surl: string, fsId: string, cookie: string): Promise<string> {
    const res = await this.fetchFn(`${HOST}/s/1${surl}`, { headers: this.baseHeaders(cookie) })
    const html = await res.text()
    if (!res.ok) {
      throw new BaiduError('share_api_error', `百度内容页拉取失败（HTTP ${res.status}），无法解析下载签名`)
    }
    const pick = (re: RegExp): string => re.exec(html)?.[1] ?? ''
    const sign = pick(/"sign"\s*:\s*"([^"]+)"/) || pick(/sign\s*:\s*'([^']+)'/)
    const timestamp = pick(/"timestamp"\s*:\s*(\d+)/) || pick(/timestamp\s*:\s*'?(\d+)/)
    const shareid = pick(/"shareid"\s*:\s*"?(\d+)/) || pick(/shareid\s*:\s*'?(\d+)/)
    const uk = pick(/"share_uk"\s*:\s*"?(\d+)/) || pick(/"uk"\s*:\s*"?(\d+)/)
    if (sign === '' || timestamp === '' || shareid === '') {
      throw new BaiduError('share_api_error', '内容页缺少下载签名（sign/timestamp/shareid）：登录态可能失效或页面结构变化')
    }
    const qs = new URLSearchParams({
      sign, timestamp, bdstoken: '', channel: 'chunlei', clienttype: '12', web: '1', app_id: '250528',
    })
    if (uk !== '') qs.set('uk', uk)
    if (shareid !== '') qs.set('shareid', shareid)
    const dl = await this.fetchFn(`${HOST}/api/download?${qs.toString()}`, {
      method: 'POST',
      headers: { ...this.baseHeaders(cookie), 'Content-Type': 'application/x-www-form-urlencoded', Origin: HOST },
      body: 'fid_list=' + encodeURIComponent(`[${fsId}]`),
    })
    const text = await dl.text()
    let j: Record<string, unknown> = {}
    try { j = JSON.parse(text) as Record<string, unknown> } catch { /* 按 API 错误处理 */ }
    const errno = typeof j.errno === 'number' ? j.errno : Number(j.errno ?? -1)
    const err = errnoToError(errno, 'download')
    if (err !== null) throw err
    const dlink = typeof j.dlink === 'string' ? j.dlink : ''
    if (dlink === '') throw new BaiduError('share_api_error', `百度下载响应无 dlink: ${text.slice(0, 160)}`)
    return dlink
  }

  /** 分享链接 → dlink + 下载头（提取码即面板提取码框的值；URL ?pwd= 亦可）。 */
  async resolve(shareUrl: string, passcode?: string): Promise<BaiduMeta> {
    const ref = parseBaiduShareUrl(shareUrl)
    if (ref === null) throw new BaiduError('share_api_error', `无法解析百度网盘分享链接: ${shareUrl}`)
    const pwd = passcode !== undefined && passcode !== '' ? passcode : ref.pwd
    const auth = this.getAuth()
    if (auth === '') {
      throw new BaiduError('share_auth_required', '百度网盘下载需要登录态：请在面板「百度网盘登录态」里粘贴 BDUSS Cookie')
    }
    let cookie: string
    try {
      cookie = normalizeBaiduCookie(auth)
    } catch (e) {
      throw new BaiduError('share_auth_required', `已配置的百度登录态无效，请重新粘贴（详情：${(e as Error).message}）`)
    }

    // 1) 列表（wxlist 匿名 + pwd 即可；失败再走 verify → BDCLND）
    let files: WxEntry[]
    let bdclnd = ''
    let listed = await this.listRoot(ref.surl, pwd, cookie)
    if (listed.needVerify) {
      if (pwd === undefined || pwd === '') {
        throw new BaiduError('share_passcode_required', '该百度网盘分享需要提取码：请在提取码框填入后重试')
      }
      bdclnd = await this.verifyPwd(ref.surl, pwd, cookie)
      const withClnd = bdclnd !== '' ? `${cookie}; BDCLND=${bdclnd}` : cookie
      listed = await this.listRoot(ref.surl, undefined, withClnd)
      if (listed.needVerify) throw new BaiduError('share_passcode_wrong', '提取码验证通过但列表仍要求验证（可能登录态失效）')
    }
    files = listed.files

    // 2) 根目录必须是单个文件（文件夹/多文件暂不支持，与 139 适配器同语义）
    if (files.some((f) => f.isDir)) {
      const names = files.filter((f) => f.isDir).map((f) => f.name).slice(0, 5).join(', ')
      throw new BaiduError('share_not_file', `百度分享根目录含文件夹（暂不支持文件夹分享）: ${names}`)
    }
    if (files.length === 0) throw new BaiduError('share_not_file', '百度分享内容为空')
    if (files.length > 1) {
      const names = files.map((f) => f.name).slice(0, 5).join(', ')
      throw new BaiduError('share_not_file', `百度分享根目录不是单个文件（暂不支持多文件分享）: ${names}`)
    }
    const file = files[0]!

    // 3) dlink：wxlist 自带优先；否则内容页签名单兜底
    const downloadUrl = file.dlink !== undefined && file.dlink !== ''
      ? file.dlink
      : await this.dlinkViaContentPage(ref.surl, file.fsId, cookie)
    const dlCookie = bdclnd !== '' ? `${cookie}; BDCLND=${bdclnd}` : cookie
    return {
      downloadUrl,
      headers: { 'User-Agent': BAIDU_DOWNLOAD_UA, Cookie: dlCookie },
      fileName: file.name,
      size: file.size,
    }
  }
}
