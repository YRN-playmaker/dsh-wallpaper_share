// ASCII 分析：眼睛纹理 alpha 分布 + 眨眼方向场 + 不透明度 mask
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { decodeTex } from '../src/scene/SceneTex.ts'

const PKG = 'D:/SteamLibrary/steamapps/workshop/content/431960/3791428510/scene.pkg'
const OUT = resolve(import.meta.dirname, 'denia-out')

function parsePkg(buf) {
  let pos = 0
  const i32 = () => { const v = buf.readInt32LE(pos); pos += 4; return v }
  const magicLen = i32()
  pos += magicLen
  pos += 4
  const entries = []
  for (;;) {
    if (pos + 8 > buf.length) break
    const nameLen = buf.readInt32LE(pos); pos += 4
    if (nameLen <= 0 || nameLen > 2048 || pos + nameLen + 8 > buf.length) break
    const name = buf.subarray(pos, pos + nameLen).toString('utf8'); pos += nameLen
    const offset = buf.readInt32LE(pos); pos += 4
    const size = buf.readInt32LE(pos); pos += 4
    if (offset < 0 || size < 0 || offset + size > buf.length) break
    entries.push({ name, offset, size })
  }
  const dataStart = pos
  return { read: (n) => { const e = entries.find((x) => x.name === n); return e === undefined ? null : buf.subarray(dataStart + e.offset, dataStart + e.offset + e.size) } }
}

const pkg = parsePkg(readFileSync(PKG))
const eyes = decodeTex(pkg.read('materials/09眼睛.tex')).mip0.rgba
const flowTex = decodeTex(pkg.read('materials/masks/shake_mask_73999545.tex')).mip0.rgba
const opTex = decodeTex(pkg.read('materials/masks/shake_mask_5bdd3707.tex')).mip0.rgba
const W = 201, H = 355
const COLS = 50, ROWS = 40

const ramp = ' .:-=+*#%@'
function dump(title, fn) {
  const lines = [title]
  for (let r = 0; r < ROWS; r++) {
    let s = ''
    for (let c = 0; c < COLS; c++) {
      const x0 = Math.floor(c * W / COLS), x1 = Math.max(x0 + 1, Math.floor((c + 1) * W / COLS))
      const y0 = Math.floor(r * H / ROWS), y1 = Math.max(y0 + 1, Math.floor((r + 1) * H / ROWS))
      let sum = 0, n = 0
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { sum += fn(x, y); n++ }
      s += ramp[Math.min(ramp.length - 1, Math.max(0, Math.round((sum / n) * (ramp.length - 1))))]
    }
    lines.push(s)
  }
  return lines.join('\n')
}

const out = []
out.push('=== 眼睛纹理 alpha（眼睛可见区域）===')
out.push(dump('eyes alpha', (x, y) => eyes[(y * W + x) * 4 + 3] / 255))
out.push('')
out.push('=== 眼睛纹理 RGB 亮度（皮肤/背景为 0）===')
out.push(dump('eyes lum', (x, y) => (eyes[(y * W + x) * 4] + eyes[(y * W + x) * 4 + 1] + eyes[(y * W + x) * 4 + 2]) / 765))
out.push('')
out.push('=== 不透明度 mask（1 = 允许位移）===')
out.push(dump('mask', (x, y) => opTex[(y * W + x) * 4 + 3] / 255))
out.push('')
out.push('=== 方向场 X 分量（+1 右 / -1 左，0.5 = 零）===')
out.push(dump('flow x', (x, y) => ((flowTex[(y * W + x) * 4] / 255 - 0.498) * 2 + 1) / 2))
out.push('')
out.push('=== 方向场 Y 分量（+1 下 / -1 上，0.5 = 零）===')
out.push(dump('flow y', (x, y) => ((flowTex[(y * W + x) * 4 + 3] / 255 - 0.498) * 2 + 1) / 2))

// 眼睛区域内（alpha>0.5）方向场统计
let n = 0, sx = 0, sy = 0, ys = 0
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  if (eyes[(y * W + x) * 4 + 3] > 128) {
    n++
    sx += (flowTex[(y * W + x) * 4] / 255 - 0.498) * 2
    sy += (flowTex[(y * W + x) * 4 + 3] / 255 - 0.498) * 2
    ys += opTex[(y * W + x) * 4 + 3] / 255
  }
}
out.push('')
out.push(`眼睛区域像素=${n} 方向均值=(${(sx / n).toFixed(3)},${(sy / n).toFixed(3)}) mask均值=${(ys / n).toFixed(3)}`)

// 纹理内的图集排布：找出 alpha 行带
const rowAlpha = []
for (let y = 0; y < H; y++) { let s = 0; for (let x = 0; x < W; x++) s += eyes[(y * W + x) * 4 + 3]; rowAlpha.push(s / W / 255) }
const bands = []
let inB = false, start = 0
for (let y = 0; y < H; y++) {
  const on = rowAlpha[y] > 0.02
  if (on && !inB) { inB = true; start = y }
  if (!on && inB) { inB = false; bands.push([start, y - 1]) }
}
if (inB) bands.push([start, H - 1])
out.push('alpha 行带（y 起止）: ' + bands.map(([a, b]) => `${a}-${b}`).join(', '))

import { writeFileSync } from 'node:fs'
writeFileSync(resolve(OUT, 'ascii.txt'), out.join('\n'), 'utf8')
console.log('ascii.txt written; bands=' + bands.map(([a, b]) => `${a}-${b}`).join(','))
