/**
 * wallpaper_share 会话视图标签页：当前壁纸信息、同步开关、显示器选择、
 * 专注模式、渲染模式，以及透明度 / 模糊 / 阴影三个滑块（即时生效）。
 * 样式类名由 PANEL_CSS 在 apply 阶段注入，不依赖 CSS Modules。
 */
import { useEffect, useState } from 'react'
import { store, PLUGIN_VERSION, type WeSyncInfo } from './index'
import { startGaze, stopGaze, calibrate, onGazeStatus, hasCalibrationData, type GazeStatus } from './GazeLens.ts'
import { fetchCatalog, fetchInstalled, buildCards, searchCards, collectTags, install, uninstall, type MarketEntry, type MarketCard } from './market-api.ts'

/* =========================================================================
 * 1. 国际化字典 (i18n Dictionary)
 * ========================================================================= */
const DICT = {
  zh: {
    // 头部与壁纸状态
    noWallpaper: 'Wallpaper Engine 尚未应用壁纸',
    webNoPreview: '当前为网页壁纸（无本地预览）',
    applyHint: '在 Wallpaper Engine 中应用壁纸后，此处会同步显示',
    // 副标题只留场景渲染通路（别处看不到的唯一诊断出口）
    sceneEco: '场景 · 预览图',
    sceneExternal: '场景 · 捕获 live',
    sceneModel: '场景 · 浏览器模型渲染',
    sceneFallback: '场景 · 回退：',
    versionTitle: '插件版本',

    // 显示器
    bgMonitor: '背景显示器',
    autoFollowLatest: '自动 · 跟随最新变化',
    auto: 'auto',

    // 同步按钮
    syncOn: '⏻ 同步开启',
    syncOff: '⏻ 同步关闭',
    flashSyncOn: '已开启壁纸同步',
    flashSyncOff: '已关闭壁纸同步',
    dwpMountedHint: '已挂载 DWP 壁纸：期间WE 捕获模式禁用。',
    syncPaused: '⏻ 同步暂停（DWP）',
    perfDisabledHint: '挂载 DWP 期间捕获模式不可用',

    // 视觉效果与专注模式
    visualTitle: '视觉效果',
    focusMode: '专注模式',
    focusIntro: '随任务自适应调节背景效果',
    flashFocusOn: '专注模式已开启：注视点透镜跟随鼠标（圆心清晰）；可再开「眼动追踪」改为跟随视线',
    flashFocusOff: '专注模式已关闭，恢复手动滑块',

    // 渲染模式（三档：预览 / 捕获 / 完整）
    renderModeTitle: '渲染模式',
    modeEco: '预览',
    modePerf: '捕获',
    modeEnhanced: '完整',
    flashEco: '节能模式：静态预览图（最省电）',
    flashPerfScene: '性能模式：捕获 WE 桌面背景',
    flashPerfFallback: '性能模式：WE 未运行 / 捕获不可用 → 回退浏览器渲染',
    flashEnhancedScene: '增强模式：浏览器解 pkg 渲染（不依赖 WE，效果覆盖不全）',
    flashVideo: '使用壁纸源视频实时渲染',
    flashWeb: '加载 Web 壁纸页面',
    flashSource: '使用壁纸源文件实时渲染',

    // 眼动追踪
    gazeMode: '眼动追踪',
    gazeCalibrate: '校准视线',
    gazeStarting: '眼动：加载模型并请求摄像头…（首次请用「校准视线」标定一次）',
    gazeOff: '眼动追踪已关闭（摄像头已释放）',
    gazeNeedOn: '请先开启眼动追踪再校准',
    gazeNeedCalib: '· 眼动待校准：点「校准视线」标定一次',
    gazeCalibHint: '校准：依次注视并点击 9 个黄点（Esc 取消）',
    gazeCalibDone: '校准完成，透镜将跟随视线',
    gazeCalibCancel: '校准已取消',
    gazeStatusRunning: '· 视线跟随中',
    gazeStatusLoading: '· 眼动加载中…',
    gazeStatusError: '· 眼动出错',
    gazeSnap: '文字吸附',

    // 滑块
    panelAlpha: '面板透明度',
    blur: '背景模糊',
    shadow: '阴影深度',

    // 壁纸库（本地 / 市场 两大分类）
    appsTitle: '壁纸库',
    catLocal: '本地', catMarket: '市场',
    collapse: '收起',
    listApps: '浏览壁纸',
    appsEmpty: '暂无内容。',
    appsNoMatch: '没有匹配当前搜索的壁纸',
    openFolder: '打开文件夹：',
    mountHint: '点击挂载为壁纸：',
    unmountHint: '点击取消挂载：',
    unmounted: '已取消挂载',
    noPreview: '无预览',
    loadFailed: '列表加载失败',
    openFolderFailed: '打开文件夹失败',
    mountFailed: '挂载失败',
    typeDwp: 'dwp壁纸',
    typeWeApp: 'we 应用',
    mounted: '已挂载',
    searchPlaceholder: '搜索标题…',
    showMore: '显示更多',
    dwpEmpty: '还没有已安装的 DWP 壁纸，去壁纸库「市场」一栏拉取。',
    weAppEmpty: '没有 WE 应用类壁纸。',
    appsCount: (total: number, matched: number) => (total === matched ? `共 ${String(total)} 个` : `共 ${String(total)} 个 · 匹配 ${String(matched)} 个`),

    // 市场一栏（浏览 dwp-registry 目录 + 安装/更新/卸载）
    marketRefresh: '刷新', marketSearch: '搜索名称 / 作者…', marketAll: '全部',
    marketInstall: '安装', marketInstalling: '安装中…', marketUpdate: '更新', marketUninstall: '卸载', marketInstalled: '已安装',
    marketEmpty: '目录为空', marketLoading: '加载中…', marketNoMatch: '无匹配结果',
    marketLoadFailed: '目录加载失败（node 半 market 路由未就绪？）',
    marketBy: '作者', marketInstalledAt: '已装',
    flashMInstalled: '已安装', flashMUpdated: '已更新', flashMUninstalled: '已卸载', flashMFailed: '操作失败',

    // 壁纸读取位置（自定义目录）
    dirsTitle: '壁纸读取位置',
    dirsHint: '添加自己收藏的壁纸文件夹：可直接指向某个壁纸目录（含 project.json），或指向包含多个壁纸目录的集合文件夹',
    dirPlaceholder: '粘贴本地壁纸目录路径，如 D:\\MyWallpapers',
    addDir: '添加',
    removeDir: '移除',
    dirEmpty: '尚未添加自定义目录（默认扫描 workshop + projects）',
    dirExists: '该目录已在列表中',
    dirNotFound: '目录不存在或不可读',
    dirAdded: '已添加目录，重新扫描中',
    dirRemoved: '已移除目录',
  },
  en: {
    // Header & Wallpaper status
    noWallpaper: 'Wallpaper Engine has no active wallpaper',
    webNoPreview: 'Current wallpaper is Web type (no local preview)',
    applyHint: 'Apply a wallpaper in Wallpaper Engine to sync here',
    // Subtitle keeps only the scene render path (the one diagnostic found nowhere else)
    sceneEco: 'Scene · preview image',
    sceneExternal: 'Scene · capture live',
    sceneModel: 'Scene · browser model render',
    sceneFallback: 'Scene · fallback: ',
    versionTitle: 'Plugin version',

    // Monitor
    bgMonitor: 'Background Monitor',
    autoFollowLatest: 'Auto · Follow Latest',
    auto: 'auto',

    // Sync button
    syncOn: '⏻ Sync Enabled',
    syncOff: '⏻ Sync Disabled',
    flashSyncOn: 'Wallpaper sync enabled',
    flashSyncOff: 'Wallpaper sync disabled',
    dwpMountedHint: 'DWP wallpaper mounted: WE capture mode is disabled while active.',
    syncPaused: '⏻ Sync Paused (DWP)',
    perfDisabledHint: 'Capture mode is unavailable while a DWP is mounted',

    // Visuals & Focus mode
    visualTitle: 'Visual Adjustments',
    focusMode: 'Focus Mode',
    focusIntro: 'Background adjusts adaptively to your task',
    flashFocusOn: 'Focus mode on: lens follows mouse (clear center); enable Eye Tracking to follow gaze instead',
    flashFocusOff: 'Focus mode off, manual sliders restored',

    // Render mode (Preview / Capture / Full)
    renderModeTitle: 'Render Mode',
    modeEco: 'Preview',
    modePerf: 'Capture',
    modeEnhanced: 'Full',
    flashEco: 'Eco mode: static preview (lowest power)',
    flashPerfScene: 'Perf mode: capturing WE desktop',
    flashPerfFallback: 'Perf mode: WE not running / capture unavailable → fallback to browser render',
    flashEnhancedScene: 'Enhanced mode: browser .pkg render (no WE dependency, partial effects)',
    flashVideo: 'Live rendering from source video',
    flashWeb: 'Loading Web wallpaper page',
    flashSource: 'Live rendering from wallpaper source file',

    // Eye tracking
    gazeMode: 'Eye Tracking',
    gazeCalibrate: 'Calibrate Gaze',
    gazeStarting: 'Eye tracking: loading model & requesting camera… (run Calibrate Gaze once)',
    gazeOff: 'Eye tracking off (camera released)',
    gazeNeedOn: 'Enable eye tracking before calibrating',
    gazeNeedCalib: '· gaze needs calibration — click Calibrate Gaze once',
    gazeCalibHint: 'Calibration: look at and click each of the 9 yellow dots (Esc to cancel)',
    gazeCalibDone: 'Calibrated — lens will follow your gaze',
    gazeCalibCancel: 'Calibration cancelled',
    gazeStatusRunning: '· gaze following',
    gazeStatusLoading: '· eye tracking loading…',
    gazeStatusError: '· eye tracking error',
    gazeSnap: 'Text snap',

    // Sliders
    panelAlpha: 'Panel Transparency',
    blur: 'Background Blur',
    shadow: 'Shadow Depth',

    // Wallpaper library (Local / Market categories)
    appsTitle: 'Wallpaper Library',
    catLocal: 'Local', catMarket: 'Market',
    collapse: 'Collapse',
    listApps: 'Browse Wallpapers',
    appsEmpty: 'Nothing here yet.',
    appsNoMatch: 'No wallpapers match the current search',
    openFolder: 'Open folder: ',
    mountHint: 'Click to mount as wallpaper: ',
    unmountHint: 'Click to unmount: ',
    unmounted: 'Unmounted',
    noPreview: 'No Preview',
    loadFailed: 'Failed to load list',
    openFolderFailed: 'Failed to open folder',
    mountFailed: 'Mount failed',
    typeDwp: 'DWP',
    typeWeApp: 'WE Apps',
    mounted: 'Mounted',
    searchPlaceholder: 'Search titles…',
    showMore: 'Show more',
    dwpEmpty: 'No installed DWP wallpapers yet — pull some in the library "Market" tab.',
    weAppEmpty: 'No WE application wallpapers.',
    appsCount: (total: number, matched: number) => (total === matched ? `Total ${String(total)}` : `Total ${String(total)} · Matched ${String(matched)}`),

    // Market tab (browse dwp-registry catalog + install/update/uninstall)
    marketRefresh: 'Refresh', marketSearch: 'Search name / author…', marketAll: 'All',
    marketInstall: 'Install', marketInstalling: 'Installing…', marketUpdate: 'Update', marketUninstall: 'Uninstall', marketInstalled: 'Installed',
    marketEmpty: 'Catalog is empty', marketLoading: 'Loading…', marketNoMatch: 'No matches',
    marketLoadFailed: 'Failed to load catalog (node market route not ready?)',
    marketBy: 'by', marketInstalledAt: 'installed',
    flashMInstalled: 'Installed', flashMUpdated: 'Updated', flashMUninstalled: 'Uninstalled', flashMFailed: 'Operation failed',

    // Wallpaper read locations (custom dirs)
    dirsTitle: 'Wallpaper Read Locations',
    dirsHint: 'Add your own wallpaper folders: point to a single wallpaper dir (with project.json) or a collection folder containing wallpaper dirs',
    dirPlaceholder: 'Paste a local wallpaper dir path, e.g. D:\\MyWallpapers',
    addDir: 'Add',
    removeDir: 'Remove',
    dirEmpty: 'No custom dirs yet (defaults: workshop + projects)',
    dirExists: 'Dir already in list',
    dirNotFound: 'Dir missing or unreadable',
    dirAdded: 'Dir added, rescanning',
    dirRemoved: 'Dir removed',
  },
}

type Lang = 'zh' | 'en'

/* =========================================================================
 * 2. 语言解析
 * 权威源是 store.locale（apply 阶段从 DSH locale 服务同步，含用户持久化偏好）。
 * conversation.view 是 session 作用域插槽：切换对话 / 轨迹会重挂载面板，
 * 语言状态在模块级 store 里，重挂载直接读取、不再重新探测，所以不会"弹回英语"；
 * 运行中切换语言由 locale 服务 → store.notify() → 面板订阅重渲染即时生效。
 * ========================================================================= */
function resolveLang(): Lang {
  if (store.locale === 'zh' || store.locale === 'en') return store.locale
  // 兜底（locale 服务不可用的老宿主）：<html lang> 由 DSH locale 插件同步为 zh-CN / en，
  // 两个方向都要识别——旧实现只认 en，zh-CN 会漏到 navigator 导致误判英语。
  if (typeof document !== 'undefined') {
    const docLang = (document.documentElement.lang ?? '').toLowerCase()
    if (docLang.startsWith('zh')) return 'zh'
    if (docLang.startsWith('en')) return 'en'
  }
  if (typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('en')) {
    return 'en'
  }
  return 'zh'
}

/* =========================================================================
 * 3. 主面板组件
 * ========================================================================= */
export function WallpaperSharePanel(props?: { ctx?: any }) {
  const [, force] = useState(0)
  const t = DICT[resolveLang()]

  const [info, setInfo] = useState<WeSyncInfo | null>(store.info)
  const [enabled, setEnabled] = useState(store.settings.enabled)
  const [alpha, setAlpha] = useState(store.settings.panelAlpha)
  const [blur, setBlur] = useState(store.settings.blur)
  const [shadow, setShadow] = useState(store.settings.shadow)
  const [status, setStatus] = useState('')
  const [monitor, setMonitor] = useState(store.settings.monitor)
  const [focus, setFocus] = useState(store.settings.focus)
  const [focusHover, setFocusHover] = useState(false)
  const [renderMode, setRenderMode] = useState(store.settings.renderMode)
  const [gazeEnabled, setGazeEnabled] = useState(store.settings.gazeEnabled)
  const [gazeStatus, setGazeStatus] = useState<GazeStatus>('off')
  const [gazeError, setGazeError] = useState('')
  const [gazeSnapText, setGazeSnapText] = useState(store.settings.gazeSnapText)
  const [needsCalib, setNeedsCalib] = useState(false)
  useEffect(() => onGazeStatus((s, err) => { setGazeStatus(s); setGazeError(err) }), [])
  const [appsOpen, setAppsOpen] = useState(false)
  const [libTab, setLibTab] = useState<'local' | 'market'>('local')
  const [apps, setApps] = useState<Array<{ id: string; title: string; file: string; type: string; hasPreview: boolean }>>([])
  const [appsCounts, setAppsCounts] = useState<Record<string, number>>({})
  const [typeFilter, setTypeFilter] = useState('dwp')
  const [search, setSearch] = useState('')
  const [visible, setVisible] = useState(60)
  const [appsError, setAppsError] = useState('')
  const [dwpCards, setDwpCards] = useState<Array<{ id: string; name: string; thumbnail: string; version: string }>>([])
  const [dirs, setDirs] = useState<string[]>([])
  const [dirInput, setDirInput] = useState('')
  const [dirStatus, setDirStatus] = useState('')
  // 市场一栏
  const [mCards, setMCards] = useState<MarketCard[]>([])
  const [mLoading, setMLoading] = useState(false)
  const [mError, setMError] = useState('')
  const [mSearch, setMSearch] = useState('')
  const [mTag, setMTag] = useState('')
  const [mBusy, setMBusy] = useState<Record<string, boolean>>({})
  const [mFlash, setMFlash] = useState('')

  // store 是唯一事实源：每次 notify 都把设置项镜像回本地 state。
  // 面板只在挂载时读一次 store 的话，外部对设置的修正（显示器锁失效回退自动、眼动启动失败回拨 off）
  // 就永远显示不出来的；React 对同值 setState 会自动跳过，2.5s 一次的轮询不会造成额外重渲染。
  useEffect(() => store.subscribe(() => {
    setInfo(store.info)
    setEnabled(store.settings.enabled)
    setAlpha(store.settings.panelAlpha)
    setBlur(store.settings.blur)
    setShadow(store.settings.shadow)
    setMonitor(store.settings.monitor)
    setFocus(store.settings.focus)
    setRenderMode(store.settings.renderMode)
    setGazeEnabled(store.settings.gazeEnabled)
    setGazeSnapText(store.settings.gazeSnapText)
    force((x) => x + 1)
  }), [])

  // 挂载时加载自定义壁纸目录列表
  useEffect(() => { void loadDirs() }, [])

  const flash = (text: string): void => {
    setStatus(text)
    window.setTimeout(() => setStatus(''), 3500)
  }

  const onAlpha = (v: number): void => {
    store.settings.panelAlpha = v
    setAlpha(v)
    store.actions.applyTheme()
  }

  const onBlur = (v: number): void => {
    store.settings.blur = v
    setBlur(v)
    store.actions.applyBackground()
  }

  const onShadow = (v: number): void => {
    store.settings.shadow = v
    setShadow(v)
    store.actions.applyBackground()
  }

  const onPower = (): void => {
    const next = !store.settings.enabled
    store.settings.enabled = next
    setEnabled(next)
    store.actions.applyBackground()
    flash(next ? t.flashSyncOn : t.flashSyncOff)
  }

  const onMonitor = (v: string): void => {
    store.settings.monitor = v
    setMonitor(v)
    store.actions.repoll()
  }

  const onFocus = (): void => {
    const next = !store.settings.focus
    store.settings.focus = next
    setFocus(next)
    // 专注是透镜总开关：关闭专注时一并关掉眼动（释放摄像头）——眼动只是专注的子模式
    if (!next && store.settings.gazeEnabled) {
      store.settings.gazeEnabled = false
      setGazeEnabled(false)
      stopGaze()
    }
    store.actions.applyTheme()
    store.actions.applyBackground()
    flash(next ? t.flashFocusOn : t.flashFocusOff)
  }

  const onRenderMode = (mode: 'eco' | 'perf' | 'enhanced'): void => {
    store.settings.renderMode = mode
    setRenderMode(mode)
    store.actions.applyBackground()
    const kind = store.info !== null ? store.info.source.kind : ''
    if (mode === 'eco') flash(t.flashEco)
    else if (kind === 'scene') {
      if (mode === 'perf') flash(store.info?.scene?.available === true ? t.flashPerfScene : t.flashPerfFallback)
      else flash(t.flashEnhancedScene)
    } else if (kind === 'video') flash(t.flashVideo)
    else if (kind === 'web') flash(t.flashWeb)
    else flash(t.flashSource)
  }

  const onGazeToggle = async (): Promise<void> => {
    const next = !store.settings.gazeEnabled
    store.settings.gazeEnabled = next
    setGazeEnabled(next)
    store.actions.applyBackground()   // 眼动模式下无需任务也立即显示 / 移除透镜
    if (next) {
      flash(t.gazeStarting)
      await startGaze()
      const noCalib = !hasCalibrationData()
      setNeedsCalib(noCalib)
      if (noCalib) flash(t.gazeNeedCalib)
    } else {
      stopGaze()
      setNeedsCalib(false)
      flash(t.gazeOff)
    }
    store.notify()
  }

  const onCalibrate = (): void => {
    if (!store.settings.gazeEnabled) { flash(t.gazeNeedOn); return }
    flash(t.gazeCalibHint)
    calibrate((completed) => {
      if (completed) setNeedsCalib(false)
      flash(completed ? t.gazeCalibDone : t.gazeCalibCancel)
    })
  }

  const onToggleSnap = (): void => {
    const next = !store.settings.gazeSnapText
    store.settings.gazeSnapText = next
    setGazeSnapText(next)
    store.notify()
  }

  // 壁纸库：两组——dwp壁纸（已装 DWP，点击挂载）/ we应用（WE application 类，点击打开文件夹）
  const onAppsToggle = async (): Promise<void> => {
    const next = !appsOpen
    setAppsOpen(next)
    if (next) { void loadApps(); void loadDwp(); void loadMarket() }
  }

  const loadDwp = async (): Promise<void> => {
    try {
      const f = (url: string, init?: { cache?: 'no-store' }) => fetch(url, init)
      const [catalog, installed] = await Promise.all([fetchCatalog(f), fetchInstalled(f)])
      const byId = new Map(catalog.map((e: MarketEntry) => [e.id, e]))
      setDwpCards(installed.map((it) => {
        const e = byId.get(it.id)
        return { id: it.id, name: e ? (resolveLang() === 'en' ? e.name.en : e.name.zh) : it.id, thumbnail: e?.dwp.thumbnail ?? '', version: it.version }
      }))
    } catch { /* dwp 列表拉取失败不阻断其余 UI */ }
  }

  // 点击切换：已挂载 → 取消挂载；未挂载 → 挂载为全局背景（权威态取共享 store.settings.dwpMounted）
  const onToggleDwp = async (id: string): Promise<void> => {
    if (store.settings.dwpMounted === id) {
      await store.actions.unmountDwp()
      flash(t.unmounted)
      return
    }
    const ok = await store.actions.mountDwp(id)
    if (ok) flash(t.mountHint + id)
    else flash(t.mountFailed)
  }

  // 市场一栏：浏览 dwp-registry 目录 + 安装/更新/卸载（免费 only，不含"应用"——挂载走本地栏）
  const loadMarket = async (): Promise<void> => {
    setMLoading(true); setMError('')
    try {
      const f = (url: string, init?: { cache?: 'no-store' }) => fetch(url, init)
      const [catalog, installed] = await Promise.all([fetchCatalog(f), fetchInstalled(f)])
      setMCards(buildCards(catalog, installed))
    } catch (e) {
      setMError(String((e as Error).message ?? e))
    }
    setMLoading(false)
  }
  const flashM = (msg: string): void => { setMFlash(msg); window.setTimeout(() => setMFlash(''), 3000) }
  const mInstall = async (id: string, isUpdate: boolean): Promise<void> => {
    setMBusy((b) => ({ ...b, [id]: true }))
    const r = await install((url, init) => fetch(url, init), id)
    setMBusy((b) => { const n = { ...b }; delete n[id]; return n })
    if (r.ok) { void loadMarket(); void loadDwp(); flashM(isUpdate ? t.flashMUpdated : t.flashMInstalled) }
    else flashM(t.flashMFailed + (r.error ? ': ' + r.error : ''))
  }
  const mUninstall = async (id: string): Promise<void> => {
    setMBusy((b) => ({ ...b, [id]: true }))
    const r = await uninstall((url, init) => fetch(url, init), id)
    setMBusy((b) => { const n = { ...b }; delete n[id]; return n })
    if (r.ok) {
      if (store.settings.dwpMounted === id) await store.actions.unmountDwp()   // 冲突：卸载正挂载的包先撤背景，避免引用已删文件
      void loadMarket(); void loadDwp(); flashM(t.flashMUninstalled)
    } else flashM(t.flashMFailed)
  }

  const onAppOpen = (id: string): void => {
    void fetch('/we-sync/apps/open?id=' + encodeURIComponent(id), { cache: 'no-store' }).then((res) => {
      if (!res.ok) flash(t.openFolderFailed)
    }).catch(() => flash(t.openFolderFailed))
  }

  // 壁纸读取位置：加载自定义目录、添加/移除
  const loadDirs = async (): Promise<void> => {
    try {
      const res = await fetch('/we-sync/apps/dirs', { cache: 'no-store' })
      const body = (await res.json()) as { dirs: string[] }
      setDirs(body.dirs ?? [])
    } catch { /* 忽略 */ }
  }

  const loadApps = async (): Promise<void> => {
    try {
      const res = await fetch('/we-sync/apps', { cache: 'no-store' })
      const body = (await res.json()) as { apps?: Array<{ id: string; title: string; file: string; type: string; hasPreview: boolean }>; counts?: Record<string, number>; error?: string }
      if (body.error !== undefined) setAppsError(body.error)
      else {
        setApps(body.apps ?? [])
        setAppsCounts(body.counts ?? {})
      }
    } catch {
      setAppsError(t.loadFailed)
    }
  }

  const onAddDir = async (): Promise<void> => {
    const dir = dirInput.trim()
    if (dir === '') return
    // 检查是否已在列表中
    if (dirs.some((d) => d.replace(/\\/g, '/') === dir.replace(/\\/g, '/'))) {
      setDirStatus(t.dirExists)
      return
    }
    try {
      const res = await fetch('/we-sync/apps/dirs/add?dir=' + encodeURIComponent(dir), { cache: 'no-store' })
      const body = (await res.json()) as { dirs: string[]; error?: string }
      if (body.error !== undefined) {
        setDirStatus(body.error)
        return
      }
      setDirs(body.dirs ?? [])
      setDirInput('')
      setDirStatus(t.dirAdded)
      // 重新加载 apps 列表
      if (appsOpen) void loadApps()
    } catch {
      setDirStatus(t.dirNotFound)
    }
  }

  const onRemoveDir = async (dir: string): Promise<void> => {
    try {
      const res = await fetch('/we-sync/apps/dirs/remove?dir=' + encodeURIComponent(dir), { cache: 'no-store' })
      const body = (await res.json()) as { dirs: string[] }
      setDirs(body.dirs ?? [])
      setDirStatus(t.dirRemoved)
      if (appsOpen) void loadApps()
    } catch { /* 忽略 */ }
  }

  // 壁纸库：两组（dwp壁纸 / we应用）+ 标题搜索前端筛选
  const weApps = apps.filter((a) => a.type === 'application')
  const kw = search.trim().toLowerCase()
  const filteredApps = weApps.filter((a) => kw === '' || a.title.toLowerCase().includes(kw))
  const filteredDwp = dwpCards.filter((d) => kw === '' || d.name.toLowerCase().includes(kw))
  const shownApps = filteredApps.slice(0, visible)
  const shownDwp = filteredDwp.slice(0, visible)
  // 市场一栏：标签 + 搜索筛选
  const mTags = collectTags(mCards)
  const mShown = searchCards(mCards, mSearch, mTag)

  const wallpaper = info !== null && info.wallpaper !== null ? info.wallpaper : null
  const title = wallpaper === null
    ? (info !== null && info.kind === 'web' ? t.webNoPreview : t.noWallpaper)
    : wallpaper.title
  // 副标题只保留"别处看不到"的那一条：场景壁纸当前走哪条渲染通路。
  // 原先拼的 wallpaper.type 与 Scene[...] 语义重复、静态预览有无属内部产物、
  // 显示器名在多显示器时上方下拉框的 <output> 已经显示 —— 三段全部删除，
  // 非场景壁纸因此不再显示副标题（整行不渲染，而不是留一行空字）。
  const scene = info !== null && info.source.kind === 'scene' ? info.scene : null
  const subtitle = wallpaper === null
    ? t.applyHint
    : scene === null
      ? ''
      : renderMode === 'eco'
        ? t.sceneEco
        : scene.live === true
          ? t.sceneExternal + ' ' + String(scene.status?.fps ?? '?') + 'fps'
          : scene.model === true
            ? t.sceneModel
            : t.sceneFallback + scene.fallback

  const monitors = info !== null && Array.isArray(info.monitors) && info.monitors.length > 1 ? info.monitors : null

  return (
    <div className="wesync-panel">
      <div className="wesync-card">
        <div className="wesync-head">
          <div className="wesync-title">{title}</div>
          <span className="wesync-ver" title={t.versionTitle}>{'v' + PLUGIN_VERSION}</span>
        </div>
        {subtitle !== '' ? <div className="wesync-sub">{subtitle}</div> : null}
        {monitors !== null
          ? (
              <div className="wesync-row">
                <label>{t.bgMonitor}</label>
                <select
                  className="wesync-select"
                  value={monitor}
                  onChange={(e) => onMonitor(e.target.value)}
                >
                  <option value="">{t.autoFollowLatest}</option>
                  {monitors.map((m) => (
                    <option key={m.key} value={m.key}>{m.key + ' · ' + m.title}</option>
                  ))}
                </select>
                <output>{monitor === '' ? t.auto : monitor}</output>
              </div>
            )
          : null}
        <div className="wesync-actions">
          <button className="wesync-btn" onClick={onPower} disabled={store.settings.dwpMounted !== null}>
            {store.settings.dwpMounted !== null ? t.syncPaused : (enabled ? t.syncOn : t.syncOff)}
          </button>
          {store.settings.dwpMounted !== null ? <span className="wesync-sync-hint">{t.dwpMountedHint}</span> : null}
        </div>
        {status !== '' ? <div className="wesync-status">{status}</div> : null}
      </div>
      <div className="wesync-card">
        <div className="wesync-sub">{t.visualTitle}</div>
        <div className="wesync-seg" role="group" aria-label={t.renderModeTitle}>
          {(['eco', 'perf', 'enhanced'] as const).map((m) => {
            const perfOff = m === 'perf' && store.settings.dwpMounted !== null
            return (
              <button
                key={m}
                type="button"
                disabled={perfOff}
                title={perfOff ? t.perfDisabledHint : ''}
                className={['wesync-seg-item', renderMode === m ? 'wesync-seg-active' : ''].join(' ')}
                onClick={() => onRenderMode(m)}
              >
                {m === 'eco' ? t.modeEco : m === 'perf' ? t.modePerf : t.modeEnhanced}
              </button>
            )
          })}
        </div>
        <div className="wesync-actions">
          <div className="wesync-focuswrap" onMouseEnter={() => setFocusHover(true)} onMouseLeave={() => setFocusHover(false)}>
            <button className={['wesync-btn', focus ? 'wesync-focusOn' : 'wesync-focusOff'].join(' ')} onClick={onFocus}>
              {t.focusMode}
            </button>
            {(focusHover || focus)
              ? (
                  <div className="wesync-focus-flyout">
                    {focus
                      ? (
                          <>
                            <button className={['wesync-btn', gazeEnabled ? 'wesync-focusOn' : 'wesync-focusOff'].join(' ')} onClick={() => { void onGazeToggle() }}>
                              {t.gazeMode}
                            </button>
                            <button className="wesync-btn" onClick={onCalibrate} disabled={!gazeEnabled}>
                              {t.gazeCalibrate}
                            </button>
                            <button className={['wesync-btn', gazeSnapText ? 'wesync-focusOn' : 'wesync-focusOff'].join(' ')} onClick={onToggleSnap}>
                              {t.gazeSnap}
                            </button>
                          </>
                        )
                      : <span className="wesync-focus-intro">{t.focusIntro}</span>}
                    {focus && (gazeEnabled && needsCalib
                      ? <span className="wesync-gaze-status is-error">{t.gazeNeedCalib}</span>
                      : gazeStatus === 'running'
                        ? <span className="wesync-gaze-status is-running">{t.gazeStatusRunning}</span>
                        : gazeStatus === 'error'
                          ? <span className="wesync-gaze-status is-error">{t.gazeStatusError}{gazeError !== '' ? '：' + gazeError : ''}</span>
                          : gazeEnabled
                            ? <span className="wesync-gaze-status is-loading">{t.gazeStatusLoading}</span>
                            : null)}
                  </div>
                )
              : null}
          </div>
        </div>
        {/* 专注模式开启时三个滑块由 FOCUS_WORK/IDLE + 注视点透镜接管，直接隐藏 */}
        {focus
          ? null
          : (
              <>
                <Slider label={t.panelAlpha} min={0} max={100} value={alpha} unit="%" onChange={onAlpha} />
                <Slider label={t.blur} min={0} max={30} value={blur} unit="px" onChange={onBlur} />
                <Slider label={t.shadow} min={0} max={100} value={shadow} unit="%" onChange={onShadow} />
              </>
            )}
      </div>
      <div className="wesync-card">
        <div className="wesync-apps">
          <div className="wesync-dirs">
            <div className="wesync-sub">{t.dirsTitle}</div>
            <div className="wesync-sub" style={{ fontSize: 11, opacity: 0.85 }}>{t.dirsHint}</div>
            <div className="wesync-dir-row">
              <input
                className="wesync-dir-input"
                placeholder={t.dirPlaceholder}
                value={dirInput}
                onChange={(e) => setDirInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void onAddDir() }}
              />
              <button className="wesync-btn" onClick={() => { void onAddDir() }}>{t.addDir}</button>
            </div>
            {dirStatus !== '' ? <div className="wesync-dir-status">{dirStatus}</div> : null}
            {dirs.length === 0
              ? <div className="wesync-dir-status">{t.dirEmpty}</div>
              : (
                  <div className="wesync-dir-list">
                    {dirs.map((dir) => (
                      <div key={dir} className="wesync-dir-item">
                        <span className="wesync-dir-path" title={dir}>{dir}</span>
                        <button className="wesync-dir-remove" onClick={() => { void onRemoveDir(dir) }}>{t.removeDir}</button>
                      </div>
                    ))}
                  </div>
                )}
          </div>
          <div className="wesync-apps-head">
            <div className="wesync-sub">{t.appsTitle}</div>
            <button className="wesync-btn" onClick={() => { void onAppsToggle() }}>
              {appsOpen ? t.collapse : t.listApps}
            </button>
          </div>
          {appsOpen
            ? (
                <>
                  <div className="wesync-apps-cats">
                    <button className={['wesync-chip', libTab === 'local' ? 'wesync-chip-on' : ''].join(' ')} onClick={() => setLibTab('local')}>{t.catLocal}</button>
                    <button className={['wesync-chip', libTab === 'market' ? 'wesync-chip-on' : ''].join(' ')} onClick={() => setLibTab('market')}>{t.catMarket}</button>
                  </div>
                  {libTab === 'local'
                    ? (
                        <>
                          <div className="wesync-apps-filters">
                            <button className={['wesync-chip', typeFilter === 'dwp' ? 'wesync-chip-on' : ''].join(' ')} onClick={() => { setTypeFilter('dwp'); setVisible(60) }}>
                              {t.typeDwp + ' ' + String(dwpCards.length)}
                            </button>
                            <button className={['wesync-chip', typeFilter === 'weapp' ? 'wesync-chip-on' : ''].join(' ')} onClick={() => { setTypeFilter('weapp'); setVisible(60) }}>
                              {t.typeWeApp + ' ' + String(weApps.length)}
                            </button>
                            <input
                              className="wesync-app-search"
                              placeholder={t.searchPlaceholder}
                              value={search}
                              onChange={(e) => { setSearch(e.target.value); setVisible(60) }}
                            />
                          </div>
                          {typeFilter === 'dwp'
                            ? (
                                dwpCards.length === 0
                                  ? <div className="wesync-app-empty">{t.dwpEmpty}</div>
                                  : filteredDwp.length === 0
                                    ? <div className="wesync-app-empty">{t.appsNoMatch}</div>
                                    : (
                                        <>
                                          <div className="wesync-apps-count">{t.appsCount(dwpCards.length, filteredDwp.length)}</div>
                                          <div className="wesync-apps-grid">
                                            {shownDwp.map((d) => (
                                              <div key={d.id} className="wesync-app-card" title={(store.settings.dwpMounted === d.id ? t.unmountHint : t.mountHint) + d.name} onClick={() => { void onToggleDwp(d.id) }}>
                                                <div className="wesync-app-thumbwrap">
                                                  {d.thumbnail !== ''
                                                    ? <img className="wesync-app-thumb" src={d.thumbnail} alt={d.name} loading="lazy" onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden' }} />
                                                    : <div className="wesync-app-thumb" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{t.noPreview}</div>}
                                                  <span className={'wesync-app-badge wesync-badge-' + (store.settings.dwpMounted === d.id ? 'video' : 'image')}>{store.settings.dwpMounted === d.id ? t.mounted : t.typeDwp}</span>
                                                </div>
                                                <div className="wesync-app-title">{d.name}</div>
                                              </div>
                                            ))}
                                          </div>
                                          {filteredDwp.length > shownDwp.length
                                            ? <button className="wesync-btn wesync-show-more" onClick={() => setVisible((v) => v + 60)}>{t.showMore + ' (+60)'}</button>
                                            : null}
                                        </>
                                      )
                              )
                            : (
                                weApps.length === 0
                                  ? <div className="wesync-app-empty">{t.weAppEmpty}</div>
                                  : filteredApps.length === 0
                                    ? <div className="wesync-app-empty">{t.appsNoMatch}</div>
                                    : (
                                        <>
                                          <div className="wesync-apps-count">{t.appsCount(weApps.length, filteredApps.length)}</div>
                                          <div className="wesync-apps-grid">
                                            {shownApps.map((app) => (
                                              <div key={app.id} className="wesync-app-card" title={t.openFolder + app.title} onClick={() => onAppOpen(app.id)}>
                                                <div className="wesync-app-thumbwrap">
                                                  {app.hasPreview
                                                    ? <img className="wesync-app-thumb" src={'/we-sync/apps/preview?id=' + encodeURIComponent(app.id)} alt={app.title} loading="lazy" />
                                                    : <div className="wesync-app-thumb" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{t.noPreview}</div>}
                                                  <span className="wesync-app-badge wesync-badge-application">{t.typeWeApp}</span>
                                                </div>
                                                <div className="wesync-app-title">{app.title}</div>
                                              </div>
                                            ))}
                                          </div>
                                          {filteredApps.length > shownApps.length
                                            ? <button className="wesync-btn wesync-show-more" onClick={() => setVisible((v) => v + 60)}>{t.showMore + ' (+60)'}</button>
                                            : null}
                                        </>
                                      )
                              )}
                        </>
                      )
                    : (
                        <>
                          <div className="wesync-apps-filters">
                            <button className={['wesync-chip', mTag === '' ? 'wesync-chip-on' : ''].join(' ')} onClick={() => setMTag('')}>{t.marketAll}</button>
                            {mTags.map((tg) => (
                              <button key={tg} className={['wesync-chip', mTag === tg ? 'wesync-chip-on' : ''].join(' ')} onClick={() => setMTag(tg)}>{tg}</button>
                            ))}
                            <input
                              className="wesync-app-search"
                              placeholder={t.marketSearch}
                              value={mSearch}
                              onChange={(e) => setMSearch(e.target.value)}
                            />
                            <button className="wesync-btn" onClick={() => { void loadMarket() }}>{t.marketRefresh}</button>
                          </div>
                          {mFlash !== '' ? <div className="wesync-market-flash">{mFlash}</div> : null}
                          {mLoading
                            ? <div className="wesync-app-empty">{t.marketLoading}</div>
                            : mError !== ''
                              ? <div className="wesync-app-empty">{t.marketLoadFailed}</div>
                              : mCards.length === 0
                                ? <div className="wesync-app-empty">{t.marketEmpty}</div>
                                : mShown.length === 0
                                  ? <div className="wesync-app-empty">{t.marketNoMatch}</div>
                                  : (
                                      <div className="wesync-apps-grid">
                                        {mShown.map((c) => {
                                          const busyId = mBusy[c.entry.id] === true
                                          const mName = resolveLang() === 'en' ? c.entry.name.en : c.entry.name.zh
                                          const mInstalled = c.state === 'installed' || c.state === 'update'
                                          return (
                                            <div key={c.entry.id} className="wesync-app-card wesync-market-card">
                                              <div className="wesync-app-thumbwrap">
                                                <img className="wesync-app-thumb" src={c.entry.dwp.thumbnail} alt={mName} loading="lazy"
                                                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden' }} />
                                                <span className={'wesync-app-badge wesync-badge-' + (c.state === 'installed' ? 'image' : c.state === 'update' ? 'video' : 'web')}>
                                                  {c.state === 'installed' ? t.marketInstalled : c.state === 'update' ? t.marketUpdate : ''}
                                                </span>
                                              </div>
                                              <div className="wesync-app-title">{mName}</div>
                                              <div className="wesync-market-meta">{t.marketBy} {c.entry.author}{c.installedVersion ? ' · ' + t.marketInstalledAt + ' ' + c.installedVersion : ''}</div>
                                              <div className="wesync-market-actions">
                                                {c.state === 'absent' || c.state === 'update'
                                                  ? <button className="wesync-btn wesync-market-install" disabled={busyId} onClick={() => { void mInstall(c.entry.id, c.state === 'update') }}>
                                                      {busyId ? t.marketInstalling : c.state === 'update' ? t.marketUpdate : t.marketInstall}
                                                    </button>
                                                  : null}
                                                {c.state === 'installed'
                                                  ? <button className="wesync-btn wesync-market-uninstall" disabled={busyId} onClick={() => { void mUninstall(c.entry.id) }}>{t.marketUninstall}</button>
                                                  : null}
                                              </div>
                                            </div>
                                          )
                                        })}
                                      </div>
                                    )}
                        </>
                      )}
                </>
              )
            : null}
        </div>
      </div>
    </div>
  )
}

function Slider(props: {
  label: string
  min: number
  max: number
  value: number
  unit: string
  disabled?: boolean
  onChange: (v: number) => void
}) {
  return (
    <div className="wesync-row" style={props.disabled === true ? { opacity: 0.45 } : undefined}>
      <label>{props.label}</label>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={1}
        value={props.value}
        disabled={props.disabled}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
      <output>{String(props.value) + props.unit}</output>
    </div>
  )
}