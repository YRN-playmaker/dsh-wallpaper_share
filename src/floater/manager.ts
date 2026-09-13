/**
 * we-floater 子进程管理器：定位 exe、懒 spawn、stdin 写命令、stdout 行喂给 FloaterHub、
 * 崩溃交由 hub 决策重拉、dispose 硬清理。进程细节集中在这里，hub 保持纯逻辑可测。
 *
 * exe 定位（对齐 SceneCapabilities.resolveBundledCapture）：随包 bin/ 优先，其次本地
 * native/we-capture/target/release/。非 win32 或找不到 exe → supported=false，悬浮球整体禁用。
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FloaterHub, parseEvent, type HubDeps } from './hub.ts'

export interface FloaterManagerOptions {
  /** 位置持久化文件；null/'' = 不落盘（测试用） */
  posFile: string | null
  /** 覆盖 exe 路径（测试用） */
  exePath?: string | null
  /** 注入 spawn（测试用） */
  spawnImpl?: (path: string) => ChildProcess
  log?: (msg: string) => void
}

export class FloaterManager {
  readonly supported: boolean
  private readonly exePath: string | null
  private readonly posFile: string | null
  private readonly spawnImpl: (path: string) => ChildProcess
  private readonly log: (msg: string) => void
  private child: ChildProcess | null = null
  private stopping = false
  private stdoutBuf = ''
  readonly hub: FloaterHub

  constructor(opts: FloaterManagerOptions) {
    this.posFile = opts.posFile
    this.spawnImpl = opts.spawnImpl ?? defaultSpawn
    this.log = opts.log ?? (() => {})
    this.exePath = opts.exePath !== undefined ? opts.exePath : resolveFloaterExe()
    this.supported = process.platform === 'win32' && this.exePath !== null
    const hubDeps: HubDeps = {
      send: (line) => this.writeStdin(line),
      startProc: () => this.startProc(),
      stopProc: () => this.stopProc(),
      setTimeout: (fn, ms) => setTimeout(fn, ms) as unknown as number,
      clearTimeout: (h) => clearTimeout(h as unknown as ReturnType<typeof setTimeout>),
      now: () => Date.now(),
      persistPos: (x, y) => this.persistPos(x, y),
      log: (m) => this.log(m),
    }
    this.hub = new FloaterHub(hubDeps)
    const saved = this.loadPos()
    if (saved !== null) this.hub.pos = saved
  }

  /** 记录最近一次拖拽落点（client 打开面板时回填，球重启后位置不丢）。 */
  private loadPos(): { x: number; y: number } | null {
    if (this.posFile === null) return null
    try {
      const raw = JSON.parse(readFileSync(this.posFile, 'utf8')) as { x?: unknown; y?: unknown }
      if (typeof raw.x === 'number' && typeof raw.y === 'number') return { x: raw.x, y: raw.y }
    } catch { /* 无文件/损坏：默认位置 */ }
    return null
  }

  private persistPos(x: number, y: number): void {
    if (this.posFile === null) return
    try {
      mkdirSync(dirname(this.posFile), { recursive: true })
      writeFileSync(this.posFile, JSON.stringify({ x, y }), 'utf8')
    } catch { /* 存不下不致命 */ }
  }

  private startProc(): void {
    if (!this.supported || this.exePath === null || this.child !== null) return
    this.stopping = false
    try {
      this.child = this.spawnImpl(this.exePath)
    } catch (e) {
      this.child = null
      this.log('floater: spawn 失败 ' + String((e as Error).message ?? e))
      // spawn 同步失败：视作一次异常退出，交给 hub 的熔断/重拉策略
      queueMicrotask(() => this.hub.onExit(false))
      return
    }
    const child = this.child
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => this.onStdout(chunk))
    child.on('error', (err) => this.log('floater: 子进程错误 ' + String((err as Error).message ?? err)))
    child.on('exit', () => {
      this.child = null
      this.stdoutBuf = ''
      const intentional = this.stopping
      this.stopping = false
      this.hub.onExit(intentional)
    })
    this.hub.procUp = true
  }

  private stopProc(): void {
    const child = this.child
    this.stopping = true
    if (child === null) return
    this.writeStdin('quit')
    // 给 we-floater 一点时间优雅退出，超时硬杀
    const kill = setTimeout(() => {
      try { child.kill('SIGKILL') } catch { /* 已退 */ }
    }, 1200)
    child.once('exit', () => clearTimeout(kill))
  }

  private writeStdin(line: string): void {
    const child = this.child
    if (child === null || child.stdin === null || child.stdin.destroyed) return
    try {
      child.stdin.write(line + '\n')
    } catch (e) {
      this.log('floater: stdin 写入失败 ' + String((e as Error).message ?? e))
    }
  }

  private onStdout(chunk: string): void {
    this.stdoutBuf += chunk
    let nl = this.stdoutBuf.indexOf('\n')
    while (nl >= 0) {
      const line = this.stdoutBuf.slice(0, nl).replace(/\r$/, '')
      this.stdoutBuf = this.stdoutBuf.slice(nl + 1)
      this.handleLine(line)
      nl = this.stdoutBuf.indexOf('\n')
    }
  }

  private handleLine(line: string): void {
    if (line.trim() === '') return
    const ev = parseEvent(line)
    if (ev === null) {
      this.log('floater: ' + line)
      return
    }
    switch (ev.kind) {
      case 'ready': this.hub.onReady(); break
      case 'dismiss': this.hub.onDismiss(); break
      case 'click': this.hub.onClick(ev.ok); break
      case 'moved': this.hub.onMoved(ev.x, ev.y); break
      case 'startup-fail':
        this.log('floater: 启动失败 ' + ev.reason)
        break
    }
  }

  /** 插件 dispose 时调用：确保子进程不留存。 */
  dispose(): void {
    this.hub.shutdown()
  }
}

/** 默认真实 spawn（管教 stdin/stdout，隐藏控制台窗）。 */
function defaultSpawn(path: string): ChildProcess {
  const child = spawn(path, [], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true, detached: false })
  return child
}

/** 定位 we-floater.exe：<包根>/bin/we-floater.exe 优先，其次 native 本地构建产物。 */
export function resolveFloaterExe(): string | null {
  try {
    const here = fileURLToPath(import.meta.url)
    // 打包后所有 node 半模块并入 <包根>/lib/index.js，dirname 的上一级即包根（同 SceneCapabilities）
    const pkgRoot = resolve(dirname(here), '..')
    const name = process.platform === 'win32' ? 'we-floater.exe' : 'we-floater'
    const cands = [
      resolve(pkgRoot, 'bin', name),
      resolve(pkgRoot, 'native', 'we-capture', 'target', 'release', name),
    ]
    for (const c of cands) if (existsSync(c)) return c
    return null
  } catch {
    return null
  }
}
