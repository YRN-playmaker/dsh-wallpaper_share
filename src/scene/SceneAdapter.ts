/**
 * SceneAdapter —— scene 壁纸动态渲染的统一编排层。
 *
 * 职责（与任务十一致）：
 *   renderer detection / startup / shutdown、scene.pkg 路径、engine assets 路径、
 *   输出分辨率、FPS、帧传输（→ SceneFrameHub）、renderer 健康检查、自动重启一次、
 *   fallback 信号、缓存（指纹）、诊断。
 *
 * 活动模型（按需渲染，避免空转）：
 *   - 只有「目标显示器是 scene」且「至少有一个浏览器 WS 客户端」时才运行 renderer；
 *   - 浏览器切到性能模式 / 关闭同步 / 关闭页面 → WS 断开 → renderer 停止；
 *   - 切换壁纸 / 显示器 → 旧 renderer 停止 → 新 renderer 启动；
 *   - 崩溃 → 自动重启一次 → 仍失败 → 由浏览器走 texture/preview fallback。
 */
import {
  detectSceneRenderer,
  resolveAssetsDir,
  sceneFingerprint,
  type SceneRendererConfig,
} from './SceneCapabilities.ts'
import { SceneRendererProcess } from './SceneRendererProcess.ts'
import { SceneFrameHub } from './SceneWebSocket.ts'
import {
  resolveSceneFallback,
  describeSceneStatus,
  type SceneFallbackResult,
} from './SceneFallback.ts'
import { parseCaptureScreen, type SceneCapabilities, type SceneFrame, type SceneRenderStatus } from './SceneProtocol.ts'

/** renderer 崩溃后最多自动重启次数 */
const MAX_RESTARTS = 1
/** 无帧心跳超过该毫秒视为 stalled（触发一次重启） */
const STALL_MS = 4000
/** 崩溃后重启前的退避 */
const RESTART_DELAY_MS = 500
/** 健康轮询间隔 */
const HEALTH_INTERVAL_MS = 1000

/**
 * 捕获型 renderer 的最低可用版本。we-capture 0.3.0 是「每次唤醒只捡一帧 + 100ms 轮询兜底」，
 * 出帧节奏被绑死在 100ms 上：任何壁纸都被压到 ~8fps，且与分辨率/画质/窗口可见性无关
 * （实测 1080p 5.9fps、720p 7.84fps，反推出的「每帧约 95ms 固定开销」就是这个轮询超时）。
 * 0.4.0 起改用 CreateFreeThreaded 事件驱动出帧，同一台机器同一张壁纸实测 8.1 → 23~25fps。
 * 一旦旧二进制被打进发布包（26.9.12~26.9.29 就是这样漏了三版），这行日志能让用户直接看出原因。
 */
const MIN_CAPTURE_VERSION = '0.4.0'

/**
 * 几何上报口径修正的最低版本：0.4.3 起捕获器把 Win32 **物理**像素按显示器缩放换算成
 * **逻辑**像素（DIP）再上报。低于它的二进制在 125% / 150% 这类高 DPI 缩放上，页面会把
 * 物理坐标当逻辑坐标用 —— 背景与真实壁纸错位，且偏差随窗口越靠屏幕右侧越大。
 * 100% 缩放（逻辑 = 物理）时旧版看不出问题，所以这里只在版本过旧时提示、不做阻断。
 */
const MIN_CAPTURE_GEOMETRY_VERSION = '0.4.3'

/** 语义化版本比较（只比较前 3 段数字）：a < b */
function versionLess(a: string, b: string): boolean {
  const pa = a.split('.').map((s) => Number.parseInt(s, 10))
  const pb = b.split('.').map((s) => Number.parseInt(s, 10))
  for (let i = 0; i < 3; i++) {
    const x = Number.isFinite(pa[i]) ? (pa[i] as number) : 0
    const y = Number.isFinite(pb[i]) ? (pb[i] as number) : 0
    if (x !== y) return x < y
  }
  return false
}

export interface SceneTarget {
  key: string
  file: string
  kind: string
}

/** 从显示器 key（如 "Monitor2"）提取序号；无法解析返回 undefined（renderer 自行挑选） */
function monitorIndexOf(key: string): number | undefined {
  const m = /(\d+)/.exec(key)
  if (m === null) return undefined
  const n = Number(m[1])
  return Number.isInteger(n) && n >= 1 ? n : undefined
}

export interface SceneAdapterOptions {
  config: SceneRendererConfig & {
    width: number
    height: number
    fps: number
    quality: number
  }
  weDir: string
  log: (line: string) => void
}

export class SceneAdapter {
  readonly hub: SceneFrameHub

  private config: SceneAdapterOptions['config']
  private weDir: string
  private logFn: (line: string) => void

  private capabilities: SceneCapabilities | null = null
  private process: SceneRendererProcess | null = null
  private target: SceneTarget | null = null
  private fingerprint = ''
  private status: SceneRenderStatus = { state: 'idle', restarts: 0 }
  private restarts = 0
  private disposed = false
  private healthTimer: ReturnType<typeof setInterval> | null = null

  constructor(opts: SceneAdapterOptions) {
    this.config = opts.config
    this.weDir = opts.weDir
    this.logFn = opts.log
    this.capabilities = detectSceneRenderer(opts.config, opts.weDir)
    this.log('[SceneRenderer] ' + (this.capabilities.available
      ? 'Renderer found: ' + this.capabilities.rendererPath + ' (assets ' + (this.capabilities.assetsFound ? 'ok' : 'missing') + ')'
      : 'Renderer not found: ' + (this.capabilities.reason ?? '')))

    // 客户端数量变化 → 按需启动/停止 renderer
    this.hub = new SceneFrameHub((line) => this.log(line), () => this.syncActivity())

    this.healthTimer = setInterval(() => this.checkHealth(), HEALTH_INTERVAL_MS)
    if (typeof this.healthTimer.unref === 'function') this.healthTimer.unref()
  }

  /** 目标显示器/壁纸变化时调用；kind 非 scene 或文件变化会重启 renderer */
  setTarget(target: SceneTarget | null): void {
    if (target === null || target.kind !== 'scene') {
      if (this.target !== null) {
        this.stopProcess()
        this.target = null
        this.fingerprint = ''
        this.status = { state: 'idle', restarts: this.restarts }
      }
      return
    }
    const fp = sceneFingerprint(target.file)
    if (this.target !== null && this.target.key === target.key && this.fingerprint === fp) return
    this.log('[SceneRenderer] Scene changed → restarting renderer (' + target.file + ')')
    this.stopProcess()
    this.target = target
    this.fingerprint = fp
    this.restarts = 0
    this.syncActivity()
  }

  /** 按需启动/停止：目标为 scene 且有客户端才运行 */
  private syncActivity(): void {
    if (this.disposed) return
    if (this.target === null) return
    if (this.hub.clientCount > 0) {
      if (this.process === null || !this.process.running) this.start(this.target)
    } else {
      this.stopProcess()
    }
  }

  /** 停止进程但不改变 target（客户端断开时调用，保持可重新启动） */
  private stopProcess(): void {
    if (this.target !== null) this.hub.setCaptureScreen(this.target.key, null)
    if (this.process !== null) {
      this.process.kill()
      this.process = null
    }
    if (this.status.state !== 'idle' && this.status.state !== 'stopped') {
      this.status = { state: 'idle', restarts: this.restarts }
    }
  }

  /** 显式完全停止（dispose） */
  stop(): void {
    this.disposed = true
    this.stopProcess()
    this.target = null
    this.fingerprint = ''
    this.status = { state: 'stopped', restarts: this.restarts }
  }

  /** 切换渲染分辨率（供未来多显示器 / 分辨率调整） */
  resize(width: number, height: number): void {
    this.config.width = width
    this.config.height = height
    if (this.process !== null && this.process.running) {
      this.process.send({ cmd: 'resize', width, height })
    }
  }

  pause(): void {
    if (this.process !== null && this.process.running) {
      this.process.send({ cmd: 'pause' })
      this.status = { ...this.status, state: 'paused' }
    }
  }

  resume(): void {
    if (this.process !== null && this.process.running) {
      this.process.send({ cmd: 'resume' })
      this.status = { ...this.status, state: 'running' }
    }
  }

  /** 帧 → 广播给浏览器（经 SceneFrameHub） */
  private onFrame = (frame: SceneFrame): void => {
    if (this.target !== null) this.hub.broadcast(this.target.key, frame)
    if (this.status.state !== 'running' && this.status.state !== 'paused') {
      this.status = { state: 'running', pid: this.process?.pid ?? undefined, restarts: this.restarts, resolution: this.status.resolution }
    }
  }

  private start(target: SceneTarget): void {
    if (this.capabilities === null || !this.capabilities.available) {
      this.status = { state: 'crashed', restarts: this.restarts, lastError: this.capabilities?.reason ?? 'Renderer not found' }
      this.log('[SceneRenderer] Renderer not available, falling back to extracted scene texture')
      return
    }
    if (!this.capabilities.assetsFound) {
      this.status = { state: 'crashed', restarts: this.restarts, lastError: 'Wallpaper Engine assets dir missing: ' + this.capabilities.assetsDir }
      this.log('[SceneRenderer] Assets dir missing (' + this.capabilities.assetsDir + '), falling back to texture')
      return
    }
    this.status = { state: 'starting', restarts: this.restarts, resolution: { width: this.config.width, height: this.config.height } }
    this.hub.setCaptureScreen(target.key, null)
    this.warnIfCaptureOutdated()
    this.log('[SceneRenderer] Starting renderer')

    const proc = new SceneRendererProcess({ path: this.capabilities.bin, args: this.capabilities.args })
    proc.on('frame', this.onFrame)
    proc.on('status', (s) => { if (this.process === proc) this.onStatus(s) })
    proc.on('version', (v) => { this.log('[SceneRenderer] Renderer version: ' + v) })
    proc.on('log', (line) => this.log(line))
    proc.on('exit', (code, signal) => this.onExit(proc, code, signal))
    this.process = proc

    proc.start({
      scene: target.file,
      assets: resolveAssetsDir(this.config as SceneRendererConfig, this.weDir),
      width: this.config.width,
      height: this.config.height,
      fps: this.config.fps,
      quality: this.config.quality,
      // 目标显示器序号（WE MonitorN）：捕获型 renderer（we-capture ≥0.2.0）用它挑对应显示器上的
      // 壁纸窗口；参考 renderer 忽略该字段。多显示器时让「背景显示器」锁定对性能模式生效。
      monitor: monitorIndexOf(target.key),
    })
  }

  /**
   * 捕获型 renderer 版本过旧时给出可操作的警告。旧二进制被打进发布包时（26.9.12~26.9.29
   * 就是源码 0.4.0 / 包内 0.3.0），用户的日志里只会看到「壁纸只有 ~8fps」而没有任何线索，
   * 这行日志直接把根因和修复方式写清楚。
   */
  private warnIfCaptureOutdated(): void {
    const version = this.capabilities?.version ?? ''
    if (!version.startsWith('we-capture-')) return
    const semver = version.slice('we-capture-'.length)
    if (versionLess(semver, MIN_CAPTURE_VERSION)) {
      this.log(
        '[SceneRenderer] ⚠ 捕获器 ' + version + ' 过旧（低于 ' + MIN_CAPTURE_VERSION + '）：出帧被 100ms 轮询封顶在 ~8fps，' +
        '与分辨率 / 画质 / 窗口是否可见都无关。请更新到自带 we-capture ≥ ' + MIN_CAPTURE_VERSION + ' 的插件版本。',
      )
      return
    }
    if (versionLess(semver, MIN_CAPTURE_GEOMETRY_VERSION)) {
      this.log(
        '[SceneRenderer] ⚠ 捕获器 ' + version + ' 的几何是 Win32 物理像素（低于 ' + MIN_CAPTURE_GEOMETRY_VERSION + '）：' +
        '在 125% / 150% 等高 DPI 缩放下背景会与真实壁纸错位，且窗口越靠屏幕右侧偏差越大。' +
        '请更新到自带 we-capture ≥ ' + MIN_CAPTURE_GEOMETRY_VERSION + ' 的插件版本。',
      )
    }
  }

  private onStatus(s: Record<string, unknown>): void {
    const captureScreen = parseCaptureScreen(s.captureScreen) ?? this.status.captureScreen
    if (s.captureScreen !== undefined && this.target !== null) this.hub.setCaptureScreen(this.target.key, captureScreen ?? null)
    const fps = typeof s.fps === 'number' ? s.fps : this.status.fps
    const frameIndex = typeof s.frame === 'number' ? s.frame : this.status.frameIndex
    this.status = { state: 'running', pid: this.process?.pid ?? undefined, fps, frameIndex, resolution: this.status.resolution, captureScreen, restarts: this.restarts }
  }

  private onExit(proc: SceneRendererProcess, code: number | null, signal: string | null): void {
    // 关键：只有「退出的正是当前跟踪的进程」时才处理。切换壁纸时 stopProcess() 先 kill 旧
    // 进程并置 this.process=null，随后 start() 立即把 this.process 指向新进程；而旧进程的
    // 'exit' 事件是异步稍后才触发的——若不校验身份，就会把新进程的引用误清空，导致新进程
    // 变成无人跟踪的孤儿（仍在后台编码 1080p），每次切换壁纸泄漏一个 → 累积拖垮 CPU。
    if (this.process !== proc) return
    this.process = null
    if (this.disposed || this.hub.clientCount === 0 || this.target === null) {
      this.status = { state: 'idle', restarts: this.restarts }
      return
    }
    this.log('[SceneRenderer] Renderer exited unexpectedly (code=' + String(code) + ', signal=' + String(signal) + ')')
    if (this.restarts < MAX_RESTARTS) {
      this.restarts += 1
      this.log('[SceneRenderer] Auto-restarting renderer (attempt ' + this.restarts + '/' + MAX_RESTARTS + ')')
      this.status = { state: 'starting', restarts: this.restarts }
      setTimeout(() => {
        if (!this.disposed && this.hub.clientCount > 0 && this.target !== null && this.process === null) this.start(this.target)
      }, RESTART_DELAY_MS)
    } else {
      this.status = { state: 'crashed', restarts: this.restarts, lastError: 'Renderer crashed after ' + this.restarts + ' restart(s)' }
      this.log('[SceneRenderer] Fallback to extracted scene texture')
    }
  }

  private checkHealth(): void {
    const proc = this.process
    if (proc === null || !proc.running || this.disposed) return
    // 存活判据取「最近帧」与「最近心跳」的较大者：静态/暂停壁纸无新帧但持续心跳，
    // 不应被误判为 stalled 而反复重启（原生捕获器在 WE 暂停时正是这种情况）。
    const lastAlive = Math.max(proc.lastFrameAt, proc.lastBeatAt)
    if (lastAlive > 0 && Date.now() - lastAlive > STALL_MS) {
      this.log('[SceneRenderer] No frame or heartbeat for ' + STALL_MS + 'ms — restarting renderer')
      proc.kill()
    }
  }

  getCapabilities(): SceneCapabilities | null {
    return this.capabilities
  }

  /** 当前 renderer 正在渲染的目标（浏览器经 WS 锁定后可能与 auto 显示器不同） */
  getTarget(): SceneTarget | null {
    return this.target
  }

  getStatus(): SceneRenderStatus {
    const s = this.status
    if (s.pid === undefined && this.process?.pid != null) s.pid = this.process.pid
    return s
  }

  /** 是否正在出帧（浏览器据此决定是否走 live canvas） */
  isRunning(): boolean {
    return this.process !== null && this.process.running && this.hub.clientCount > 0
  }

  getFallback(opts: { kind: string; hasTexture: boolean; hasPreview: boolean; renderMode: 'preview' | 'source' }): SceneFallbackResult {
    return resolveSceneFallback({
      kind: opts.kind,
      rendererRunning: this.isRunning(),
      rendererAvailable: this.capabilities?.available === true,
      hasTexture: opts.hasTexture,
      hasPreview: opts.hasPreview,
      renderMode: opts.renderMode,
    })
  }

  describe(): string {
    return describeSceneStatus(this.getStatus(), this.getFallback({ kind: this.target?.kind ?? 'scene', hasTexture: false, hasPreview: false, renderMode: 'source' }))
  }

  dispose(): void {
    this.disposed = true
    if (this.healthTimer !== null) clearInterval(this.healthTimer)
    this.stopProcess()
    this.hub.closeAll()
  }

  private log(line: string): void {
    this.logFn(line)
  }
}
