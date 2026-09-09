/**
 * 工作区脉搏 → DWP 变量映射（client 半，纯函数，Node 可测）。
 * 把 node 半 /we-sync/workspace/pulse 的 changes 映射成 scene 变量表：
 * 每槽位 4 个变量（on/name/badge 字色/glyph 徽章符号）+ 尺寸差文案 + 槽位整体显隐。
 * 变量名与 _dev/make-workspace-pulse.mjs 生成的 scene.json 一一对应。
 */
import type { VarValue } from 'dwp-core'

export interface PulseChange {
  name: string
  rel: string
  sign: '+' | '-'
  kind: 'add' | 'del' | 'mod'
  size: number
  delta: number
  at: number
}

export const PULSE_SLOTS = 3
/** 内置 DWP id（与 src/workspace/pack.ts 的 PULSE_ID 一致；client 半不能 import 那边的 node 模块） */
export const PULSE_DWP_ID = 'workspace-pulse'
const GREEN = '#3fb950'
const RED = '#f85149'
/** 字节 → 人类可读（1 位小数，去尾零交给 toFixed 的选择） */
export function formatBytes(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 1_048_576) return (n / 1_048_576).toFixed(abs >= 10_485_760 ? 0 : 1) + ' MB'
  if (abs >= 1024) return (n / 1024).toFixed(abs >= 10_240 ? 0 : 1) + ' KB'
  return String(n) + ' B'
}

/** 文件名过长时保留尾部（扩展名比开头更重要） */
export function truncateName(name: string, max = 18): string {
  if (name.length <= max) return name
  return '…' + name.slice(name.length - (max - 1))
}

/** changes → $var 表（槽位 1..3；不足的槽位 on=0 隐藏） */
export function pulseVars(changes: PulseChange[]): Record<string, VarValue> {
  const vars: Record<string, VarValue> = {
    ws_count: changes.length,
    idle_on: changes.length > 0 ? 0 : 1,
  }
  for (let i = 0; i < PULSE_SLOTS; i++) {
    const c = changes[i]
    vars[`b${i + 1}_on`] = c !== undefined ? 1 : 0
    if (c === undefined) continue
    const plus = c.sign === '+'
    // 徽章量级：新增=文件大小；删除=删除前大小；修改=|Δ|（0 视作同体积内容变化 → 显示当前大小）
    const mag = Math.abs(c.delta) || c.size
    vars[`b${i + 1}_name`] = truncateName(c.name)
    vars[`b${i + 1}_glyph`] = plus ? '+' : '−'
    vars[`b${i + 1}_badge`] = plus ? GREEN : RED
    vars[`b${i + 1}_size`] = (plus ? '+' : '−') + formatBytes(mag)
  }
  return vars
}
