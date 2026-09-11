import { useEffect, useRef, useState } from 'react'

export function DwpEditorCard(): React.ReactElement {
  const [phase, setPhase] = useState<'checking' | 'available' | 'installing' | 'installed' | 'error'>('checking')
  const [message, setMessage] = useState('')
  const [opened, setOpened] = useState(false)
  const alive = useRef(true)
  const acquiring = useRef(false)
  async function request(install = false): Promise<boolean> {
    const r = await fetch('/we-sync/editor', install ? { method: 'POST', headers: { 'X-Wallpaper-Editor': 'install' } } : { cache: 'no-store' })
    const s = await r.json()
    if (!r.ok) throw new Error(s.error || '无法连接编辑器服务，请刷新后重试。')
    if (alive.current) setPhase(s.installed ? 'installed' : s.installing ? 'installing' : 'available')
    return s.installed
  }
  useEffect(() => { alive.current = true; void request().catch(e => { if (alive.current) { setPhase('error'); setMessage(String(e.message)) } }); return () => { alive.current = false } }, [])
  useEffect(() => {
    if (phase !== 'installing' || acquiring.current) return
    const timer = setInterval(() => { void request().catch(e => { if (alive.current) { setPhase('error'); setMessage(String(e.message)) } }) }, 3000)
    return () => clearInterval(timer)
  }, [phase])
  async function acquire(): Promise<void> {
    if (acquiring.current) return
    acquiring.current = true; setMessage(''); setPhase('installing')
    try { if (await request(true) && alive.current) setOpened(true) }
    catch (e) { if (alive.current) { setPhase('error'); setMessage(e instanceof Error ? e.message : '获取失败，请重试。') } }
    finally { acquiring.current = false }
  }
  return <div className="wesync-card">
    <div className="wesync-sub">DWP 创作</div>
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <button className="wesync-btn" disabled={phase === 'checking' || phase === 'installing'} onClick={() => phase === 'installed' ? setOpened(true) : void acquire()}>
        {phase === 'checking' ? '检查编辑器…' : phase === 'installing' ? '正在获取壁纸编辑器…' : phase === 'installed' ? '打开壁纸编辑器' : '获取壁纸编辑器'}
      </button>
      <span style={{ opacity: .65, fontSize: 12 }}>{phase === 'installed' ? '已安装 · 可离线创作' : '24 帧创作 · 图像与视频 · 抠图 · 粒子 · 时钟'}</span>
      {phase === 'installed' && <a className="wesync-btn" href="/we-sync/editor/app" target="_blank" rel="noreferrer">独立窗口</a>}
    </div>
    {message && <p role="alert">{message}</p>}
    {opened && <iframe title="壁纸编辑器" src="/we-sync/editor/app" style={{ width: '100%', height: 'min(850px, 80vh)', minHeight: 560, border: 0, marginTop: 12, borderRadius: 8 }} allow="fullscreen" />}
  </div>
}
