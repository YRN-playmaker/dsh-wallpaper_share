/**
 * 应用启动器前端纯逻辑层（client 半，浏览器安全：只用 fetch，零 node 依赖）。
 * 与服务端 src/launcher/routes.ts 的 API 一一对应；全部函数注入 fetch 便于测试。
 *
 * 服务端契约：
 *   GET  /we-sync/launcher/installed   → { installed: InstalledApp[] }
 *   POST /we-sync/launcher/install     JSON{url,title?,integrity?,previewDataUrl?}
 *                                      → { ok, record, candidates } | { error }（422=无入口）
 *   POST /we-sync/launcher/entry       JSON{id,file} → { ok, record }
 *   POST /we-sync/launcher/preview     JSON{id,dataUrl} → { ok }
 *   GET  /we-sync/launcher/uninstall?id= → { ok }
 *   GET  /we-sync/apps/launch?id=      → { launched } | { error }
 */

export interface InstalledApp {
  id: string
  title: string
  slug: string
  file: string
  preview: string
  sourceUrl: string
  sourceName: string
  size: number
  sha512: string
  installedAt: string
}

export interface InstallOutcome {
  ok: boolean
  error?: string
  /** 422 密码/分享语义错误：password_required（包加密未给密码）/ wrong_password（密码错或文件损坏）
   *  / share_passcode_required（139 分享需要提取码）/ share_passcode_wrong（提取码错）
   *  / share_auth_required（139 下载需要登录态）/ share_api_error / share_not_file（139 分享非单文件） */
  code?: 'password_required' | 'wrong_password' | 'share_passcode_required' | 'share_passcode_wrong' | 'share_auth_required' | 'share_api_error' | 'share_not_file'
  /** 422 时服务端返回包内文件样本，供 UI 提示 */
  files?: string[]
  record?: InstalledApp
  /** 除默认入口外的其余候选（UI 可提示用户去面板切换入口） */
  candidates?: string[]
}

export type Fetch = (url: string, init?: { method?: string; body?: string; cache?: 'no-store'; headers?: Record<string, string> }) => Promise<{
  ok: boolean; status: number; json(): Promise<unknown>
}>

const defaultFetch: Fetch = (url, init) => fetch(url, init)

export async function fetchInstalled(fetchFn: Fetch = defaultFetch): Promise<InstalledApp[]> {
  const res = await fetchFn('/we-sync/launcher/installed', { cache: 'no-store' })
  if (!res.ok) return []
  const body = await res.json() as { installed?: InstalledApp[] }
  return Array.isArray(body.installed) ? body.installed : []
}

export async function installApp(
  opts: { url: string; title?: string; /** 压缩包解压密码（含内层嵌套包），与提取码分离 */ password?: string; /** 139 分享提取码；缺省时服务端回落用 password（旧调用兼容） */ passcode?: string; integrity?: string; previewDataUrl?: string },
  fetchFn: Fetch = defaultFetch,
): Promise<InstallOutcome> {
  const res = await fetchFn('/we-sync/launcher/install', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts),
  })
  const body = await res.json().catch(() => ({})) as { error?: string; code?: InstallOutcome['code']; files?: string[]; record?: InstalledApp; candidates?: string[] }
  if (!res.ok) return { ok: false, error: body.error ?? `HTTP ${res.status}`, code: body.code, files: body.files }
  return { ok: true, record: body.record, candidates: body.candidates }
}

export async function uninstallApp(id: string, fetchFn: Fetch = defaultFetch): Promise<{ ok: boolean; error?: string }> {
  const res = await fetchFn('/we-sync/launcher/uninstall?id=' + encodeURIComponent(id), { cache: 'no-store' })
  if (!res.ok) { const b = await res.json().catch(() => ({})) as { error?: string }; return { ok: false, error: b.error ?? `HTTP ${res.status}` } }
  return { ok: true }
}

/** 启动（用户手势触发；服务端 detached spawn）。 */
export async function launchApp(id: string, fetchFn: Fetch = defaultFetch): Promise<{ ok: boolean; error?: string }> {
  const res = await fetchFn('/we-sync/apps/launch?id=' + encodeURIComponent(id), { cache: 'no-store' })
  const body = await res.json().catch(() => ({})) as { error?: string }
  if (!res.ok) return { ok: false, error: body.error ?? `HTTP ${res.status}` }
  return { ok: true }
}

/** 多候选时切换入口。 */
export async function setEntry(id: string, file: string, fetchFn: Fetch = defaultFetch): Promise<{ ok: boolean; error?: string }> {
  const res = await fetchFn('/we-sync/launcher/entry', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, file }),
  })
  const body = await res.json().catch(() => ({})) as { error?: string }
  if (!res.ok) return { ok: false, error: body.error ?? `HTTP ${res.status}` }
  return { ok: true }
}

/** 139 登录态：查询是否已配置（返回掩码账号）与保存。 */
export async function get139Auth(fetchFn: Fetch = defaultFetch): Promise<{ present: boolean; account: string }> {
  const res = await fetchFn('/we-sync/launcher/139auth', { cache: 'no-store' })
  const body = await res.json().catch(() => ({})) as { present?: boolean; account?: string }
  return { present: body.present === true, account: typeof body.account === 'string' ? body.account : '' }
}

export async function set139Auth(authorization: string, fetchFn: Fetch = defaultFetch): Promise<{ ok: boolean; error?: string }> {
  const res = await fetchFn('/we-sync/launcher/139auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ authorization }),
  })
  const body = await res.json().catch(() => ({})) as { error?: string }
  if (!res.ok) return { ok: false, error: body.error ?? `HTTP ${res.status}` }
  return { ok: true }
}

// ── 安装前校验（纯函数）─────────────────────────────────────────────

/** URL 粗校验：仅 http(s)。 */
export const isValidHttpUrl = (text: string): boolean => {
  try {
    const u = new URL(text.trim())
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch { return false }
}

/** 文件大小的人类可读格式（安装确认弹层展示）。 */
export function humanSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KiB', 'MiB', 'GiB']
  let v = bytes
  let i = 0
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  return (i === 0 ? String(v) : v.toFixed(1)) + ' ' + units[i]!
}
