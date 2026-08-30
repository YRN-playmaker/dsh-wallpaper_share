/**
 * wallpaper_market 会话视图标签页：浏览 dwp-registry 目录 + 安装/更新/卸载（免费 only）
 * + 渲染面：点"应用"把已装 DWP 用 @dwp/web mount() 画进预览 canvas（所见即壁纸）。
 * 与 wallpaper_share 分工：本窗口管"拉取 + 预览应用"，已拉内容的库管理在 share 侧。
 * 逻辑在 market-api.ts（可 Node 测）+ dwp-stage.ts（浏览器渲染）；本组件仅渲染与事件。
 * 复用 PANEL_CSS 的 wesync- 类，市场专有样式见 panelStyle.ts 的 MARKET_CSS。
 */
import { useEffect, useRef, useState } from 'react'
import { store } from './index'
import {
  fetchCatalog, fetchInstalled, buildCards, searchCards, collectTags,
  install, uninstall, applyDwp, unapplyDwp, fetchApplied,
  type MarketCard, type Fetch, type AppliedInfo,
} from './market-api.ts'
import { mountDwp } from './dwp-stage.ts'
import type { Handle } from 'dwp-web'

type Lang = 'zh' | 'en'
function lang(): Lang {
  const l = store.locale
  if (l === 'zh' || l === 'en') return l
  if (typeof document !== 'undefined' && (document.documentElement.lang ?? '').toLowerCase().startsWith('en')) return 'en'
  return 'zh'
}

const DICT: Record<Lang, Record<string, string>> = {
  zh: {
    title: '壁纸市场', subtitle: '浏览并拉取 DWP 壁纸',
    refresh: '刷新', search: '搜索名称 / 作者…', all: '全部',
    install: '安装', installing: '安装中…', update: '更新', installed: '已安装', uninstall: '卸载',
    apply: '应用', unapply: '取消应用', current: '当前',
    empty: '目录为空', loading: '加载中…', noMatch: '无匹配结果',
    loadFailed: '目录加载失败（node 半 market 路由未就绪？）',
    by: '作者', installedAt: '已装',
    flashInstalled: '已安装', flashUpdated: '已更新', flashUninstalled: '已卸载', flashApplied: '已应用', flashFailed: '操作失败',
    stageEmpty: '点已装壁纸的「应用」即可在此预览渲染效果', stageMode: '渲染', degraded: '降级',
  },
  en: {
    title: 'Wallpaper Market', subtitle: 'Browse and pull DWP wallpapers',
    refresh: 'Refresh', search: 'Search name / author…', all: 'All',
    install: 'Install', installing: 'Installing…', update: 'Update', installed: 'Installed', uninstall: 'Uninstall',
    apply: 'Apply', unapply: 'Unapply', current: 'Active',
    empty: 'Catalog is empty', loading: 'Loading…', noMatch: 'No matches',
    loadFailed: 'Failed to load catalog (node market route not ready?)',
    by: 'by', installedAt: 'installed',
    flashInstalled: 'Installed', flashUpdated: 'Updated', flashUninstalled: 'Uninstalled', flashApplied: 'Applied', flashFailed: 'Operation failed',
    stageEmpty: 'Click "Apply" on an installed wallpaper to preview it here', stageMode: 'mode', degraded: 'degraded',
  },
}

export function MarketPanel() {
  const t = DICT[lang()]
  const [cards, setCards] = useState<MarketCard[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [tag, setTag] = useState('')
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [flash, setFlash] = useState('')
  const [applied, setApplied] = useState<AppliedInfo | null>(null)
  const [previewId, setPreviewId] = useState('')
  const [stageMode, setStageMode] = useState('')
  const [degraded, setDegraded] = useState<string[]>([])
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const flashMsg = (m: string): void => { setFlash(m); window.setTimeout(() => setFlash(''), 3000) }

  const reload = async (): Promise<void> => {
    setLoading(true); setError('')
    try {
      const f: Fetch = (url, init) => fetch(url, init)
      const [catalog, installed, cur] = await Promise.all([fetchCatalog(f), fetchInstalled(f), fetchApplied(f)])
      setCards(buildCards(catalog, installed))
      setApplied(cur)
      if (cur) setPreviewId(cur.id)
    } catch (e) {
      setError(String((e as Error).message ?? e))
    }
    setLoading(false)
  }
  useEffect(() => { void reload() }, [])

  // 预览挂载：previewId 变化 → mountDwp 到 canvas；卸载时 dispose。
  useEffect(() => {
    if (previewId === '' || canvasRef.current == null) return
    let handle: Handle | null = null
    let cancelled = false
    setDegraded([])
    mountDwp(canvasRef.current, previewId, { onDegrade: (d) => setDegraded(d) })
      .then((h) => { if (cancelled) h.dispose(); else { handle = h; setStageMode(h.mode) } })
      .catch((e) => { flashMsg(t.stageMode + ': ' + String((e as Error).message ?? e)) })
    return () => { cancelled = true; handle?.dispose() }
  }, [previewId])

  const doInstall = async (id: string, isUpdate: boolean): Promise<void> => {
    setBusy((b) => ({ ...b, [id]: true }))
    const r = await install((url, init) => fetch(url, init), id)
    setBusy((b) => { const n = { ...b }; delete n[id]; return n })
    if (r.ok) { void reload(); flashMsg(isUpdate ? t.flashUpdated : t.flashInstalled) }
    else flashMsg(t.flashFailed + (r.error ? ': ' + r.error : ''))
  }
  const doUninstall = async (id: string): Promise<void> => {
    setBusy((b) => ({ ...b, [id]: true }))
    const r = await uninstall((url, init) => fetch(url, init), id)
    setBusy((b) => { const n = { ...b }; delete n[id]; return n })
    if (applied?.id === id) { setApplied(null); setPreviewId('') }
    if (r.ok) { void reload(); flashMsg(t.flashUninstalled) } else flashMsg(t.flashFailed)
  }
  const doApply = async (id: string): Promise<void> => {
    const r = await applyDwp((url, init) => fetch(url, init), id)
    if (r.ok) { setApplied({ id, version: '', appliedAt: new Date().toISOString() }); setPreviewId(id); flashMsg(t.flashApplied) }
    else flashMsg(t.flashFailed + (r.error ? ': ' + r.error : ''))
  }
  const doUnapply = async (): Promise<void> => {
    await unapplyDwp((url, init) => fetch(url, init))
    setApplied(null); setPreviewId(''); setStageMode('')
  }

  const tags = collectTags(cards)
  const shown = searchCards(cards, search, tag)

  return (
    <div className="wesync-panel wesync-market">
      <div className="wesync-market-head">
        <div>
          <div className="wesync-market-title">{t.title}</div>
          <div className="wesync-market-sub">{t.subtitle}</div>
        </div>
        <button className="wesync-btn" onClick={() => void reload()}>{t.refresh}</button>
      </div>

      {flash !== '' ? <div className="wesync-market-flash">{flash}</div> : null}

      <div className="wesync-market-stage">
        <canvas ref={canvasRef} className="wesync-market-canvas" />
        {previewId === '' ? <div className="wesync-market-stage-empty">{t.stageEmpty}</div> : null}
        <div className="wesync-market-stage-bar">
          <span>{applied ? `${t.current}: ${applied.id}` : ''}</span>
          <span className="wesync-market-stage-info">
            {stageMode !== '' ? `${t.stageMode}: ${stageMode}` : ''}
            {degraded.length > 0 ? ` · ${t.degraded} ${degraded.length}` : ''}
          </span>
          {applied ? <button className="wesync-btn wesync-market-unapply" onClick={() => void doUnapply()}>{t.unapply}</button> : null}
        </div>
      </div>

      <div className="wesync-apps-filters">
        <button className={['wesync-chip', tag === '' ? 'wesync-chip-on' : ''].join(' ')} onClick={() => setTag('')}>{t.all}</button>
        {tags.map((tg) => (
          <button key={tg} className={['wesync-chip', tag === tg ? 'wesync-chip-on' : ''].join(' ')} onClick={() => setTag(tg)}>{tg}</button>
        ))}
        <input className="wesync-app-search" placeholder={t.search} value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {loading
        ? <div className="wesync-app-empty">{t.loading}</div>
        : error !== ''
          ? <div className="wesync-app-empty">{t.loadFailed}</div>
          : cards.length === 0
            ? <div className="wesync-app-empty">{t.empty}</div>
            : shown.length === 0
              ? <div className="wesync-app-empty">{t.noMatch}</div>
              : (
                  <div className="wesync-apps-grid">
                    {shown.map((c) => {
                      const busyId = busy[c.entry.id] === true
                      const name = lang() === 'en' ? c.entry.name.en : c.entry.name.zh
                      const isInstalled = c.state === 'installed' || c.state === 'update'
                      const isApplied = applied?.id === c.entry.id
                      return (
                        <div key={c.entry.id} className="wesync-app-card wesync-market-card">
                          <div className="wesync-app-thumbwrap">
                            <img className="wesync-app-thumb" src={c.entry.dwp.thumbnail} alt={name} loading="lazy"
                              onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden' }} />
                            <span className={'wesync-app-badge wesync-badge-' + (isApplied ? 'video' : c.state === 'installed' ? 'image' : c.state === 'update' ? 'video' : 'web')}>
                              {isApplied ? t.current : c.state === 'installed' ? t.installed : c.state === 'update' ? t.update : ''}
                            </span>
                          </div>
                          <div className="wesync-app-title">{name}</div>
                          <div className="wesync-market-meta">{t.by} {c.entry.author}{c.installedVersion ? ' · ' + t.installedAt + ' ' + c.installedVersion : ''}</div>
                          <div className="wesync-market-actions">
                            {c.state === 'absent' || c.state === 'update'
                              ? <button className="wesync-btn wesync-market-install" disabled={busyId} onClick={() => void doInstall(c.entry.id, c.state === 'update')}>
                                  {busyId ? t.installing : c.state === 'update' ? t.update : t.install}
                                </button>
                              : null}
                            {isInstalled
                              ? <button className="wesync-btn wesync-market-apply" disabled={isApplied} onClick={() => void doApply(c.entry.id)}>{t.apply}</button>
                              : null}
                            {c.state === 'installed'
                              ? <button className="wesync-btn wesync-market-uninstall" disabled={busyId} onClick={() => void doUninstall(c.entry.id)}>{t.uninstall}</button>
                              : null}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
    </div>
  )
}
