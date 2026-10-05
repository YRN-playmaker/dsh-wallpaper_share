// 可视化达妮娅眨眼用纹理：
//   materials/09眼睛.tex           → eyes.png（DXT5 解码）
//   materials/masks/shake_mask_73999545.tex → flow.png（R=X 红 / G=Y 绿，放大观察）
//   materials/masks/shake_mask_5bdd3707.tex → opacity.png（R8 灰度）
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { decodeTex, texMipToPng } from '../src/scene/SceneTex.ts'
import { encodePng } from './png-encode.mjs'

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
mkdirSync(resolve(OUT, 'png'), { recursive: true })

// 1) 眼睛纹理
const eyes = decodeTex(pkg.read('materials/09眼睛.tex'))
writeFileSync(resolve(OUT, 'png', 'eyes.png'), texMipToPng(eyes))

// 2) 方向场（RG88：byte0 = X，byte1 = Y；decodeTex 把 G 放进 alpha）
const flowTex = decodeTex(pkg.read('materials/masks/shake_mask_73999545.tex'))
const fw = flowTex.imageWidth
const fh = flowTex.imageHeight
const frgba = flowTex.mip0.rgba
const flowVis = new Uint8ClampedArray(fw * fh * 4)
let xmin = 1, xmax = -1, ymin = 1, ymax = -1, xs = 0, ys = 0
for (let i = 0; i < fw * fh; i++) {
  const x = (frgba[i * 4] / 255 - 0.498) * 2
  const y = (frgba[i * 4 + 3] / 255 - 0.498) * 2
  if (x < xmin) xmin = x
  if (x > xmax) xmax = x
  if (y < ymin) ymin = y
  if (y > ymax) ymax = y
  xs += x; ys += y
  // 可视化：X → 红（正红/负青），Y → 绿（正绿/负品红），亮度随长度
  flowVis[i * 4] = Math.round(128 + Math.max(0, x) * 127)
  flowVis[i * 4 + 1] = Math.round(128 + Math.max(0, y) * 127)
  flowVis[i * 4 + 2] = Math.round(128 + Math.max(0, -x) * 127)
  flowVis[i * 4 + 3] = 255
}
writeFileSync(resolve(OUT, 'png', 'flow.png'), encodePng(flowVis, fw, fh))
console.log(`flow ${fw}x${fh} x∈[${xmin.toFixed(3)},${xmax.toFixed(3)}] y∈[${ymin.toFixed(3)},${ymax.toFixed(3)}] mean=(${(xs / (fw * fh)).toFixed(3)},${(ys / (fw * fh)).toFixed(3)})`)

// 3) 不透明度 mask（R8）
const opTex = decodeTex(pkg.read('materials/masks/shake_mask_5bdd3707.tex'))
const ow = opTex.imageWidth
const oh = opTex.imageHeight
const orgba = opTex.mip0.rgba
const opVis = new Uint8ClampedArray(ow * oh * 4)
let os = 0, omin = 255, omax = 0
for (let i = 0; i < ow * oh; i++) {
  const v = orgba[i * 4 + 3] // r8 解码 → alpha
  os += v
  if (v < omin) omin = v
  if (v > omax) omax = v
  opVis[i * 4] = v; opVis[i * 4 + 1] = v; opVis[i * 4 + 2] = v; opVis[i * 4 + 3] = 255
}
writeFileSync(resolve(OUT, 'png', 'opacity.png'), encodePng(opVis, ow, oh))
console.log(`opacity ${ow}x${oh} format=${opTex.format} v∈[${omin},${omax}] mean=${(os / (ow * oh)).toFixed(1)}`)
console.log('eyes ' + eyes.imageWidth + 'x' + eyes.imageHeight + ' format=' + eyes.format)
