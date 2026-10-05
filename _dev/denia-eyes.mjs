// 眼睛纹理精细结构：alpha 阈值轮廓 + 连通块包围盒 + 方向场/掩码在眼睛区域内的分布
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { decodeTex } from '../src/scene/SceneTex.ts'

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
const out = []

out.push(`eyes tex=${eyesTex.textureWidth}x${eyesTex.textureHeight} img=${eyesTex.imageWidth}x${eyesTex.imageHeight} mips=${eyesTex.mipCount}`)
out.push(`flow ${flowTex.imageWidth}x${flowTex.imageHeight} format=${flowTex.format}; op ${opTex.imageWidth}x${opTex.imageHeight} format=${opTex.format}`)

// alpha>0.5 轮廓（1 字符 = 4x4 像素）
out.push('')
out.push('=== alpha>128 轮廓（每字符 4x4 px，左=x0..200 右）===')
for (let r = 0; r < H / 4; r++) {
  let s = ''
  for (let c = 0; c < W / 4; c++) {
    let on = 0
    for (let y = r * 4; y < r * 4 + 4; y++) for (let x = c * 4; x < c * 4 + 4; x++) if (eyes[(y * W + x) * 4 + 3] > 128) on++
    s += on > 8 ? '#' : on > 2 ? '+' : on > 0 ? '.' : ' '
  }
  out.push(String(r * 4).padStart(3, ' ') + ' ' + s)
}

// 逐行 alpha 统计 + 重心
out.push('')
out.push('=== 行 alpha 和 > 0.5 的行段 ===')
const rows = []
for (let y = 0; y < H; y++) { let s = 0; for (let x = 0; x < W; x++) s += eyes[(y * W + x) * 4 + 3]; rows.push(s / 255) }
let inB = false, start = 0
for (let y = 0; y < H; y++) {
  const on = rows[y] > 0.5
  if (on && !inB) { inB = true; start = y }
  if (!on && inB) { inB = false; out.push(`  y ${start}-${y - 1} (h=${y - start})`) }
}
if (inB) out.push(`  y ${start}-${H - 1} (h=${H - start})`)

// 每个行段的列分布（x 重心 / 覆盖范围）
function regionStats(y0, y1) {
  let sx = 0, sw = 0, xmin = W, xmax = -1
  for (let y = y0; y <= y1; y++) for (let x = 0; x < W; x++) {
    const a = eyes[(y * W + x) * 4 + 3] / 255
    if (a > 0.5) { sx += x * a; sw += a; if (x < xmin) xmin = x; if (x > xmax) xmax = x }
  }
  return { centroid: sw > 0 ? sx / sw : -1, xmin, xmax }
}
for (const [y0, y1] of [[74, 163], [242, 354]]) {
  const st = regionStats(y0, y1)
  out.push(`行段 ${y0}-${y1}: x∈[${st.xmin},${st.xmax}] 重心x=${st.centroid.toFixed(1)}`)
}

// 眼睛区域（alpha>0.5）内 flow x/y 分布直方图
out.push('')
out.push('=== 眼睛区域(alpha>0.5) flow 直方图 ===')
const histX = new Array(10).fill(0), histY = new Array(10).fill(0)
let n = 0
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  if (eyes[(y * W + x) * 4 + 3] > 128) {
    n++
    const fx = (flow[(y * W + x) * 4] / 255 - 0.498) * 2
    const fy = (flow[(y * W + x) * 4 + 3] / 255 - 0.498) * 2
    histX[Math.min(9, Math.max(0, Math.floor((fx + 1) / 2 * 10)))]++
    histY[Math.min(9, Math.max(0, Math.floor((fy + 1) / 2 * 10)))]++
  }
}
out.push('flow.x 桶(-1..1, 10档): ' + histX.map((v, i) => `${(-1 + i * 0.2).toFixed(1)}:${(v / n * 100).toFixed(0)}%`).join(' '))
out.push('flow.y 桶(-1..1, 10档): ' + histY.map((v, i) => `${(-1 + i * 0.2).toFixed(1)}:${(v / n * 100).toFixed(0)}%`).join(' '))

// 掩码在眼睛区域内分布
const histM = new Array(10).fill(0)
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  if (eyes[(y * W + x) * 4 + 3] > 128) histM[Math.min(9, Math.floor(op[(y * W + x) * 4 + 3] / 256 * 10))]++
}
out.push('mask 桶(0..1, 10档): ' + histM.map((v, i) => `${(i / 10).toFixed(1)}:${(v / n * 100).toFixed(0)}%`).join(' '))

writeFileSync(resolve(OUT, 'eyes-structure.txt'), out.join('\n'), 'utf8')
console.log('eyes-structure.txt written; eye px=' + n)
