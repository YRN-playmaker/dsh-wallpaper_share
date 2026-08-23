// 解码 preview.gif 首帧，输出 PNG，用于目视对比官方渲染
import { readFileSync, writeFileSync } from 'node:fs'
import zlib from 'node:zlib'

const buf = readFileSync('D:/SteamLibrary/steamapps/workshop/content/431960/3409595232/preview.gif')
console.log('GIF 大小: ' + buf.length)
if (buf.readUInt32LE(0) !== 0x38464947) { console.log('not GIF: ' + buf.subarray(0, 6).toString('ascii')); process.exit(0) }
const w = buf.readUInt16LE(6)
const h = buf.readUInt16LE(8)
console.log('GIF 尺寸: ' + w + 'x' + h)
const packed = buf[10]
const gctFlag = packed & 0x80
const gctSize = 2 << (packed & 7)
console.log('GCT flag=' + gctFlag + ' size=' + gctSize)
let pos = 13
const gct = []
if (gctFlag) {
  for (let i = 0; i < gctSize; i++) {
    gct.push([buf[pos], buf[pos + 1], buf[pos + 2]])
    pos += 3
  }
}
// 解析帧
let frameCount = 0
let frameData = null
while (pos < buf.length && frameCount < 3) {
  const sep = buf[pos]
  if (sep === 0x3b) break // trailer
  if (sep !== 0x21 && sep !== 0x2c) { pos++; continue }
  if (sep === 0x21) {
    const label = buf[pos + 1]
    if (label === 0xf9) {
      // GCE
      const blockSize = buf[pos + 2]
      const delay = buf.readUInt16LE(pos + 4)
      const transparent = (buf[pos + 3] & 1) === 1
      const transIdx = buf[pos + 6]
      console.log('GCE: delay=' + delay + ' transparent=' + transparent + ' idx=' + (transparent ? transIdx : '-'))
      pos += 3 + blockSize
    } else {
      // 跳过子块
      pos += 2
      while (buf[pos] !== 0 && pos < buf.length) { pos += buf[pos] + 1 }
      pos++
    }
    continue
  }
  // image descriptor 0x2c
  const ix = buf.readUInt16LE(pos + 1)
  const iy = buf.readUInt16LE(pos + 3)
  const iw = buf.readUInt16LE(pos + 5)
  const ih = buf.readUInt16LE(pos + 7)
  const ipacked = buf[pos + 9]
  const lctFlag = ipacked & 0x80
  const interlace = (ipacked & 0x40) !== 0
  let lct = gct
  pos += 10
  if (lctFlag) {
    const lctSize = 2 << (ipacked & 7)
    lct = []
    for (let i = 0; i < lctSize; i++) { lct.push([buf[pos], buf[pos + 1], buf[pos + 2]]); pos += 3 }
  }
  const lzwMin = buf[pos++]
  // 收集子块
  const blocks = []
  while (pos < buf.length) {
    const n = buf[pos++]
    if (n === 0) break
    blocks.push(buf.subarray(pos, pos + n))
    pos += n
  }
  const data = Buffer.concat(blocks)
  // LZW 解压
  const pixels = lzwDecode(data, lzwMin, iw * ih)
  if (pixels === null) { console.log('LZW fail'); break }
  // 反隔行
  const rows = new Array(ih)
  const px = new Uint8Array(pixels)
  let pi = 0
  if (interlace) {
    const passes = [[0, 8], [4, 8], [2, 4], [1, 2]]
    for (const [start, step] of passes) {
      for (let y = start; y < ih; y += step) {
        rows[y] = px.subarray(pi * iw, (pi + 1) * iw)
        pi++
      }
    }
  } else {
    for (let y = 0; y < ih; y++) {
      rows[y] = px.subarray(y * iw, (y + 1) * iw)
    }
  }
  frameCount++
  console.log('frame ' + frameCount + ': ' + iw + 'x' + ih + ' lzwMin=' + lzwMin + ' interlace=' + interlace + ' pixels=' + pixels.length)
  if (frameCount === 1) frameData = { ix, iy, iw, ih, rows, lct, transparentIdx: -1 }
  if (frameCount >= 1) break
}
if (frameData !== null) {
  const { ix, iy, iw, ih, rows, lct, transparentIdx } = frameData
  const rgba = new Uint8Array(w * h * 4)
  // 背景：GCT[0]
  const bg = lct[0] ?? [0, 0, 0]
  for (let i = 0; i < w * h; i++) { rgba[i * 4] = bg[0]; rgba[i * 4 + 1] = bg[1]; rgba[i * 4 + 2] = bg[2]; rgba[i * 4 + 3] = 255 }
  for (let y = 0; y < ih; y++) {
    const row = rows[y]
    for (let x = 0; x < iw; x++) {
      const c = row[x]
      if (c >= lct.length) continue
      const o = ((iy + y) * w + (ix + x)) * 4
      const [r, g, b] = lct[c]
      rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; rgba[o + 3] = 255
    }
  }
  writePNG('_dev/out-miku-preview.png', w, h, rgba)
  console.log('preview 首帧已写出 _dev/out-miku-preview.png')
}

function lzwDecode(data, minCodeSize, expected) {
  const out = []
  const clearCode = 1 << minCodeSize
  const eoiCode = clearCode + 1
  let codeSize = minCodeSize + 1
  let dict = []
  const resetDict = () => {
    dict = []
    for (let i = 0; i < clearCode; i++) dict.push([i])
    dict.push([]) // clear
    dict.push([]) // eoi
    codeSize = minCodeSize + 1
  }
  resetDict()
  let bitBuf = 0
  let bitCnt = 0
  let prev = null
  let pos = 0
  while (pos < data.length) {
    bitBuf |= data[pos++] << bitCnt
    bitCnt += 8
    while (bitCnt >= codeSize) {
      const code = bitBuf & ((1 << codeSize) - 1)
      bitBuf >>>= codeSize
      bitCnt -= codeSize
      if (code === clearCode) { resetDict(); prev = null; continue }
      if (code === eoiCode) return out
      if (code < dict.length) {
        const entry = dict[code]
        for (const b of entry) out.push(b)
        if (prev !== null) {
          const np = [...prev, entry[0]]
          dict.push(np)
        }
        prev = entry
      } else if (code === dict.length && prev !== null) {
        const np = [...prev, prev[0]]
        for (const b of np) out.push(b)
        dict.push(np)
        prev = np
      } else {
        return null
      }
      if (dict.length === (1 << codeSize) && codeSize < 12) codeSize++
    }
  }
  return out
}

function writePNG(path, w, h, rgba) {
  const crcTable = []
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0 }
  const crc32 = (b) => { let c = 0xffffffff; for (const v of b) c = crcTable[(c ^ v) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td))
    return Buffer.concat([len, td, crc])
  }
  const raw = Buffer.alloc(h * (1 + w * 4))
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 4)] = 0
    for (let x = 0; x < w; x++) {
      const o = y * (1 + w * 4) + 1 + x * 4
      const s = (y * w + x) * 4
      raw[o] = rgba[s]; raw[o + 1] = rgba[s + 1]; raw[o + 2] = rgba[s + 2]; raw[o + 3] = rgba[s + 3]
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8; ihdr[9] = 6
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))])
  writeFileSync(path, png)
}
