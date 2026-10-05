// 分析真实 WE 渲染的眼睛区域：亮度/帧差序列 + 眨眼位移估计（交叉相关）
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const OUT = resolve(import.meta.dirname, 'denia-out')
const W = 110, H = 145, FRAMES = 128
const raw = readFileSync(resolve(OUT, 'truth-eye.raw'))
const stride = W * 4
const lum = (i) => { const b = i * stride; return 0.114 * raw[b] + 0.587 * raw[b + 1] + 0.299 * raw[b + 2] }

const L = []
const lumSeries = []
const diffSeries = []
for (let f = 0; f < FRAMES; f++) {
  let s = 0
  const base = f * stride * H
  for (let p = 0; p < W * H; p++) {
    const o = base + p * 4
    s += 0.114 * raw[o] + 0.587 * raw[o + 1] + 0.299 * raw[o + 2]
  }
  lumSeries.push(s / (W * H))
  if (f > 0) {
    let d = 0
    for (let p = 0; p < W * H; p++) {
      const o = base + p * 4, o2 = o - stride * H
      d += Math.abs(raw[o] - raw[o2]) + Math.abs(raw[o + 1] - raw[o2 + 1]) + Math.abs(raw[o + 2] - raw[o2 + 2])
    }
    diffSeries.push(d / (W * H * 3))
  } else diffSeries.push(0)
}
L.push('frame  lum    diff')
for (let f = 0; f < FRAMES; f++) L.push(String(f).padStart(5) + '  ' + lumSeries[f].toFixed(2).padStart(6) + '  ' + diffSeries[f].toFixed(2).padStart(6))

// 峰值检测（帧差 > 均值+2σ）
const mean = diffSeries.reduce((a, b) => a + b, 0) / FRAMES
const sd = Math.sqrt(diffSeries.reduce((a, b) => a + (b - mean) ** 2, 0) / FRAMES)
L.push('')
L.push(`diff mean=${mean.toFixed(2)} sd=${sd.toFixed(2)} 阈值=${(mean + 2 * sd).toFixed(2)}`)
const peaks = []
for (let f = 1; f < FRAMES; f++) if (diffSeries[f] > mean + 2 * sd) peaks.push(f)
L.push('峰值帧: ' + peaks.join(','))

// 位移估计：把帧 f 的眼睛区域与帧 f-1 比对，找使 SSD 最小的整数位移
function shiftEstimate(f, maxShift = 24) {
  const a = (f - 1) * stride * H, b = f * stride * H
  let best = { dx: 0, dy: 0, err: Infinity }
  for (let dy = -maxShift; dy <= maxShift; dy += 1) {
    for (let dx = -maxShift; dx <= maxShift; dx += 1) {
      let err = 0, n = 0
      for (let y = maxShift; y < H - maxShift; y += 2) {
        for (let x = maxShift; x < W - maxShift; x += 2) {
          const o = b + (y * W + x) * 4
          const o2 = a + ((y - dy) * W + (x - dx)) * 4
          err += Math.abs(raw[o] - raw[o2]) + Math.abs(raw[o + 1] - raw[o2 + 1]) + Math.abs(raw[o + 2] - raw[o2 + 2])
          n++
        }
      }
      err /= n
      if (err < best.err) best = { dx, dy, err }
    }
  }
  return best
}
L.push('')
L.push('=== 峰值帧的位移估计（相对上一帧，正值 = 眼睛内容向 +x/+y 移动）===')
for (const f of peaks) {
  const s = shiftEstimate(f)
  L.push(`f${f}: dx=${s.dx} dy=${s.dy} err=${s.err.toFixed(1)}`)
}
L.push('')
L.push('=== 全体帧位移序列（每 2 帧）===')
for (let f = 2; f < FRAMES; f += 2) {
  const s = shiftEstimate(f)
  L.push(`f${f}: dx=${s.dx} dy=${s.dy} err=${s.err.toFixed(1)}`)
}
writeFileSync(resolve(OUT, 'truth-analysis.txt'), L.join('\n'), 'utf8')
console.log('truth-analysis.txt written; peaks=' + peaks.join(','))
