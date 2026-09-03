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
import { getGaze, startGaze, isGazeRunning } from './GazeLens.ts'
import { createPersistentSettings } from './settings.ts'
import { DwpBackgroundLayer } from './dwp-background.ts'
import { applyDwp, unapplyDwp, fetchApplied } from './market-api.ts'

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
  /** 眼动追踪（专注子模式）：开=透镜跟随视线（getGaze，无脸 / 陈旧回落鼠标）；关=跟随鼠标 */
  gazeEnabled: boolean
  /** 文字行锁定：眼动时把注视点 Y 锁到最近文字行中心（X 跟随），消除上下抖动 */
  gazeSnapText: boolean
  /** 沉浸模式：隐藏对话 chrome（上边栏 + 输入框），并把 web 壁纸 iframe 置顶解锁鼠标交互 */
  immersive: boolean
  /** 是否有待用户授权的请求（黄色状态信号） */
  approvalPending: boolean
  /** 当前挂载为 DSH 背景的 DWP id；null = 未挂载（走 WE 同步）。派生态，不落盘（服务端 applied.json 为事实源）。 */
  dwpMounted: string | null
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

/** 出厂默认值：无存档、存档损坏或字段越界时的回退基线。 */
export const DEFAULT_SETTINGS: WeSyncSettings = { enabled: true, panelAlpha: 72, blur: 6, shadow: 30, monitor: '', focus: false, taskActive: false, renderMode: 'perf', gazeEnabled: false, gazeSnapText: true, immersive: false, approvalPending: false, dwpMounted: null }

/** 包内单例 store：apply 循环更新，面板组件订阅渲染。 */
export const store = {
  info: null as WeSyncInfo | null,
  /** DSH locale 服务同步下来的界面语言（'zh' | 'en'）；null = locale 服务不可用，面板走 DOM 兜底探测。
   *  模块级持久：conversation.view 是 session 作用域插槽，切会话/轨迹会重挂载面板，
   *  重挂载时直接读这里而不是重新探测，语言才不会"弹回英语"。 */
  locale: null as 'zh' | 'en' | null,
  /** 用户偏好（同步开关 / 渲染模式 / 显示器锁 / 透明度·模糊·阴影 / 专注·眼动）经 localStorage 持久化：
   *  写即存，刷新或重启 DSH 后自动恢复。实现见 settings.ts —— 包一层 Proxy，所有
   *  `store.settings.x = v` 的既有赋值点无需改动即自动落盘；派生态（taskActive /
   *  approvalPending）与临时视图态（immersive）不在落盘白名单内。 */
  settings: createPersistentSettings(DEFAULT_SETTINGS),
  listeners: new Set<() => void>(),
  actions: {
    applyTheme: (): void => {},
    applyBackground: (): void => {},
    applyImmersive: (): void => {},
    repoll: (): void => {},
    mountDwp: async (_id: string): Promise<boolean> => false,
    unmountDwp: async (): Promise<void> => {},
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

  // DWP 全局背景层（真实渲染）：与 WE 各层互斥，由 applyBackground 的 dwpMounted 分支驱动。
  const dwpBg = new DwpBackgroundLayer()
  function stopDwp(): void { dwpBg.unmount() }

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

  // —— 专注 · 注视点透镜：专注模式是总开关，开启即显示透镜。gazeEnabled 决定跟随视线（开）还是鼠标（关）。
  //   圆心恒为清晰（阅读窗：圆心透明、圆外模糊）。实现：壁纸全局模糊在透镜激活时置 0（见 applyBackground），
  //   改由此 fixed 层用 backdrop-filter 施加模糊，反向 mask 让模糊只落在清晰圆之外。入场：半径 0→R 张开（先全糊再汇聚）。
  const FOCUS_LENS_RADIUS = 260          // 目标圆渐变半径（px）
  const LENS_BLUR = 12                   // 透镜 backdrop-filter 模糊强度（px）
  const LENS_ENTER_MS = 1400             // 入场动画时长
  const LINE_HYST = 6                    // 行锁定滞回：注视 y 在当前行带内 ±此值则不切换行
  const GAZE_SMOOTH = 0.08               // 视线 EMA 平滑系数（越小越稳）
  const GAZE_DEADZONE = 12               // 死区：注视点移动 < 此值视为抖动，忽略（冻结）
  let focusLens: HTMLDivElement | null = null
  let mouseX = 0
  let mouseY = 0
  let lensX = 0
  let lensY = 0
  let lensRaf: number | null = null
  let lensStart = 0
  // —— 文字行锁定：把注视点 Y 锁到最近的文字行中心（X 仍跟随），逐行吸附、消除上下抖动。
  //   用 Range.getClientRects 拿到块内每一"视觉行"；带滞回，避免在相邻两行间反复横跳。
  let lineCache: { el: Element; lines: Array<{ top: number; bottom: number; cy: number }>; at: number } | null = null
  let lockedLineCy: number | null = null
  function collectLines(el: Element): Array<{ top: number; bottom: number; cy: number }> {
    const range = document.createRange()
    range.selectNodeContents(el)
    const rects = range.getClientRects()
    const lines: Array<{ top: number; bottom: number; cy: number }> = []
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i]
      if (r.height < 6 || r.width < 8) continue
      lines.push({ top: r.top, bottom: r.bottom, cy: (r.top + r.bottom) / 2 })
    }
    return lines
  }
  function findTextBlock(x: number, y: number): Element | null {
    let cur = document.elementFromPoint(x, y) as HTMLElement | null
    for (let i = 0; i < 6 && cur !== null; i++) {
      if ((cur.textContent || '').trim().length > 1 && cur.getBoundingClientRect().width >= 40) return cur
      cur = cur.parentElement
    }
    return null
  }
  function snapToLine(x: number, y: number): { x: number; y: number } | null {
    const el = findTextBlock(x, y)
    if (el === null) { lockedLineCy = null; return null }
    const now = performance.now()
    let lines: Array<{ top: number; bottom: number; cy: number }>
    if (lineCache !== null && lineCache.el === el && now - lineCache.at < 200) lines = lineCache.lines
    else { lines = collectLines(el); lineCache = { el, lines, at: now } }
    if (lines.length === 0) return null
    // 滞回：当前锁定行仍罩住注视 y 就保持，避免在相邻行抖动
    if (lockedLineCy !== null) {
      const lockCy = lockedLineCy
      const lk = lines.find((ln) => Math.abs(ln.cy - lockCy) < 2)
      if (lk !== undefined && y >= lk.top - LINE_HYST && y <= lk.bottom + LINE_HYST) return { x, y: lk.cy }
    }
    let bestCy: number | null = null
    let bestD = Infinity
    for (const ln of lines) {
      const inLine = y >= ln.top - 4 && y <= ln.bottom + 4
      const d = inLine ? 0 : Math.min(Math.abs(y - ln.top), Math.abs(y - ln.bottom))
      if (d < bestD) { bestD = d; bestCy = ln.cy }
    }
    if (bestCy === null || bestD > 40) { lockedLineCy = null; return null } // 离文字太远（空白处）→ 不锁
    lockedLineCy = bestCy
    return { x, y: bestCy }
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
        const s = snapToLine(tx, ty)
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
      lockedLineCy = null
    }
    // 入场：先全屏模糊，再"汇聚"到视线处的圆。半径用字面量拼进 mask（最稳），圆心位置用 CSS 变量。
    const p = Math.min(1, (performance.now() - lensStart) / LENS_ENTER_MS)
    const eased = 1 - Math.pow(1 - p, 3)
    let r: number
    let grad: string
    // 圆心清晰（唯一模式）：透明核心 0→R 张开（起始全糊 → 汇聚出清晰圆）
    r = Math.max(0.5, eased * FOCUS_LENS_RADIUS)
    grad = 'radial-gradient(circle ' + r.toFixed(1) + 'px at var(--wesync-lens-x) var(--wesync-lens-y), transparent 0%, transparent 50%, rgba(0,0,0,0.45) 70%, rgba(0,0,0,0.82) 88%, #000 100%)'
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
    // 专注模式是透镜总开关：开启即显示。gazeEnabled 只决定跟随视线还是鼠标（子模式）。
    const show = store.settings.focus
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
    // DWP 挂载优先：接管背景层，停掉所有 WE 层，忽略 WE info（避免同步 / 性能模式与 DWP 抢背景）。
    if (store.settings.dwpMounted !== null) {
      const lensActive = store.settings.focus
      const blurPx = lensActive ? 0 : Math.round(effectiveVisuals().blur)
      const scale = 1 + blurPx / 400
      const shadowAlpha = (effectiveVisuals().shadow / 100) * 0.60
      stopSceneLayers()
      setMedia(null)
      styleTag.textContent =
        'html { background-color: #0d0e12; }' +
        'body::after { content: ""; position: fixed; top: 0; left: 0; right: 0; bottom: 0; z-index: -1; ' +
        'background: linear-gradient(rgba(6,8,12,' + shadowAlpha.toFixed(3) + '), rgba(6,8,12,' + (shadowAlpha * 0.85).toFixed(3) + ')); }'
      void dwpBg.mount(store.settings.dwpMounted)
        .then(() => dwpBg.applyVisuals(blurPx, scale))
        .catch((e: unknown) => { console.error('[dwp] 背景挂载失败：', e) })
      applyImmersive()
      applyFocusLens()
      return
    }
    // 非 DWP：先撤掉可能存在的 DWP 层，再走 WE 管线
    stopDwp()
    const info = store.info
    const visuals = effectiveVisuals()
    const enabled = store.settings.enabled
    // 专注+任务时透镜接管模糊：壁纸全局模糊置 0，由透镜在清晰圆之外施加（圆心才能真清晰）
    const lensActive = store.settings.focus
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
      if (!res.ok) { polling = false; return }
      const info = await res.json() as WeSyncInfo
      // 存档里的显示器锁可能已经过期（拔掉 / 改名了）：不在当前列表中就回退"自动跟随"，
      // 否则面板下拉框会选到一个不存在的项。node 半的 effectiveKey 本就会兜底，这里只是让 UI 说实话。
      if (store.settings.monitor !== '' && Array.isArray(info.monitors) && info.monitors.length > 0 &&
          !info.monitors.some((m) => m.key === store.settings.monitor)) {
        store.settings.monitor = ''
      }
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

  // —— DWP 挂载 / 卸载：真实渲染为全局背景，并处理与 WE 的冲突（关同步、禁性能、恢复）——
  let dwpPrevEnabled = true   // 挂载前的同步开关值，卸载时恢复
  store.actions.mountDwp = async (id: string): Promise<boolean> => {
    const r = await applyDwp((url, init) => fetch(url, init), id)
    if (!r.ok) return false
    if (store.settings.dwpMounted === null) dwpPrevEnabled = store.settings.enabled
    store.settings.dwpMounted = id
    store.settings.enabled = false                                              // 冲突①：关 WE 同步，避免抢背景
    if (store.settings.renderMode === 'perf') store.settings.renderMode = 'enhanced'  // 冲突②：性能(捕获 WE 桌面)→增强
    store.notify()
    applyBackground()
    return true
  }
  store.actions.unmountDwp = async (): Promise<void> => {
    await unapplyDwp((url, init) => fetch(url, init))
    store.settings.dwpMounted = null
    store.settings.enabled = dwpPrevEnabled                                     // 恢复同步
    store.notify()
    applyBackground()
  }
  // 刷新 / 重启后恢复：服务端 applied.json 为准，重新挂载并重申冲突处理
  void fetchApplied((url, init) => fetch(url, init)).then((applied) => {
    if (applied === null) return
    dwpPrevEnabled = true   // 刷新后无从得知挂载前的同步值，按"开"恢复（常见情形）
    store.settings.dwpMounted = applied.id
    store.settings.enabled = false
    if (store.settings.renderMode === 'perf') store.settings.renderMode = 'enhanced'
    store.notify()
    applyBackground()
  }).catch(() => { /* node 半未就绪，忽略 */ })

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
    stopDwp()
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

  // 眼动开关同样持久化，但摄像头是"活"的会话态：刷新后得重新拉起。用户此前已授权（同源权限浏览器会记住），
  // 这里只是恢复他离开时的状态。起不来（无摄像头 / 被拒绝 / CDN 不可达）就把开关拨回 off —— 绝不让面板
  // 显示一个假的"已开启"而透镜其实在跟鼠标。
  if (store.settings.gazeEnabled) {
    void startGaze().then(() => {
      if (!isGazeRunning()) store.settings.gazeEnabled = false
      store.notify()
    })
  }

  slotsService.inject('conversation.view', () => slotsService.register(
    { name: 'conversation.view', id: 'wallpaper_share', order: 20, label: 'wallpaper_share' },
    WallpaperSharePanel,
  ))
}
