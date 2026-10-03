/**
 * shake 效果的官方波形数学（纯函数，可在 node 测试中直接验证）。
 *
 * 语义来源：Wallpaper Engine 官方 `shaders/effects/shake.frag`（壁纸包内随附，
 * 本仓库只做行为等价实现，不复制官方代码）。关键点（实测 + 引擎头文件确认）：
 *
 *   1. WE 的 `common.h` 把 **`M_PI_2` 定义为 2π**（不是 π/2）：
 *      `#define M_PI_2 6.28318530718`。因此
 *        `sin(frac(time / M_PI_2) * M_PI_2)` == `sin(time)`
 *      —— 波形基频周期 = 2π / speed 秒（**不是** π/2）。
 *   2. `bounds` 是"脉冲阈值"而不是位移范围：
 *        `offset = saturate((offset - bounds.x) / (bounds.y - bounds.x))`
 *      默认 `0 1` → 波形直接当位移系数（连续摆动）；
 *      达妮娅眨眼用 `0.992 0.998` → 一个 2π 周期里只在正弦峰值附近
 *      出现约 0.16~0.22s 的窄脉冲（= 一次眨眼）。
 *   3. `friction` 是波形上升/下降沿的幂曲线：`cos(time) >= 0` 用 y 分量，
 *      否则用 x 分量补（`1 - (1-v)^x`）。
 *   4. `DIRECTION`（编辑器 combo，非 uniform）：
 *        0 = center → offset = offset*2 - 1（居中双向摆动）
 *        1 = left   → offset 原样（仅正方向）
 *        2 = right  → offset = offset - 1（仅负方向）
 *   5. `AUDIOPROCESSING` 打开时完全取代计时脉冲：
 *        DIRECTION 0 → offset += audioPulse
 *        DIRECTION 1 → offset = 1 - audioPulse
 *        DIRECTION 2 → offset -= audioPulse
 *      本渲染器不做音频分析：按"有声音"处理（audioPulse = 1），
 *      此时 DIRECTION 1 的位移为 0（= 静止睁眼），与用户在放 BGM 时的观感一致，
 *      避免把眼睛永久顶到"闭眼"。
 */

/** WE `common.h` 的 M_PI_2 = 2π（名字有误导性，实为 2π） */
export const SHAKE_TWO_PI = 6.28318530718

/** shake 效果的不透明 mask 组合（g_Texture3 是否绑定）— 未绑定时不混 mask */
export interface ShakeParams {
  /** 播放倍速（scene.json passes[0].constantshadervalues.speed） */
  speed: number
  /** [bounds.x, bounds.y]；位移脉冲区间 */
  bounds: [number, number]
  /** [friction.x, friction.y]；上升/下降沿幂 */
  friction: [number, number]
  /** DIRECTION combo：0 center / 1 left / 2 right */
  direction: number
  /** AUDIOPROCESSING combo 是否打开（本渲染器无音频分析） */
  audioProcessing?: boolean
}

/** 官方 `saturate()` */
function saturate(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

/**
 * 计算官方 shake 的标量位移系数 `offset`（把 shader 里的 offset 逐字搬出来）。
 * 返回值 0..1（NOISE=0、无 TIMEOFFSET 分支时；见上方文档）。
 */
export function shakeOffset(timeSec: number, p: ShakeParams): number {
  const time = p.speed * timeSec
  const fx = p.friction[0]
  const fy = p.friction[1]

  if (p.audioProcessing === true) {
    // AUDIOPROCESSING == 1：无音频分析 → 视为"有声音"(pulse = 1)
    const audioPulse = 1
    if (p.direction === 1) return saturate(1 - audioPulse)
    // DIRECTION 0：offset += pulse（原始 offset 为 0） / DIRECTION 2：offset -= pulse
    return p.direction === 0 ? audioPulse : -audioPulse
  }

  // #else 分支（NOISE == 0）
  // sin(frac(time / M_PI_2) * M_PI_2) == sin(time)
  let offset = Math.sin(time)
  offset = offset * 0.498 + 0.5
  const base = Math.cos(time) >= 0 ? 1 : 0
  offset = base === 1 ? Math.pow(offset, fy) : 1 - Math.pow(1 - offset, fx)
  // v_Bounds.x = bounds.x，v_Bounds.y = 1 / (bounds.y - bounds.x)
  const span = p.bounds[1] - p.bounds[0]
  offset = saturate(span !== 0 ? (offset - p.bounds[0]) / span : offset - p.bounds[0])

  // DIRECTION combo
  if (p.direction === 0) offset = offset * 2 - 1
  else if (p.direction === 2) offset = offset - 1
  return offset
}

/** 官方 `flowMask = (flowColors.rg - 0.498) * 2`；分量取值 0..1（0.5 = 无位移） */
export function shakeFlowMask(r: number, g: number): [number, number] {
  return [(r - 0.498) * 2, (g - 0.498) * 2]
}

/** 位移量（UV 空间）：`texCoordOffset = offset * strength² * flowMask` */
export function shakeTexCoordOffset(offset: number, strength: number, flow: [number, number]): [number, number] {
  const amp = strength * strength
  return [offset * amp * flow[0], offset * amp * flow[1]]
}

/** 一次脉冲的描述（供诊断/测试：周期、脉冲宽度、峰值时刻） */
export function shakePulseInfo(p: ShakeParams): { period: number; peakAt: number; aboveHalfSpan: number } {
  const period = p.speed > 0 ? SHAKE_TWO_PI / p.speed : Infinity
  let peakAt = 0
  let best = -Infinity
  const step = period / 2000
  for (let t = 0; t < period; t += step) {
    const v = shakeOffset(t, p)
    if (v > best) {
      best = v
      peakAt = t
    }
  }
  // 脉冲宽度：offset > 0.5 的时长（默认连续摆动时约为半周期）
  let inner = 0
  for (let t = 0; t < period; t += step) if (shakeOffset(t, p) > 0.5) inner += step
  return { period, peakAt, aboveHalfSpan: inner }
}
