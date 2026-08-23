// 验证假设：cropoffset = 纹理内容(alpha)区域相对图片中心/图层的偏移？
// 检查 3759313716 的 7.json、6.json、5.json 纹理 alpha 区域
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import zlib from 'node:zlib'

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
  let pos = 8, w = 0, h = 0, colorType = 0
  const idat = []
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('ascii', pos + 4, pos + 8)
    const data = buf.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); colorType = data[9] }
    else if (type === 'IDAT') idat.push(data)
    pos += 12 + len
  }
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 4 ? 2 : 1
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
  return { w, h, rgba: out, colorType }
}

function alphaBBox(rgba, w, h) {
  let mnx = w, mny = h, mxx = -1, mxy = -1
  let total = 0, opaque = 0
  for (let y = 0; y < h; y += 3) {
    for (let x = 0; x < w; x += 3) {
      const a = rgba[(y * w + x) * 4 + 3]
      if (a > 8) {
        total++
        if (a >= 250) opaque++
        if (x < mnx) mnx = x
        if (y < mny) mny = y
        if (x > mxx) mxx = x
        if (y > mxy) mxy = y
      }
    }
  }
  return { mnx, mny, mxx, mxy, total, opaque }
}

const base = 'D:/SteamLibrary/steamapps/workshop/content/431960/'
const read = parsePkg(readFileSync(base + '3759313716/scene.pkg'))
const tex = decodeTex(read('materials/7.tex'))
const png = decodePNG(tex.mip0.data)
const b = alphaBBox(png.rgba, png.w, png.h)
console.log('7.json 纹理: ' + png.w + 'x' + png.h + ' colorType=' + png.colorType)
console.log('alpha 区域: x[' + b.mnx + ',' + b.mxx + '] 宽 ' + (b.mxx - b.mnx) + '，y[' + b.mny + ',' + b.mxy + '] 高 ' + (b.mxy - b.mny))
console.log('内容中心: (' + ((b.mnx + b.mxx) / 2).toFixed(1) + ', ' + ((b.mny + b.mxy) / 2).toFixed(1) + ')')
console.log('图片中心: (' + (png.w / 2) + ', ' + (png.h / 2) + ')')
// 网格信息（7.json：cropoffset=-226 -191，网格 x[-341,339] y[-211,161]，图层 776×417）
console.log('网格: x[-341,339] y[-211,161]，cropoffset=(-226,-191)')
console.log('网格图片空间: x[' + (776 / 2 - 341) + ',' + (776 / 2 + 339) + '] y[' + (417 / 2 - 161) + ',' + (417 / 2 + 211) + ']')
// 内容中心 - 网格中心（模型空间）
console.log('内容中心相对图片中心(模型空间 y-up): (' + ((b.mnx + b.mxx) / 2 - png.w / 2).toFixed(1) + ', ' + (-((b.mny + b.mxy) / 2 - png.h / 2)).toFixed(1) + ')')
console.log('网格中心(模型空间): (' + (-341 + 339) / 2 + ', ' + (-211 + 161) / 2 + ')')
