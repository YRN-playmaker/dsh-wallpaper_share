/**
 * 工作区脉搏（Workspace Pulse）：轻量文件系统快照 + 差分，产出"近期改动文件"流。
 * 供同名内置 DWP 动态壁纸消费（气泡显示最近改动的文件，右上角 +/− 徽章表示体积增减方向）。
 * 纯 Node，不依赖 git：未提交/未保存/二进制文件都能捕获；跳过 node_modules/.git 等重目录，
 * 有界遍历（条目数 + 深度）防失控；journal 只保留窗口期内的改动，重启即重新基线（不产生洪流）。
 */
import { readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

export interface PulseChange {
  /** 显示名（basename） */
  name: string
  /** 相对根路径（'/' 分隔，正斜杠统一） */
  rel: string
  /** 体积增减方向：'+' 增（新增/变大/同体积内容变化），'−' 减（缩小/删除） */
  sign: '+' | '-'
  /** 改动类型：add 新出现 / del 消失 / mod 内容或大小变化 */
  kind: 'add' | 'del' | 'mod'
  /** 当前（删除时为删除前）字节大小 */
  size: number
  /** 字节增量：add=size，del=−size，mod=差值（可为 0） */
  delta: number
  /** 检出时间戳（ms） */
  at: number
}

interface SnapshotEntry { mtimeMs: number; size: number }

/** 跳过的重目录（依赖/构建产物/版本库内部——不是"用户改动的工作文件"） */
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.svn', '.hg', 'dist', 'build', 'out',
  '.venv', 'venv', '__pycache__', '.next', '.nuxt', '.cache', '.gradle', 'target', '.turbo',
])

export interface WorkspacePulseOptions {
  /** 改动保留窗口（ms），超期从显示流里淘汰 */
  windowMs?: number
  /** 扫描 TTL 缓存（ms）——客户端 2.5s 轮询，默认 1.5s 保证每次轮询至多触发一次真实扫描 */
  ttlMs?: number
  /** 单次遍历文件条目上限（防失控） */
  maxEntries?: number
  /** 递归深度上限 */
  maxDepth?: number
}

export class WorkspacePulse {
  readonly root: string
  private readonly windowMs: number
  private readonly ttlMs: number
  private readonly maxEntries: number
  private readonly maxDepth: number
  private prev = new Map<string, SnapshotEntry>()
  private baselined = false
  private journal: PulseChange[] = []
  private lastScan = 0
  private truncated = false

  constructor(root: string, opts: WorkspacePulseOptions = {}) {
    this.root = root
    this.windowMs = opts.windowMs ?? 90_000
    this.ttlMs = opts.ttlMs ?? 1_500
    this.maxEntries = opts.maxEntries ?? 20_000
    this.maxDepth = opts.maxDepth ?? 10
  }

  /** 扫描（TTL 缓存）：返回去重后的近期改动（最新在前，≤32 条）。根目录不存在/不可读时返回已有结果。 */
  scan(): PulseChange[] {
    const now = Date.now()
    if (now - this.lastScan >= this.ttlMs) {
      this.lastScan = now
      try { this.scanOnce(now) } catch { /* 根目录消失等：维持上一轮快照 */ }
      this.journal = this.journal.filter((c) => now - c.at <= this.windowMs)
      if (this.journal.length > 200) this.journal = this.journal.slice(this.journal.length - 200)
    }
    return this.changes()
  }

  /** journal 去重（同路径保最新）+ 最新在前，≤32 条。 */
  changes(): PulseChange[] {
    const byPath = new Map<string, PulseChange>()
    for (const c of this.journal) byPath.set(c.rel, c)   // journal 按时间追加 → 后写覆盖 = 最新
    return [...byPath.values()].sort((a, b) => b.at - a.at).slice(0, 32)
  }

  /** 最近一次遍历是否触及条目上限（诊断用）。 */
  isTruncated(): boolean { return this.truncated }

  private scanOnce(now: number): void {
    const cur = new Map<string, SnapshotEntry>()
    this.truncated = false
    this.walk(this.root, 0, cur)
    if (!this.baselined) {
      // 首扫 = 基线：全量视为已有，避免插件启动/重启时产生"全部是新增"的洪流
      this.baselined = true
      this.prev = cur
      return
    }
    for (const [rel, e] of cur) {
      const p = this.prev.get(rel)
      if (p === undefined) {
        this.push({ name: base(rel), rel, sign: '+', kind: 'add', size: e.size, delta: e.size, at: now })
      } else if (p.mtimeMs !== e.mtimeMs || p.size !== e.size) {
        const delta = e.size - p.size
        this.push({ name: base(rel), rel, sign: delta >= 0 ? '+' : '-', kind: 'mod', size: e.size, delta, at: now })
      }
    }
    for (const [rel, p] of this.prev) {
      if (!cur.has(rel)) this.push({ name: base(rel), rel, sign: '-', kind: 'del', size: p.size, delta: -p.size, at: now })
    }
    this.prev = cur
  }

  private push(c: PulseChange): void { this.journal.push(c) }

  private walk(dir: string, depth: number, cur: Map<string, SnapshotEntry>): void {
    if (this.truncated || depth > this.maxDepth) return
    let names: string[]
    try { names = readdirSync(dir) } catch { return }
    for (const name of names) {
      if (cur.size >= this.maxEntries) { this.truncated = true; return }
      const full = join(dir, name)
      let st
      try { st = statSync(full) } catch { continue }   // 竞态删除/无权限：跳过
      if (st.isDirectory()) {
        if (SKIP_DIRS.has(name)) continue
        this.walk(full, depth + 1, cur)
      } else if (st.isFile()) {
        cur.set(relative(this.root, full).split(sep).join('/'), { mtimeMs: st.mtimeMs, size: st.size })
      }
    }
  }
}

function base(rel: string): string {
  const i = rel.lastIndexOf('/')
  return i >= 0 ? rel.slice(i + 1) : rel
}
