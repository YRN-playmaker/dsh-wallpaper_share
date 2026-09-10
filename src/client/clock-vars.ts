/**
 * 时钟 → DWP 变量（client 半，纯函数，Node 可测）。
 *
 * 变量契约（插件的通用能力：任何挂载的 DWP 都会收到这些变量，未声明的场景自动忽略）：
 *   hour        0..23 当前小时（整数，供时钟类壁纸用）
 *   night_alpha 0..1  夜间图透明度（连续值，走软过渡；v1.0 的「DeepSeek 日夜」用它切图）
 *   night_on    1 = 处于夜间时段（18:00–06:00），否则 0
 *   day_on      1 = 处于白天时段（06:00–18:00），否则 0
 *   hd_on       1 = 当前处于高档纹理档（渲染模式「增强/完整」），0 = 低档（「预览/捕获」）
 *   night_sd    0..1  低档夜层透明度（hd_on=1 时恒 0）
 *   night_hd    0..1  高档夜层透明度（hd_on=0 时恒 0）
 *
 * 为什么"档位×昼夜"要在客户端乘好：DWP 场景**没有表达式**（`$var` 是直接替换、不做算术），
 * 一个图层的 alpha 只能来自一个变量，而"两档纹理 × 昼夜"有四个组合，只能由喂食端算完再推。
 *
 * 过渡语义：18:00 起 10 分钟内 night_alpha 0→1，05:50 起 10 分钟内 1→0，
 * 即"6 点切换"落在边界上，只是把硬切变成 ±10 分钟的线性过渡（观感上就是夜景缓缓压上来）。
 */

/** 夜间起点（小时，含） */
export const NIGHT_START_HOUR = 18
/** 夜间终点（小时，不含） */
export const NIGHT_END_HOUR = 6
/** 边界软过渡时长（分钟）：18:00–18:10 淡入，05:50–06:00 淡出 */
export const FADE_MINUTES = 10

const DAY_MINUTES = 1440

/** 一天中的分钟数（0..1439.99…，带秒的小数）→ 夜间透明度 0..1。 */
export function nightAlpha(minutesOfDay: number): number {
  const m = ((minutesOfDay % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES
  // 以 18:00 为原点把一天拉直：rel = 0 是 18:00，rel 到 720 是 06:00
  const start = NIGHT_START_HOUR * 60
  const nightLen = (NIGHT_END_HOUR * 60 - start + DAY_MINUTES) % DAY_MINUTES // = 720
  const rel = (m - start + DAY_MINUTES) % DAY_MINUTES
  const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x)
  if (rel <= FADE_MINUTES) return clamp01(rel / FADE_MINUTES)                       // 18:00→18:10 淡入
  if (rel >= nightLen - FADE_MINUTES && rel <= nightLen) return clamp01((nightLen - rel) / FADE_MINUTES) // 05:50→06:00 淡出
  return rel < nightLen ? 1 : 0                                                     // 夜间 / 白天
}

export interface ClockVarOptions {
  /** true = 高档纹理档（渲染模式「增强/完整」）；缺省 false（「预览/捕获」） */
  hd?: boolean
}

/** 当前时间（+ 纹理档位）→ 变量表（值域收敛到 4 位小数，避免每次轮询都产生"变化"）。 */
export function clockVars(now: Date, opts: ClockVarOptions = {}): Record<string, number> {
  const hd = opts.hd === true
  const minutes = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60
  const alpha = Number(nightAlpha(minutes).toFixed(4))
  return {
    hour: now.getHours(),
    night_alpha: alpha,
    night_on: alpha >= 0.9999 ? 1 : 0,
    day_on: alpha <= 0.0001 ? 1 : 0,
    hd_on: hd ? 1 : 0,
    night_sd: hd ? 0 : alpha,
    night_hd: hd ? alpha : 0,
  }
}

/** 去重签名：值没变就不喂（避免无谓重绘）。 */
export function clockSig(vars: Record<string, number>): string {
  return Object.keys(vars).sort().map((k) => k + '=' + String(vars[k])).join(',')
}
