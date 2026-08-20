/**
 * dsh-wallpaper_share · browser half（内部 id / 路由前缀仍为 we-sync）
 * 玻璃面板主题覆盖 + 壁纸背景层 + wallpaper_share 会话视图标签页。
 * 与 node half 通过同源 HTTP 路由（/we-sync/state、/we-sync/preview、
 * /we-sync/source、/we-sync/scene）通信，不依赖任何 RPC 基础设施。
 * 多显示器：?monitor= 锁定某台；不传则跟随"最近变化"的一台。
 */
import { WallpaperSharePanel } from './WallpaperSharePanel.tsx'
import { PANEL_CSS } from './panelStyle.ts'
import { SceneCanvas } from './SceneCanvas.ts'
import { SceneModelRenderer } from './SceneModelRenderer.ts'

export const inject = ['slots', 'theme']

export interface WeSyncMonitor {
  key: string
  file: string
  title: string
  type: string
}

export interface WeSyncInfo {
  version: number
  kind: string
  hash: string
  monitor: string
  latestMonitor: string
  monitors: WeSyncMonitor[]
  wallpaper: null | { title: string; type: string }
  /** 当前生效显示器的源文件类型（'video' | 'web' | 'scene' | 'application' | 'image' | 'other' | ''）；
   *  scene 表示增强模式下已从 scene.pkg 提取出可用的内嵌纹理 */
  source: { kind: string; mime: string; scene: boolean }
  /** scene 增强状态：renderer 是否可用/在跑、纹理是否存在、渲染模式、当前 fallback 层（来自 node half） */
  scene: null | {
    live: boolean
    available: boolean
    version: string
    texture: boolean
    fallback: string
    /** 'browser' = 浏览器子集渲染器（SceneModelRenderer）；'external' = 外部 renderer（WS 帧流） */
    mode?: 'browser' | 'external'
    /** 浏览器子集渲染器能否拿到 SceneModel */
    model?: boolean
    status?: { state: string; fps?: number; frameIndex?: number; restarts?: number; lastError?: string }
  }
  /** 壁纸源服务器端口（web 壁纸 iframe 用）；0 = 不可用（回退旧代理） */
  webPort: number
}

export interface WeSyncSettings {
  enabled: boolean
  panelAlpha: number
  blur: number
  shadow: number
  /** 锁定的显示器 key；'' = 自动（跟随最近变化） */
  monitor: string
  /** 专注模式开关 */
  focus: boolean
  /** 当前会话是否有任务在进行（由 sessions 列表快照推导） */
  taskActive: boolean
  /** 渲染模式：'preview' 性能（预览图）| 'source' 增强（壁纸源文件） */
  renderMode: 'preview' | 'source'
  /** 沉浸模式：隐藏对话 chrome（上边栏 + 输入框），并把 web 壁纸 iframe 置顶解锁鼠标交互 */
  immersive: boolean
  /** 是否有待用户授权的请求（黄色状态信号） */
  approvalPending: boolean
}

/** 专注模式：任务进行中 */
export const FOCUS_WORK = { panelAlpha: 30, blur: 15, shadow: 90 }
/** 专注模式：任务全部完成 */
export const FOCUS_IDLE = { panelAlpha: 9, blur: 6, shadow: 40 }

/** 当前生效的视觉参数（专注模式覆盖用户滑块值） */
export function effectiveVisuals(): { panelAlpha: number; blur: number; shadow: number } {
  if (store.settings.focus) return store.settings.taskActive ? FOCUS_WORK : FOCUS_IDLE
  return { panelAlpha: store.settings.panelAlpha, blur: store.settings.blur, shadow: store.settings.shadow }
}

/** 包内单例 store：apply 循环更新，面板组件订阅渲染。 */
export const store = {
  info: null as WeSyncInfo | null,
  settings: { enabled: true, panelAlpha: 72, blur: 6, shadow: 30, monitor: '', focus: false, taskActive: false, renderMode: 'preview', immersive: false, approvalPending: false } as WeSyncSettings,
  listeners: new Set<() => void>(),
  actions: {
    applyTheme: (): void => {},
    applyBackground: (): void => {},
    applyImmersive: (): void => {},
    repoll: (): void => {},
  },
  subscribe(fn: () => void): () => void {
    store.listeners.add(fn)
    return () => { store.listeners.delete(fn) }
  },
  notify(): void {
    for (const fn of store.listeners) fn()
  },
}

interface ThemeService {
  overrideTokens(source: string, tokens: Record<string, { light: string; dark: string }>): () => void
}

interface SlotsService {
  inject(key: string, callback: () => unknown): unknown
  register(registration: unknown, render: unknown): unknown
}

interface SessionsService {
  list: {
    getSnapshot(): { current?: string; byId: Record<string, { running?: boolean; blank?: boolean }> } | null
    subscribe(fn: () => void): () => void
  }
}

interface WorkspacesService {
  startSession(workspaceId?: string): void
}

/** 最小化的 Cordis 上下文结构（独立构建不依赖 @deepseek-ai/cordis 的类型包） */
interface CordisCtx {
  get(name: string): unknown
  effect(callback: () => (() => void) | void): void
}

export function apply(ctx: CordisCtx): void {
  const theme = ctx.get('theme') as unknown as ThemeService | undefined
  const slots = ctx.get('slots') as unknown as SlotsService | undefined
  if (theme === undefined || slots === undefined) return

  const sessions = ctx.get('sessions') as unknown as SessionsService | undefined
  const workspaces = ctx.get('workspaces') as unknown as WorkspacesService | undefined

  const themeService = theme
  const slotsService = slots

  let themeDisposer: (() => void) | null = null
  function applyTheme(): void {
    if (themeDisposer !== null) { themeDisposer(); themeDisposer = null }
    const a = 0.30 + (effectiveVisuals().panelAlpha / 100) * 0.60
    const dark: Record<string, string> = {
      '--dsw-alias-bg-base': 'rgba(15,16,20,' + a.toFixed(3) + ')',
      '--dsw-alias-bg-layer-1': 'rgba(24,26,32,' + (a * 0.95).toFixed(3) + ')',
      '--dsw-alias-bg-layer-2': 'rgba(31,33,40,' + (a * 0.90).toFixed(3) + ')',
      '--dsw-alias-bg-overlay': 'rgba(22,24,29,' + Math.min(a + 0.12, 0.96).toFixed(3) + ')',
      '--dsw-specific-sidebar-fill': 'rgba(13,14,17,' + (a * 0.92).toFixed(3) + ')',
    }
    const light: Record<string, string> = {
      '--dsw-alias-bg-base': 'rgba(246,247,250,' + Math.min(a + 0.10, 0.95).toFixed(3) + ')',
      '--dsw-alias-bg-layer-1': 'rgba(255,255,255,' + (a * 0.95).toFixed(3) + ')',
      '--dsw-alias-bg-layer-2': 'rgba(251,252,253,' + (a * 0.90).toFixed(3) + ')',
      '--dsw-alias-bg-overlay': 'rgba(255,255,255,' + Math.min(a + 0.14, 0.97).toFixed(3) + ')',
      '--dsw-specific-sidebar-fill': 'rgba(238,240,244,' + (a * 0.92).toFixed(3) + ')',
    }
    const tokens: Record<string, { light: string; dark: string }> = {}
    for (const key of Object.keys(dark)) tokens[key] = { light: light[key] ?? '', dark: dark[key] ?? '' }
    themeDisposer = themeService.overrideTokens('we-sync', tokens)
  }

  const styleTag = document.createElement('style')
  styleTag.dataset.plugin = 'dsh-wallpaper_share'
  document.head.appendChild(styleTag)

  const panelStyleTag = document.createElement('style')
  panelStyleTag.dataset.plugin = 'dsh-wallpaper_share'
  panelStyleTag.textContent = PANEL_CSS
  document.head.appendChild(panelStyleTag)

  // 增强模式媒体层：视频或 iframe（性能模式不创建）
  let mediaEl: HTMLVideoElement | HTMLIFrameElement | null = null

  // scene 动态背景层：live canvas（外部 renderer 出帧，mode=external）
  let sceneCanvas: SceneCanvas | null = null
  function stopSceneCanvas(): void {
    if (sceneCanvas !== null) { sceneCanvas.stop(); sceneCanvas = null }
  }

  // scene 浏览器子集渲染器（mode=browser：真实图层树 + transform 合成）
  let sceneModelRenderer: SceneModelRenderer | null = null
  function stopSceneModelRenderer(): void {
    if (sceneModelRenderer !== null) { sceneModelRenderer.stop(); sceneModelRenderer = null }
  }
  function stopSceneLayers(): void {
    stopSceneCanvas()
    stopSceneModelRenderer()
  }

  function setMedia(el: HTMLVideoElement | HTMLIFrameElement | null): void {
    if (mediaEl !== null && mediaEl !== el) {
      if (mediaEl instanceof HTMLVideoElement) mediaEl.pause()
      mediaEl.remove()
    }
    mediaEl = el
    if (el !== null) {
      el.style.position = 'fixed'
      el.style.top = '0'
      el.style.left = '0'
      el.style.width = '100%'
      el.style.height = '100%'
      el.style.zIndex = '-2'
      el.style.pointerEvents = 'none'
      el.style.border = '0'
      document.body.appendChild(el)
    }
  }

  // —— 沉浸模式：隐藏对话 chrome（上边栏 + 输入框），并把 web iframe 置顶解锁鼠标 ——
  const immersiveStyleTag = document.createElement('style')
  immersiveStyleTag.dataset.plugin = 'dsh-wallpaper_share'
  document.head.appendChild(immersiveStyleTag)

  // 球形状态按钮：侧边栏收起时出现在左缘（搜索下方），点击切换沉浸模式，颜色随状态变化
  const orbBtn = document.createElement('button')
  orbBtn.type = 'button'
  orbBtn.title = ''
  orbBtn.style.cssText = 'position:fixed;left:11px;top:232px;width:34px;height:34px;border-radius:50%;border:3px solid rgba(255,255,255,0.4);cursor:pointer;z-index:2147483001;opacity:0;visibility:hidden;background:rgba(15,16,20,0.4);box-shadow:0 2px 8px rgba(0,0,0,0.45);outline:none;transition:opacity 0.25s ease, visibility 0.25s ease, border-color 0.25s ease;'
  document.body.appendChild(orbBtn)

  const STATUS_COLORS = { approval: '#eab308', running: '#3b82f6', idle: '#22c55e' }

  function syncStatus(): void {
    // 优先级：待授权(黄) > 任务进行中(蓝) > 空闲(绿)
    const approval = document.querySelector('[data-approval-key]') !== null
    if (approval !== store.settings.approvalPending) {
      store.settings.approvalPending = approval
      store.notify()
    }
    const color = approval ? STATUS_COLORS.approval : (store.settings.taskActive ? STATUS_COLORS.running : STATUS_COLORS.idle)
    orbBtn.style.borderColor = color
    orbBtn.title = approval ? '等待授权' : (store.settings.taskActive ? '任务进行中' : '空闲')
    // 仅在侧边栏收起时显示球形按钮（opacity/visibility 过渡动画）
    const sidebarCollapsed = document.querySelector('[data-sidebar-collapsed]') !== null
    orbBtn.style.opacity = sidebarCollapsed ? '1' : '0'
    orbBtn.style.visibility = sidebarCollapsed ? 'visible' : 'hidden'
  }

  function applyImmersive(): void {
    const on = store.settings.immersive
    immersiveStyleTag.textContent = on
      ? '[data-phase] > header, [data-composer-seat] { opacity: 0 !important; pointer-events: none !important; transition: opacity 0.3s ease !important; }'
      : ''
    if (mediaEl instanceof HTMLIFrameElement) {
      // 沉浸时置顶，但不遮住侧边栏（左缘 56px rail），保留侧边栏与球形按钮可点
      mediaEl.style.zIndex = on ? '2147483000' : '-2'
      mediaEl.style.pointerEvents = on ? 'auto' : 'none'
      mediaEl.style.left = on ? '56px' : '0'
      mediaEl.style.width = on ? 'calc(100% - 56px)' : '100%'
    }
  }
  orbBtn.addEventListener('click', () => {
    if (!store.settings.immersive) {
      // 进入沉浸前：若当前不是新会话页面，先切到新会话
      const snap = sessions?.list.getSnapshot()
      const id = snap?.current
      const isBlank = id === undefined || (snap != null && snap.byId[id]?.blank === true)
      if (!isBlank && typeof workspaces?.startSession === 'function') {
        workspaces.startSession()
      }
    }
    store.settings.immersive = !store.settings.immersive
    applyImmersive()
    store.notify()
  })
  // 侧边栏收起时，点击其中任意按钮都退出沉浸
  function onDocClick(ev: MouseEvent): void {
    if (!store.settings.immersive) return
    const frame = document.querySelector('[data-sidebar-collapsed]')
    if (frame === null) return
    const sidebarCol = frame.firstElementChild
    if (sidebarCol === null) return
    const target = ev.target
    if (target instanceof Element) {
      const btn = target.closest('button')
      if (btn !== null && sidebarCol.contains(btn)) {
        store.settings.immersive = false
        applyImmersive()
        store.notify()
      }
    }
  }
  document.addEventListener('click', onDocClick, true)
  function onImmersiveKey(ev: KeyboardEvent): void {
    if (ev.key === 'Escape' && store.settings.immersive) { store.settings.immersive = false; applyImmersive(); store.notify() }
  }
  document.addEventListener('keydown', onImmersiveKey)

  // 状态同步：观察审批面板出现/消失 + 侧边栏收起状态，更新球形按钮颜色与显隐
  syncStatus()
  let statusRaf: number | null = null
  const scheduleSync = (): void => {
    if (statusRaf !== null) return
    statusRaf = requestAnimationFrame(() => { statusRaf = null; syncStatus() })
  }
  const statusObserver = new MutationObserver(() => { scheduleSync() })
  statusObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-sidebar-collapsed'] })

  function applyBackground(): void {
    const info = store.info
    const visuals = effectiveVisuals()
    const enabled = store.settings.enabled
    const blurPx = Math.round(visuals.blur)
    const scale = 1 + blurPx / 400
    const shadowAlpha = (visuals.shadow / 100) * 0.60
    const monitorKey = info !== null && info.monitor !== '' ? info.monitor : ''
    const monitorQuery = store.settings.monitor !== '' ? '&monitor=' + encodeURIComponent(store.settings.monitor) : ''
    const rawSourceKind = enabled && info !== null && store.settings.renderMode === 'source' ? info.source.kind : ''
    // scene：renderer 可用 或 已提取纹理 → 走 scene 增强；两者皆无 → 回退预览
    const sceneEnhance = rawSourceKind === 'scene' && info !== null && (info.scene?.available === true || info.source.scene === true)
    const sourceKind = rawSourceKind === 'video' || rawSourceKind === 'web' || rawSourceKind === 'image' || sceneEnhance ? rawSourceKind : ''

    // 增强模式背景：image/scene 走专用路由；性能模式 / 提取失败回退静态预览
    let imgUrl = 'none'
    if (enabled && info !== null) {
      if (sourceKind === 'image') {
        imgUrl = 'url("/we-sync/source?monitor=' + encodeURIComponent(monitorKey) + '&v=' + info.version + '")'
      } else if (sourceKind === 'scene') {
        // 纹理始终垫底（canvas 出帧前 / renderer 失败时可见）；无纹理则垫预览
        imgUrl = info.source.scene
          ? 'url("/we-sync/scene?monitor=' + encodeURIComponent(monitorKey) + '&v=' + info.version + '")'
          : 'url("/we-sync/preview?v=' + info.version + monitorQuery + '")'
      } else if (sourceKind === '' && info.kind === 'image') {
        imgUrl = 'url("/we-sync/preview?v=' + info.version + monitorQuery + '")'
      }
    }

    styleTag.textContent =
      'html { background-color: #0d0e12; }' +
      (imgUrl !== 'none'
        ? 'body::before { content: ""; position: fixed; top: 0; left: 0; right: 0; bottom: 0; z-index: -2; ' +
          'background-image: ' + imgUrl + '; background-size: cover; background-position: center; background-repeat: no-repeat; ' +
          'filter: blur(' + blurPx + 'px); transform: scale(' + scale.toFixed(3) + '); transition: filter 0.12s linear; }'
        : '') +
      'body::after { content: ""; position: fixed; top: 0; left: 0; right: 0; bottom: 0; z-index: -1; ' +
      'background: linear-gradient(rgba(6,8,12,' + shadowAlpha.toFixed(3) + '), rgba(6,8,12,' + (shadowAlpha * 0.85).toFixed(3) + ')); }'

    if (sourceKind === 'scene' && info !== null) {
      const sceneMode = info.scene?.mode === 'external' ? 'external' : 'browser'
      if (sceneMode === 'external' && info.scene?.available === true) {
        // 外部 renderer：live canvas（WS 帧流），出帧覆盖在纹理垫底之上；连接失败自动回退
        if (sceneCanvas === null) sceneCanvas = new SceneCanvas()
        sceneCanvas.applyVisuals(blurPx, scale)
        sceneCanvas.start(monitorKey, info.version)
        stopSceneModelRenderer()
      } else if (sceneMode === 'browser') {
        // 浏览器子集渲染器：真实 scene.json 图层树 + transform 合成（Phase 1 最小切片）
        if (sceneModelRenderer === null) sceneModelRenderer = new SceneModelRenderer()
        sceneModelRenderer.applyVisuals(blurPx, scale)
        sceneModelRenderer.start(monitorKey, info.version)
        stopSceneCanvas()
      } else {
        stopSceneLayers()
      }
      setMedia(null)
    } else if (sourceKind === 'video' && info !== null) {
      let video = mediaEl instanceof HTMLVideoElement ? mediaEl : null
      if (video === null) {
        video = document.createElement('video')
        video.muted = true
        video.loop = true
        video.playsInline = true
        video.autoplay = true
        setMedia(video)
      }
      const src = '/we-sync/source?monitor=' + encodeURIComponent(monitorKey) + '&v=' + info.version
      if (video.src !== location.origin + src) video.src = src
      video.style.filter = 'blur(' + blurPx + 'px)'
      video.style.transform = 'scale(' + scale.toFixed(3) + ')'
      video.style.objectFit = 'cover'
      const p = video.play()
      if (p !== undefined && p !== null) void p.catch(() => { /* 自动播放被浏览器拦截时静默 */ })
    } else if (sourceKind === 'web' && info !== null) {
      let frame = mediaEl instanceof HTMLIFrameElement ? mediaEl : null
      if (frame === null) {
        frame = document.createElement('iframe')
        // 壁纸源服务器提供独立同源：allow-same-origin 指壁纸自己的源（127.0.0.1:webPort），
        // 与 DSH 主源（3080）隔离；WebGL 贴图因此不被 tainted，module/fetch/import 全通
        frame.setAttribute('sandbox', 'allow-scripts allow-same-origin')
        setMedia(frame)
      }
      const src = typeof info.webPort === 'number' && info.webPort > 0
        ? 'http://127.0.0.1:' + info.webPort + '/index.html?monitor=' + encodeURIComponent(monitorKey) + '&v=' + info.version
        : location.origin + '/we-sync/wallpaper/index.html?monitor=' + encodeURIComponent(monitorKey) + '&v=' + info.version
      if (frame.src !== src) frame.src = src
      frame.style.filter = 'blur(' + blurPx + 'px)'
    } else {
      stopSceneLayers()
      setMedia(null)
    }
    applyImmersive()
  }

  let polling = false
  let lastHash = ''
  let lastWebPort = -1
  async function poll(): Promise<void> {
    if (polling) return
    polling = true
    try {
      const monitorQuery = store.settings.monitor !== '' ? '?monitor=' + encodeURIComponent(store.settings.monitor) : ''
      const res = await fetch('/we-sync/state' + monitorQuery, { cache: 'no-store' })
      if (!res.ok) return
      const info = await res.json() as WeSyncInfo
      const changed = typeof info.hash === 'string' && info.hash !== lastHash
      const portChanged = typeof info.webPort === 'number' && info.webPort !== lastWebPort
      store.info = info
      store.notify()
      if (changed || portChanged) {
        lastHash = typeof info.hash === 'string' ? info.hash : lastHash
        lastWebPort = typeof info.webPort === 'number' ? info.webPort : lastWebPort
        applyBackground()
      }
    } catch { /* host 尚未就绪，下轮重试 */ }
    polling = false
  }

  store.actions.applyTheme = applyTheme
  store.actions.applyBackground = applyBackground
  store.actions.applyImmersive = applyImmersive
  store.actions.repoll = () => { lastHash = ''; void poll() }

  ctx.effect(() => () => {
    styleTag.remove()
    panelStyleTag.remove()
    immersiveStyleTag.remove()
    orbBtn.remove()
    statusObserver.disconnect()
    document.removeEventListener('keydown', onImmersiveKey)
    document.removeEventListener('click', onDocClick, true)
    stopSceneLayers()
    setMedia(null)
    if (themeDisposer !== null) { themeDisposer(); themeDisposer = null }
  })

  ctx.effect(() => {
    const timer = setInterval(() => { void poll() }, 2500)
    void poll()
    return () => clearInterval(timer)
  })

  // 任务状态检测：订阅 sessions 列表快照，任意会话（跨工作区）running = 任务进行中
  if (sessions !== undefined) {
    const updateTaskState = (): void => {
      const snapshot = sessions.list.getSnapshot()
      const active = snapshot != null && Object.values(snapshot.byId).some((s) => s.running === true)
      if (active !== store.settings.taskActive) {
        store.settings.taskActive = active
        if (store.settings.focus) { applyTheme(); applyBackground() }
        syncStatus()
        store.notify()
      }
    }
    ctx.effect(() => sessions.list.subscribe(updateTaskState))
    updateTaskState()
  }

  applyTheme()
  applyBackground()

  slotsService.inject('conversation.view', () => slotsService.register(
    { name: 'conversation.view', id: 'wallpaper_share', order: 20, label: 'wallpaper_share' },
    WallpaperSharePanel,
  ))
}
