import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { FloaterHub, parseSync, parseEvent, type HubDeps } from '../hub.ts'
import { createFloaterRoutes, type Req, type Res } from '../routes.ts'

/** 假 deps：记录发出的命令与定时回调，可手动触发 spawn 失败/退出。 */
function makeHub(): {
  hub: FloaterHub
  sent: string[]
  timers: Array<{ at: number; fn: () => void; handle: number }>
  startCount: () => number
  stopCount: () => number
  runDue: (ms: number) => void
  advance: (ms: number) => void
  persist: Array<{ x: number; y: number }>
} {
  const sent: string[] = []
  const timers: Array<{ at: number; fn: () => void; handle: number }> = []
  let now = 0
  let handleSeq = 1
  let started = 0
  let stopped = 0
  const persist: Array<{ x: number; y: number }> = []
  const deps: HubDeps = {
    send: (l) => { sent.push(l) },
    startProc: () => { started++ },
    stopProc: () => { stopped++ },
    setTimeout: (fn, ms) => { const h = handleSeq++; timers.push({ at: now + ms, fn, handle: h }); return h },
    clearTimeout: (h) => { const i = timers.findIndex((t) => t.handle === h); if (i >= 0) timers.splice(i, 1) },
    now: () => now,
    persistPos: (x, y) => { persist.push({ x, y }) },
    log: () => {},
  }
  const hub = new FloaterHub(deps)
  return {
    hub,
    sent,
    timers,
    startCount: () => started,
    stopCount: () => stopped,
    persist,
    advance: (ms: number) => { now += ms },
    runDue: (ms) => {
      now += ms
      const due = timers.filter((t) => t.at <= now).sort((a, b) => a.at - b.at)
      for (const t of due) {
        const i = timers.indexOf(t)
        if (i >= 0) timers.splice(i, 1)
        t.fn()
      }
    },
  }
}

test('parseSync 校验：要求 enabled:boolean 与合法 state，title 截断、color 需 6 hex', () => {
  assert.equal(parseSync('nope'), null)
  assert.equal(parseSync({ state: 'hidden' }), null)
  assert.equal(parseSync({ enabled: true, state: 'nope' }), null)
  const badColor = parseSync({ enabled: true, state: 'visible', color: 'zzzzzz' })
  assert.ok(badColor)
  assert.equal(badColor.color, undefined) // 非法色被丢弃而非拒绝整包
  const p = parseSync({ enabled: true, state: 'hidden', title: 'x'.repeat(500), color: '#ABCDEF' })
  assert.ok(p)
  assert.equal(p.title!.length, 300)
  assert.equal(p.color, 'abcdef') // 归一小写，非法色被丢弃
  assert.equal(p.pageId, undefined) // 缺省无桶 id（旧版 client 走共享桶）
  assert.equal(parseSync({ pageId: 'p-1', enabled: false, state: 'unloading' })?.pageId, 'p-1')
  assert.equal(parseSync({ enabled: false, state: 'unloading' })?.color, undefined)
})

test('parseEvent：协议行 → 结构化事件', () => {
  assert.deepEqual(parseEvent('ready'), { kind: 'ready' })
  assert.deepEqual(parseEvent('click ok'), { kind: 'click', ok: true })
  assert.deepEqual(parseEvent('click miss'), { kind: 'click', ok: false })
  assert.deepEqual(parseEvent('moved 10 -5'), { kind: 'moved', x: 10, y: -5 })
  assert.deepEqual(parseEvent('dismiss'), { kind: 'dismiss' })
  assert.deepEqual(parseEvent('startup failed already-running'), { kind: 'startup-fail', reason: 'already-running' })
  assert.equal(parseEvent('some log line'), null)
})

test('关开关或未上报 → 无进程无球', () => {
  const { hub, startCount, stopCount } = makeHub()
  hub.sync({ enabled: false, state: 'hidden' })
  assert.equal(startCount(), 0)
  assert.equal(stopCount(), 0)
  assert.equal(hub.procUp, false)
})

test('开启 + 隐藏 → 起进程并 show；title/color 缓存待 ready 回发', () => {
  const { hub, sent, startCount } = makeHub()
  hub.sync({ enabled: true, state: 'hidden', title: 'My Page', color: '22c55e' })
  assert.equal(startCount(), 1)
  assert.equal(hub.procUp, true)
  assert.equal(hub.ringShown, true)
  assert.deepEqual(sent, ['show']) // 冷启动进程还没 ready，title/color 由 onReady 补发
  assert.equal(hub.title, 'My Page')
  assert.equal(hub.color, '22c55e')
})

test('ready 补发上下文；球已显示不重复 show；崩溃重拉后才重新挂球', () => {
  const { hub, sent, runDue, startCount } = makeHub()
  hub.sync({ enabled: true, state: 'hidden', title: 'T' })
  sent.length = 0
  hub.onReady()
  assert.deepEqual(sent, ['title T']) // show 在冷启动那帧已入队，无需重发
  hub.onExit(false) // 意外崩溃
  assert.equal(hub.ringShown, false)
  runDue(2000) // 重拉窗口
  assert.equal(startCount(), 2)
  assert.deepEqual(sent.at(-1), 'show') // 重拉后按注册表重新挂球
})

test('恢复可见 → 收球停进程，title/color 保留', () => {
  const { hub, sent, stopCount } = makeHub()
  hub.sync({ enabled: true, state: 'hidden', title: 'Keep', color: '3b82f6' })
  sent.length = 0
  hub.sync({ enabled: true, state: 'visible' })
  assert.deepEqual(sent, ['hide'])
  assert.equal(stopCount(), 1)
  assert.equal(hub.ringShown, false)
  assert.equal(hub.title, 'Keep')
})

test('拖拽落点持久化，下次 show 带坐标', () => {
  const { hub, sent, persist } = makeHub()
  hub.sync({ enabled: true, state: 'hidden' })
  hub.onMoved(120, 340)
  assert.deepEqual(persist, [{ x: 120, y: 340 }])
  hub.sync({ enabled: true, state: 'visible' })
  sent.length = 0
  hub.sync({ enabled: true, state: 'hidden' })
  assert.deepEqual(sent, ['show 120 340'])
})

test('dismiss 后 snooze：继续 hidden 不再挂球，回到 visible 才解除', () => {
  const { hub, sent } = makeHub()
  hub.sync({ enabled: true, state: 'hidden' })
  hub.onDismiss()
  assert.equal(hub.snoozed, true)
  assert.equal(hub.ringShown, false)
  sent.length = 0
  hub.sync({ enabled: true, state: 'hidden' }) // 再次隐藏（进程崩溃重拉后可能再收到）
  assert.deepEqual(sent, []) // snooze 挡着，不弹
  hub.sync({ enabled: true, state: 'visible' })
  hub.sync({ enabled: true, state: 'hidden' })
  assert.equal(hub.snoozed, false)
  assert.deepEqual(sent, ['show']) // 回到页面再隐藏，恢复弹出
})

test('进程崩溃 → 2s 后重拉；连续 4 次快速崩溃 → 熔断到下一次 visible', () => {
  const { hub, startCount, runDue } = makeHub()
  hub.sync({ enabled: true, state: 'hidden' })
  assert.equal(startCount(), 1)
  hub.onExit(false) // 崩溃 1
  hub.onExit(false) // 崩溃 2（同一批，测试计数路径；正常由重拉后再崩）
  runDue(2000) // 触发一次重拉
  assert.equal(startCount(), 2)
  // 连拉到熔断阈值
  hub.onExit(false)
  hub.onExit(false)
  hub.onExit(false)
  hub.onExit(false)
  runDue(2000)
  assert.equal(hub.failed, true)
  assert.equal(startCount(), 2) // 不再拉起
  hub.sync({ enabled: true, state: 'visible' }) // 回页面解除熔断
  assert.equal(hub.failed, false)
})

test('点击不改变球显示（激活由 exe 负责）', () => {
  const { hub, sent } = makeHub()
  hub.sync({ enabled: true, state: 'hidden' })
  sent.length = 0
  hub.onClick(false)
  hub.onClick(true)
  assert.deepEqual(sent, [])
  assert.equal(hub.ringShown, true)
})

test('shutdown 彻底清理并停进程', () => {
  const { hub, stopCount } = makeHub()
  hub.sync({ enabled: true, state: 'hidden' })
  hub.shutdown()
  assert.equal(stopCount(), 1)
  assert.equal(hub.procUp, false)
  assert.equal(hub.ringShown, false)
})

test('多页签互不踩踏（"虚影一闪"回归）：B 页 enabled:false 只摘自己一票，A 页的球不受影响', () => {
  const { hub, sent, startCount, stopCount } = makeHub()
  hub.sync({ pageId: 'a', enabled: true, state: 'hidden' })
  assert.equal(startCount(), 1)
  assert.equal(hub.ringShown, true)
  sent.length = 0
  // 另一个页签（内存里开关还是 false）上报：不能把 A 的球拆掉
  hub.sync({ pageId: 'b', enabled: false, state: 'visible' })
  assert.deepEqual(sent, [])
  assert.equal(stopCount(), 0)
  assert.equal(hub.ringShown, true)
  // B 开启并保持前台 → 用户在看应用，球收起（正确语义，不是踩踏）
  hub.sync({ pageId: 'b', enabled: true, state: 'visible' })
  assert.deepEqual(sent, ['hide'])
  assert.equal(stopCount(), 1)
  // B 关掉页签（unloading）→ 只剩 A 在后台 → 球回来
  sent.length = 0
  hub.sync({ pageId: 'b', enabled: true, state: 'unloading' })
  assert.equal(hub.pages.has('b'), false)
  hub.sync({ pageId: 'a', enabled: true, state: 'hidden' })
  assert.equal(startCount(), 2)
  assert.deepEqual(sent, ['show'])
})

test('可见页签心跳断了（直接杀进程没发 unloading）→ TTL 剔除后球恢复', () => {
  const { hub, advance, runDue } = makeHub()
  hub.sync({ pageId: 'a', enabled: true, state: 'hidden' })
  hub.sync({ pageId: 'b', enabled: true, state: 'visible' })
  assert.equal(hub.ringShown, false) // b 在前台 → 不弹
  advance(16000) // 远超 VISIBLE_TTL_MS，b 再没心跳
  runDue(0)
  assert.equal(hub.pages.has('b'), false)
  assert.equal(hub.ringShown, true)
})

test('dismiss 的 snooze 由「任一页面回前台」解除，而非特定页签', () => {
  const { hub } = makeHub()
  hub.sync({ pageId: 'a', enabled: true, state: 'hidden' })
  hub.onDismiss()
  hub.sync({ pageId: 'c', enabled: true, state: 'visible' }) // 另一页签回前台
  assert.equal(hub.snoozed, false)
})

// —— 路由：用 EventEmitter 假 req（对齐 launcher 测试风格）——
function fakeReq(method: string, body: unknown): Req {
  const req = new EventEmitter() as unknown as Req
  ;(req as unknown as { method: string }).method = method
  queueMicrotask(() => {
    const e = req as unknown as EventEmitter
    const buf = Buffer.from(JSON.stringify(body))
    e.emit('data', buf)
    e.emit('end')
  })
  return req
}
function fakeRes(): { res: Res; status: () => number; json: () => unknown } {
  let code = 0
  let out: unknown
  const res: Res = {
    statusCode: 200,
    setHeader() {},
    end(body?: unknown) { code = res.statusCode; out = body },
  }
  return { res, status: () => code, json: () => JSON.parse(String(out)) }
}

test('GET /we-sync/floater → supported + 状态快照', async () => {
  const { hub } = makeHub()
  const [route] = createFloaterRoutes({ hub, supported: () => true })
  const { res, status, json } = fakeRes()
  await route.handler({ method: 'GET', url: '/we-sync/floater' }, res)
  assert.equal(status(), 200)
  assert.equal((json() as { supported: boolean }).supported, true)
  assert.equal((json() as { enabled: boolean }).enabled, false)
})

test('POST /we-sync/floater → 喂给 hub 并回状态', async () => {
  const { hub, startCount } = makeHub()
  const [route] = createFloaterRoutes({ hub, supported: () => false })
  const { res, status, json } = fakeRes()
  await route.handler(fakeReq('POST', { enabled: true, state: 'hidden', title: 'P' }), res)
  assert.equal(status(), 200)
  assert.equal(startCount(), 1)
  assert.equal((json() as { supported: boolean }).supported, false) // 平台位仍如实回报
  assert.equal((json() as { title: string }).title, 'P')
})

test('POST 非法体 → 400', async () => {
  const { hub } = makeHub()
  const [route] = createFloaterRoutes({ hub, supported: () => true })
  const { res, status } = fakeRes()
  await route.handler(fakeReq('POST', { enabled: 'yes' }), res)
  assert.equal(status(), 400)
})

test('未知 method → 405', async () => {
  const { hub } = makeHub()
  const [route] = createFloaterRoutes({ hub, supported: () => true })
  const { res, status } = fakeRes()
  await route.handler({ method: 'DELETE', url: '/we-sync/floater' }, res)
  assert.equal(status(), 405)
})
