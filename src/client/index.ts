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
import { getGaze } from './GazeLens.ts'

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
  /** 渲染模式（三档）：'eco' 节能（静态预览图）| 'perf' 性能（捕获 WE 桌面背景，WE 未开则回退增强）| 'enhanced' 增强（浏览器解 pkg 渲染，不依赖 WE） */
  renderMode: 'eco' | 'perf' | 'enhanced'
  /** 眼动追踪：开启后专注透镜跟随视线（getGaze），无脸 / 陈旧自动回落鼠标 */
  gazeEnabled: boolean
  /** 透镜圆心模式：true=圆心清晰、圆外模糊（阅读窗）；false=圆心模糊、圆外清晰（模糊圆盘）。可切换 */
  lensCenterClear: boolean
  /** 文字吸附：眼动时把注视点磁吸到最近文字块中心，抑制消费级眼动的抖动 */
  gazeSnapText: boolean
  /** 沉浸模式：隐藏对话 chrome（上边栏 + 输入框），并把 web 壁纸 iframe 置顶解锁鼠标交互 */
  immersive: boolean
  /** 是否有待用户授权的请求（黄色状态信号） */
  approvalPending: boolean
}

/** 专注模式：任务进行中（本版下调的全局值；鼠标圆内另按 FOCUS_LENS 加浓） */
export const FOCUS_WORK = { panelAlpha: 20, blur: 9, shadow: 75 }
/** 专注模式：任务全部完成 */
export const FOCUS_IDLE = { panelAlpha: 9, blur: 6, shadow: 40 }
/** 专注模式 · 注视点透镜：鼠标圆形范围内背景采用的参数（比全局更浓的磨砂） */
export const FOCUS_LENS = { panelAlpha: 30, blur: 15, shadow: 90 }

/** 当前生效的视觉参数（专注模式覆盖用户滑块值） */
export function effectiveVisuals(): { panelAlpha: number; blur: number; shadow: number } {
  if (store.settings.focus) return store.settings.taskActive ? FOCUS_WORK : FOCUS_IDLE
  return { panelAlpha: store.settings.panelAlpha, blur: store.settings.blur, shadow: store.settings.shadow }
}

/** 包内单例 store：apply 循环更新，面板组件订阅渲染。 */
export const store = {
  info: null as WeSyncInfo | null,
  /** DSH locale 服务同步下来的界面语言（'zh' | 'en'）；null = locale 服务不可用，面板走 DOM 兜底探测。
   *  模块级持久：conversation.view 是 session 作用域插槽，切会话/轨迹会重挂载面板，
   *  重挂载时直接读这里而不是重新探测，语言才不会"弹回英语"。 */
  locale: null as 'zh' | 'en' | null,
  settings: { enabled: true, panelAlpha: 72, blur: 6, shadow: 30, monitor: '', focus: false, taskActive: false, renderMode: 'perf', gazeEnabled: false, lensCenterClear: false, gazeSnapText: false, immersive: false, approvalPending: false } as WeSyncSettings,
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

/** DSH locale 服务（packages/client/locale 的 LocaleRuntime）最小面：只读当前语言 + 订阅变化 */
interface LocaleService {
  getLocale(): { active: string }
  subscribe(fn: () => void): () => void
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

  // 界面语言：从 DSH locale 服务同步到模块级 store.locale（权威源，含持久化的用户偏好）。
  // 不注入 'locale'（ctx.get 软依赖）：老宿主没有该服务时保持 null，面板回退 DOM 探测。
  const localeService = ctx.get('locale') as unknown as LocaleService | undefined
  if (localeService !== undefined) {
    const syncLocale = (): void => {
      const active = localeService.getLocale().active
      const next: 'zh' | 'en' | null = active === 'en' ? 'en' : active === 'zh' ? 'zh' : null
      if (next !== null && next !== store.locale) {
        store.locale = next
        store.notify()
      }
    }
    ctx.effect(() => localeService.subscribe(syncLocale))
    syncLocale()
  }

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
    if (sceneModelRenderer !== null) { sceneModelRenderer.destroy(); sceneModelRenderer = null }
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

  // —— 专注 / 眼动 · 注视点透镜：眼动模式（gazeEnabled）下始终显示并跟随视线；或专注+任务时跟随鼠标。
  //   圆心可切换：清晰（阅读窗，圆外模糊）或模糊（圆盘，圆外清晰）。实现：壁纸全局模糊在透镜激活时
  //   置 0（见 applyBackground），改由此 fixed 层用 backdrop-filter 施加模糊，mask 决定模糊落在圆心还是圆外。
  //   入场：先全屏模糊，再"汇聚"到视线处的圆（清晰模式半径 0→R 张开；模糊模式半径 大→R 收拢）。
  const FOCUS_LENS_RADIUS = 260          // 目标圆渐变半径（px）
  const LENS_BLUR = 12                   // 透镜 backdrop-filter 模糊强度（px）
  const LENS_ENTER_MS = 1400             // 入场动画时长
  const LENS_ENTER_START_MULT = 1.35     // 模糊模式入场起始半径 = 视口对角线 × 此系数（先盖满全屏）
  const SNAP_PULL = 0.7                  // 文字吸附强度（0=不吸，1=完全吸到块中心）
  const GAZE_SMOOTH = 0.08               // 视线 EMA 平滑系数（越小越稳）
  const GAZE_DEADZONE = 12               // 死区：注视点移动 < 此值视为抖动，忽略（冻结）
  let focusLens: HTMLDivElement | null = null
  let mouseX = 0
  let mouseY = 0
  let lensX = 0
  let lensY = 0
  let lensRaf: number | null = null
  let lensStart = 0
  // —— 文字吸附：用 elementFromPoint 命中注视处的元素，向上找最近的"文本行/块"，把目标磁吸到其中心。
  //   与具体标签 / class 无关（DSH 聊天文本可能是 div+pre-wrap 或 markdown 的 p/li），故比固定选择器稳。
  function snapToText(x: number, y: number): { x: number; y: number } | null {
    let cur = document.elementFromPoint(x, y) as HTMLElement | null
    for (let i = 0; i < 6 && cur !== null; i++) {
      const r = cur.getBoundingClientRect()
      const txt = (cur.textContent || '').trim()
      if (r.width >= 40 && r.height >= 16 && r.height <= 200 && txt.length > 1) {
        return { x: x + (r.left + r.width / 2 - x) * SNAP_PULL, y: y + (r.top + r.height / 2 - y) * SNAP_PULL }
      }
      cur = cur.parentElement
    }
    return null
  }
  function onLensMove(ev: MouseEvent): void {
    mouseX = ev.clientX
    mouseY = ev.clientY
  }
  // 每帧决定透镜位置：眼动开启且有新鲜注视 → 跟视线；否则跟鼠标。
  // 无脸 / 离开座位时 getGaze() 返回 null，自动回落鼠标（无需额外逻辑）。
  function pumpLens(): void {
    if (focusLens === null) { lensRaf = null; return }
    // 位置：眼动新鲜 → （可选文字吸附 +）死区 + EMA 平滑（求稳，不追眼跳）；否则直接跟鼠标
    const g = store.settings.gazeEnabled ? getGaze() : null
    if (g !== null) {
      let tx = g.x
      let ty = g.y
      if (store.settings.gazeSnapText) {
        const s = snapToText(tx, ty)
        if (s !== null) { tx = s.x; ty = s.y }
      }
      // 死区：注视点相对当前透镜只移动一点点（< GAZE_DEADZONE）当作抖动忽略、冻结不动 → 只有大幅移动才跟随
      if (Math.abs(tx - lensX) < GAZE_DEADZONE && Math.abs(ty - lensY) < GAZE_DEADZONE) {
        tx = lensX
        ty = lensY
      }
      lensX += (tx - lensX) * GAZE_SMOOTH
      lensY += (ty - lensY) * GAZE_SMOOTH
    } else {
      lensX = mouseX
      lensY = mouseY
    }
    // 入场：先全屏模糊，再"汇聚"到视线处的圆。半径用字面量拼进 mask（最稳），圆心位置用 CSS 变量。
    const p = Math.min(1, (performance.now() - lensStart) / LENS_ENTER_MS)
    const eased = 1 - Math.pow(1 - p, 3)
    let r: number
    let grad: string
    if (store.settings.lensCenterClear) {
      // 圆心清晰：透明核心 0→R 张开（起始全糊）
      r = Math.max(0.5, eased * FOCUS_LENS_RADIUS)
      grad = 'radial-gradient(circle ' + r.toFixed(1) + 'px at var(--wesync-lens-x) var(--wesync-lens-y), transparent 0%, transparent 50%, rgba(0,0,0,0.45) 70%, rgba(0,0,0,0.82) 88%, #000 100%)'
    } else {
      // 圆心模糊：不透明核心 大→R 收拢（起始盖满全屏 = 全糊）
      const startR = Math.hypot(window.innerWidth, window.innerHeight) * LENS_ENTER_START_MULT
      r = startR + (FOCUS_LENS_RADIUS - startR) * eased
      grad = 'radial-gradient(circle ' + r.toFixed(1) + 'px at var(--wesync-lens-x) var(--wesync-lens-y), #000 0%, #000 50%, rgba(0,0,0,0.5) 72%, rgba(0,0,0,0.18) 88%, transparent 100%)'
    }
    focusLens.style.setProperty('--wesync-lens-x', lensX + 'px')
    focusLens.style.setProperty('--wesync-lens-y', lensY + 'px')
    focusLens.style.maskImage = grad
    focusLens.style.webkitMaskImage = grad
    lensRaf = requestAnimationFrame(pumpLens)
  }
  function destroyFocusLens(): void {
    if (focusLens === null) return
    focusLens.remove()
    focusLens = null
    document.removeEventListener('mousemove', onLensMove, true)
    if (lensRaf !== null) { cancelAnimationFrame(lensRaf); lensRaf = null }
  }
  function applyFocusLens(): void {
    // 眼动模式（gazeEnabled）下始终显示并追踪（无需任务）；或专注+任务时显示（跟随鼠标）
    const show = store.settings.gazeEnabled || (store.settings.focus && store.settings.taskActive)
    if (!show) { destroyFocusLens(); return }
    if (focusLens === null) {
      // 初始放在视口中心，等鼠标 / 视线接管
      mouseX = window.innerWidth / 2
      mouseY = window.innerHeight / 2
      lensX = mouseX
      lensY = mouseY
      lensStart = performance.now()
      focusLens = document.createElement('div')
      focusLens.dataset.plugin = 'dsh-wallpaper_share'
      focusLens.style.cssText = 'position:fixed;inset:0;z-index:-1;pointer-events:none;'
      focusLens.style.setProperty('--wesync-lens-x', lensX + 'px')
      focusLens.style.setProperty('--wesync-lens-y', lensY + 'px')
      document.addEventListener('mousemove', onLensMove, true)
      document.body.appendChild(focusLens)
      if (lensRaf === null) lensRaf = requestAnimationFrame(pumpLens)
    }
    // 壁纸全局模糊在透镜激活时置 0（见 applyBackground），模糊全部由本层 backdrop-filter 承担；
    // mask（圆心清晰 or 圆心模糊）由 pumpLens 每帧按入场半径重建，这里只设静态模糊强度。
    const bf = 'blur(' + LENS_BLUR + 'px)'
    focusLens.style.backdropFilter = bf
    focusLens.style.setProperty('-webkit-backdrop-filter', bf)
    focusLens.style.background = 'transparent'
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
    // 专注+任务时透镜接管模糊：壁纸全局模糊置 0，由透镜在清晰圆之外施加（圆心才能真清晰）
    const lensActive = store.settings.gazeEnabled || (store.settings.focus && store.settings.taskActive)
    const blurPx = lensActive ? 0 : Math.round(visuals.blur)
    const scale = 1 + blurPx / 400
    const shadowAlpha = (visuals.shadow / 100) * 0.60
    const monitorKey = info !== null && info.monitor !== '' ? info.monitor : ''
    const monitorQuery = store.settings.monitor !== '' ? '&monitor=' + encodeURIComponent(store.settings.monitor) : ''
    const wantLive = store.settings.renderMode !== 'eco'
    const rawSourceKind = enabled && info !== null && wantLive ? info.source.kind : ''
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
      // 三档：性能=捕获 WE（external，需 available）；增强=浏览器解 pkg（browser）；
      // 性能但 WE/捕获不可用时自动回退到浏览器渲染，再不行回退静态预览（imgUrl 垫底）。
      const canExternal = info.scene?.available === true
      const canBrowser = info.scene?.model === true || info.scene?.texture === true || info.source.scene === true
      const useExternal = store.settings.renderMode === 'perf' && canExternal
      if (useExternal) {
        // 性能：live canvas（WS 帧流），出帧覆盖在纹理垫底之上；连接失败自动回退
        if (sceneCanvas === null) sceneCanvas = new SceneCanvas()
        sceneCanvas.applyVisuals(blurPx, scale)
        sceneCanvas.start(monitorKey, info.version)
        stopSceneModelRenderer()
      } else if (canBrowser) {
        // 增强（或性能回退）：浏览器子集渲染器，真实 scene.json 图层树 + transform 合成
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
    applyFocusLens()
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
    destroyFocusLens()
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
