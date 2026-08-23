// 分析 Miku 纹理像素：四角颜色、是否存在"背景色"、人物实际占位
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
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); colorType = data[8] }
    else if (type === 'IDAT') idat.push(data)
    pos += 12 + len
  }
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 1
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
      else { out[o] = cur[x]; out[o + 1] = cur[x]; out[o + 2] = cur[x]; out[o + 3] = 255 }
    }
    prev.set(cur)
  }
  return { w, h, rgba: out, colorType, channels }
}

const read = parsePkg(readFileSync('D:/SteamLibrary/steamapps/workshop/content/431960/3409595232/scene.pkg'))
const tex = decodeTex(read('materials/导出初音.tex'))
const png = decodePNG(tex.mip0.data)
const { w, h, rgba, colorType, channels } = png
console.log('PNG colorType=' + colorType + ' channels=' + channels)
const px = (x, y) => { const o = (y * w + x) * 4; return [rgba[o], rgba[o + 1], rgba[o + 2], rgba[o + 3]] }
console.log('四角: TL=' + px(0, 0) + ' TR=' + px(w - 1, 0) + ' BL=' + px(0, h - 1) + ' BR=' + px(w - 1, h - 1))
console.log('边中点: T=' + px(w >> 1, 0) + ' B=' + px(w >> 1, h - 1) + ' L=' + px(0, h >> 1) + ' R=' + px(w - 1, h >> 1))
// 采样全图：统计"非背景"分布。取四角平均色为背景候选
const bg = [0, 0, 0]
for (const [x, y] of [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]]) {
  const c = px(x, y)
  bg[0] += c[0] / 4; bg[1] += c[1] / 4; bg[2] += c[2] / 4
}
console.log('背景候选: ' + bg.map((v) => v.toFixed(0)).join(','))
// 每 16px 采样，统计远离背景色的像素分布（行/列直方图）
const step = 16
const colHist = new Array(Math.ceil(w / step)).fill(0)
const rowHist = new Array(Math.ceil(h / step)).fill(0)
let content = 0
for (let y = 0; y < h; y += step) {
  for (let x = 0; x < w; x += step) {
    const c = px(x, y)
    const d = Math.abs(c[0] - bg[0]) + Math.abs(c[1] - bg[1]) + Math.abs(c[2] - bg[2])
    if (d > 40) {
      content++
      colHist[Math.floor(x / step)]++
      rowHist[Math.floor(y / step)]++
    }
  }
}
console.log('非背景采样点: ' + content)
const firstCol = colHist.findIndex((v) => v > 0)
const lastCol = colHist.length - 1 - [...colHist].reverse().findIndex((v) => v > 0)
const firstRow = rowHist.findIndex((v) => v > 0)
const lastRow = rowHist.length - 1 - [...rowHist].reverse().findIndex((v) => v > 0)
console.log('内容范围: x[' + firstCol * step + ',' + lastCol * step + '] 宽 ' + ((lastCol - firstCol) * step) + '，y[' + firstRow * step + ',' + lastRow * step + '] 高 ' + ((lastRow - firstRow) * step))
console.log('内容中心: (' + ((firstCol + lastCol) * step / 2).toFixed(0) + ', ' + ((firstRow + lastRow) * step / 2).toFixed(0) + ')')
console.log('图片中心: (' + (w / 2) + ', ' + (h / 2) + ')')
