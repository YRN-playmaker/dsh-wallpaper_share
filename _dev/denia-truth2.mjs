// 长时捕获的眼睛区域分析：去全局漂移后找周期性眨眼脉冲
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const OUT = resolve(import.meta.dirname, 'denia-out')
const W = 110, H = 145, stride = W * 4
const raw = readFileSync(resolve(OUT, 'truth2-eye.raw'))
const FRAMES = Math.floor(raw.length / (stride * H))
const FPS = FRAMES / 20 // 名义 20 秒
const L = []
L.push(`frames=${FRAMES} assumedFps=${FPS.toFixed(2)}`)

// 每帧灰度（去均值）
const gray = []
for (let f = 0; f < FRAMES; f++) {
  const g = new Float32Array(W * H)
  let mean = 0
  const base = f * stride * H
  for (let p = 0; p < W * H; p++) {
    const o = base + p * 4
    const v = 0.114 * raw[o] + 0.587 * raw[o + 1] + 0.299 * raw[o + 2]
    g[p] = v
    mean += v
  }
  mean /= W * H
  for (let p = 0; p < W * H; p++) g[p] -= mean
  gray.push(g)
}

// 帧间差异（去均值后，抑制整体明暗漂移）
const diff = [0]
for (let f = 1; f < FRAMES; f++) {
  let d = 0
  for (let p = 0; p < W * H; p++) d += Math.abs(gray[f][p] - gray[f - 1][p])
  diff.push(d / (W * H))
}
const mean = diff.reduce((a, b) => a + b, 0) / FRAMES
const sd = Math.sqrt(diff.reduce((a, b) => a + (b - mean) ** 2, 0) / FRAMES)
L.push(`diff mean=${mean.toFixed(2)} sd=${sd.toFixed(2)}`)
L.push('')
L.push('frame  t(s)  diff  flag')
const flags = []
for (let f = 0; f < FRAMES; f++) {
  const hi = diff[f] > mean + 3 * sd
  if (hi) flags.push(f)
  L.push(String(f).padStart(5) + '  ' + (f / FPS).toFixed(2).padStart(5) + '  ' + diff[f].toFixed(2).padStart(6) + '  ' + (hi ? '<<<' : ''))
}
L.push('')
L.push('异常帧(>mean+3sd): ' + flags.map((f) => `f${f}@${(f / FPS).toFixed(2)}s`).join(' '))
const gaps = []
for (let i = 1; i < flags.length; i++) gaps.push(flags[i] - flags[i - 1])
L.push('异常帧间隔: ' + gaps.join(' '))

// 只在高梯度像素上做位移估计（去均值，±10px），避免明暗漂移造成的假位移
const maskPix = []
for (let p = 0; p < W * H; p++) maskPix.push(p)
function shift(f) {
  const a = gray[f - 1], b = gray[f]
  let best = { dx: 0, dy: 0, err: Infinity }
  for (let dy = -10; dy <= 10; dy++) {
    for (let dx = -10; dx <= 10; dx++) {
      let err = 0, c = 0
      for (let y = 12; y < H - 12; y++) {
        for (let x = 12; x < W - 12; x++) {
          const p = y * W + x
          const q = (y - dy) * W + (x - dx)
          // 只统计有明显结构的像素
          const gx = Math.abs(b[p + 1] - b[p - 1])
          const gy = Math.abs(b[p + W] - b[p - W])
          if (gx + gy < 12) continue
          err += Math.abs(b[p] - a[q]); c++
        }
      }
      if (c > 50) { err /= c; if (err < best.err) best = { dx, dy, err } }
    }
  }
  return best
}
L.push('')
L.push('=== 逐帧位移（相对上一帧，仅高梯度像素）===')
for (let f = 1; f < FRAMES; f++) {
  const s = shift(f)
  if (Math.abs(s.dx) > 1 || Math.abs(s.dy) > 1 || diff[f] > mean + 2 * sd) {
    L.push(`f${f}@${(f / FPS).toFixed(2)}s: dx=${s.dx} dy=${s.dy} err=${s.err.toFixed(1)} diff=${diff[f].toFixed(2)}`)
  }
}
writeFileSync(resolve(OUT, 'truth2-analysis.txt'), L.join('\n'), 'utf8')
console.log('truth2-analysis.txt written; flags=' + flags.length + ' gaps=' + gaps.join(','))
