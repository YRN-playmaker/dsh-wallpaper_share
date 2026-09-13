/**
 * 桌面悬浮球（we-floater）的 node 半状态机 —— 纯逻辑，无 child_process / DOM 依赖，
 * 用假时钟 + 假 deps 即可单测（对齐 launcher/routes.ts 的可测约定）。
 *
 * 事实源：client 半向 /we-sync/floater 发的 sync 上报
 *   { pageId, enabled, state: visible|hidden|unloading, title, color }
 * 外加 we-floater.exe stdout 的事件（click / moved / dismiss / ready）。
 *
 * 多页签注册表模型（关键设计，修复"虚影一闪"）：
 *  同一浏览器常开着多个 3080 页面，各自内存里都有自己的开关值；若按"最后上报者赢"
 *  记单一全局态，一个未开启/旧状态页面的一次 visible 上报就会把另一个页面刚挂起的球
 *  秒拆掉（实测：球闪一下就没了）。因此这里按 pageId 记账，球的出现条件是全局语义：
 *    存在至少一个「参与(enabled)且隐藏」的页面，且 不存在任何「参与且可见」的页面。
 *  - enabled:false / unloading → 仅摘除该 pageId 的记录，不否决别人。
 *  - visible 记录依赖 5s 心跳保鲜：超 VISIBLE_TTL_MS 未续期视为页签已死，剔除
 *    （隐藏记录无需心跳：离开瞬间的 visibilitychange/blur 已即时送达）。
 *  - dismiss（右键/双击）→ snooze：安静到「有任一页面回到前台」为止。
 *  - 进程意外退出且仍需要它 → 2s 后重拉；连续快速崩溃 ≥4 次 → 熔断到有页面回前台。
 *  - title/color 由最近一次上报者驱动（同屏只有一个球，取谁的都是折中，行为一致）。
 */

export interface SyncPayload {
  pageId?: string
  enabled: boolean
  state: 'visible' | 'hidden' | 'unloading'
  title?: string
  color?: string
}

/** 解析并夹紧 sync 请求体；非法返回 null（路由层回 400）。 */
export function parseSync(body: unknown): SyncPayload | null {
  if (body === null || typeof body !== 'object') return null
  const o = body as Record<string, unknown>
  if (typeof o.enabled !== 'boolean') return null
  if (o.state !== 'visible' && o.state !== 'hidden' && o.state !== 'unloading') return null
  return {
    pageId: typeof o.pageId === 'string' && o.pageId !== '' ? o.pageId.slice(0, 64) : undefined,
    enabled: o.enabled,
    state: o.state,
    title: typeof o.title === 'string' ? o.title.slice(0, 300) : undefined,
    color: typeof o.color === 'string' && /^#?[0-9a-fA-F]{6}$/.test(o.color) ? o.color.replace('#', '').toLowerCase() : undefined,
  }
}

export interface HubDeps {
  /** 向 we-floater stdin 写一行命令（进程不在时可被忽略，由实现保证不抛） */
  send(line: string): void
  /** 懒启动子进程（已在跑则幂等）；就绪后会回调 onReady() */
  startProc(): void
  /** 结束子进程（quit + 兜底强杀），幂等 */
  stopProc(): void
  setTimeout(fn: () => void, ms: number): number
  clearTimeout(handle: number): void
  /** 当前毫秒时间戳（注入假时钟即可测可见记录 TTL 剔除） */
  now(): number
  /** 拖拽落点持久化 */
  persistPos(x: number, y: number): void
  log(msg: string): void
}

export const RESPAWN_MS = 2000
export const CRASH_LIMIT = 4
/** 可见页 5s 心跳一发；连丢 ~3 拍即认为该页已关闭/假死，从注册表剔除 */
export const VISIBLE_TTL_MS = 15000

/** 无 pageId 的上报（旧版 client）共用这一个桶。 */
const LEGACY_PAGE = 'legacy'

interface PageInfo { hidden: boolean; ts: number }

export class FloaterHub {
  /** 子进程被认为存活（startProc 后到 onExit 前） */
  procUp = false
  /** 球当前应显示 */
  ringShown = false
  /** 用户主动 dismiss：隐藏到下一次"有页面回前台" */
  snoozed = false
  /** 连续崩溃熔断：到下一次有页面回前台前不再拉起 */
  failed = false
  title = ''
  color = ''
  pos: { x: number; y: number } | null = null
  /** pageId → 参与状态（只存 enabled 的页面）；测试与路由快照用 */
  readonly pages = new Map<string, PageInfo>()

  private crashes = 0
  private respawnTimer = 0
  /** 最早到期的"可见"记录定时器：到点自我 reconcile（可见页暴毙没发 unloading 时球也能恢复） */
  private pruneTimer = 0
  private readonly deps: HubDeps

  constructor(deps: HubDeps) {
    this.deps = deps
  }

  /** client sync 上报的统一入口。 */
  sync(p: SyncPayload): void {
    if (typeof p.title === 'string' && p.title !== this.title) {
      this.title = p.title
      if (this.procUp) this.deps.send('title ' + p.title)
    }
    if (typeof p.color === 'string' && p.color !== this.color) {
      this.color = p.color
      if (this.procUp) this.deps.send('color ' + p.color)
    }
    const id = p.pageId ?? LEGACY_PAGE
    if (!p.enabled || p.state === 'unloading') {
      this.pages.delete(id) // 只摘自己这一票，不否决别人
    } else {
      this.pages.set(id, { hidden: p.state === 'hidden', ts: this.deps.now() })
    }
    this.reconcile()
  }

  /** 由注册表推导全局裁决：挂不挂球、收不收场。 */
  private reconcile(): void {
    const now = this.deps.now()
    let nextPruneAt = Infinity
    for (const [id, info] of this.pages) {
      const expiry = info.ts + VISIBLE_TTL_MS
      if (info.hidden) continue
      if (now - info.ts > VISIBLE_TTL_MS) this.pages.delete(id) // 心跳断供的"可见"页签：已死，剔除
      else if (expiry < nextPruneAt) nextPruneAt = expiry
    }
    this.armPrune(nextPruneAt, now)
    let anyVisible = false
    let anyHidden = false
    for (const info of this.pages.values()) {
      if (info.hidden) anyHidden = true
      else anyVisible = true
    }
    if (anyVisible) {
      // 用户回到了任一 3080 页面：解除 snooze 与熔断
      this.snoozed = false
      this.failed = false
      this.crashes = 0
    }
    const wantRing = anyHidden && !anyVisible
    if (!wantRing) {
      this.hideRing()
      this.teardownProc()
      return
    }
    if (this.snoozed || this.failed) return
    this.ensureProc()
    if (this.procUp && !this.ringShown) {
      this.ringShown = true
      this.showRing()
    }
  }

  /** 进程 stdout `ready`：补发上下文并按注册表重新裁决。 */
  onReady(): void {
    if (this.title !== '') this.deps.send('title ' + this.title)
    if (this.color !== '') this.deps.send('color ' + this.color)
    this.reconcile()
  }

  /** stdout `moved x y`（拖拽结束）。 */
  onMoved(x: number, y: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return
    this.pos = { x, y }
    this.deps.persistPos(x, y)
  }

  /** stdout `dismiss`（右键 / 双击主动收起）：exe 已自行隐藏。 */
  onDismiss(): void {
    this.snoozed = true
    this.ringShown = false
  }

  /** stdout `click ok|miss`：球保持原位（激活由 exe 完成；失败则无 visible sync，球还在）。 */
  onClick(_ok: boolean): void {
    // 无需动作；保留回调供日志/测试观察
  }

  /** 子进程退出。intentional=我方 stopProc 触发。 */
  onExit(intentional: boolean): void {
    this.procUp = false
    this.ringShown = false
    if (intentional) {
      this.crashes = 0
      return
    }
    if (this.snoozed) return
    this.crashes += 1
    if (this.crashes >= CRASH_LIMIT) {
      this.failed = true
      this.deps.log(`floater: 连续 ${this.crashes} 次异常退出，暂停拉起（回到 3080 页面后自动恢复）`)
      return
    }
    if (this.respawnTimer !== 0) return
    this.respawnTimer = this.deps.setTimeout(() => {
      this.respawnTimer = 0
      this.reconcile() // 仍满足"全部后台"才会真正重拉
    }, RESPAWN_MS)
  }

  /** 彻底停止（插件 dispose）：清定时器 + 停进程 + 清注册表。 */
  shutdown(): void {
    this.pages.clear()
    if (this.pruneTimer !== 0) {
      this.deps.clearTimeout(this.pruneTimer)
      this.pruneTimer = 0
    }
    this.hideRing()
    this.teardownProc()
  }

  /** 有活跃"可见"记录时，预约一次到点 reconcile（重复 arm 会撤旧弹新，随心跳顺移动）。 */
  private armPrune(nextPruneAt: number, now: number): void {
    if (this.pruneTimer !== 0) {
      this.deps.clearTimeout(this.pruneTimer)
      this.pruneTimer = 0
    }
    if (nextPruneAt === Infinity) return
    this.pruneTimer = this.deps.setTimeout(() => {
      this.pruneTimer = 0
      this.reconcile()
    }, Math.max(0, nextPruneAt - now))
  }

  /** 路由层 / 测试用的只读快照。 */
  status(): {
    enabled: boolean; pages: number; hiddenPages: number
    procUp: boolean; ringShown: boolean; snoozed: boolean; failed: boolean
    title: string; color: string; pos: { x: number; y: number } | null
  } {
    let hiddenPages = 0
    for (const info of this.pages.values()) if (info.hidden) hiddenPages++
    return {
      enabled: this.pages.size > 0,
      pages: this.pages.size,
      hiddenPages,
      procUp: this.procUp,
      ringShown: this.ringShown,
      snoozed: this.snoozed,
      failed: this.failed,
      title: this.title,
      color: this.color,
      pos: this.pos,
    }
  }

  private ensureProc(): void {
    if (!this.procUp) {
      this.procUp = true
      this.deps.startProc()
    }
  }

  private teardownProc(): void {
    if (this.respawnTimer !== 0) {
      this.deps.clearTimeout(this.respawnTimer)
      this.respawnTimer = 0
    }
    if (this.procUp) {
      this.procUp = false
      this.crashes = 0
      this.deps.stopProc()
    }
  }

  private showRing(): void {
    this.deps.send(this.pos === null ? 'show' : `show ${this.pos.x} ${this.pos.y}`)
  }

  private hideRing(): void {
    if (this.ringShown) {
      this.ringShown = false
      this.deps.send('hide')
    }
  }
}

/** 进程 stdout 行 → 结构化事件（未知行返回 null，交由日志）。 */
export function parseEvent(line: string):
  | { kind: 'ready' }
  | { kind: 'click'; ok: boolean }
  | { kind: 'moved'; x: number; y: number }
  | { kind: 'dismiss' }
  | { kind: 'startup-fail'; reason: string }
  | null {
  const t = line.trim()
  if (t === 'ready') return { kind: 'ready' }
  if (t === 'dismiss') return { kind: 'dismiss' }
  if (t === 'click ok') return { kind: 'click', ok: true }
  if (t === 'click miss') return { kind: 'click', ok: false }
  const m = /^moved (-?\d+) (-?\d+)$/.exec(t)
  if (m) return { kind: 'moved', x: Number(m[1]), y: Number(m[2]) }
  const sf = /^startup failed (.+)$/.exec(t)
  if (sf) return { kind: 'startup-fail', reason: sf[1] }
  return null
}
