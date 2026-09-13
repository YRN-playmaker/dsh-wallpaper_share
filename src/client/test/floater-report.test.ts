import { test } from 'node:test'
import assert from 'node:assert/strict'
import { startFloaterReporter, FLOATER_URL, type FloaterReportEnv } from '../floater-report.ts'

/** 假环境：捕获 send，手动触发可见性/焦点/心跳/防抖回调。 */
function makeEnv() {
  let vis: 'visible' | 'hidden' = 'visible'
  const sent: Array<{ url: string; body: Record<string, unknown>; keepalive: boolean }> = []
  const visFns = new Set<() => void>()
  const hideFns = new Set<() => void>()
  const focusFns = new Set<() => void>()
  const blurFns = new Set<() => void>()
  let intervalFn: (() => void) | null = null
  let cleared = 0
  const timeouts = new Map<number, () => void>()
  let timeoutSeq = 1
  const env: FloaterReportEnv = {
    visibilityState: () => vis,
    title: () => 'DSH 页面',
    pageId: () => 'tab-1',
    onFocus: (fn) => { focusFns.add(fn); return () => focusFns.delete(fn) },
    onBlur: (fn) => { blurFns.add(fn); return () => blurFns.delete(fn) },
    onVisibilityChange: (fn) => { visFns.add(fn); return () => visFns.delete(fn) },
    onPageHide: (fn) => { hideFns.add(fn); return () => hideFns.delete(fn) },
    setInterval: (fn) => { intervalFn = fn; return 1 },
    clearInterval: () => { cleared++ },
    setTimeout: (fn) => { const h = timeoutSeq++; timeouts.set(h, fn); return h },
    clearTimeout: (handle) => { timeouts.delete(handle) },
    send: (url, body, keepalive) => { sent.push({ url, body: JSON.parse(body) as Record<string, unknown>, keepalive }) },
  }
  let enabled = false
  const r = startFloaterReporter(env, () => enabled)
  return {
    sent,
    reporter: r,
    setEnabled(v: boolean) { enabled = v },
    setVisibility(v: 'visible' | 'hidden') { vis = v; for (const fn of [...visFns]) fn() },
    pageHide() { for (const fn of [...hideFns]) fn() },
    blur() { for (const fn of [...blurFns]) fn() },
    focus() { for (const fn of [...focusFns]) fn() },
    tick() { intervalFn?.() },
    /** 触发所有挂起的防抖定时器（blur 确认） */
    flushTimeouts() { for (const fn of [...timeouts.values()]) { timeouts.clear(); fn() } },
    pendingTimeouts: () => timeouts.size,
    cleared: () => cleared,
  }
}

test('启动即报一次当前状态（带真实 document.title），未开启也报（enabled:false 让服务端 teardown）', () => {
  const h = makeEnv()
  assert.equal(h.sent.length, 1)
  assert.equal(h.sent[0].url, FLOATER_URL)
  assert.deepEqual(h.sent[0].body, { pageId: 'tab-1', enabled: false, state: 'visible', title: 'DSH 页面' }) // color 未设 → 键整个缺席
  assert.equal(h.sent[0].keepalive, false)
})

test('切后台/回前台 → hidden/visible，keepalive 送达；重复事件去重不刷请求', () => {
  const h = makeEnv()
  h.setEnabled(true)
  h.setVisibility('hidden')
  assert.equal(h.sent.length, 2)
  assert.equal(h.sent[1].body.state, 'hidden')
  assert.equal(h.sent[1].body.enabled, true)
  assert.equal(h.sent[1].keepalive, true)
  h.setVisibility('hidden') // 再触发一次同状态 → emit 去重
  assert.equal(h.sent.length, 2)
  h.setVisibility('visible')
  assert.equal(h.sent[2].body.state, 'visible')
})

test('窗口被其他应用压住（blur，无 visibilitychange）→ 防抖确认后报 hidden；focus 即收', () => {
  const h = makeEnv()
  h.setEnabled(true)
  h.blur()
  assert.equal(h.sent.length, 1) // 防抖期内不立刻发（小弹窗抢焦点不闪球）
  assert.equal(h.pendingTimeouts(), 1)
  h.focus() // 400ms 内回来 → 定时器撤销，什么都没发生
  assert.equal(h.pendingTimeouts(), 0)
  assert.equal(h.sent.length, 1)
  h.blur()
  h.flushTimeouts() // 真的走了
  assert.equal(h.sent.at(-1)?.body.state, 'hidden')
  assert.equal(h.reporter.state, 'hidden')
  h.focus()
  assert.equal(h.sent.at(-1)?.body.state, 'visible')
})

test('blur 确认后又切页签/最小化：visibilitychange 不产生重复 hidden（同为 hidden 去重）', () => {
  const h = makeEnv()
  h.setEnabled(true)
  h.blur()
  h.flushTimeouts()
  const n = h.sent.length
  h.setVisibility('hidden')
  assert.equal(h.sent.length, n)
})

test('pagehide → unloading（node 半停进程），不走变化检测', () => {
  const h = makeEnv()
  h.pageHide()
  assert.equal(h.sent.at(-1)?.body.state, 'unloading')
  assert.equal(h.sent.at(-1)?.keepalive, true)
})

test('pingColor：仅在已开启且值变化时发送；色板同侧边球（hex 无 #）', () => {
  const h = makeEnv()
  h.reporter.pingColor('eab308') // 未开启 → 静默
  assert.equal(h.sent.length, 1)
  h.setEnabled(true)
  h.reporter.pingColor('eab308')
  h.reporter.pingColor('eab308') // 同色不再发
  assert.equal(h.sent.length, 2)
  assert.equal(h.sent[1].body.color, 'eab308')
  h.reporter.pingColor('3b82f6')
  assert.equal(h.sent.at(-1)?.body.color, '3b82f6')
})

test('心跳：只在自认前台且开启时补发 visible（解除 snooze / 校正标题）', () => {
  const h = makeEnv()
  h.tick() // 关着 → 不刷流量
  h.setEnabled(true)
  h.setVisibility('hidden')
  h.tick()
  assert.equal(h.sent.filter((s) => s.body.state === 'visible' && s.keepalive === true).length, 0)
  h.setVisibility('visible')
  h.tick()
  assert.equal(h.sent.at(-1)?.body.state, 'visible')
  assert.equal(h.sent.at(-1)?.body.enabled, true)
  h.blur()
  h.flushTimeouts() // blur 也算后台 → 心跳闭嘴
  const n = h.sent.length
  h.tick()
  assert.equal(h.sent.length, n)
})

test('syncNow：面板开关变更后立即重发（enabled 取当前值 + 当前前台态）', () => {
  const h = makeEnv()
  h.setEnabled(true)
  h.reporter.syncNow()
  assert.deepEqual(h.sent.at(-1)?.body, { pageId: 'tab-1', enabled: true, state: 'visible', title: 'DSH 页面' })
})

test('dispose：摘监听 + 清心跳与防抖，之后一切静默', () => {
  const h = makeEnv()
  h.setEnabled(true)
  h.reporter.dispose()
  h.setVisibility('hidden')
  h.pageHide()
  h.tick()
  assert.equal(h.sent.length, 1) // 只有启动那一次
  assert.equal(h.cleared(), 1)
  h.blur() // 监听已摘 → 无新定时器
  assert.equal(h.pendingTimeouts(), 0)
})
