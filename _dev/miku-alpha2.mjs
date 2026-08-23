// 修正 colorType 读取，重新分析 Miku 纹理 alpha 与内容分布
import { readFileSync } from 'node:fs'
import zlib from 'node:zlib'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = fileURLToPath(import.meta.url).replace(/\\/g, '/')
const root = here.slice(0, here.lastIndexOf('/_dev/'))
const { decodeTex } = await import(pathToFileURL(join(root, 'src/scene/SceneTex.ts')).href)

function parsePkg(buf) {
  let pos = 16
  const entries = []
  while (pos + 8 <= buf.length) {
    const nameLen = buf.readInt32LE(pos); pos += 4
    if (nameLen <= 0 || nameLen > 1024 || pos + nameLen + 8 > buf.length) break
    const name = buf.subarray(pos, pos + nameLen).toString('utf8'); pos += nameLen
    const offset = buf.readInt32LE(pos); pos += 4
    const size = buf.readInt32LE(pos); pos += 4
    if (offset < 0 || size < 0 || offset + size > buf.length) break
    entries.push({ name, offset, size })
  }
  const dataStart = pos
  return (n) => { const e = entries.find((x) => x.name === n); if (!e) return null; return buf.subarray(dataStart + e.offset, dataStart + e.offset + e.size) }
}

function decodePNG(buf) {
  let pos = 8, w = 0, h = 0, bitDepth = 0, colorType = 0
  const idat = []
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('ascii', pos + 4, pos + 8)
    const data = buf.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9] }
    else if (type === 'IDAT') idat.push(data)
    pos += 12 + len
  }
  const raw = zlib.inflateSync(Buffer.concat(idat))
  // colorType: 0=gray, 2=rgb, 3=palette, 4=gray+alpha, 6=rgba
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 4 ? 2 : colorType === 0 ? 1 : 0
  const stride = w * channels
  const out = new Uint8Array(w * h * 4)
  const prev = new Uint8Array(stride)
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)]
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    const cur = new Uint8Array(stride)
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0
      const b = prev[x]
      const c = x >= channels ? prev[x - channels] : 0
      let v = line[x]
      if (filter === 1) v = (v + a) & 0xff
      else if (filter === 2) v = (v + b) & 0xff
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 0xff
      else if (filter === 4) { const p = a + b - c; const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff }
      cur[x] = v
    }
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4
      if (channels === 4) { out[o] = cur[x * 4]; out[o + 1] = cur[x * 4 + 1]; out[o + 2] = cur[x * 4 + 2]; out[o + 3] = cur[x * 4 + 3] }
      else if (channels === 3) { out[o] = cur[x * 3]; out[o + 1] = cur[x * 3 + 1]; out[o + 2] = cur[x * 3 + 2]; out[o + 3] = 255 }
      else if (channels === 2) { const g = cur[x * 2], al = cur[x * 2 + 1]; out[o] = g; out[o + 1] = g; out[o + 2] = g; out[o + 3] = al }
      else { const g = cur[x]; out[o] = g; out[o + 1] = g; out[o + 2] = g; out[o + 3] = 255 }
    }
    prev.set(cur)
  }
  return { w, h, rgba: out, bitDepth, colorType, channels }
}

const read = parsePkg(readFileSync('D:/SteamLibrary/steamapps/workshop/content/431960/3409595232/scene.pkg'))
const tex = decodeTex(read('materials/导出初音.tex'))
const png = decodePNG(tex.mip0.data)
const { w, h, rgba, bitDepth, colorType, channels } = png
console.log('PNG bitDepth=' + bitDepth + ' colorType=' + colorType + ' channels=' + channels + ' 尺寸=' + w + 'x' + h)
const px = (x, y) => { const o = (y * w + x) * 4; return [rgba[o], rgba[o + 1], rgba[o + 2], rgba[o + 3]] }
console.log('四角: TL=' + px(0, 0) + ' TR=' + px(w - 1, 0) + ' BL=' + px(0, h - 1) + ' BR=' + px(w - 1, h - 1))
// alpha 包围盒（alpha < 250 视为透明/半透明边缘）
let mnx = w, mny = h, mxx = -1, mxy = -1
let opaque = 0, semi = 0, transparent = 0
for (let y = 0; y < h; y += 2) {
  for (let x = 0; x < w; x += 2) {
    const a = rgba[(y * w + x) * 4 + 3]
    if (a >= 250) opaque++
    else if (a > 8) semi++
    else transparent++
    if (a > 8) {
      if (x < mnx) mnx = x
      if (y < mny) mny = y
      if (x > mxx) mxx = x
      if (y > mxy) mxy = y
    }
  }
}
console.log('alpha>8 包围盒: x[' + mnx + ',' + mxx + '] 宽 ' + (mxx - mnx) + '，y[' + mny + ',' + mxy + '] 高 ' + (mxy - mny))
console.log('不透明=' + opaque + ' 半透明=' + semi + ' 透明=' + transparent)
console.log('包围盒中心: (' + ((mnx + mxx) / 2).toFixed(1) + ', ' + ((mny + mxy) / 2).toFixed(1) + ')，图片中心: (' + (w / 2) + ', ' + (h / 2) + ')')
