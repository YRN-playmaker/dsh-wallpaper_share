import { EditorInstaller } from './installer.ts'
interface Req { method?: string; headers?: { range?: string; origin?: string; host?: string; 'x-wallpaper-editor'?: string; 'sec-fetch-site'?: string } }
interface Res { statusCode: number; setHeader(name: string, value: string): void; end(body?: unknown): void }
export function createEditorRoutes(installer: EditorInstaller) {
  const json = (res: Res, code: number, data: unknown) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(data)) }
  return [{ kind: 'exact' as const, path: '/we-sync/editor', async handler(req: Req, res: Res) {
    try {
      if (req.method === 'GET') return json(res, 200, await installer.status())
      if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return json(res, 405, { error: 'Method not allowed' }) }
      const h = req.headers ?? {}
      let sameOrigin = false
      try { sameOrigin = !!h.origin && new URL(h.origin).host === h.host } catch {}
      if (!sameOrigin || h['x-wallpaper-editor'] !== 'install' || (h['sec-fetch-site'] && h['sec-fetch-site'] !== 'same-origin')) return json(res, 403, { error: '请在 share 页面中安装编辑器。' })
      await installer.install()
      return json(res, 200, await installer.status())
    } catch (e) { return json(res, 500, { error: e instanceof Error ? e.message : '编辑器获取失败，请重试。' }) }
  } }, { kind: 'exact' as const, path: '/we-sync/editor/app', async handler(req: Req, res: Res) {
    if (req.method !== 'GET') { res.statusCode = 405; res.end(); return }
    try {
      const bytes = await installer.content()
      if (!bytes) { res.statusCode = 404; res.end('请先获取壁纸编辑器。'); return }
      res.statusCode = 200
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.setHeader('Cache-Control', 'no-cache')
      res.setHeader('X-Content-Type-Options', 'nosniff')
      res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src blob: data:; media-src blob: data:; connect-src 'self' blob:; font-src data:; frame-ancestors 'self'")
      res.end(bytes)
    } catch { res.statusCode = 500; res.end('编辑器读取失败，请重试。') }
  } }]
}
