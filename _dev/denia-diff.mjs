// 两帧全屏差分图（放大 4 倍）→ 看真实渲染里到底什么在动
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { encodePng } from './png-encode.mjs'

const OUT = resolve(import.meta.dirname, 'denia-out')
const W = 1920, H = 1080, B = W * 4
const buf = readFileSync(resolve(OUT, 'truth-full.raw'))
const expected = 2 * B * H
console.log('raw bytes=' + buf.length + ' expected=' + expected)

const out = new Uint8ClampedArray(W * H * 4)
let maxd = 0
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const o = y * B + x * 4
  const o2 = o + B * H
  const d = (Math.abs(buf[o] - buf[o2]) + Math.abs(buf[o + 1] - buf[o2 + 1]) + Math.abs(buf[o + 2] - buf[o2 + 2])) / 3
  if (d > maxd) maxd = d
  const v = Math.min(255, d * 4)
  out[o] = v; out[o + 1] = v; out[o + 2] = v; out[o + 3] = 255
}
writeFileSync(resolve(OUT, 'diff-f0-f120.png'), encodePng(out, W, H))
console.log('diff-f0-f120.png written; maxDiff=' + maxd.toFixed(1))
