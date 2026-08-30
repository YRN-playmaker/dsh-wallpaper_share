/**
 * wallpaper_market 会话视图标签页：浏览 dwp-registry 目录 + 安装/更新/卸载（免费 only）。
 * 与 wallpaper_share 分工：本窗口只管"拉取"，已拉内容的管理在 share 侧（后续接入）。
 * 逻辑全在 market-api.ts（可 Node 测）；本组件仅负责渲染与事件。
 * 复用 PANEL_CSS 的 wesync- 类，市场专有样式见 panelStyle.ts 的 MARKET_CSS。
 */
import { useEffect, useState } from 'react'
import { store } from './index'
import {
  fetchCatalog, fetchInstalled, buildCards, searchCards, collectTags,
  install, uninstall, type MarketCard, type Fetch,
} from './market-api.ts'

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
    empty: '目录为空', loading: '加载中…', noMatch: '无匹配结果',
    loadFailed: '目录加载失败（node 半 market 路由未就绪？）',
    by: '作者', installedAt: '已装',
    flashInstalled: '已安装', flashUpdated: '已更新', flashUninstalled: '已卸载', flashFailed: '操作失败',
  },
  en: {
    title: 'Wallpaper Market', subtitle: 'Browse and pull DWP wallpapers',
    refresh: 'Refresh', search: 'Search name / author…', all: 'All',
    install: 'Install', installing: 'Installing…', update: 'Update', installed: 'Installed', uninstall: 'Uninstall',
    empty: 'Catalog is empty', loading: 'Loading…', noMatch: 'No matches',
    loadFailed: 'Failed to load catalog (node market route not ready?)',
    by: 'by', installedAt: 'installed',
    flashInstalled: 'Installed', flashUpdated: 'Updated', flashUninstalled: 'Uninstalled', flashFailed: 'Operation failed',
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

  const flashMsg = (m: string): void => { setFlash(m); window.setTimeout(() => setFlash(''), 3000) }

  const reload = async (): Promise<void> => {
    setLoading(true); setError('')
    try {
      const f: Fetch = (url, init) => fetch(url, init)
      const [catalog, installed] = await Promise.all([fetchCatalog(f), fetchInstalled(f)])
      setCards(buildCards(catalog, installed))
    } catch (e) {
      setError(String((e as Error).message ?? e))
    }
    setLoading(false)
  }
  useEffect(() => { void reload() }, [])

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
    if (r.ok) { void reload(); flashMsg(t.flashUninstalled) } else flashMsg(t.flashFailed)
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
                      return (
                        <div key={c.entry.id} className="wesync-app-card wesync-market-card">
                          <div className="wesync-app-thumbwrap">
                            <img className="wesync-app-thumb" src={c.entry.dwp.thumbnail} alt={name} loading="lazy"
                              onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden' }} />
                            <span className={'wesync-app-badge wesync-badge-' + (c.state === 'installed' ? 'image' : c.state === 'update' ? 'video' : 'web')}>
                              {c.state === 'installed' ? t.installed : c.state === 'update' ? t.update : ''}
                            </span>
                          </div>
                          <div className="wesync-app-title">{name}</div>
                          <div className="wesync-market-meta">{t.by} {c.entry.author}{c.installedVersion ? ' · ' + t.installedAt + ' ' + c.installedVersion : ''}</div>
                          <div className="wesync-market-actions">
                            {c.state === 'absent' || c.state === 'update'
                              ? <button className="wesync-btn wesync-market-install" disabled={busyId} onClick={() => void doInstall(c.entry.id, c.state === 'update')}>
                                  {busyId ? t.installing : c.state === 'update' ? t.update : t.install}
                                </button>
                              : <button className="wesync-btn wesync-market-uninstall" disabled={busyId} onClick={() => void doUninstall(c.entry.id)}>{t.uninstall}</button>}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
    </div>
  )
}
