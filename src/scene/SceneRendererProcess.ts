/**
 * 单个 scene renderer 子进程的管理：spawn、stdin 命令写入、stdout 帧解析、
 * stderr 日志/[STATUS] 解析、退出/崩溃事件、健康心跳、带超时的优雅停止。
 *
 * stdout 帧格式（renderer → Node）：
 *   [4B LE uint32 payloadLen][payload]
 *   payload = [1B format][4B LE width][4B LE height][编码/像素字节]
 *
 * stdin 命令（Node → renderer）：换行分隔 JSON，见 SceneProtocol。
 * stderr：人类日志 + 可选 `[STATUS]{"fps":..,"frame":..}` 心跳行 + `[VERSION]x` 自报版本。
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { EventEmitter } from 'node:events'
import {
  FRAME_FORMAT_CODE,
  FORMAT_CODE_NAME,
  STDOUT_PAYLOAD_HEADER_BYTES,
  type SceneControlCommand,
  type SceneFrame,
  type SceneFrameFormat,
  type SceneRenderRequest,
} from './SceneProtocol.ts'

export interface SceneRendererProcessEvents {
  frame: (frame: SceneFrame) => void
  /** stderr [STATUS] 心跳 JSON（已解析） */
  status: (status: Record<string, unknown>) => void
  /** renderer 自报版本（stderr [VERSION] 行） */
  version: (version: string) => void
  exit: (code: number | null, signal: string | null) => void
  log: (line: string) => void
}

export interface SceneRendererProcessOptions {
  path: string
  args: string[]
  /** 向 stdout 日志加的前缀（便于多实例区分） */
  logPrefix?: string
}

/** 优雅停止：先发 {"cmd":"stop"}，超时后 SIGKILL */
const STOP_GRACE_MS = 1500

export class SceneRendererProcess extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null
  private stdoutBuf: Buffer = Buffer.alloc(0)
  private stderrBuf = ''
  private stopped = false
  private stopTimer: ReturnType<typeof setTimeout> | null = null

  readonly path: string
  readonly args: string[]
  readonly logPrefix: string
  pid: number | null = null
  lastFrameAt = 0
  lastFrame: SceneFrame | null = null
  version = ''

  constructor(opts: SceneRendererProcessOptions) {
    super()
    this.path = opts.path
    this.args = opts.args
    this.logPrefix = opts.logPrefix ?? '[SceneRenderer]'
  }

  get running(): boolean {
    return this.child !== null && this.stopped === false && this.child.exitCode === null
  }

  start(request: Omit<SceneRenderRequest, 'cmd'>): void {
    if (this.running) return
    this.stopped = false
    this.child = spawn(this.path, this.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    this.pid = this.child.pid ?? null
    this.log(this.logPrefix + ' Starting renderer ' + this.path + ' ' + this.args.join(' '))

    this.child.stdout.on('data', (chunk: Buffer) => this.onStdout(chunk))
    this.child.stderr.on('data', (chunk: Buffer) => this.onStderr(chunk.toString('utf8')))
    this.child.on('error', (err) => {
      this.log(this.logPrefix + ' Renderer spawn error: ' + String((err as Error).message ?? err))
      this.emit('exit', null, null)
    })
    this.child.on('exit', (code, signal) => {
      this.log(this.logPrefix + ' Renderer exited unexpectedly (code=' + String(code) + ', signal=' + String(signal) + ')')
      this.cleanup()
      this.emit('exit', code, signal)
    })

    this.send({ cmd: 'load' as const, ...request })
  }

  send(command: SceneControlCommand | SceneRenderRequest): void {
    if (this.child === null || this.stopped || this.child.stdin.destroyed) return
    try {
      this.child.stdin.write(JSON.stringify(command) + '\n')
    } catch (err) {
      this.log(this.logPrefix + ' stdin write failed: ' + String((err as Error).message ?? err))
    }
  }

  /** 优雅停止：先 stop 命令，超时强杀 */
  stop(): void {
    if (this.child === null) return
    if (this.stopped) return
    // 先发 stop 再置 stopped：send() 内部会跳过 stopped 状态
    try { this.send({ cmd: 'stop' }) } catch { /* 忽略 */ }
    this.stopped = true
    this.stopTimer = setTimeout(() => {
      if (this.child !== null && this.child.exitCode === null) {
        this.log(this.logPrefix + ' Force-killing renderer after grace timeout')
        try { this.child.kill('SIGKILL') } catch { /* 已退出 */ }
      }
    }, STOP_GRACE_MS)
  }

  /** 立即强制终止（用于 dispose / 切换壁纸的硬清理） */
  kill(): void {
    this.stopped = true
    if (this.stopTimer !== null) { clearTimeout(this.stopTimer); this.stopTimer = null }
    if (this.child !== null) {
      try { this.child.kill('SIGKILL') } catch { /* 已退出 */ }
      this.cleanup()
    }
  }

  private cleanup(): void {
    if (this.stopTimer !== null) { clearTimeout(this.stopTimer); this.stopTimer = null }
    this.child = null
    this.pid = null
    this.stdoutBuf = Buffer.alloc(0)
  }

  private log(line: string): void {
    this.emit('log', line)
  }

  private onStdout(chunk: Buffer): void {
    this.stdoutBuf = Buffer.concat([this.stdoutBuf, chunk])
    // 解析一个或多个 length-prefixed 帧
    for (;;) {
      if (this.stdoutBuf.length < 4) return
      const len = this.stdoutBuf.readUInt32LE(0)
      if (len <= 0 || len > 16 * 1024 * 1024) {
        // 非法长度：丢弃 1 字节重新同步，避免死循环
        this.stdoutBuf = this.stdoutBuf.subarray(1)
        continue
      }
      if (this.stdoutBuf.length < 4 + len) return
      const payload = this.stdoutBuf.subarray(4, 4 + len)
      this.stdoutBuf = this.stdoutBuf.subarray(4 + len)
      const frame = this.decodePayload(payload)
      if (frame !== null) {
        this.lastFrame = frame
        this.lastFrameAt = Date.now()
        this.emit('frame', frame)
      }
    }
  }

  private decodePayload(payload: Buffer): SceneFrame | null {
    if (payload.length < STDOUT_PAYLOAD_HEADER_BYTES) return null
    const formatCode = payload[0]
    const format = FORMAT_CODE_NAME[formatCode]
    if (format === undefined) return null
    const width = payload.readUInt32LE(1)
    const height = payload.readUInt32LE(5)
    if (width < 1 || height < 1 || width > 16384 || height > 16384) return null
    const data = Uint8Array.from(payload.subarray(STDOUT_PAYLOAD_HEADER_BYTES))
    return { format, width, height, data, ts: Date.now() }
  }

  private onStderr(text: string): void {
    this.stderrBuf += text
    let nl = this.stderrBuf.indexOf('\n')
    while (nl >= 0) {
      const line = this.stderrBuf.slice(0, nl).replace(/\r$/, '')
      this.stderrBuf = this.stderrBuf.slice(nl + 1)
      this.handleStderrLine(line)
      nl = this.stderrBuf.indexOf('\n')
    }
  }

  private handleStderrLine(line: string): void {
    if (line.trim() === '') return
    const statusIdx = line.indexOf('[STATUS]')
    if (statusIdx >= 0) {
      try {
        const json = JSON.parse(line.slice(statusIdx + '[STATUS]'.length).trim()) as Record<string, unknown>
        this.emit('status', json)
        return
      } catch { /* 非法心跳，按日志处理 */ }
    }
    const verIdx = line.indexOf('[VERSION]')
    if (verIdx >= 0) {
      const v = line.slice(verIdx + '[VERSION]'.length).trim()
      if (v !== '') this.version = v
      this.emit('version', this.version)
      return
    }
    // renderer 自身 stderr 已带 [SceneRenderer] 前缀时不再重复
    this.emit('log', line.startsWith(this.logPrefix) ? line : this.logPrefix + ' ' + line)
  }
}

/** 便于类型收窄：判断一个格式字节是否合法 */
export function isFrameFormatCode(code: number): code is number {
  return code in FORMAT_CODE_NAME
}

/** 导出格式码表，供 SceneRendererProcess 与测试使用 */
export { FRAME_FORMAT_CODE }
