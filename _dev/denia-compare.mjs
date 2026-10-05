// 眨眼对比图：上排 = 修复前（整层滑动）/ 下排 = 修复后（官方 shader 语义）
// 时间轴取一个周期内的 5 个采样点（脉冲峰在 t≈1.57s）
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { decodeTex } from '../src/scene/SceneTex.ts'
import { encodePng } from './png-encode.mjs'
import { shakeOffset } from '../src/client/shake-math.ts'

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
const eyes = eyesTex.mip0.rgba
const flow = flowTex.mip0.rgba
const op = opTex.mip0.rgba
const W = 201, H = 355
const BG = [240, 211, 189]
const STRENGTH = 0.4
const EFF_SCALE = 0.6 // 修复前 shake 还乘了 effectStrengthScale

function sampleRGBA(tex, tw, th, u, v, out) {
  const x = Math.min(W - 1.001, Math.max(0, u * (W - 1)))
  const y = Math.min(H - 1.001, Math.max(0, v * (H - 1)))
  const x0 = Math.floor(x), y0 = Math.floor(y)
  const fx = x - x0, fy = y - y0
  for (let c = 0; c < 4; c++) {
    const a = tex[(y0 * tw + x0) * 4 + c], b = tex[(y0 * tw + (x0 + 1)) * 4 + c]
    const d = tex[((y0 + 1) * tw + x0) * 4 + c], e = tex[((y0 + 1) * tw + (x0 + 1)) * 4 + c]
    out[c] = (a * (1 - fx) + b * fx) * (1 - fy) + (d * (1 - fx) + e * fx) * fy
  }
}
function sample1(data, tw, th, u, v, ch) {
  const x = Math.min(W - 1.001, Math.max(0, u * (W - 1)))
  const y = Math.min(H - 1.001, Math.max(0, v * (H - 1)))
  const x0 = Math.floor(x), y0 = Math.floor(y)
  const fx = x - x0, fy = y - y0
  const a = data[(y0 * tw + x0) * 4 + ch], b = data[(y0 * tw + (x0 + 1)) * 4 + ch]
  const d = data[((y0 + 1) * tw + x0) * 4 + ch], e = data[((y0 + 1) * tw + (x0 + 1)) * 4 + ch]
  return (a * (1 - fx) + b * fx) * (1 - fy) + (d * (1 - fx) + e * fx) * fy
}

/** 修复前：整层平移（offset = sin(speed·t)，方向取平均方向失败后的默认 [0,-1]） */
function frameOld(t) {
  const out = new Uint8ClampedArray(W * H * 4)
  const offset = Math.sin(t * 1)
  const amp = STRENGTH * STRENGTH * EFF_SCALE
  const dy = -offset * amp * H // fd = [0,-1]
  const s = new Float32Array(4)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = (x + 0.5) / W
      const v = ((y + 0.5) - dy) / H
      sampleRGBA(eyes, eyesTex.textureWidth, eyesTex.textureHeight, u, v, s)
      const a = s[3] / 255
      const i = (y * W + x) * 4
      for (let c = 0; c < 3; c++) out[i + c] = s[c] * a + BG[c] * (1 - a)
      out[i + 3] = 255
    }
  }
  return out
}

/** 修复后：官方 shake.frag（逐像素方向场 + 不透明度 mask 混合） */
function frameNew(t) {
  const offset = shakeOffset(t, { speed: 1, bounds: [0.992, 0.998], friction: [1, 1], direction: 1 })
  const amp = STRENGTH * STRENGTH
  const out = new Uint8ClampedArray(W * H * 4)
  const s = new Float32Array(4), m = new Float32Array(4)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = (x + 0.5) / W
      const v = (y + 0.5) / H
      const fx = (sample1(flow, W, H, u, v, 0) / 255 - 0.498) * 2
      const fy = (sample1(flow, W, H, u, v, 3) / 255 - 0.498) * 2
      const tox = offset * amp * fx
      const toy = offset * amp * fy
      sampleRGBA(eyes, eyesTex.textureWidth, eyesTex.textureHeight, u, v, s)
      sampleRGBA(eyes, eyesTex.textureWidth, eyesTex.textureHeight, u + tox, v + toy, m)
      const mv = sample1(op, W, H, u + tox, v + toy, 3) / 255
      const i = (y * W + x) * 4
      for (let c = 0; c < 3; c++) {
        const val = s[c] * (1 - mv) + m[c] * mv
        const al = (s[3] * (1 - mv) + m[3] * mv) / 255
        out[i + c] = val * al + BG[c] * (1 - al)
      }
      out[i + 3] = 255
    }
  }
  return out
}

const TIMES = [0, 0.8, 1.5708, 2.4, 3.1416]
const rows = [frameOld(0), frameNew(0)]
rows.length = 0
const oldFrames = TIMES.map(frameOld)
const newFrames = TIMES.map(frameNew)
const GAP = 10
const SW = W * TIMES.length + GAP * (TIMES.length - 1)
const SH = H * 2 + GAP
const sheet = new Uint8ClampedArray(SW * SH * 4)
sheet.fill(255)
const blit = (img, row) => {
  for (let y = 0; y < H; y++) {
    for (let k = 0; k < TIMES.length; k++) {
      for (let x = 0; x < W; x++) {
        const dx = k * (W + GAP) + x
        const dy = row * (H + GAP) + y
        const so = (dy * SW + dx) * 4
        const io = (y * W + x) * 4
        sheet[so] = img[k][io]; sheet[so + 1] = img[k][io + 1]; sheet[so + 2] = img[k][io + 2]; sheet[so + 3] = 255
      }
    }
  }
}
blit(oldFrames, 0)
blit(newFrames, 1)
writeFileSync(resolve(OUT, 'blink-compare.png'), encodePng(sheet, SW, SH))
console.log('blink-compare.png written ' + SW + 'x' + SH + ' (上排=修复前，下排=修复后；列 t=0/0.8/1.57/2.4/3.14s)')
console.log('新实现在这些时刻的 offset: ' + TIMES.map((t) => shakeOffset(t, { speed: 1, bounds: [0.992, 0.998], friction: [1, 1], direction: 1 }).toFixed(3)).join(', '))
// 虹膜紫色像素数：闭眼时骤降（用来确认上下排确实是"旧=滑动 / 新=眨眼"）
const purple = (img) => {
  let n = 0
  for (let i = 0; i < W * H; i++) {
    const r = img[i * 4], g = img[i * 4 + 1], b = img[i * 4 + 2]
    if (b - g > 30 && b > 90) n++
  }
  return n
}
console.log('旧实现 虹膜像素: ' + oldFrames.map(purple).join(', '))
console.log('新实现 虹膜像素: ' + newFrames.map(purple).join(', '))
// 单独导出 t=1.5708 的两种结果，便于逐个核对
writeFileSync(resolve(OUT, 'panel-old-t1.57.png'), encodePng(oldFrames[2], W, H))
writeFileSync(resolve(OUT, 'panel-new-t1.57.png'), encodePng(newFrames[2], W, H))
console.log('panel-old-t1.57.png / panel-new-t1.57.png written')
// 单行三格：静止 / 修复前(滑动) / 修复后(眨眼) —— 避免上下排误读
const newAt = (t) => frameNew(t)
const trio = [newAt(0), oldFrames[2], newFrames[2]]
const TW = W * 3 + GAP * 2
const tsheet = new Uint8ClampedArray(TW * H * 4)
for (let k = 0; k < 3; k++) {
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = k * (W + GAP) + x
      const so = (y * TW + dx) * 4
      const io = (y * W + x) * 4
      tsheet[so] = trio[k][io]; tsheet[so + 1] = trio[k][io + 1]; tsheet[so + 2] = trio[k][io + 2]; tsheet[so + 3] = 255
    }
  }
}
writeFileSync(resolve(OUT, 'blink-panels.png'), encodePng(tsheet, TW, H))
console.log('blink-panels.png written（左=静止，中=修复前 t=1.57s，右=修复后 t=1.57s）；虹膜像素 ' + trio.map(purple).join(' / '))
