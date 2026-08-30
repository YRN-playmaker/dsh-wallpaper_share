/**
 * 面板设置的 localStorage 持久化。
 *
 * 做法：把 store.settings 包一层 Proxy —— 任何 `store.settings.x = v` 写入都自动落盘，
 * 现有十几处直接赋值的调用点一行都不用改，也不会出现「加了新设置项却忘了存」的情况。
 *
 * 只持久化「用户偏好」。以下三类刻意不落盘：
 *   - taskActive / approvalPending：运行时从 sessions 快照与 DOM 派生，存下来只会读到过期脏值；
 *   - immersive：临时视图态，刷新后把聊天标题栏 + 输入框藏起来是惊吓不是恢复。
 *
 * 读取时逐字段校验并夹取范围：手改过的、旧版本残留的、损坏的 JSON 一律回退默认值，
 * 绝不让一份坏存档把面板搞崩。存储不可用（隐私模式 / 配额满）时静默降级为「不持久化」。
 */
import type { WeSyncSettings } from './index.ts'

/** localStorage 键（沿用插件内部 id 前缀 we-sync） */
export const SETTINGS_STORAGE_KEY = 'we-sync.settings'

/** 落盘字段白名单；不在表内的字段（派生态 / 临时态）写入不触发保存，也不会被存下 */
const PERSISTED_KEYS: readonly (keyof WeSyncSettings)[] = [
  'enabled', 'panelAlpha', 'blur', 'shadow', 'monitor', 'focus',
  'renderMode', 'gazeEnabled', 'gazeSnapText',
]

const asNumber = (v: unknown, fallback: number, min: number, max: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback

const asBoolean = (v: unknown, fallback: boolean): boolean =>
  typeof v === 'boolean' ? v : fallback

/** 逐字段校验 + 夹取，顺带修复「眼动开但专注关」这类跨版本残留的非法组合 */
export function sanitizeSettings(raw: unknown, d: WeSyncSettings): WeSyncSettings {
  const o: Record<string, unknown> = raw !== null && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const focus = asBoolean(o.focus, d.focus)
  const mode = o.renderMode
  return {
    ...d,
    enabled: asBoolean(o.enabled, d.enabled),
    panelAlpha: asNumber(o.panelAlpha, d.panelAlpha, 0, 100),
    blur: asNumber(o.blur, d.blur, 0, 30),
    shadow: asNumber(o.shadow, d.shadow, 0, 100),
    monitor: typeof o.monitor === 'string' ? o.monitor : d.monitor,
    focus,
    renderMode: mode === 'eco' || mode === 'perf' || mode === 'enhanced' ? mode : d.renderMode,
    // 眼动是专注的子模式：专注没开就不可能存在眼动
    gazeEnabled: focus && asBoolean(o.gazeEnabled, d.gazeEnabled),
    gazeSnapText: asBoolean(o.gazeSnapText, d.gazeSnapText),
    // 派生态 / 临时态：永远从默认值起，不接受存档
    taskActive: d.taskActive,
    approvalPending: d.approvalPending,
    immersive: d.immersive,
  }
}

/** 读存档并返回一份已校验的设置对象；无存档 / 读失败 → 默认值副本 */
export function readStoredSettings(defaults: WeSyncSettings): WeSyncSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY)
    if (raw === null) return { ...defaults }
    return sanitizeSettings(JSON.parse(raw) as unknown, defaults)
  } catch {
    return { ...defaults }
  }
}

/**
 * 生成「写即存」的设置对象：初始值来自存档，之后每次改动自动落盘。
 * 滑块拖动会高频触发写入，故合并成 250ms 的尾随写；页面隐藏 / 关闭前强制补一次，避免丢最后一次改动。
 */
export function createPersistentSettings(defaults: WeSyncSettings): WeSyncSettings {
  const target = readStoredSettings(defaults)
  let timer: number | null = null

  const flush = (): void => {
    if (timer !== null) { clearTimeout(timer); timer = null }
    try {
      const out: Record<string, unknown> = {}
      for (const key of PERSISTED_KEYS) out[key] = target[key]
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(out))
    } catch { /* 存不下就不存，面板照常工作 */ }
  }

  const schedule = (): void => {
    if (timer !== null) return
    timer = window.setTimeout(flush, 250)
  }

  window.addEventListener('pagehide', flush)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush() })

  return new Proxy(target, {
    set(obj, prop, value): boolean {
      const key = prop as string
      const rec = obj as unknown as Record<string, unknown>
      const prev = rec[key]
      rec[key] = value
      if (prev !== value && PERSISTED_KEYS.includes(key as keyof WeSyncSettings)) schedule()
      return true
    },
  })
}
