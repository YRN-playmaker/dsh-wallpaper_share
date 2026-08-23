/**
 * wallpaper_share 会话视图标签页：当前壁纸信息、同步开关、显示器选择、
 * 专注模式、渲染模式，以及透明度 / 模糊 / 阴影三个滑块（即时生效）。
 * 样式类名由 PANEL_CSS 在 apply 阶段注入，不依赖 CSS Modules。
 */
import { useEffect, useState } from 'react'
import { store, type WeSyncInfo, FOCUS_WORK, FOCUS_IDLE } from './index'

export function WallpaperSharePanel() {
  const [, force] = useState(0)
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

  useEffect(() => store.subscribe(() => {
    setInfo(store.info)
    force((x) => x + 1)
  }), [])

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
    flash(next ? '已开启壁纸同步' : '已关闭壁纸同步')
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
    flash(next ? '专注模式已开启：任务中 30%/15px/90%，空闲 9%/6px/40%' : '专注模式已关闭，恢复手动滑块')
  }

  const onRenderMode = (): void => {
    const next: 'preview' | 'source' = store.settings.renderMode === 'source' ? 'preview' : 'source'
    store.settings.renderMode = next
    setRenderMode(next)
    store.actions.applyBackground()
    if (next === 'source') {
      const kind = store.info !== null ? store.info.source.kind : ''
      if (kind === 'video') flash('增强模式：播放壁纸源视频')
      else if (kind === 'web') flash('增强模式：加载 Web 壁纸页面')
      else if (kind === 'scene') flash(store.info?.scene?.live === true
        ? '增强模式：Scene 实时渲染中'
        : '增强模式：Scene（renderer 未出帧，回退纹理/预览）')
      else flash('当前壁纸（' + (kind === '' ? '无' : kind) + '）仅支持预览，增强模式自动回退')
    } else {
      flash('性能模式：使用静态预览图')
    }
  }

  // 应用启动器：列出 type=application 壁纸；点击缩略图在资源管理器中打开所在文件夹
  const onAppsToggle = async (): Promise<void> => {
    const next = !appsOpen
    setAppsOpen(next)
    if (next && apps.length === 0) {
      try {
        const res = await fetch('/we-sync/apps', { cache: 'no-store' })
        const body = (await res.json()) as { apps?: Array<{ id: string; title: string; file: string; hasPreview: boolean }>; error?: string }
        if (body.error !== undefined) setAppsError(body.error)
        else setApps(body.apps ?? [])
      } catch {
        setAppsError('列表加载失败')
      }
    }
  }

  const onAppOpen = (id: string): void => {
    void fetch('/we-sync/apps/open?id=' + encodeURIComponent(id), { cache: 'no-store' }).then((res) => {
      if (!res.ok) flash('打开文件夹失败')
    }).catch(() => flash('打开文件夹失败'))
  }

  const wallpaper = info !== null && info.wallpaper !== null ? info.wallpaper : null
  const title = wallpaper === null
    ? (info !== null && info.kind === 'web' ? '当前为网页壁纸（无本地预览）' : 'Wallpaper Engine 尚未应用壁纸')
    : wallpaper.title
  const subtitle = wallpaper === null
    ? '在 Wallpaper Engine 中应用壁纸后，此处会同步显示'
    : wallpaper.type + (info !== null && info.kind === 'image' ? ' · 已同步静态预览' : ' · 无静态预览图') + (info !== null && info.monitor !== '' ? ' · 显示器 ' + info.monitor : '') + (info !== null && info.kind === 'scene' && info.scene !== null ? ' · Scene[' + (info.scene.mode ?? 'browser') + '] ' + (info.scene.live ? 'live ' + String(info.scene.status?.fps ?? '?') + 'fps' : (info.scene.model === true ? 'model 渲染' : 'fallback:' + info.scene.fallback)) : '')

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
                <label>背景显示器</label>
                <select
                  className="wesync-select"
                  value={monitor}
                  onChange={(e) => onMonitor(e.target.value)}
                >
                  <option value="">自动 · 跟随最新变化</option>
                  {monitors.map((m) => (
                    <option key={m.key} value={m.key}>{m.key + ' · ' + m.title}</option>
                  ))}
                </select>
                <output>{monitor === '' ? 'auto' : monitor}</output>
              </div>
            )
          : null}
        <div className="wesync-actions">
          <button className="wesync-btn" onClick={onPower}>
            {enabled ? '⏻ 同步开启' : '⏻ 同步关闭'}
          </button>
        </div>
        {status !== '' ? <div className="wesync-status">{status}</div> : null}
      </div>
      <div className="wesync-card">
        <div className="wesync-sub">视觉效果 · 即时生效</div>
        <div className="wesync-actions">
          <button className={['wesync-btn', focus ? 'wesync-focusOn' : 'wesync-focusOff'].join(' ')} onClick={onFocus}>
            {focus
              ? (store.settings.taskActive ? '专注模式 · 任务进行中' : '专注模式 · 已完成')
              : '开启专注模式'}
          </button>
          <button className={['wesync-btn', renderMode === 'source' ? 'wesync-sourceOn' : 'wesync-sourceOff'].join(' ')} onClick={onRenderMode}>
            {renderMode === 'source' ? '渲染：增强（源文件）' : '渲染：性能（预览）'}
          </button>
        </div>
        <Slider label="面板透明度" min={0} max={100} value={focusVisuals !== null ? focusVisuals.panelAlpha : alpha} unit="%" disabled={focusVisuals !== null} onChange={onAlpha} />
        <Slider label="背景模糊" min={0} max={30} value={focusVisuals !== null ? focusVisuals.blur : blur} unit="px" disabled={focusVisuals !== null} onChange={onBlur} />
        <Slider label="阴影深度" min={0} max={100} value={focusVisuals !== null ? focusVisuals.shadow : shadow} unit="%" disabled={focusVisuals !== null} onChange={onShadow} />
      </div>
      <div className="wesync-card">
        <div className="wesync-apps">
          <div className="wesync-apps-head">
            <div className="wesync-sub">应用启动器 · 新版 WE 不再支持的应用类壁纸</div>
            <button className="wesync-btn" onClick={() => { void onAppsToggle() }}>
              {appsOpen ? '收起' : '列出应用壁纸'}
            </button>
          </div>
          {appsOpen
            ? (
                appsError !== ''
                  ? <div className="wesync-app-empty">{appsError}</div>
                  : apps.length === 0
                    ? <div className="wesync-app-empty">未找到 application 类型壁纸（扫描 workshop + projects 目录）。点击卡片在资源管理器中打开所在文件夹。</div>
                    : (
                        <div className="wesync-apps-grid">
                          {apps.map((app) => (
                            <div key={app.id} className="wesync-app-card" title={'打开文件夹：' + app.title} onClick={() => onAppOpen(app.id)}>
                              {app.hasPreview
                                ? <img className="wesync-app-thumb" src={'/we-sync/apps/preview?id=' + encodeURIComponent(app.id)} alt={app.title} loading="lazy" />
                                : <div className="wesync-app-thumb" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>无预览</div>}
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
