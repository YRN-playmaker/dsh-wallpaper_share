/**
 * 快捷键规格：把 KeyboardEvent 归一化成可比较、可落盘的字符串。
 *
 * 规格形如 `F11` / `Ctrl+Shift+K` / `Alt+1`：修饰键按 Ctrl → Alt → Shift → Meta 的固定顺序，
 * 主键取 `KeyboardEvent.key`（单字符统一大写、空格记作 `Space`）。录制时只按下修饰键
 * （Ctrl / Shift / Alt / Meta / CapsLock / Dead…）不产生规格，否则会把「Ctrl」本身存成快捷键。
 *
 * 匹配要求修饰键完全一致：绑定 `A` 时按 Ctrl+A 不触发，绑定 `Ctrl+K` 时单按 K 也不触发。
 * `isTypingBinding` 单独标出「打字键」（不带修饰键的单字符 / 编辑键），供 DOM 侧在输入框内让位。
 * 纯函数、无 DOM 依赖，node --test 直接可测（DOM 侧的输入框守卫在 index.ts）。
 */

export interface KeyLike {
  key: string
  ctrlKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
  metaKey?: boolean
}

/** 修饰键本身 / 无主键的按键：按下时不产生绑定 */
const MODIFIER_KEYS = new Set([
  'Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'NumLock', 'ScrollLock', 'Dead', 'Unidentified',
])

/** 主键归一化：单字符大写（a → A）、空格 → Space，其余保持原值（F11 / ArrowUp / PageDown） */
function normalizeKey(key: string): string {
  if (key === ' ') return 'Space'
  return key.length === 1 ? key.toUpperCase() : key
}

/** 事件 → 规格；纯修饰键或无法识别的主键返回 null（调用方应忽略这次按键，继续等） */
export function bindingFromEvent(ev: KeyLike): string | null {
  if (typeof ev.key !== 'string' || ev.key === '' || MODIFIER_KEYS.has(ev.key)) return null
  const parts: string[] = []
  if (ev.ctrlKey === true) parts.push('Ctrl')
  if (ev.altKey === true) parts.push('Alt')
  if (ev.shiftKey === true) parts.push('Shift')
  if (ev.metaKey === true) parts.push('Meta')
  parts.push(normalizeKey(ev.key))
  return parts.join('+')
}

/** 事件是否命中绑定（修饰键必须完全一致） */
export function matchesBinding(binding: string, ev: KeyLike): boolean {
  const got = bindingFromEvent(ev)
  return got !== null && got === binding
}

/** 显示文本：规格本身就是显示形式，保留成函数以便以后加本地化符号 */
export function describeBinding(binding: string): string {
  return binding
}

/** 规格校验：存档里的值可能被手改 / 由旧版本残留，只接受「不重复的修饰键 + 主键」形式 */
export function isValidBinding(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 32) return false
  const parts = value.split('+')
  const main = parts[parts.length - 1] ?? ''
  if (main === '' || MODIFIER_KEYS.has(main)) return false
  const mods = parts.slice(0, -1)
  if (mods.some((mod) => mod !== 'Ctrl' && mod !== 'Alt' && mod !== 'Shift' && mod !== 'Meta')) return false
  return new Set(mods).size === mods.length
}

/** 编辑 / 导航类按键：在文本框里按下时属于「打字」，不该被当成快捷键 */
const TYPING_KEYS = new Set([
  'Space', 'Enter', 'Tab', 'Backspace', 'Delete',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown',
])

/**
 * 规格是否属于「打字键」：不带修饰键的单字符或编辑 / 导航键。
 * 焦点在输入框里时，这类绑定必须让位给打字；`F11` / `Ctrl+K` 这类则照常触发。
 */
export function isTypingBinding(binding: string): boolean {
  const parts = binding.split('+')
  const main = parts[parts.length - 1] ?? ''
  if (parts.length > 1) return false
  return main.length === 1 || TYPING_KEYS.has(main)
}
