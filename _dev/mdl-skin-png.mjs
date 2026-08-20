// 蒙皮网格光栅化 → PNG（含未蒙皮 raw 对比）
import { readFileSync, writeFileSync } from 'node:fs'
import zlib from 'node:zlib'

function parsePkg(path) {
  const buf = readFileSync(path)
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
  const read = (n) => {
    const e = entries.find((x) => x.name === n)
    if (!e) return null
    return buf.subarray(dataStart + e.offset, dataStart + e.offset + e.size)
  }
  return { read }
}

function writePNG(path, w, h, rgba) {
  const crcTable = []
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    crcTable[n] = c >>> 0
  }
  const crc32 = (buf) => {
    let c = 0xffffffff
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
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
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
  writeFileSync(path, png)
}

const pkg = parsePkg('D:/SteamLibrary/steamapps/workshop/content/431960/3463520581/scene.pkg')
const m = pkg.read('models/asuna body_puppet.mdl')
const mdlsIdx = m.indexOf('MDLS')
const mdleIdx = m.indexOf('MDLE0002')
const byteCount = m.readUInt32LE(mdleIdx + 13)
const matCount = byteCount / 64
const bones = []
for (let i = 0; i < matCount; i++) {
  const mp = mdleIdx + 17 + i * 64
  const b = []
  for (let r = 0; r < 4; r++) b.push([m.readFloatLE(mp + r * 16), m.readFloatLE(mp + r * 16 + 4), m.readFloatLE(mp + r * 16 + 8), m.readFloatLE(mp + r * 16 + 12)])
  bones.push(b)
}
const stride = 80
let blk = null
for (let offset = 9; offset + 12 < mdlsIdx; offset++) {
  const cvb = m.readUInt32LE(offset + 4)
  const vo = offset + 8
  const ilo = vo + cvb
  if (cvb === 0 || cvb % stride !== 0 || ilo + 4 > mdlsIdx) continue
  const cib = m.readUInt32LE(ilo)
  if (cib === 0 || cib % 6 !== 0 || ilo + 4 + cib > mdlsIdx) continue
  blk = { vo, vc: cvb / stride, ilo, ib: cib }
  break
}
const idx = []
for (let i = 0; i < blk.ib / 2; i++) idx.push(m.readUInt16LE(blk.ilo + 4 + i * 2))

// 蒙皮（MDLE）+ raw
const skin = [], raw = []
for (let i = 0; i < blk.vc; i++) {
  const vo = blk.vo + i * stride
  const px = m.readFloatLE(vo), py = m.readFloatLE(vo + 4), pz = m.readFloatLE(vo + 8)
  let sx = 0, sy = 0, sz = 0
  for (let w = 0; w < 4; w++) {
    const wt = m.readFloatLE(vo + 56 + w * 4)
    if (wt === 0 || w >= bones.length) continue
    const bm = bones[w]
    sx += wt * (bm[0][0] * px + bm[1][0] * py + bm[2][0] * pz + bm[3][0])
    sy += wt * (bm[0][1] * px + bm[1][1] * py + bm[2][1] * pz + bm[3][1])
    sz += wt * (bm[0][2] * px + bm[1][2] * py + bm[2][2] * pz + bm[3][2])
  }
  skin.push([sx, sy, sz])
  raw.push([px, py, pz])
}

// 画布：模型空间（y-up）→ 像素（y-down）。皮肤用蓝色，raw 用红色
const W = 640, H = 640
const img = new Uint8Array(W * H * 4)
const pts = (v, col) => {
  const mnx = -110, mxx = 260, mny = -920, mxy = 800
  const s = (W - 40) / Math.max(mxx - mnx, mxy - mny)
  return [40 + (v[0] - mnx) * s, H - 40 - (v[1] - mny) * s]
}
const edge = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
const fillTri = (tris, col) => {
  for (const [a, b, c] of tris) {
    const A = pts(a), B = pts(b), C = pts(c)
    const area = edge(A, B, C)
    if (Math.abs(area) < 1e-3) continue
    const minX = Math.max(0, Math.floor(Math.min(A[0], B[0], C[0])))
    const maxX = Math.min(W - 1, Math.ceil(Math.max(A[0], B[0], C[0])))
    const minY = Math.max(0, Math.floor(Math.min(A[1], B[1], C[1])))
    const maxY = Math.min(H - 1, Math.ceil(Math.max(A[1], B[1], C[1])))
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const P = [x + 0.5, y + 0.5]
        const w0 = edge(B, C, P), w1 = edge(C, A, P), w2 = edge(A, B, P)
        const ok = (area > 0) ? (w0 >= 0 && w1 >= 0 && w2 >= 0) : (w0 <= 0 && w1 <= 0 && w2 <= 0)
        if (!ok) continue
        const o = (y * W + x) * 4
        img[o] = Math.min(255, img[o] + col[0])
        img[o + 1] = Math.min(255, img[o + 1] + col[1])
        img[o + 2] = Math.min(255, img[o + 2] + col[2])
        img[o + 3] = 255
      }
    }
  }
}
const trisSkin = [], trisRaw = []
for (let t = 0; t + 2 < idx.length; t += 3) {
  trisSkin.push([skin[idx[t]], skin[idx[t + 1]], skin[idx[t + 2]]])
  trisRaw.push([raw[idx[t]], raw[idx[t + 1]], raw[idx[t + 2]]])
}
fillTri(trisSkin, [28, 60, 160])
fillTri(trisRaw, [140, 30, 30])
// 骨骼位置标记（红点 = 骨骼平移）
for (let i = 0; i < bones.length; i++) {
  const [bx, by] = pts([bones[i][3][0], bones[i][3][1]], null)
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const x = Math.round(bx) + dx, y = Math.round(by) + dy
    if (x >= 0 && x < W && y >= 0 && y < H) {
      const o = (y * W + x) * 4
      img[o] = 255; img[o + 1] = 255; img[o + 2] = 0; img[o + 3] = 255
    }
  }
}
writePNG('_dev/out-asuna-skin.png', W, H, img)
console.log('PNG written; bones=' + matCount)
