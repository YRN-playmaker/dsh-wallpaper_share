// 逐帧测量真实渲染中眼睛特征（睫毛暗部 / 虹膜紫色）的质心轨迹 —— 用来找眨眼脉冲
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const OUT = resolve(import.meta.dirname, 'denia-out')
const raw = readFileSync(resolve(OUT, 'truth-eye.raw'))
const W = 110, H = 145, FRAMES = 128, stride = W * 4

function stats(f, y0, y1) {
  let darkN = 0, darkX = 0, darkY = 0
  let irisN = 0, irisX = 0, irisY = 0
  let lumSum = 0
  const base = f * stride * H
  for (let y = y0; y < y1; y++) {
    for (let x = 0; x < W; x++) {
      const o = base + (y * W + x) * 4
      const b = raw[o], g = raw[o + 1], r = raw[o + 2]
      const lum = 0.114 * b + 0.587 * g + 0.299 * r
      lumSum += lum
      // 睫毛/瞳孔：暗
      if (lum < 70) { darkN++; darkX += x; darkY += y }
      // 虹膜：紫（B 明显大于 G，且中等亮度）
      if (b - g > 22 && lum > 60 && lum < 200) { irisN++; irisX += x; irisY += y }
    }
  }
  return {
    lum: lumSum / ((y1 - y0) * W),
    dark: darkN > 0 ? [darkX / darkN, darkY / darkN, darkN] : null,
    iris: irisN > 0 ? [irisX / irisN, irisY / irisN, irisN] : null,
  }
}

const L = []
L.push('frame  lum   up_darkX up_darkY n   up_irisX up_irisY n   lo_darkX lo_darkY n   lo_irisX lo_irisY n')
const series = []
for (let f = 0; f < FRAMES; f++) {
  const up = stats(f, 0, 72)
  const lo = stats(f, 72, H)
  series.push({ f, up, lo })
  L.push(
    String(f).padStart(5) + '  ' + up.lum.toFixed(1).padStart(5) +
    (up.dark ? '  ' + up.dark[0].toFixed(2).padStart(7) + ' ' + up.dark[1].toFixed(2).padStart(7) + ' ' + String(up.dark[2]).padStart(4) : '      --      --   --') +
    (up.iris ? '  ' + up.iris[0].toFixed(2).padStart(7) + ' ' + up.iris[1].toFixed(2).padStart(7) + ' ' + String(up.iris[2]).padStart(4) : '      --      --   --') +
    (lo.dark ? '  ' + lo.dark[0].toFixed(2).padStart(7) + ' ' + lo.dark[1].toFixed(2).padStart(7) + ' ' + String(lo.dark[2]).padStart(4) : '      --      --   --') +
    (lo.iris ? '  ' + lo.iris[0].toFixed(2).padStart(7) + ' ' + lo.iris[1].toFixed(2).padStart(7) + ' ' + String(lo.iris[2]).padStart(4) : '      --      --   --')
  )
}
// 相对整段均值的偏差，弱化整体漂移
function dev(key, sub, idx) {
  const vals = series.map((s) => s[key][sub] ? s[key][sub][idx] : NaN).filter((v) => !Number.isNaN(v))
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length
  return { mean, dev: series.map((s) => (s[key][sub] ? s[key][sub][idx] - mean : NaN)) }
}
L.push('')
L.push('=== 相对均值偏差（只列 |dev|>=1.0 的帧）===')
for (const [key, sub, idx, name] of [['up', 'iris', 0, '上眼虹膜X'], ['up', 'dark', 0, '上眼睫毛X'], ['up', 'iris', 1, '上眼虹膜Y'], ['lo', 'iris', 0, '下眼虹膜X'], ['lo', 'dark', 0, '下眼睫毛X'], ['lo', 'iris', 1, '下眼虹膜Y']]) {
  const d = dev(key, sub, idx)
  const hits = d.dev.map((v, i) => [i, v]).filter(([, v]) => Math.abs(v) >= 1.0)
  L.push(`${name}（均值 ${d.mean.toFixed(2)}）: ` + (hits.length === 0 ? '无' : hits.map(([i, v]) => `f${i}:${v > 0 ? '+' : ''}${v.toFixed(2)}`).join(' ')))
}
writeFileSync(resolve(OUT, 'eye-features.txt'), L.join('\n'), 'utf8')
console.log('eye-features.txt written')
