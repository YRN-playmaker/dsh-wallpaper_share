/**
 * dsh-wallpaper_share · node half（内部 id / 路由前缀仍为 we-sync）
 * Wallpaper Engine ↔ DSH 壁纸同步（纯显示）：轮询 WE 的 config.json，
 * 通过 HTTP 路由提供当前壁纸状态、预览图与增强模式源文件。
 * 多显示器：跟踪所有条目，默认跟随"最近变化"的一台；客户端可用
 * ?monitor= 参数锁定某台。
 *
 * 无敏感信息。安装目录运行时自动检测（注册表 → 常见 Steam 路径），
 * 检测不到时在下方 CONFIG.wallpaperEngineDir 手动指定。
 */
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Writable } from 'node:stream'
import { SceneAdapter, type SceneTarget } from './scene/SceneAdapter.ts'
import { sceneFingerprint } from './scene/SceneCapabilities.ts'
import { buildSceneModel, type SceneModel } from './scene/SceneModel.ts'
import { parseScenePkg } from './scene/ScenePkg.ts'
import { decodeTex, texMimeOf, texMipToPng } from './scene/SceneTex.ts'

/** 最小化的 Cordis 上下文结构（独立构建不依赖 @deepseek-ai/cordis 的类型包） */
interface CordisCtx {
  get(name: string): unknown
  effect(callback: () => (() => void) | void): void
}

export const inject = ['webServer']

const CONFIG = {
  /** Wallpaper Engine 安装目录；留空 = 自动检测（注册表 HKCU\Software\WallpaperEngine\installPath → 常见 Steam 路径） */
  wallpaperEngineDir: '',
  /** 工作坊内容目录；留空自动推导为 <Steam库>/steamapps/workshop/content/431960 */
  workshopContentDir: '',
  /** 轮询间隔（毫秒） */
  pollIntervalMs: 2000,
  /** 预览图大小上限（字节） */
  previewMaxBytes: 6291456,
  /** 外部 scene renderer 可执行文件；留空 = 使用内置参考 renderer（诊断动画，非真实渲染） */
  sceneRendererPath: '',
  /** Wallpaper Engine engine assets 目录；留空自动推导为 <weDir>/assets */
  wallpaperEngineAssetsDir: '',
  /** scene renderer 输出分辨率（真实 renderer 建议 1920x1080；参考 renderer 会自行 clamp） */
  sceneRenderWidth: 1920,
  sceneRenderHeight: 1080,
  /** scene renderer 目标帧率 */
  sceneRenderFps: 30,
  /** JPEG/WebP 帧质量（0..100） */
  sceneRenderQuality: 80,
  /** scene 渲染模式：'auto'（默认：浏览器子集渲染器为主；显式配置 sceneRendererPath 则 external）| 'browser'（强制浏览器子集渲染器）| 'external'（强制外部 renderer 子进程） */
  sceneRenderMode: 'auto',
  /** 粒子发射率缩放（视觉校准项；WE rate 单位 = 每秒粒子数，默认 1） */
  particleRateScale: 1,
  /** 粒子尺寸缩放（视觉校准项，默认 1） */
  particleSizeScale: 1,
  /** puppet 网格蒙皮渲染（实验：部件按顶点网格渲染；默认关闭，验证后启用） */
  puppetMeshRender: false,
}

interface Req { url?: string; method?: string; headers?: { range?: string } }
interface Res {
  statusCode: number
  setHeader(name: string, value: string): void
  end(body?: unknown): void
}
interface Route { kind: 'exact' | 'prefix'; path: string; handler(req: Req, res: Res): void | Promise<void> }
interface UpgradeRoute { path: string; handler(req: Req, socket: unknown, head: unknown): void | Promise<void> }
interface WebServer { register(route: Route): () => void; registerUpgrade(route: UpgradeRoute): () => void }

interface WallpaperMeta { title: string; type: string; id: string }
interface SceneImage { start: number; end: number; mime: string; width: number; height: number }
interface MonitorInfo { key: string; file: string; title: string; type: string; kind: string; mime: string; sourceFile: string; sceneImage: SceneImage | null }
interface PreviewInfo { bytes: Uint8Array | null; mime: string; kind: string }

export function apply(ctx: CordisCtx): void {
  const webServer = ctx.get('webServer') as unknown as WebServer | undefined
  if (webServer === undefined) return

  const state = {
    version: 0,
    snapshot: null as Record<string, { file: string }> | null,
    latestMonitor: '',
    monitors: [] as MonitorInfo[],
    previews: {} as Record<string, PreviewInfo>,
    lastError: '',
    weDir: '',
  }

  /** Scene renderer 编排器（在 detectWeDir 成功后实例化） */
  let sceneAdapter: SceneAdapter | null = null

  /** SceneModel 缓存（key=指纹；避免每次轮询重新解析 scene.pkg） */
  let sceneModelCache: { fp: string; model: SceneModel | null } | null = null

  const disposers: Array<() => void> = []
  ctx.effect(() => () => { for (const d of disposers) d() })

  function normalize(path: string): string {
    return path.replace(/\\/g, '/')
  }

  function detectWeDir(): string | null {
    if (CONFIG.wallpaperEngineDir.trim() !== '') return normalize(CONFIG.wallpaperEngineDir.trim())
    try {
      const out = execFileSync('reg', ['query', 'HKCU\\Software\\WallpaperEngine', '/v', 'installPath'], {
        encoding: 'utf8', windowsHide: true, timeout: 5000,
      })
      const match = /REG_SZ\s+(.+)/.exec(out)
      if (match !== null) {
        const installPath = match[1]
        if (installPath !== undefined) return normalize(installPath.trim()).replace(/\/wallpaper(64|32)\.exe$/i, '')
      }
    } catch { /* 注册表不可用 */ }
    const defaults = [
      'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine',
      'D:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine',
      'C:/Steam/steamapps/common/wallpaper_engine',
      'D:/Steam/steamapps/common/wallpaper_engine',
    ]
    for (const dir of defaults) {
      if (existsSync(dir + '/wallpaper64.exe')) return dir
    }
    return null
  }

  function resolveWorkshopDir(weDir: string): string {
    if (CONFIG.workshopContentDir.trim() !== '') return normalize(CONFIG.workshopContentDir.trim())
    const idx = weDir.indexOf('/steamapps/common/')
    if (idx >= 0) return weDir.slice(0, idx) + '/steamapps/workshop/content/431960'
    return weDir.replace(/\/common\/[^/]+$/, '') + '/workshop/content/431960'
  }

  function readText(path: string): string {
    return readFileSync(path, 'utf8')
  }

  function readBytes(path: string): Uint8Array {
    const buf = readFileSync(path)
    if (buf.byteLength > CONFIG.previewMaxBytes) throw new Error('preview exceeds ' + CONFIG.previewMaxBytes + ' bytes')
    return new Uint8Array(buf)
  }

  function exists(path: string): boolean {
    return existsSync(path)
  }

  function dirOf(file: string): string {
    const slash = normalize(file)
    const idx = slash.lastIndexOf('/')
    return idx >= 0 ? slash.slice(0, idx) : slash
  }

  /** 读取所有显示器的壁纸条目 + 最近选中的显示器 */
  function readEntries(weDir: string): { entries: Record<string, { file: string }>; last: string } {
    const root = JSON.parse(readText(weDir + '/config.json').replace(/^\uFEFF/, '')) as Record<string, unknown>
    let cfg: Record<string, unknown> | null = null
    for (const key of Object.keys(root)) {
      const value = root[key]
      if (value !== null && typeof value === 'object' && (value as Record<string, unknown>).general !== undefined) {
        cfg = value as Record<string, unknown>
        break
      }
    }
    const general = (cfg?.general ?? {}) as Record<string, unknown>
    const wc = (general.wallpaperconfig ?? {}) as Record<string, unknown>
    const sel = (wc.selectedwallpapers ?? {}) as Record<string, unknown>
    const entries: Record<string, { file: string }> = {}
    for (const key of Object.keys(sel)) {
      if (!key.startsWith('Monitor')) continue
      const value = sel[key]
      if (value === null || typeof value !== 'object') continue
      const file = (value as Record<string, unknown>).file
      if (typeof file === 'string' && file.length > 0) entries[key] = { file }
    }
    const browser = (general.browser ?? {}) as Record<string, unknown>
    const last = typeof browser.lastselectedmonitor === 'string' ? browser.lastselectedmonitor : ''
    return { entries, last }
  }

  /** workshopcache 的 workshopid → {title, type} 映射（一次解析，全体复用） */
  function readCacheMeta(weDir: string): Map<string, { title: string; type: string }> {
    const map = new Map<string, { title: string; type: string }>()
    try {
      const cache = JSON.parse(readText(weDir + '/bin/workshopcache.json')) as {
        wallpapers?: Array<{ workshopid?: unknown; title?: unknown; type?: unknown }>
      }
      for (const w of cache.wallpapers ?? []) {
        if (w.workshopid !== undefined && w.workshopid !== null) {
          map.set(String(w.workshopid), { title: String(w.title ?? ''), type: String(w.type ?? '') })
        }
      }
    } catch { /* 缓存不可用 */ }
    return map
  }

  function resolveMeta(file: string, workshopDir: string, cacheMap: Map<string, { title: string; type: string }>): WallpaperMeta {
    const slash = normalize(file)
    const match = /431960\/(\d+)/.exec(slash)
    const id = (match !== null ? match[1] : '') ?? ''
    let title = ''
    let type = ''
    const cached = id !== '' ? cacheMap.get(id) : undefined
    if (cached !== undefined) { title = cached.title; type = cached.type }
    if (title === '') {
      try {
        const base = id !== '' ? workshopDir + '/' + id : dirOf(slash)
        const project = JSON.parse(readText(base + '/project.json')) as { title?: unknown; type?: unknown }
        if (project !== null && typeof project === 'object') {
          if (project.title !== undefined) title = String(project.title)
          if (type === '' && project.type !== undefined) type = String(project.type)
        }
      } catch { /* project.json 不可用 */ }
    }
    if (title === '') title = id !== '' ? id : slash.slice(slash.lastIndexOf('/') + 1)
    return { title, type, id }
  }

  function probePreview(dir: string): { path: string; mime: string } | null {
    const candidates: Array<[string, string]> = [['preview.jpg', 'image/jpeg'], ['preview.png', 'image/png'], ['preview.gif', 'image/gif']]
    for (const [name, mime] of candidates) {
      const path = dir + '/' + name
      try {
        if (exists(path)) return { path, mime }
      } catch { /* 跳过 */ }
    }
    return null
  }

  /** 按扩展名判断源文件能否被浏览器直接渲染 */
  function sourceKindOf(file: string): { kind: string; mime: string } {
    const lower = normalize(file).toLowerCase()
    if (lower.endsWith('.mp4')) return { kind: 'video', mime: 'video/mp4' }
    if (lower.endsWith('.webm')) return { kind: 'video', mime: 'video/webm' }
    if (lower.endsWith('.mov')) return { kind: 'video', mime: 'video/quicktime' }
    if (lower.endsWith('.avi')) return { kind: 'video', mime: 'video/x-msvideo' }
    if (lower.endsWith('.mkv')) return { kind: 'video', mime: 'video/x-matroska' }
    if (lower.endsWith('.html') || lower.endsWith('.htm')) return { kind: 'web', mime: 'text/html' }
    if (lower.endsWith('.pkg')) return { kind: 'scene', mime: '' }
    if (lower.endsWith('.exe')) return { kind: 'application', mime: '' }
    if (lower.endsWith('.png')) return { kind: 'image', mime: 'image/png' }
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return { kind: 'image', mime: 'image/jpeg' }
    if (lower.endsWith('.gif')) return { kind: 'image', mime: 'image/gif' }
    if (lower.endsWith('.webp')) return { kind: 'image', mime: 'image/webp' }
    return { kind: 'other', mime: '' }
  }

  /** 从 scene.pkg（Wallpaper Engine 私有 PKGV 容器）中扫描最大的一张 JPEG/PNG 纹理。
   *  scene 壁纸的真实画面由 WE 引擎（shader / 粒子 / 纹理）渲染，浏览器无法执行；
   *  这里提取内嵌背景纹理的 mipmap 链中最高清的一张，作为增强模式的近似背景。 */
  function scanPkgImage(file: string): SceneImage | null {
    let buf: Buffer
    try {
      buf = readFileSync(file)
    } catch { return null }
    let best: SceneImage | null = null
    const consider = (start: number, end: number, mime: string, w: number, h: number): void => {
      if (w < 64 || h < 64 || w > 16384 || h > 16384) return
      const area = w * h
      if (best === null || area > best.width * best.height) best = { start, end, mime, width: w, height: h }
    }
    let pos = 0
    while (pos < buf.length - 4) {
      // JPEG SOI（FF D8 FF）
      if (buf[pos] === 0xff && buf[pos + 1] === 0xd8 && buf[pos + 2] === 0xff) {
        let scan = pos + 2
        let w = 0
        let h = 0
        for (let guard = 0; scan < buf.length - 9 && guard < 64; guard++) {
          if (buf[scan] !== 0xff) { scan++; continue }
          const marker = buf[scan + 1]
          if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) { scan += 2; continue }
          const len = buf.readUInt16BE(scan + 2)
          if (len < 2) break
          // SOF0–SOF15（排除 DHT/JPG/DAC）
          if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
            h = buf.readUInt16BE(scan + 5)
            w = buf.readUInt16BE(scan + 7)
            break
          }
          scan += 2 + len
        }
        if (w > 0 && h > 0) {
          const eoi = buf.indexOf(Buffer.from([0xff, 0xd9]), scan)
          const end = eoi >= 0 ? eoi + 1 : buf.length - 1
          consider(pos, end, 'image/jpeg', w, h)
          pos = end
          continue
        }
      }
      // PNG 签名（89 50 4E 47 0D 0A 1A 0A）+ IHDR
      if (buf[pos] === 0x89 && buf[pos + 1] === 0x50 && buf[pos + 2] === 0x4e && buf[pos + 3] === 0x47 && buf.readUInt32BE(pos + 12) === 0x49484452) {
        const w = buf.readUInt32BE(pos + 16)
        const h = buf.readUInt32BE(pos + 20)
        const iend = buf.indexOf(Buffer.from('49454e44ae426082', 'hex'), pos)
        const end = iend >= 0 ? iend + 7 : buf.length - 1
        consider(pos, end, 'image/png', w, h)
        pos = end
        continue
      }
      pos++
    }
    return best
  }

  function mimeOfPath(path: string): string {
    const lower = normalize(path).toLowerCase()
    if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'text/html; charset=utf-8'
    if (lower.endsWith('.css')) return 'text/css; charset=utf-8'
    if (lower.endsWith('.js')) return 'application/javascript; charset=utf-8'
    if (lower.endsWith('.json')) return 'application/json; charset=utf-8'
    if (lower.endsWith('.png')) return 'image/png'
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
    if (lower.endsWith('.gif')) return 'image/gif'
    if (lower.endsWith('.webp')) return 'image/webp'
    if (lower.endsWith('.svg')) return 'image/svg+xml'
    if (lower.endsWith('.woff2')) return 'font/woff2'
    if (lower.endsWith('.woff')) return 'font/woff'
    if (lower.endsWith('.ttf')) return 'font/ttf'
    if (lower.endsWith('.mp4')) return 'video/mp4'
    if (lower.endsWith('.webm')) return 'video/webm'
    if (lower.endsWith('.mp3')) return 'audio/mpeg'
    if (lower.endsWith('.wav')) return 'audio/wav'
    return 'application/octet-stream'
  }

  /** 读取壁纸 project.json 的 general.properties 默认值，构造 WE applyUserProperties 入参 */
  function buildWallpaperProps(dir: string): Record<string, { value: unknown }> {
    try {
      const project = JSON.parse(readText(dir + '/project.json')) as {
        general?: { properties?: Record<string, { value?: unknown }> }
      }
      const props: Record<string, { value: unknown }> = {}
      for (const key of Object.keys(project?.general?.properties ?? {})) {
        const p = project.general?.properties?.[key]
        if (p !== undefined && 'value' in p) props[key] = { value: p.value }
      }
      // modelresolution 会触发 reloadModel 并决定纹理分辨率；8k(8192²/131MB) 在浏览器 WebGL 里常静默失败，
      // 且 8k 是 realcugan 放大产物（atlas 里 size 仍是 2048，UV 不匹配）。自动选最小可用分辨率，2k 最稳。
      if (project?.general?.properties?.modelresolution !== undefined) {
        for (const res of ['2k', '4k', '8k']) {
          if (exists(dir + '/assets/' + res)) {
            props.modelresolution = { value: res }
            break
          }
        }
      }
      if (Object.keys(props).length > 0) return props
    } catch { /* project.json 不可用 */ }
    // 兜底：至少解锁 introAnimation，否则很多 Spine 壁纸的 load() 永远空转
    return { introanimation: { value: true } }
  }

  /** 注入到壁纸页面里的 WE 环境 shim：复刻 WE 默认环境（html/body 铺满黑底 + 主 canvas 全屏），
   *  并等 wallpaperPropertyListener 注册后自动调用 applyUserProperties */
  function wallpaperShim(props: Record<string, { value: unknown }>): string {
    const json = JSON.stringify(props).replace(/</g, '\\u003c')
    // 只对"没有自己定位 canvas"的壁纸（如 Spine 类）接管 canvas 为全屏；W2 这类自带 CSS 的不受影响。
    const fit = 'var c=document.getElementById("canvas");if(c&&getComputedStyle(c).position==="static"){c.style.position="fixed";c.style.top="0";c.style.left="0";c.style.width="100%";c.style.height="100%"}'
    const apply = 'var p=' + json + ';var f=function(){if(window.wallpaperPropertyListener&&typeof window.wallpaperPropertyListener.applyUserProperties==="function"){window.wallpaperPropertyListener.applyUserProperties(p);return true}return false};if(!f()){var n=0;var t=setInterval(function(){n++;if(f()||n>200)clearInterval(t)},50)}'
    return '<style>html,body{width:100%;height:100%;overflow:hidden;background:#000;margin:0;padding:0}</style>'
      + '<script>(function(){' + fit + ';' + apply + '})();<\\/script>'
  }

  /** 伺服 web 壁纸文件；HTML 注入 WE 属性 shim（否则 introAnimation 等属性永远 undefined，渲染被卡住） */
  function serveWebFile(dir: string, target: string, req: Req, res: Res): void {
    const lower = target.toLowerCase()
    if (lower.endsWith('.html') || lower.endsWith('.htm')) {
      try {
        const html = readText(target)
        const shim = wallpaperShim(buildWallpaperProps(dir))
        const injected = html.replace(/<\/body>/i, shim + '</body>')
        const out = injected === html ? html + shim : injected
        res.statusCode = 200
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        res.setHeader('Cache-Control', 'no-store')
        res.end(out)
        return
      } catch { /* 读取失败则回退 serveFile */ }
    }
    serveFile(target, mimeOfPath(target), req, res)
  }

  /** 解析 HTTP Range 头；返回 undefined=无 Range，null=非法范围，否则为闭区间 */
  function parseRange(header: string | undefined, total: number): { start: number; end: number } | null | undefined {
    if (typeof header !== 'string') return undefined
    const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
    if (m === null) return undefined
    const left = m[1] ?? ''
    const right = m[2] ?? ''
    if (left === '' && right === '') return null
    let start: number
    let end: number
    if (left === '') {
      const n = Number(right)
      if (!Number.isFinite(n) || n <= 0) return null
      start = Math.max(0, total - n)
      end = total - 1
    } else {
      start = Number(left)
      if (!Number.isFinite(start) || start < 0 || start >= total) return null
      end = right === '' ? total - 1 : Math.min(Number(right), total - 1)
      if (!Number.isFinite(end) || end < start) return null
    }
    return { start, end }
  }

  /** 流式返回文件（视频等大文件不能整读进内存），支持 HTTP Range 以便视频可 seek/播放 */
  function serveFile(path: string, mime: string, req: Req, res: Res): void {
    let info
    try {
      info = statSync(path)
    } catch {
      res.statusCode = 404
      res.end('not found')
      return
    }
    if (!info.isFile()) {
      res.statusCode = 404
      res.end('not found')
      return
    }
    const total = info.size
    res.setHeader('Accept-Ranges', 'bytes')
    res.setHeader('Content-Type', mime)
    res.setHeader('Cache-Control', 'no-store')
    const range = parseRange(req.headers?.range, total)
    if (range === null) {
      res.statusCode = 416
      res.setHeader('Content-Range', 'bytes */' + total)
      res.end()
      return
    }
    if (range !== undefined) {
      res.statusCode = 206
      res.setHeader('Content-Range', 'bytes ' + range.start + '-' + range.end + '/' + total)
      res.setHeader('Content-Length', String(range.end - range.start + 1))
      const stream = createReadStream(path, { start: range.start, end: range.end })
      stream.on('error', () => { try { res.end() } catch { /* 已关闭 */ } })
      stream.pipe(res as unknown as Writable)
      return
    }
    res.statusCode = 200
    res.setHeader('Content-Length', String(total))
    const stream = createReadStream(path)
    stream.on('error', () => { try { res.end() } catch { /* 已关闭 */ } })
    stream.pipe(res as unknown as Writable)
  }

  /** 流式返回文件的一个字节切片（用于从 scene.pkg 内提取纹理），支持 HTTP Range */
  function serveSlice(path: string, start: number, end: number, mime: string, req: Req, res: Res): void {
    const total = end - start + 1
    res.setHeader('Accept-Ranges', 'bytes')
    res.setHeader('Content-Type', mime)
    res.setHeader('Cache-Control', 'no-store')
    const range = parseRange(req.headers?.range, total)
    if (range === null) {
      res.statusCode = 416
      res.setHeader('Content-Range', 'bytes */' + total)
      res.end()
      return
    }
    if (range !== undefined) {
      res.statusCode = 206
      res.setHeader('Content-Range', 'bytes ' + range.start + '-' + range.end + '/' + total)
      res.setHeader('Content-Length', String(range.end - range.start + 1))
      const stream = createReadStream(path, { start: start + range.start, end: start + range.end })
      stream.on('error', () => { try { res.end() } catch { /* 已关闭 */ } })
      stream.pipe(res as unknown as Writable)
      return
    }
    res.statusCode = 200
    res.setHeader('Content-Length', String(total))
    const stream = createReadStream(path, { start, end })
    stream.on('error', () => { try { res.end() } catch { /* 已关闭 */ } })
    stream.pipe(res as unknown as Writable)
  }

  /** 重建全量显示器信息 + 每台预览缓存；识别"最近变化"的显示器 */
  function refresh(entries: Record<string, { file: string }>, last: string, weDir: string, workshopDir: string): void {
    state.lastError = ''
    const prev = state.snapshot
    state.snapshot = entries

    let changedKey: string | null = null
    for (const key of Object.keys(entries)) {
      const entry = entries[key]
      if (entry === undefined) continue
      const prevEntry = prev === null ? undefined : prev[key]
      if (prevEntry === undefined || prevEntry.file !== entry.file) { changedKey = key; break }
    }
    if (changedKey === null && prev !== null) {
      for (const key of Object.keys(prev)) {
        if (entries[key] === undefined) { changedKey = key; break }
      }
    }
    if (changedKey !== null) state.latestMonitor = changedKey
    if (state.latestMonitor === '' || entries[state.latestMonitor] === undefined) {
      state.latestMonitor = entries[last] !== undefined ? last : (Object.keys(entries)[0] ?? '')
    }

    const cacheMap = readCacheMeta(weDir)
    state.monitors = Object.keys(entries).flatMap((key) => {
      const entry = entries[key]
      if (entry === undefined) return []
      const meta = resolveMeta(entry.file, workshopDir, cacheMap)
      const src = sourceKindOf(entry.file)
      let kind = src.kind
      let mime = src.mime
      let sourceFile = entry.file
      let sceneImage: SceneImage | null = null
      if (kind === 'other') {
        const index = dirOf(entry.file) + '/index.html'
        if (exists(index)) { kind = 'web'; mime = 'text/html'; sourceFile = index }
      }
      if (kind === 'scene') sceneImage = scanPkgImage(entry.file)
      return [{ key, file: entry.file, title: meta.title, type: meta.type, kind, mime, sourceFile, sceneImage }]
    })

    // 每台显示器分别解析预览
    const previews: Record<string, PreviewInfo> = {}
    for (const monitor of state.monitors) {
      let info: PreviewInfo = { bytes: null, mime: '', kind: 'none' }
      if (!/^https?:\/\//i.test(monitor.file)) {
        const preview = probePreview(dirOf(monitor.file))
        if (preview !== null) {
          try {
            info = { bytes: readBytes(preview.path), mime: preview.mime, kind: 'image' }
          } catch (e) {
            state.lastError = String((e as Error).message ?? e)
          }
        }
      } else {
        info = { bytes: null, mime: '', kind: 'web' }
      }
      previews[monitor.key] = info
    }
    state.previews = previews
    state.version += 1
    syncSceneTarget()
  }

  function poll(weDir: string): void {
    if (weDir === '') return
    try {
      const { entries, last } = readEntries(weDir)
      const fingerprint = JSON.stringify(entries)
      if (fingerprint !== JSON.stringify(state.snapshot)) refresh(entries, last, weDir, resolveWorkshopDir(weDir))
    } catch (e) {
      state.lastError = String((e as Error).message ?? e)
    }
  }

  function sendJson(res: Res, body: unknown): void {
    res.statusCode = 200
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    res.end(JSON.stringify(body))
  }

  function monitorFromQuery(req: Req): string {
    const match = /[?&]monitor=([^&]+)/.exec(req.url ?? '')
    if (match === null || match[1] === undefined) return ''
    try { return decodeURIComponent(match[1]) } catch { return '' }
  }

  function effectiveKey(locked: string): string {
    const keys = state.monitors.map((m) => m.key)
    if (keys.includes(locked)) return locked
    if (state.latestMonitor !== '' && keys.includes(state.latestMonitor)) return state.latestMonitor
    return keys[0] ?? ''
  }

  /** 由显示器 key 构造 SceneAdapter 目标（仅 scene 壁纸；非 scene 返回 null） */
  function sceneTargetFor(key: string): SceneTarget | null {
    const monitor = state.monitors.find((m) => m.key === key)
    if (monitor === undefined || monitor.kind !== 'scene') return null
    return { key: monitor.key, file: monitor.file, kind: monitor.kind }
  }

  /** 让 renderer 跟随当前生效的 scene 显示器（在 monitors 重建后调用） */
  function syncSceneTarget(): void {
    if (sceneAdapter === null) return
    sceneAdapter.setTarget(sceneTargetFor(effectiveKey('')))
  }

  /** 汇总某台显示器的 scene renderer 状态（供 /we-sync/state 与 /we-sync/diag） */
  function sceneInfoFor(key: string): Record<string, unknown> | null {
    const monitor = state.monitors.find((m) => m.key === key)
    if (monitor === undefined || monitor.kind !== 'scene') return null
    const cap = sceneAdapter?.getCapabilities() ?? null
    const status = sceneAdapter?.getStatus() ?? null
    const hasPreview = state.previews[key]?.kind === 'image'
    const fallback = sceneAdapter?.getFallback({ kind: 'scene', hasTexture: monitor.sceneImage !== null, hasPreview, renderMode: 'source' }) ?? null
    return {
      live: sceneAdapter?.isRunning() === true,
      available: cap?.available === true,
      version: cap?.version ?? '',
      status,
      texture: monitor.sceneImage !== null,
      fallback: fallback?.level ?? 'generic',
      capabilities: cap,
      mode: resolveSceneMode(),
      model: getSceneModel(key) !== null,
    }
  }

  /** 解析当前 scene 渲染模式：
   *  'external' → 外部 renderer；'browser' → 浏览器子集渲染器；
   *  'auto' → 显式配置了 sceneRendererPath 则 external，否则 browser（浏览器子集渲染器为主路线） */
  function resolveSceneMode(): 'browser' | 'external' {
    if (CONFIG.sceneRenderMode === 'external') return 'external'
    if (CONFIG.sceneRenderMode === 'browser') return 'browser'
    return CONFIG.sceneRendererPath.trim() !== '' ? 'external' : 'browser'
  }

  /** 构建（并缓存）某显示器的 SceneModel；非 scene 或解析失败返回 null */
  function getSceneModel(key: string): SceneModel | null {
    const monitor = state.monitors.find((m) => m.key === key)
    if (monitor === undefined || monitor.kind !== 'scene') return null
    const fp = sceneFingerprint(monitor.file)
    if (sceneModelCache !== null && sceneModelCache.fp === fp) return sceneModelCache.model
    let model: SceneModel | null = null
    try {
      model = buildSceneModel(new Uint8Array(readFileSync(monitor.file)), {
        particleRateScale: CONFIG.particleRateScale,
        particleSizeScale: CONFIG.particleSizeScale,
        puppetMeshRender: CONFIG.puppetMeshRender,
      })
    } catch { model = null }
    sceneModelCache = { fp, model }
    return model
  }

  disposers.push(webServer.register({
    kind: 'exact',
    path: '/we-sync/state',
    handler(req, res) {
      const key = effectiveKey(monitorFromQuery(req))
      const monitor = state.monitors.find((m) => m.key === key)
      const preview = key !== '' ? state.previews[key] : undefined
      sendJson(res, {
        version: state.version,
        kind: preview !== undefined ? preview.kind : 'none',
        hash: monitor !== undefined ? key + '|' + monitor.file : 'none',
        monitor: key,
        latestMonitor: state.latestMonitor,
        monitors: state.monitors.length > 1 ? state.monitors : [],
        wallpaper: monitor !== undefined ? { title: monitor.title, type: monitor.type } : null,
        source: monitor !== undefined
          ? { kind: monitor.kind, mime: monitor.mime, scene: monitor.sceneImage !== null }
          : { kind: '', mime: '', scene: false },
        scene: sceneInfoFor(key),
        webPort,
      })
    },
  }))

  disposers.push(webServer.register({
    kind: 'exact',
    path: '/we-sync/source',
    handler(req, res) {
      const key = effectiveKey(monitorFromQuery(req))
      const monitor = state.monitors.find((m) => m.key === key)
      if (monitor === undefined) {
        res.statusCode = 404
        res.end('no wallpaper')
        return
      }
      if (monitor.kind === 'video' || monitor.kind === 'image') {
        serveFile(monitor.sourceFile, monitor.mime !== '' ? monitor.mime : 'application/octet-stream', req, res)
        return
      }
      if (monitor.kind === 'web') {
        serveFile(monitor.sourceFile, 'text/html; charset=utf-8', req, res)
        return
      }
      res.statusCode = 415
      res.end('source not renderable: ' + monitor.kind)
    },
  }))

  disposers.push(webServer.register({
    kind: 'exact',
    path: '/we-sync/scene',
    handler(req, res) {
      const key = effectiveKey(monitorFromQuery(req))
      const monitor = state.monitors.find((m) => m.key === key)
      if (monitor === undefined || monitor.kind !== 'scene' || monitor.sceneImage === null) {
        res.statusCode = 404
        res.end('no scene image')
        return
      }
      const img = monitor.sceneImage
      serveSlice(monitor.sourceFile, img.start, img.end, img.mime, req, res)
    },
  }))

  disposers.push(webServer.register({
    kind: 'prefix',
    path: '/we-sync/wallpaper',
    handler(req, res) {
      const key = effectiveKey(monitorFromQuery(req))
      const monitor = state.monitors.find((m) => m.key === key)
      if (monitor === undefined || monitor.kind !== 'web') {
        res.statusCode = 404
        res.end('no web wallpaper')
        return
      }
      const dir = normalize(dirOf(monitor.sourceFile))
      const rel = (req.url ?? '').split('?')[0].replace(/^\/we-sync\/wallpaper\//, '')
      const target = normalize(dir + '/' + rel)
      if (!target.startsWith(dir + '/') || target.length <= dir.length + 1) {
        res.statusCode = 403
        res.end('forbidden')
        return
      }
      serveWebFile(dir, target, req, res)
    },
  }))

  disposers.push(webServer.register({
    kind: 'exact',
    path: '/we-sync/diag',
    handler(_req, res) {
      const effKey = effectiveKey('')
      const effMonitor = state.monitors.find((m) => m.key === effKey)
      const adapterTarget = sceneAdapter?.getTarget() ?? null
      const sceneKey = adapterTarget !== null ? adapterTarget.key : effKey
      sendJson(res, {
        version: state.version,
        latestMonitor: state.latestMonitor,
        monitorCount: state.monitors.length,
        monitors: state.monitors.map((m) => ({
          key: m.key,
          file: m.file,
          kind: m.kind,
          sceneImage: m.sceneImage !== null
            ? { width: m.sceneImage.width, height: m.sceneImage.height, mime: m.sceneImage.mime }
            : null,
        })),
        scene: sceneInfoFor(sceneKey),
        sceneTarget: effMonitor !== undefined && effMonitor.kind === 'scene'
          ? { key: effKey, file: effMonitor.file }
          : null,
        sceneAdapterTarget: adapterTarget !== null ? { key: adapterTarget.key, file: adapterTarget.file } : null,
        sceneModel: (() => {
          const m = getSceneModel(sceneKey)
          return m === null ? null : {
            width: m.width,
            height: m.height,
            layers: m.layerCount,
            textures: m.textures.length,
            decodableTextures: m.decodableTextureCount,
          }
        })(),
        sceneMode: resolveSceneMode(),
        lastError: state.lastError,
        weDir: state.weDir,
      })
    },
  }))

  disposers.push(webServer.register({
    kind: 'exact',
    path: '/we-sync/preview',
    handler(req, res) {
      const key = effectiveKey(monitorFromQuery(req))
      const preview = key !== '' ? state.previews[key] : undefined
      if (preview === undefined || preview.bytes === null) {
        res.statusCode = 404
        res.end('no preview: ' + state.lastError)
        return
      }
      res.statusCode = 200
      res.setHeader('Content-Type', preview.mime)
      res.setHeader('Cache-Control', 'no-store')
      res.end(Buffer.from(preview.bytes))
    },
  }))

  /** SceneModel JSON：浏览器子集渲染器（SceneModelRenderer）的数据源。
   *  返回归一化图层树（transform/visible/纹理引用链），并按指纹缓存。 */
  disposers.push(webServer.register({
    kind: 'exact',
    path: '/we-sync/scene/model',
    handler(req, res) {
      const key = effectiveKey(monitorFromQuery(req))
      const model = getSceneModel(key)
      if (model === null) {
        res.statusCode = 404
        res.end('no scene model')
        return
      }
      sendJson(res, model)
    },
  }))

  /** SceneModel 纹理字节：仅提供 pkg 内可解码（jpg/png）条目，防止路径穿越 */
  disposers.push(webServer.register({
    kind: 'exact',
    path: '/we-sync/scene/texture',
    handler(req, res) {
      const key = effectiveKey(monitorFromQuery(req))
      const monitor = state.monitors.find((m) => m.key === key)
      if (monitor === undefined || monitor.kind !== 'scene') {
        res.statusCode = 404
        res.end('no scene wallpaper')
        return
      }
      const match = /[?&]name=([^&]+)/.exec(req.url ?? '')
      if (match === null || match[1] === undefined) {
        res.statusCode = 400
        res.end('missing name')
        return
      }
      let name: string
      try { name = decodeURIComponent(match[1]) } catch { name = '' }
      if (!/\.(tex|png|jpe?g)$/i.test(name)) {
        res.statusCode = 415
        res.end('unsupported texture entry: ' + name)
        return
      }
      try {
        const pkg = parseScenePkg(new Uint8Array(readFileSync(monitor.file)))
        const entry = pkg.entries.find((e) => e.name === name)
        if (entry === undefined) {
          res.statusCode = 404
          res.end('no such texture entry')
          return
        }
        const absStart = pkg.dataStart + entry.offset
        const absEnd = absStart + entry.size
        if (/\.(png|jpe?g)$/i.test(name)) {
          // 直接内嵌的 jpg/png 条目
          const mime = /\.png$/i.test(name) ? 'image/png' : 'image/jpeg'
          serveSlice(monitor.file, absStart, absEnd, mime, req, res)
          return
        }
        // .tex 条目：完整解码（内嵌 PNG/JPEG 或 raw LZ4+DXT → PNG）
        const texBytes = new Uint8Array(readFileSync(monitor.file).subarray(absStart, absEnd))
        const tex = decodeTex(texBytes)
        if (tex !== null && tex.mip0 !== null) {
          // 纹理 Image 内容区域（画布内左上角）——浏览器渲染按此裁剪
          if (tex.imageWidth > 0 && tex.imageHeight > 0) {
            res.setHeader('X-WE-Image-W', String(tex.imageWidth))
            res.setHeader('X-WE-Image-H', String(tex.imageHeight))
          }
          const mime = texMimeOf(tex) ?? 'image/png'
          const isImage = tex.mip0.kind === 'image-png' || tex.mip0.kind === 'image-jpeg'
          if (isImage) {
            // 内嵌图片：按文件区间伺服（支持 Range）
            serveSlice(monitor.file, absStart + tex.mip0.dataOffset, absStart + tex.mip0.dataOffset + tex.mip0.data.length, mime, req, res)
          } else {
            // raw（LZ4 压缩 + DXT1/3/5/RGBA）：解码为 PNG 直接返回
            const png = texMipToPng(tex)
            if (png === null) {
              res.statusCode = 500
              res.end('tex decode failed: ' + name)
              return
            }
            res.statusCode = 200
            res.setHeader('Content-Type', mime)
            res.setHeader('Cache-Control', 'no-store')
            res.end(Buffer.from(png))
          }
          return
        }
        res.statusCode = 415
        res.end('tex decode failed: ' + name)
      } catch {
        res.statusCode = 500
        res.end('pkg read failed')
      }
    },
  }))

  /** 引擎资产纹理（粒子等）：<weDir>/assets/materials/<name>.tex → 解码为 PNG。
   *  name 如 particle/fog/fog1（材质 textures 的相对路径） */
  disposers.push(webServer.register({
    kind: 'exact',
    path: '/we-sync/asset/texture',
    handler(req, res) {
      const match = /[?&]name=([^&]+)/.exec(req.url ?? '')
      if (match === null || match[1] === undefined) {
        res.statusCode = 400
        res.end('missing name')
        return
      }
      let name: string
      try { name = decodeURIComponent(match[1]) } catch { name = '' }
      if (!/^[a-zA-Z0-9_\/\-\.]+$/.test(name) || name.includes('..') || state.weDir === '') {
        res.statusCode = 403
        res.end('forbidden')
        return
      }
      try {
        const bytes = new Uint8Array(readFileSync(state.weDir + '/assets/materials/' + name + '.tex'))
        const tex = decodeTex(bytes)
        const png = tex !== null ? texMipToPng(tex) : null
        if (png === null) {
          res.statusCode = 415
          res.end('asset tex decode failed: ' + name)
          return
        }
        res.statusCode = 200
        res.setHeader('Content-Type', 'image/png')
        res.setHeader('Cache-Control', 'no-store')
        res.end(Buffer.from(png))
      } catch {
        res.statusCode = 404
        res.end('no such asset texture: ' + name)
      }
    },
  }))

  /** scene 帧流 WebSocket：SceneCanvas 连到此路由接收二进制帧。
   *  连接时按 ?monitor= 锁定渲染目标（空 = 跟随生效显示器）。 */
  disposers.push(webServer.registerUpgrade({
    path: '/we-sync/scene/stream',
    handler(req, socket, head) {
      if (sceneAdapter === null) {
        try { (socket as { destroy(): void }).destroy() } catch { /* 忽略 */ }
        return
      }
      const key = monitorFromQuery(req)
      const target = sceneTargetFor(key !== '' ? key : effectiveKey(''))
      if (target !== null) sceneAdapter.setTarget(target)
      sceneAdapter.hub.handleUpgrade(
        req as unknown as import('node:http').IncomingMessage,
        socket as unknown as import('node:stream').Duplex,
        head as unknown as Buffer,
      )
    },
  }))

  /** 壁纸源服务器：把当前 web 壁纸目录作为独立源伺服（127.0.0.1 临时端口）。
   *  Spine/WebGL 类壁纸在 iframe 里需要"自己的同源"才能渲染（贴图不 tainted、
   *  ES module / fetch / import() 全通），且与 DSH 主源（3080）隔离，无安全后门。 */
  let sourceServer: ReturnType<typeof createServer> | null = null
  let webPort = 0
  try {
    sourceServer = createServer((req, res) => {
      const key = effectiveKey(monitorFromQuery(req))
      const monitor = state.monitors.find((m) => m.key === key)
      if (monitor === undefined || monitor.kind !== 'web') {
        res.statusCode = 404
        res.end('no web wallpaper')
        return
      }
      const dir = normalize(dirOf(monitor.sourceFile))
      const rel = (req.url ?? '').split('?')[0].replace(/^\/+/, '')
      const target = normalize(dir + '/' + rel)
      if (!target.startsWith(dir + '/') || target.length <= dir.length + 1) {
        res.statusCode = 403
        res.end('forbidden')
        return
      }
      serveWebFile(dir, target, req as unknown as Req, res as unknown as Res)
    })
    sourceServer.listen(0, '127.0.0.1', () => {
      const addr = sourceServer?.address()
      if (addr !== null && typeof addr === 'object') webPort = (addr as AddressInfo).port
    })
    disposers.push(() => {
      if (sourceServer !== null) {
        try { sourceServer.close() } catch { /* 已关闭 */ }
      }
    })
  } catch { webPort = 0 }

  const detected = detectWeDir()
  if (detected === null) {
    state.lastError = '未找到 Wallpaper Engine 安装目录：请在 dsh-wallpaper_share 包源码的 CONFIG.wallpaperEngineDir 手动指定'
    return
  }
  state.weDir = detected
  sceneAdapter = new SceneAdapter({
    config: {
      sceneRendererPath: CONFIG.sceneRendererPath,
      wallpaperEngineAssetsDir: CONFIG.wallpaperEngineAssetsDir,
      width: CONFIG.sceneRenderWidth,
      height: CONFIG.sceneRenderHeight,
      fps: CONFIG.sceneRenderFps,
      quality: CONFIG.sceneRenderQuality,
    },
    weDir: detected,
    log: (line) => console.log(line),
  })
  disposers.push(() => { sceneAdapter?.dispose(); sceneAdapter = null })
  ctx.effect(() => {
    const timer = setInterval(() => poll(detected), CONFIG.pollIntervalMs)
    poll(detected)
    return () => clearInterval(timer)
  })
}
