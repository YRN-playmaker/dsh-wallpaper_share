// 分析 preview.gif 首帧内容分布（非背景像素包围盒），对比我的渲染
import { readFileSync } from 'node:fs'

const buf = readFileSync('D:/SteamLibrary/steamapps/workshop/content/431960/3409595232/preview.gif')
const w = buf.readUInt16LE(6)
const h = buf.readUInt16LE(8)
let pos = 13
let gctSize = 2 << (buf[10] & 7)
pos += (buf[10] & 0x80) ? gctSize * 3 : 0
const gct = []
if (buf[10] & 0x80) {
  for (let i = 0; i < gctSize; i++) { gct.push([buf[pos], buf[pos + 1], buf[pos + 2]]); pos += 3 }
}
// 找第一帧（跳过块直到图像描述符 0x2c）
let scan = 13 + ((buf[10] & 0x80) ? (2 << (buf[10] & 7)) * 3 : 0)
while (scan < buf.length && buf[scan] !== 0x2c) scan++
if (scan >= buf.length) { console.log('no frame'); process.exit(0) }
pos = scan
const ix = buf.readUInt16LE(pos + 1)
const iy = buf.readUInt16LE(pos + 3)
const iw = buf.readUInt16LE(pos + 5)
const ih = buf.readUInt16LE(pos + 7)
let p = pos + 10
if (buf[pos + 9] & 0x80) p += (2 << (buf[pos + 9] & 7)) * 3
const lzwMin = buf[p++]
const blocks = []
while (buf[p] !== 0) { blocks.push(buf.subarray(p + 1, p + 1 + buf[p])); p += buf[p] + 1 }
const data = Buffer.concat(blocks)

function lzwDecode(data, minCodeSize, expected) {
  const out = []
  const clearCode = 1 << minCodeSize
  const eoiCode = clearCode + 1
  let codeSize = minCodeSize + 1
  let dict = []
  const resetDict = () => { dict = []; for (let i = 0; i < clearCode; i++) dict.push([i]); dict.push([]); dict.push([]); codeSize = minCodeSize + 1 }
  resetDict()
  let bitBuf = 0, bitCnt = 0, prev = null, dp = 0, guard = 0
  while (dp < data.length && guard++ < 2000000) {
    while (bitCnt < codeSize && dp < data.length) { bitBuf |= data[dp++] << bitCnt; bitCnt += 8 }
    if (bitCnt < codeSize) break
    const code = bitBuf & ((1 << codeSize) - 1)
    bitBuf >>>= codeSize
    bitCnt -= codeSize
    if (code === clearCode) { resetDict(); prev = null; continue }
    if (code === eoiCode) break
    if (code < dict.length) {
      const entry = dict[code]
      for (const b of entry) out.push(b)
      if (prev !== null) dict.push([...prev, entry[0]])
      prev = entry
    } else if (code === dict.length && prev !== null) {
      const np = [...prev, prev[0]]
      for (const b of np) out.push(b)
      dict.push(np)
      prev = np
    } else return null
    if (dict.length === (1 << codeSize) && codeSize < 12) codeSize++
    if (out.length >= expected) return out
  }
  return out.length >= expected ? out : null
}

const pixels = lzwDecode(data, lzwMin, iw * ih)
console.log('frame: ' + iw + 'x' + ih + ' @' + ix + ',' + iy + ' pixels=' + (pixels ? pixels.length : 'null'))
if (!pixels) process.exit(0)
const rgba = new Uint8Array(w * h * 4)
for (let i = 0; i < w * h; i++) { rgba[i * 4 + 3] = 255 }
for (let y = 0; y < ih; y++) {
  for (let x = 0; x < iw; x++) {
    const c = pixels[y * iw + x]
    if (c >= gct.length) continue
    const o = ((iy + y) * w + (ix + x)) * 4
    rgba[o] = gct[c][0]; rgba[o + 1] = gct[c][1]; rgba[o + 2] = gct[c][2]
  }
}
const step = 2
let mnx = w, mny = h, mxx = -1, mxy = -1
let nonBg = 0
for (let y = 0; y < h; y += step) {
  for (let x = 0; x < w; x += step) {
    const o = (y * w + x) * 4
    const r = rgba[o], g = rgba[o + 1], b = rgba[o + 2]
    if (r + g + b > 12 && r + g + b < 753) {
      nonBg++
      if (x < mnx) mnx = x
      if (y < mny) mny = y
      if (x > mxx) mxx = x
      if (y > mxy) mxy = y
    }
  }
}
console.log('preview 尺寸: ' + w + 'x' + h)
console.log('非背景像素(采样): ' + nonBg)
console.log('内容包围盒: x[' + mnx + ',' + mxx + '] 宽 ' + (mxx - mnx) + '，y[' + mny + ',' + mxy + '] 高 ' + (mxy - mny))
console.log('内容中心: (' + ((mnx + mxx) / 2).toFixed(1) + ', ' + ((mny + mxy) / 2).toFixed(1) + ')')
const cw = Math.ceil(w / 8), chh = Math.ceil(h / 8)
const colHist = new Array(cw).fill(0)
const rowHist = new Array(chh).fill(0)
for (let y = 0; y < h; y += step) {
  for (let x = 0; x < w; x += step) {
    const o = (y * w + x) * 4
    const r = rgba[o], g = rgba[o + 1], b = rgba[o + 2]
    if (r + g + b > 12 && r + g + b < 753) {
      colHist[Math.floor(x / 8)]++
      rowHist[Math.floor(y / 8)]++
    }
  }
}
console.log('列直方图(每8px):')
console.log(Array.from(colHist, (v) => (v > 0 ? '#' : '.')).join(''))
console.log('行直方图(每8px, 顶部→底部):')
console.log(Array.from(rowHist, (v) => (v > 0 ? '#' : '.')).join(''))
