/**
 * 桌面悬浮球的 client 半上报器：把「页面是谁（document.title）、现在在前台吗、球该什么颜色」
 * 汇成同一个 sync 报文 POST 给 node 半（/we-sync/floater）。
 *
 * 「切到后台」的完整语义 = 以下任一（缺一不可，实测只盯 visibilitychange 会漏掉大头场景）：
 *  - 页签被切走 / 浏览器最小化（document.visibilityState → hidden）
 *  - 整个窗口被其他应用压住、Alt+Tab 走开（window blur —— 此时浏览器仍认为页面 visible！）
 *    用 400ms 防抖：系统托盘/权限小条抢焦点会立刻 focus 回来，不该让球闪一下。
 * 回到前台（页签转可见或 window focus）即时收球。
 *
 * 触发源：状态变化检测（visibilitychange / focus / blur）+ pagehide(unloading) +
 * 心跳兜底（5s，仅开启且自认前台；解除服务端 snooze、校正标题、补丢事件）+
 * 面板开关变更（syncNow）+ 侧边球变色（pingColor）。
 *
 * 环境全部注入（env），node --test 拿假对象就能测。
 */

export interface FloaterReportEnv {
  visibilityState(): 'visible' | 'hidden'
  title(): string
  /** 本页签的稳定身份（sessionStorage 级 UUID）：服务端按页记账，多页签互不踩踏 */
  pageId(): string
  onFocus(fn: () => void): () => void
  onBlur(fn: () => void): () => void
  onVisibilityChange(fn: () => void): () => void
  onPageHide(fn: () => void): () => void
  setInterval(fn: () => void, ms: number): number
  clearInterval(handle: number): void
  setTimeout(fn: () => void, ms: number): number
  clearTimeout(handle: number): void
  /** 发送 JSON 报文；keepalive=true 时页面隐藏/卸载后仍保证送达 */
  send(url: string, body: string, keepalive: boolean): void
}

export interface FloaterReporter {
  /** 立即同步当前状态（面板开关变更时调用） */
  syncNow(): void
  /** 状态色变化（同侧边球色板，6 位 hex 无 #）；仅在值变化且已开启时发报文 */
  pingColor(color: string): void
  /** 当前认为的前台态（供测试观察） */
  readonly state: 'visible' | 'hidden'
  readonly lastColor: string
  dispose(): void
}

export const FLOATER_URL = '/we-sync/floater'
export const FLOATER_HEARTBEAT_MS = 5000
/** 窗口失焦确认延迟：小弹窗抢焦点会立刻 focus 回来，不该让球闪一下 */
export const BLUR_CONFIRM_MS = 400

export function startFloaterReporter(env: FloaterReportEnv, isEnabled: () => boolean): FloaterReporter {
  let lastColor = ''
  let blurred = false
  let blurTimer = 0
  let disposed = false

  function current(): 'visible' | 'hidden' {
    return env.visibilityState() === 'hidden' || blurred ? 'hidden' : 'visible'
  }

  let lastSent: 'visible' | 'hidden' = current()

  const send = (state: 'visible' | 'hidden' | 'unloading', keepalive: boolean): void => {
    try {
      env.send(FLOATER_URL, JSON.stringify({
        pageId: env.pageId(),
        enabled: isEnabled(),
        state,
        title: env.title(),
        color: lastColor !== '' ? lastColor : undefined,
      }), keepalive)
    } catch { /* 网络/序列化失败不致命，心跳会补 */ }
  }

  /** 只在状态相对上次已发送值变化时发（blur/focus 抖动、重复事件不刷请求）。 */
  const emit = (keepalive: boolean): void => {
    if (disposed) return
    const s = current()
    if (s === lastSent) return
    lastSent = s
    send(s, keepalive)
  }

  const cancelBlur = (): void => {
    if (blurTimer !== 0) {
      env.clearTimeout(blurTimer)
      blurTimer = 0
    }
  }

  const offs: Array<() => void> = [
    env.onVisibilityChange(() => emit(true)),
    env.onPageHide(() => send('unloading', true)),
    env.onBlur(() => {
      if (blurTimer !== 0 || blurred) return
      blurTimer = env.setTimeout(() => {
        blurTimer = 0
        blurred = true
        emit(true)
      }, BLUR_CONFIRM_MS)
    }),
    env.onFocus(() => {
      cancelBlur()
      blurred = false
      emit(true)
    }),
  ]
  // 心跳只在「自认前台 + 已开启」时跑：后台态已由事件即时送达、隐藏页浏览器本就节流定时器；
  // 它兜住丢事件与服务端重启，并持续解除 snooze。
  const heartbeat = env.setInterval(() => {
    if (!disposed && isEnabled() && current() === 'visible') {
      lastSent = 'visible'
      send('visible', true)
    }
  }, FLOATER_HEARTBEAT_MS)
  // 启动即报一次：node 半可能刚重启（丢了 enabled/title 状态），页面来对齐
  send(lastSent, false)

  return {
    syncNow(): void {
      const s = current()
      lastSent = s
      send(s, false)
    },
    pingColor(color: string): void {
      if (color === lastColor || !isEnabled()) return
      lastColor = color
      const s = current()
      lastSent = s
      send(s, false)
    },
    get state(): 'visible' | 'hidden' {
      return current()
    },
    get lastColor(): string {
      return lastColor
    },
    dispose(): void {
      disposed = true
      cancelBlur()
      for (const off of offs) off()
      env.clearInterval(heartbeat)
    },
  }
}
