/**
 * wallpaper_share 会话视图标签页：当前壁纸信息、同步开关、显示器选择、
 * 专注模式、渲染模式，以及透明度 / 模糊 / 阴影三个滑块（即时生效）。
 * 样式类名由 PANEL_CSS 在 apply 阶段注入，不依赖 CSS Modules。
 */
import { useEffect, useState } from 'react'
import { store, type WeSyncInfo, FOCUS_WORK, FOCUS_IDLE } from './index'

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
    focusOnTask: '专注模式 · 任务进行中',
    focusOnDone: '专注模式 · 已完成',
    enableFocus: '开启专注模式',
    flashFocusOn: '专注模式已开启：任务中 30%/15px/90%，空闲 9%/6px/40%',
    flashFocusOff: '专注模式已关闭，恢复手动滑块',

    // 渲染模式
    renderSource: '渲染：增强（源文件）',
    renderPreview: '渲染：性能（预览）',
    flashVideo: '增强模式：播放壁纸源视频',
    flashWeb: '增强模式：加载 Web 壁纸页面',
    flashSceneLive: '增强模式：Scene 实时渲染中',
    flashSceneFallback: '增强模式：Scene（renderer 未出帧，回退纹理/预览）',
    flashPreviewOnly: (kind: string) => `当前壁纸（${kind === '' ? '无' : kind}）仅支持预览，增强模式自动回退`,
    flashPerf: '性能模式：使用静态预览图',

    // 滑块
    panelAlpha: '面板透明度',
    blur: '背景模糊',
    shadow: '阴影深度',

    // 应用启动器
    appsTitle: '应用启动器 · 新版 WE 不再支持的应用类壁纸',
    collapse: '收起',
    listApps: '列出应用壁纸',
    appsEmpty: '未找到 application 类型壁纸（扫描 workshop + projects 目录）。点击卡片在资源管理器中打开所在文件夹。',
    openFolder: '打开文件夹：',
    noPreview: '无预览',
    loadFailed: '列表加载失败',
    openFolderFailed: '打开文件夹失败',

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
    focusOnTask: 'Focus Mode · Task in Progress',
    focusOnDone: 'Focus Mode · Completed',
    enableFocus: 'Enable Focus Mode',
    flashFocusOn: 'Focus mode on: Task 30%/15px/90%, Idle 9%/6px/40%',
    flashFocusOff: 'Focus mode off, manual sliders restored',

    // Render mode
    renderSource: 'Render: Enhanced (Source)',
    renderPreview: 'Render: Performance (Preview)',
    flashVideo: 'Enhanced mode: Playing source video',
    flashWeb: 'Enhanced mode: Loading Web wallpaper',
    flashSceneLive: 'Enhanced mode: Scene live rendering',
    flashSceneFallback: 'Enhanced mode: Scene (renderer no frame, fallback texture/preview)',
    flashPreviewOnly: (kind: string) => `Current wallpaper (${kind === '' ? 'none' : kind}) only supports preview, falling back`,
    flashPerf: 'Performance mode: Using static preview',

    // Sliders
    panelAlpha: 'Panel Transparency',
    blur: 'Background Blur',
    shadow: 'Shadow Depth',

    // App Launcher
    appsTitle: 'App Launcher · Application wallpapers no longer supported in newer WE',
    collapse: 'Collapse',
    listApps: 'List App Wallpapers',
    appsEmpty: 'No application-type wallpapers found (scanned workshop + projects). Click card to open folder in File Explorer.',
    openFolder: 'Open folder: ',
    noPreview: 'No Preview',
    loadFailed: 'Failed to load list',
    openFolderFailed: 'Failed to open folder',

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
 * 2. 语言监听 Hook
 * ========================================================================= */
function useDshLocale(ctx?: any) {
  const detectLang = (): Lang => {
    // 优先读取 Harness 提供的 locale 服务偏好
    const harnessLang = ctx?.locale?.current || ctx?.locale?.preference || (store as any)?.ctx?.locale?.current
    if (typeof harnessLang === 'string') {
      return harnessLang.toLowerCase().startsWith('en') ? 'en' : 'zh'
    }
    // 次级读取 document 的 lang 属性或系统语言
    if (typeof document !== 'undefined' && document.documentElement.lang?.toLowerCase().startsWith('en')) {
      return 'en'
    }
    if (typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('en')) {
      return 'en'
    }
    return 'zh'
  }

  const [lang, setLang] = useState<Lang>(detectLang)

  useEffect(() => {
    // 1. 订阅 DSH 官方 locale/change 事件
    const targetCtx = ctx || (store as any)?.ctx
    if (targetCtx?.on) {
      const dispose = targetCtx.on('locale/change', (newLang: string) => {
        setLang(newLang?.toLowerCase().startsWith('en') ? 'en' : 'zh')
      })
      return () => dispose?.()
    }

    // 2. 降级：监听 <html lang="..."> 属性变化
    if (typeof MutationObserver !== 'undefined' && document?.documentElement) {
      const observer = new MutationObserver(() => {
        const docLang = document.documentElement.lang
        setLang(docLang?.toLowerCase().startsWith('en') ? 'en' : 'zh')
      })
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] })
      return () => observer.disconnect()
    }
  }, [ctx])

  const t = DICT[lang]
  return { lang, t }
}

/* =========================================================================
 * 3. 主面板组件
 * ========================================================================= */
export function WallpaperSharePanel(props?: { ctx?: any }) {
  const [, force] = useState(0)
  const { t } = useDshLocale(props?.ctx)

  const [info, setInfo] = useState<WeSyncInfo | null>(store.info)
  const [enabled, setEnabled] = useState(store.settings.enabled)
  const [alpha, setAlpha] = useState(store.settings.panelAlpha)
  const [blur, setBlur] = useState(store.settings.blur)
  const [shadow, setShadow] = useState(store.settings.shadow)
  const [status, setStatus] = useState('')
  const [monitor, setMonitor] = useState(store.settings.monitor)
  const [focus, setFocus] = useState(store.settings.focus)
  const [renderMode, setRenderMode] = useState(store.settings.renderMode)
  const [appsOpen, setAppsOpen] = useState(false)
  const [apps, setApps] = useState<Array<{ id: string; title: string; file: string; hasPreview: boolean }>>([])
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

  const onRenderMode = (): void => {
    const next: 'preview' | 'source' = store.settings.renderMode === 'source' ? 'preview' : 'source'
    store.settings.renderMode = next
    setRenderMode(next)
    store.actions.applyBackground()
    if (next === 'source') {
      const kind = store.info !== null ? store.info.source.kind : ''
      if (kind === 'video') flash(t.flashVideo)
      else if (kind === 'web') flash(t.flashWeb)
      else if (kind === 'scene') flash(store.info?.scene?.live === true ? t.flashSceneLive : t.flashSceneFallback)
      else flash(t.flashPreviewOnly(kind))
    } else {
      flash(t.flashPerf)
    }
  }

  // 应用启动器：列出 type=application 壁纸；点击缩略图在资源管理器中打开所在文件夹
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
      const body = (await res.json()) as { apps?: Array<{ id: string; title: string; file: string; hasPreview: boolean }>; error?: string }
      if (body.error !== undefined) setAppsError(body.error)
      else setApps(body.apps ?? [])
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

  const wallpaper = info !== null && info.wallpaper !== null ? info.wallpaper : null
  const title = wallpaper === null
    ? (info !== null && info.kind === 'web' ? t.webNoPreview : t.noWallpaper)
    : wallpaper.title
  const subtitle = wallpaper === null
    ? t.applyHint
    : wallpaper.type +
      (info !== null && info.kind === 'image' ? t.staticSynced : t.noStaticPreview) +
      (info !== null && info.monitor !== '' ? t.monitorPrefix + info.monitor : '') +
      (info !== null && info.kind === 'scene' && info.scene !== null
        ? ' · Scene[' + (info.scene.mode ?? 'browser') + '] ' + (info.scene.live ? 'live ' + String(info.scene.status?.fps ?? '?') + 'fps' : (info.scene.model === true ? t.modelRender : t.fallbackPrefix + info.scene.fallback))
        : '')

  const monitors = info !== null && Array.isArray(info.monitors) && info.monitors.length > 1 ? info.monitors : null
  const focusVisuals = focus ? (store.settings.taskActive ? FOCUS_WORK : FOCUS_IDLE) : null

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
            {focus
              ? (store.settings.taskActive ? t.focusOnTask : t.focusOnDone)
              : t.enableFocus}
          </button>
          <button className={['wesync-btn', renderMode === 'source' ? 'wesync-sourceOn' : 'wesync-sourceOff'].join(' ')} onClick={onRenderMode}>
            {renderMode === 'source' ? t.renderSource : t.renderPreview}
          </button>
        </div>
        <Slider label={t.panelAlpha} min={0} max={100} value={focusVisuals !== null ? focusVisuals.panelAlpha : alpha} unit="%" disabled={focusVisuals !== null} onChange={onAlpha} />
        <Slider label={t.blur} min={0} max={30} value={focusVisuals !== null ? focusVisuals.blur : blur} unit="px" disabled={focusVisuals !== null} onChange={onBlur} />
        <Slider label={t.shadow} min={0} max={100} value={focusVisuals !== null ? focusVisuals.shadow : shadow} unit="%" disabled={focusVisuals !== null} onChange={onShadow} />
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
                        <div className="wesync-apps-grid">
                          {apps.map((app) => (
                            <div key={app.id} className="wesync-app-card" title={t.openFolder + app.title} onClick={() => onAppOpen(app.id)}>
                              {app.hasPreview
                                ? <img className="wesync-app-thumb" src={'/we-sync/apps/preview?id=' + encodeURIComponent(app.id)} alt={app.title} loading="lazy" />
                                : <div className="wesync-app-thumb" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{t.noPreview}</div>}
                              <div className="wesync-app-title">{app.title}</div>
                            </div>
                          ))}
                        </div>
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