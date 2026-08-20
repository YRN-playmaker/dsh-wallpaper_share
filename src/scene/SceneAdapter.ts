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
import type { SceneCapabilities, SceneFrame, SceneRenderStatus } from './SceneProtocol.ts'

/** renderer 崩溃后最多自动重启次数 */
const MAX_RESTARTS = 1
/** 无帧心跳超过该毫秒视为 stalled（触发一次重启） */
const STALL_MS = 4000
/** 崩溃后重启前的退避 */
const RESTART_DELAY_MS = 500
/** 健康轮询间隔 */
const HEALTH_INTERVAL_MS = 1000

export interface SceneTarget {
  key: string
  file: string
  kind: string
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
    this.log('[SceneRenderer] Starting renderer')

    const proc = new SceneRendererProcess({ path: this.capabilities.bin, args: this.capabilities.args })
    proc.on('frame', this.onFrame)
    proc.on('status', (s) => this.onStatus(s))
    proc.on('version', (v) => { this.log('[SceneRenderer] Renderer version: ' + v) })
    proc.on('log', (line) => this.log(line))
    proc.on('exit', (code, signal) => this.onExit(code, signal))
    this.process = proc

    proc.start({
      scene: target.file,
      assets: resolveAssetsDir(this.config as SceneRendererConfig, this.weDir),
      width: this.config.width,
      height: this.config.height,
      fps: this.config.fps,
      quality: this.config.quality,
    })
  }

  private onStatus(s: Record<string, unknown>): void {
    const fps = typeof s.fps === 'number' ? s.fps : this.status.fps
    const frameIndex = typeof s.frame === 'number' ? s.frame : this.status.frameIndex
    this.status = { state: 'running', pid: this.process?.pid ?? undefined, fps, frameIndex, resolution: this.status.resolution, restarts: this.restarts }
  }

  private onExit(code: number | null, signal: string | null): void {
    if (this.process === null) return
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
        if (!this.disposed && this.hub.clientCount > 0 && this.target !== null) this.start(this.target)
      }, RESTART_DELAY_MS)
    } else {
      this.status = { state: 'crashed', restarts: this.restarts, lastError: 'Renderer crashed after ' + this.restarts + ' restart(s)' }
      this.log('[SceneRenderer] Fallback to extracted scene texture')
    }
  }

  private checkHealth(): void {
    const proc = this.process
    if (proc === null || !proc.running || this.disposed) return
    if (proc.lastFrameAt > 0 && Date.now() - proc.lastFrameAt > STALL_MS) {
      this.log('[SceneRenderer] No frame for ' + STALL_MS + 'ms — restarting renderer')
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
