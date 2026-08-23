// 立绘内容在网格区域内外分布：验证官方是否必须缩放/平移网格
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
  return { w, h, rgba: out }
}

const read = parsePkg(readFileSync('D:/SteamLibrary/steamapps/workshop/content/431960/3409595232/scene.pkg'))
const tex = decodeTex(read('materials/导出初音.tex'))
const png = decodePNG(tex.mip0.data)
const { w, h, rgba } = png
// 网格图片空间（模型空间 + size/2，y 翻转）：x[1057,3692] y[818,2854]
const gx0 = 4862 / 2 - 1374, gx1 = 4862 / 2 + 1261
const gy0 = 3288 / 2 - 826, gy1 = 3288 / 2 + 1210
console.log('网格图片空间: x[' + gx0 + ',' + gx1 + '] y[' + gy0 + ',' + gy1 + ']')
let inMesh = 0, outMesh = 0
const quad = { t: 0, b: 0, l: 0, r: 0 }
for (let y = 0; y < h; y += 2) {
  for (let x = 0; x < w; x += 2) {
    const a = rgba[(y * w + x) * 4 + 3]
    if (a <= 8) continue
    const inside = x >= gx0 && x <= gx1 && y >= gy0 && y <= gy1
    if (inside) inMesh++
    else {
      outMesh++
      if (y < gy0) quad.t++
      if (y > gy1) quad.b++
      if (x < gx0) quad.l++
      if (x > gx1) quad.r++
    }
  }
}
const tot = inMesh + outMesh
console.log('内容像素(采样): 网格内 ' + inMesh + ' (' + (inMesh / tot * 100).toFixed(1) + '%)，网格外 ' + outMesh + ' (' + (outMesh / tot * 100).toFixed(1) + '%)')
console.log('网格外分布: 上 ' + quad.t + ' 下 ' + quad.b + ' 左 ' + quad.l + ' 右 ' + quad.r)
// 内容每 8% 高度条带分布
const bands = 10
const bandH = h / bands
for (let i = 0; i < bands; i++) {
  let cnt = 0
  for (let y = Math.floor(i * bandH); y < Math.floor((i + 1) * bandH); y += 2) {
    for (let x = 0; x < w; x += 2) {
      if (rgba[(y * w + x) * 4 + 3] > 8) cnt++
    }
  }
  console.log('条带 y[' + Math.floor(i * bandH) + ',' + Math.floor((i + 1) * bandH) + ']: ' + cnt + '（' + (cnt / tot * 100).toFixed(1) + '%）')
}
