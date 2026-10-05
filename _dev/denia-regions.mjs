// 多区域帧间差异：判断背景静态 / 水波效果是否在动 / 眼睛是否在动
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const OUT = resolve(import.meta.dirname, 'denia-out')
const regions = [
  { name: 'bg(100,940)', file: 'reg-bg.raw', w: 100, h: 100 },
  { name: 'dress(600,640)', file: 'reg-dress.raw', w: 120, h: 120 },
  { name: 'hair(1150,300)', file: 'reg-hair.raw', w: 120, h: 120 },
  { name: 'eyes(1285,645)', file: 'truth2-eye.raw', w: 110, h: 145 },
]
const L = []
for (const r of regions) {
  const raw = readFileSync(resolve(OUT, r.file))
  const stride = r.w * 4
  const F = Math.floor(raw.length / (stride * r.h))
  const diff = []
  for (let f = 0; f < F; f++) {
    if (f === 0) { diff.push(0); continue }
    let d = 0
    const base = f * stride * r.h
    for (let p = 0; p < r.w * r.h; p++) {
      const o = base + p * 4, o2 = o - stride * r.h
      d += Math.abs(raw[o] - raw[o2]) + Math.abs(raw[o + 1] - raw[o2 + 1]) + Math.abs(raw[o + 2] - raw[o2 + 2])
    }
    diff.push(d / (r.w * r.h * 3))
  }
  const mean = diff.slice(1).reduce((a, b) => a + b, 0) / (F - 1)
  const max = Math.max(...diff.slice(1))
  const sd = Math.sqrt(diff.slice(1).reduce((a, b) => a + (b - mean) ** 2, 0) / (F - 1))
  L.push(`${r.name}: frames=${F} diff mean=${mean.toFixed(2)} sd=${sd.toFixed(2)} max=${max.toFixed(2)}`)
  L.push('  series: ' + diff.filter((_, i) => i % 8 === 0).map((v) => v.toFixed(1)).join(' '))
  // 周期性：自相关峰值
  const dev = diff.slice(1).map((v) => v - mean)
  const ac = []
  for (let lag = 1; lag < 60; lag++) {
    let s = 0
    for (let i = 0; i + lag < dev.length; i++) s += dev[i] * dev[i + lag]
    ac.push(s / (dev.length - lag))
  }
  const best = ac.map((v, i) => [i + 1, v]).sort((a, b) => b[1] - a[1]).slice(0, 5)
  L.push('  自相关前 5 峰(lag帧): ' + best.map(([lag, v]) => `${lag}(${v.toFixed(1)})`).join(' ') + `  → 周期≈${(best[0][0] / 14.65).toFixed(2)}s`)
  L.push('')
}
writeFileSync(resolve(OUT, 'region-motion.txt'), L.join('\n'), 'utf8')
console.log(L.join('\n'))
