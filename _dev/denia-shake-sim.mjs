// 复现官方 shake.frag 在眼睛层上的输出（offset 0→1），用于判断"正确眨眼"长什么样
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { decodeTex } from '../src/scene/SceneTex.ts'
import { encodePng } from './png-encode.mjs'

const PKG = 'D:/SteamLibrary/steamapps/workshop/content/431960/3791428510/scene.pkg'
const OUT = resolve(import.meta.dirname, 'denia-out')

function parsePkg(buf) {
  let pos = 0
  const i32 = () => { const v = buf.readInt32LE(pos); pos += 4; return v }
  const magicLen = i32(); pos += magicLen; pos += 4
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
const eyesTex = decodeTex(pkg.read('materials/09眼睛.tex'))
const flowTex = decodeTex(pkg.read('materials/masks/shake_mask_73999545.tex'))
const opTex = decodeTex(pkg.read('materials/masks/shake_mask_5bdd3707.tex'))
const eyesW = eyesTex.textureWidth, eyesH = eyesTex.textureHeight
const eyes = eyesTex.mip0.rgba
const flow = flowTex.mip0.rgba
const op = opTex.mip0.rgba
const W = 201, H = 355 // image 尺寸（layer 尺寸）
const strength = 0.4, amp2 = strength * strength

function sample(tex, tw, th, u, v) {
  // u,v ∈ [0,1]（图像空间）；双线性
  const x = Math.min(tw - 1.001, Math.max(0, u * (W - 1)))
  const y = Math.min(th - 1.001, Math.max(0, v * (H - 1)))
  const x0 = Math.floor(x), y0 = Math.floor(y)
  const fx = x - x0, fy = y - y0
  const get = (xx, yy, c) => tex[((yy * tw + xx) * 4) + c]
  const out = [0, 0, 0, 0]
  for (let c = 0; c < 4; c++) {
    const a = get(x0, y0, c), b = get(x0 + 1, y0, c), d = get(x0, y0 + 1, c), e = get(x0 + 1, y0 + 1, c)
    out[c] = a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + d * (1 - fx) * fy + e * fx * fy
  }
  return out
}

const rows = []
const offsets = [0, 0.25, 0.5, 0.75, 1]
const SCALE = 1
for (const off of offsets) {
  const img = new Uint8ClampedArray(W * H * 4)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x
      const fx = (flow[i * 4] / 255 - 0.498) * 2
      const fy = (flow[i * 4 + 3] / 255 - 0.498) * 2
      const ox = off * amp2 * fx
      const oy = off * amp2 * fy
      const uv = [x / (W - 1), y / (H - 1)]
      const src = sample(eyes, eyesW, eyesH, uv[0], uv[1])
      const sh = sample(eyes, eyesW, eyesH, uv[0] + ox, uv[1] + oy)
      const m = sample(op, opTex.textureWidth, opTex.textureHeight, uv[0] + ox, uv[1] + oy)[3] / 255
      // 皮肤底色 #f0d3bd 合成，便于观察
      const bg = [240, 211, 189]
      const a = src[3] / 255
      const r = src[0] * (1 - m) + sh[0] * m
      const g = src[1] * (1 - m) + sh[1] * m
      const b = src[2] * (1 - m) + sh[2] * m
      img[i * 4] = r * a + bg[0] * (1 - a)
      img[i * 4 + 1] = g * a + bg[1] * (1 - a)
      img[i * 4 + 2] = b * a + bg[2] * (1 - a)
      img[i * 4 + 3] = 255
    }
  }
  rows.push(img)
}
// 横向拼接 5 帧 + 12px 间隔
const GAP = 12
const SW = W * offsets.length + GAP * (offsets.length - 1)
const sheet = new Uint8ClampedArray(SW * H * 4)
for (let r = 0; r < H; r++) {
  for (let k = 0; k < offsets.length; k++) {
    for (let x = 0; x < W; x++) {
      const sx = k * (W + GAP) + x
      const so = (r * SW + sx) * 4
      const io = (r * W + x) * 4
      sheet[so] = rows[k][io]; sheet[so + 1] = rows[k][io + 1]; sheet[so + 2] = rows[k][io + 2]; sheet[so + 3] = 255
    }
  }
}
writeFileSync(resolve(OUT, 'shake-sim.png'), encodePng(sheet, SW, H))
console.log('shake-sim.png written (offsets ' + offsets.join(',') + ') size=' + SW + 'x' + H)

// 数值：满脉冲时位移 > 2px 的可见像素比例
let moved = 0, vis = 0, maxd = 0
for (let i = 0; i < W * H; i++) {
  const a = eyes[i * 4 + 3] / 255
  if (a < 0.05) continue
  vis++
  const fx = (flow[i * 4] / 255 - 0.498) * 2
  const fy = (flow[i * 4 + 3] / 255 - 0.498) * 2
  const d = Math.hypot(fx * amp2 * W, fy * amp2 * H)
  if (d > maxd) maxd = d
  if (d > 2) moved++
}
console.log(`可见像素=${vis} 满脉冲位移>2px 的比例=${(moved / vis * 100).toFixed(1)}% 最大位移=${maxd.toFixed(1)}px`)
