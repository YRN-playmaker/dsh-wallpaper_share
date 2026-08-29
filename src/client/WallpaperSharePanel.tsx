/**
 * wallpaper_share 会话视图标签页：当前壁纸信息、同步开关、显示器选择、
 * 专注模式、渲染模式，以及透明度 / 模糊 / 阴影三个滑块（即时生效）。
 * 样式类名由 PANEL_CSS 在 apply 阶段注入，不依赖 CSS Modules。
 */
import { useEffect, useState } from 'react'
import { store, type WeSyncInfo } from './index'
import { startGaze, stopGaze, calibrate, onGazeStatus, type GazeStatus } from './GazeLens.ts'

/* =========================================================================
 * 1. 国际化字典 (i18n Dictionary)
 * ========================================================================= */
const DICT = {
  zh: {
    // 头部与壁纸状态
    noWallpaper: 'Wallpaper Engine 尚未应用壁纸',
    webNoPreview: '当前为网页壁纸（无本地预览）',
    applyHint: '在 Wallpaper Engine 中应用壁纸后，此处会同步显示',
    staticSynced: ' · 已同步静态预览',
    noStaticPreview: ' · 无静态预览图',
    monitorPrefix: ' · 显示器 ',
    modelRender: 'model 渲染',
    fallbackPrefix: 'fallback:',

    // 显示器
    bgMonitor: '背景显示器',
    autoFollowLatest: '自动 · 跟随最新变化',
    auto: 'auto',

    // 同步按钮
    syncOn: '⏻ 同步开启',
    syncOff: '⏻ 同步关闭',
    flashSyncOn: '已开启壁纸同步',
    flashSyncOff: '已关闭壁纸同步',

    // 视觉效果与专注模式
    visualTitle: '视觉效果 · 即时生效',
    focusMode: '专注模式',
    flashFocusOn: '专注模式已开启：任务中 20%/9px/75% · 空闲 9%/6px/40% · 任务进行中鼠标注视点 30%/15px/90%',
    flashFocusOff: '专注模式已关闭，恢复手动滑块',

    // 渲染模式（三档滑块：节能 / 性能 / 增强）
    renderModeTitle: '渲染模式',
    modeEco: '节能',
    modePerf: '性能',
    modeEnhanced: '增强',
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
    gazeStarting: '眼动：加载模型并请求摄像头…（无需校准，随日常鼠标使用自动学习）',
    gazeOff: '眼动追踪已关闭（摄像头已释放）',
    gazeNeedOn: '请先开启眼动追踪再校准',
    gazeCalibHint: '校准：依次注视并点击 9 个黄点（Esc 取消）',
    gazeCalibDone: '校准完成，透镜将跟随视线',
    gazeCalibCancel: '校准已取消',
    gazeStatusRunning: '· 视线跟随中',
    gazeStatusLoading: '· 眼动加载中…',
    gazeStatusError: '· 眼动出错',
    lensCenterClear: '圆心清晰',
    lensCenterBlur: '圆心模糊',
    gazeSnap: '文字吸附',

    // 滑块
    panelAlpha: '面板透明度',
    blur: '背景模糊',
    shadow: '阴影深度',

    // 壁纸库（原"应用启动器"，现读取全部类型并支持筛选）
    appsTitle: '壁纸库 · 场景 / 视频 / 图片 / 应用 / 网页',
    collapse: '收起',
    listApps: '浏览壁纸',
    appsEmpty: '未找到壁纸（扫描 workshop + projects + 自定义目录）。点击卡片在资源管理器中打开所在文件夹。',
    appsNoMatch: '没有匹配当前筛选 / 搜索的壁纸',
    openFolder: '打开文件夹：',
    noPreview: '无预览',
    loadFailed: '列表加载失败',
    openFolderFailed: '打开文件夹失败',
    typeAll: '全部',
    typeScene: '场景',
    typeVideo: '视频',
    typeImage: '图片',
    typeApplication: '应用',
    typeWeb: '网页',
    typeOther: '其他',
    searchPlaceholder: '搜索标题…',
    showMore: '显示更多',
    appsCount: (total: number, matched: number) => (total === matched ? `共 ${String(total)} 个` : `共 ${String(total)} 个 · 匹配 ${String(matched)} 个`),

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
    staticSynced: ' · Static preview synced',
    noStaticPreview: ' · No static preview',
    monitorPrefix: ' · Monitor ',
    modelRender: 'model render',
    fallbackPrefix: 'fallback:',

    // Monitor
    bgMonitor: 'Background Monitor',
    autoFollowLatest: 'Auto · Follow Latest',
    auto: 'auto',

    // Sync button
    syncOn: '⏻ Sync Enabled',
    syncOff: '⏻ Sync Disabled',
    flashSyncOn: 'Wallpaper sync enabled',
    flashSyncOff: 'Wallpaper sync disabled',

    // Visuals & Focus mode
    visualTitle: 'Visual Adjustments · Instant',
    focusMode: 'Focus Mode',
    flashFocusOn: 'Focus mode on: task 20%/9px/75% · idle 9%/6px/40% · gaze lens 30%/15px/90% while a task runs',
    flashFocusOff: 'Focus mode off, manual sliders restored',

    // Render mode (3-segment slider: Eco / Perf / Enhanced)
    renderModeTitle: 'Render Mode',
    modeEco: 'Eco',
    modePerf: 'Perf',
    modeEnhanced: 'Enhanced',
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
    gazeStarting: 'Eye tracking: loading model & requesting camera… (no calibration — self-learns from mouse use)',
    gazeOff: 'Eye tracking off (camera released)',
    gazeNeedOn: 'Enable eye tracking before calibrating',
    gazeCalibHint: 'Calibration: look at and click each of the 9 yellow dots (Esc to cancel)',
    gazeCalibDone: 'Calibrated — lens will follow your gaze',
    gazeCalibCancel: 'Calibration cancelled',
    gazeStatusRunning: '· gaze following',
    gazeStatusLoading: '· eye tracking loading…',
    gazeStatusError: '· eye tracking error',
    lensCenterClear: 'Clear center',
    lensCenterBlur: 'Blur center',
    gazeSnap: 'Text snap',

    // Sliders
    panelAlpha: 'Panel Transparency',
    blur: 'Background Blur',
    shadow: 'Shadow Depth',

    // Wallpaper library (was "App Launcher"; now all types with filtering)
    appsTitle: 'Wallpaper Library · Scene / Video / Image / App / Web',
    collapse: 'Collapse',
    listApps: 'Browse Wallpapers',
    appsEmpty: 'No wallpapers found (scanned workshop + projects + custom dirs). Click a card to open its folder in File Explorer.',
    appsNoMatch: 'No wallpapers match the current filter / search',
    openFolder: 'Open folder: ',
    noPreview: 'No Preview',
    loadFailed: 'Failed to load list',
    openFolderFailed: 'Failed to open folder',
    typeAll: 'All',
    typeScene: 'Scene',
    typeVideo: 'Video',
    typeImage: 'Image',
    typeApplication: 'App',
    typeWeb: 'Web',
    typeOther: 'Other',
    searchPlaceholder: 'Search titles…',
    showMore: 'Show more',
    appsCount: (total: number, matched: number) => (total === matched ? `Total ${String(total)}` : `Total ${String(total)} · Matched ${String(matched)}`),

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
  const [renderMode, setRenderMode] = useState(store.settings.renderMode)
  const [gazeEnabled, setGazeEnabled] = useState(store.settings.gazeEnabled)
  const [gazeStatus, setGazeStatus] = useState<GazeStatus>('off')
  const [gazeError, setGazeError] = useState('')
  const [lensCenterClear, setLensCenterClear] = useState(store.settings.lensCenterClear)
  const [gazeSnapText, setGazeSnapText] = useState(store.settings.gazeSnapText)
  useEffect(() => onGazeStatus((s, err) => { setGazeStatus(s); setGazeError(err) }), [])
  const [appsOpen, setAppsOpen] = useState(false)
  const [apps, setApps] = useState<Array<{ id: string; title: string; file: string; type: string; hasPreview: boolean }>>([])
  const [appsCounts, setAppsCounts] = useState<Record<string, number>>({})
  const [typeFilter, setTypeFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [visible, setVisible] = useState(60)
  const [appsError, setAppsError] = useState('')
  const [dirs, setDirs] = useState<string[]>([])
  const [dirInput, setDirInput] = useState('')
  const [dirStatus, setDirStatus] = useState('')

  useEffect(() => store.subscribe(() => {
    setInfo(store.info)
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
    } else {
      stopGaze()
      flash(t.gazeOff)
    }
    store.notify()
  }

  const onCalibrate = (): void => {
    if (!store.settings.gazeEnabled) { flash(t.gazeNeedOn); return }
    flash(t.gazeCalibHint)
    calibrate((completed) => { flash(completed ? t.gazeCalibDone : t.gazeCalibCancel) })
  }

  const onToggleLensCenter = (): void => {
    const next = !store.settings.lensCenterClear
    store.settings.lensCenterClear = next
    setLensCenterClear(next)
    store.notify()
  }

  const onToggleSnap = (): void => {
    const next = !store.settings.gazeSnapText
    store.settings.gazeSnapText = next
    setGazeSnapText(next)
    store.notify()
  }

  // 壁纸库：列出全部类型壁纸（场景/视频/图片/应用/网页）；点击缩略图卡片在资源管理器中打开所在文件夹
  const onAppsToggle = async (): Promise<void> => {
    const next = !appsOpen
    setAppsOpen(next)
    if (next) void loadApps()
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

  // 壁纸库：类型 + 标题搜索的前端筛选（数据一次性来自 /we-sync/apps 缓存）
  const typeLabel = (tp: string): string =>
    tp === 'scene' ? t.typeScene
      : tp === 'video' ? t.typeVideo
        : tp === 'image' ? t.typeImage
          : tp === 'application' ? t.typeApplication
            : tp === 'web' ? t.typeWeb
              : t.typeOther
  // 全部 / 场景 / 视频 / 图片 / 应用 恒显示（用户要求的四类筛选）；网页 / 其他 仅在有内容时出现
  const filterTypes = ['all', 'scene', 'video', 'image', 'application']
    .concat((appsCounts.web ?? 0) > 0 ? ['web'] : [])
    .concat((appsCounts.other ?? 0) > 0 ? ['other'] : [])
  const kw = search.trim().toLowerCase()
  const filteredApps = apps.filter((a) => (typeFilter === 'all' || a.type === typeFilter) && (kw === '' || a.title.toLowerCase().includes(kw)))
  const shownApps = filteredApps.slice(0, visible)

  const wallpaper = info !== null && info.wallpaper !== null ? info.wallpaper : null
  const title = wallpaper === null
    ? (info !== null && info.kind === 'web' ? t.webNoPreview : t.noWallpaper)
    : wallpaper.title
  const subtitle = wallpaper === null
    ? t.applyHint
    : wallpaper.type +
      (info !== null && info.kind === 'image' ? t.staticSynced : t.noStaticPreview) +
      (info !== null && info.monitor !== '' ? t.monitorPrefix + info.monitor : '') +
      (info !== null && info.source.kind === 'scene' && info.scene !== null
        ? ' · Scene[' + (renderMode === 'eco' ? 'eco' : info.scene.live === true ? 'external' : 'browser') + '] ' + (info.scene.live ? 'live ' + String(info.scene.status?.fps ?? '?') + 'fps' : (info.scene.model === true ? t.modelRender : t.fallbackPrefix + info.scene.fallback))
        : '')

  const monitors = info !== null && Array.isArray(info.monitors) && info.monitors.length > 1 ? info.monitors : null

  return (
    <div className="wesync-panel">
      <div className="wesync-card">
        <div className="wesync-title">{title}</div>
        <div className="wesync-sub">{subtitle}</div>
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
          <button className="wesync-btn" onClick={onPower}>
            {enabled ? t.syncOn : t.syncOff}
          </button>
        </div>
        {status !== '' ? <div className="wesync-status">{status}</div> : null}
      </div>
      <div className="wesync-card">
        <div className="wesync-sub">{t.visualTitle}</div>
        <div className="wesync-actions">
          <button className={['wesync-btn', focus ? 'wesync-focusOn' : 'wesync-focusOff'].join(' ')} onClick={onFocus}>
            {t.focusMode}
          </button>
        </div>
        <div className="wesync-seg" role="group" aria-label={t.renderModeTitle}>
          {(['eco', 'perf', 'enhanced'] as const).map((m) => (
            <button
              key={m}
              type="button"
              className={['wesync-seg-item', renderMode === m ? 'wesync-seg-active' : ''].join(' ')}
              onClick={() => onRenderMode(m)}
            >
              {m === 'eco' ? t.modeEco : m === 'perf' ? t.modePerf : t.modeEnhanced}
            </button>
          ))}
        </div>
        <div className="wesync-actions">
          <button className={['wesync-btn', gazeEnabled ? 'wesync-focusOn' : 'wesync-focusOff'].join(' ')} onClick={() => { void onGazeToggle() }}>
            {t.gazeMode}
          </button>
          <button className="wesync-btn" onClick={onCalibrate} disabled={!gazeEnabled}>
            {t.gazeCalibrate}
          </button>
          <button className="wesync-btn" onClick={onToggleLensCenter}>
            {lensCenterClear ? t.lensCenterClear : t.lensCenterBlur}
          </button>
          <button className={['wesync-btn', gazeSnapText ? 'wesync-focusOn' : 'wesync-focusOff'].join(' ')} onClick={onToggleSnap}>
            {t.gazeSnap}
          </button>
          {gazeStatus === 'running'
            ? <span style={{ fontSize: '11px', color: '#7ee2a8', alignSelf: 'center' }}>{t.gazeStatusRunning}</span>
            : gazeStatus === 'error'
              ? <span style={{ fontSize: '11px', color: '#fdba74', alignSelf: 'center' }}>{t.gazeStatusError}{gazeError !== '' ? '：' + gazeError : ''}</span>
              : gazeEnabled
                ? <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.6)', alignSelf: 'center' }}>{t.gazeStatusLoading}</span>
                : null}
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
                appsError !== ''
                  ? <div className="wesync-app-empty">{appsError}</div>
                  : apps.length === 0
                    ? <div className="wesync-app-empty">{t.appsEmpty}</div>
                    : (
                        <>
                          <div className="wesync-apps-filters">
                            {filterTypes.map((tp) => (
                              <button
                                key={tp}
                                className={['wesync-chip', typeFilter === tp ? 'wesync-chip-on' : ''].join(' ')}
                                onClick={() => { setTypeFilter(tp); setVisible(60) }}
                              >
                                {(tp === 'all' ? t.typeAll : typeLabel(tp)) + ' ' + String(tp === 'all' ? (appsCounts.all ?? apps.length) : (appsCounts[tp] ?? 0))}
                              </button>
                            ))}
                            <input
                              className="wesync-app-search"
                              placeholder={t.searchPlaceholder}
                              value={search}
                              onChange={(e) => { setSearch(e.target.value); setVisible(60) }}
                            />
                          </div>
                          <div className="wesync-apps-count">{t.appsCount(apps.length, filteredApps.length)}</div>
                          {filteredApps.length === 0
                            ? <div className="wesync-app-empty">{t.appsNoMatch}</div>
                            : (
                                <>
                                  <div className="wesync-apps-grid">
                                    {shownApps.map((app) => (
                                      <div key={app.id} className="wesync-app-card" title={t.openFolder + app.title} onClick={() => onAppOpen(app.id)}>
                                        <div className="wesync-app-thumbwrap">
                                          {app.hasPreview
                                            ? <img className="wesync-app-thumb" src={'/we-sync/apps/preview?id=' + encodeURIComponent(app.id)} alt={app.title} loading="lazy" />
                                            : <div className="wesync-app-thumb" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{t.noPreview}</div>}
                                          <span className={'wesync-app-badge wesync-badge-' + app.type}>{typeLabel(app.type)}</span>
                                        </div>
                                        <div className="wesync-app-title">{app.title}</div>
                                      </div>
                                    ))}
                                  </div>
                                  {filteredApps.length > shownApps.length
                                    ? <button className="wesync-btn wesync-show-more" onClick={() => setVisible((v) => v + 60)}>{t.showMore + ' (+60)'}</button>
                                    : null}
                                </>
                              )}
                        </>
                      )
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