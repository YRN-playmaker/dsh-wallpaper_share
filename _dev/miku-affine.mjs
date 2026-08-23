// 同分辨率对比：重心法（v2 参考） vs 仿射法（buildMeshCanvas 同款）
import { readFileSync, writeFileSync } from 'node:fs'
import zlib from 'node:zlib'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = fileURLToPath(import.meta.url).replace(/\\/g, '/')
const root = here.slice(0, here.lastIndexOf('/_dev/'))
const { parsePuppetMdl } = await import(pathToFileURL(join(root, 'src/scene/ScenePuppet.ts')).href)
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
  return { w, h, rgba: out }
}

function writePNG(path, w, h, rgba) {
  const crcTable = []
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0 }
  const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
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
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
  writeFileSync(path, png)
}

const pkg = parsePkg(readFileSync('D:/SteamLibrary/steamapps/workshop/content/431960/3409595232/scene.pkg'))
const png = decodePNG(decodeTex(pkg('materials/导出初音.tex')).mip0.data)
const rgba = png.rgba
const tw = png.w, th = png.h
const mesh = parsePuppetMdl(pkg('models/导出初音_puppet.mdl')).mesh

let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity
for (const v of mesh.vertices) {
  const x = v.pos[0], y = -v.pos[1]
  if (x < mnx) mnx = x
  if (y < mny) mny = y
  if (x > mxx) mxx = x
  if (y > mxy) mxy = y
}
const pad = 4
const cw = Math.ceil(mxx - mnx) + pad * 2
const ch = Math.ceil(mxy - mny) + pad * 2
const scale = 240 / cw
const W = Math.ceil(cw * scale)
const H = Math.ceil(ch * scale)
const toX = (x) => (x + pad - mnx) * scale
const toY = (y) => (y + pad - mny) * scale
const fv = (v) => v

function renderAffine() {
  const img = new Uint8Array(W * H * 4)
  for (let i = 0; i + 2 < mesh.indices.length; i += 3) {
    const a = mesh.vertices[mesh.indices[i]], b = mesh.vertices[mesh.indices[i + 1]], cc = mesh.vertices[mesh.indices[i + 2]]
    const u0 = a.uv[0] * tw, v0 = fv(a.uv[1]) * th
    const u1 = b.uv[0] * tw, v1 = fv(b.uv[1]) * th
    const u2 = cc.uv[0] * tw, v2 = fv(cc.uv[1]) * th
    const x0 = toX(a.pos[0]), y0 = toY(-a.pos[1])
    const x1 = toX(b.pos[0]), y1 = toY(-b.pos[1])
    const x2 = toX(cc.pos[0]), y2 = toY(-cc.pos[1])
    const det = (u1 - u0) * (v2 - v0) - (u2 - u0) * (v1 - v0)
    if (Math.abs(det) < 1e-9) continue
    const m00 = ((x1 - x0) * (v2 - v0) - (x2 - x0) * (v1 - v0)) / det
    const m01 = ((u1 - u0) * (x2 - x0) - (u2 - u0) * (x1 - x0)) / det
    const m10 = ((y1 - y0) * (v2 - v0) - (y2 - y0) * (v1 - v0)) / det
    const m11 = ((u1 - u0) * (y2 - y0) - (u2 - u0) * (y1 - y0)) / det
    const tx = x0 - m00 * u0 - m01 * v0
    const ty = y0 - m10 * u0 - m11 * v0
    const area = (x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0)
    if (Math.abs(area) < 1e-3) continue
    const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2))), maxX = Math.min(W - 1, Math.ceil(Math.max(x0, x1, x2)))
    const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2))), maxY = Math.min(H - 1, Math.ceil(Math.max(y0, y1, y2)))
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const Px = x + 0.5, Py = y + 0.5
      const w0 = (x1 - Px) * (y2 - Py) - (y1 - Py) * (x2 - Px)
      const w1 = (x2 - Px) * (y0 - Py) - (y2 - Py) * (x0 - Px)
      const w2 = (x0 - Px) * (y1 - Py) - (y0 - Py) * (x1 - Px)
      const ok = area > 0 ? (w0 >= 0 && w1 >= 0 && w2 >= 0) : (w0 <= 0 && w1 <= 0 && w2 <= 0)
      if (!ok) continue
      const detM = m00 * m11 - m01 * m10
      if (Math.abs(detM) < 1e-12) continue
      const u = ((Px - tx) * m11 - m01 * (Py - ty)) / detM
      const v = (m00 * (Py - ty) - m10 * (Px - tx)) / detM
      const txp = Math.min(tw - 1, Math.max(0, Math.floor(u))), typ = Math.min(th - 1, Math.max(0, Math.floor(v)))
      const so = (typ * tw + txp) * 4, o = (y * W + x) * 4
      img[o] = rgba[so]; img[o + 1] = rgba[so + 1]; img[o + 2] = rgba[so + 2]; img[o + 3] = 255
    }
  }
  return img
}

function renderBary() {
  const img = new Uint8Array(W * H * 4)
  for (let i = 0; i + 2 < mesh.indices.length; i += 3) {
    const a = mesh.vertices[mesh.indices[i]], b = mesh.vertices[mesh.indices[i + 1]], cc = mesh.vertices[mesh.indices[i + 2]]
    const u0 = a.uv[0] * tw, v0 = fv(a.uv[1]) * th
    const u1 = b.uv[0] * tw, v1 = fv(b.uv[1]) * th
    const u2 = cc.uv[0] * tw, v2 = fv(cc.uv[1]) * th
    const x0 = toX(a.pos[0]), y0 = toY(-a.pos[1])
    const x1 = toX(b.pos[0]), y1 = toY(-b.pos[1])
    const x2 = toX(cc.pos[0]), y2 = toY(-cc.pos[1])
    const area = (x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0)
    if (Math.abs(area) < 1e-3) continue
    const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2))), maxX = Math.min(W - 1, Math.ceil(Math.max(x0, x1, x2)))
    const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2))), maxY = Math.min(H - 1, Math.ceil(Math.max(y0, y1, y2)))
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const Px = x + 0.5, Py = y + 0.5
      const w0 = ((x1 - Px) * (y2 - Py) - (y1 - Py) * (x2 - Px)) / area
      const w1 = ((x2 - Px) * (y0 - Py) - (y2 - Py) * (x0 - Px)) / area
      const w2 = 1 - w0 - w1
      if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue
      const u = w0 * u0 + w1 * u1 + w2 * u2
      const v = w0 * v0 + w1 * v1 + w2 * v2
      const txp = Math.min(tw - 1, Math.max(0, Math.floor(u))), typ = Math.min(th - 1, Math.max(0, Math.floor(v)))
      const so = (typ * tw + txp) * 4, o = (y * W + x) * 4
      img[o] = rgba[so]; img[o + 1] = rgba[so + 1]; img[o + 2] = rgba[so + 2]; img[o + 3] = 255
    }
  }
  return img
}

const aff = renderAffine()
const bar = renderBary()
let diff = 0, affPix = 0, barPix = 0, maxRgb = 0
for (let i = 0; i < W * H; i++) {
  const a = i * 4
  const covered = aff[a] !== 0 || aff[a + 1] !== 0 || aff[a + 2] !== 0
  const bco = bar[a] !== 0 || bar[a + 1] !== 0 || bar[a + 2] !== 0
  if (covered) affPix++
  if (bco) barPix++
  if (covered !== bco) diff++
  else if (covered) {
    const dr = Math.abs(aff[a] - bar[a]), dg = Math.abs(aff[a + 1] - bar[a + 1]), db = Math.abs(aff[a + 2] - bar[a + 2])
    const m = Math.max(dr, dg, db)
    if (m > maxRgb) maxRgb = m
    if (dr + dg + db > 30) diff++
  }
}
console.log('仿射法覆盖像素: ' + affPix)
console.log('重心法覆盖像素: ' + barPix)
console.log('差异像素(覆盖率或颜色差>30): ' + diff + ' / ' + (W * H))
console.log('最大单通道色差: ' + maxRgb)
writePNG('_dev/out-miku-affine.png', W, H, aff)
writePNG('_dev/out-miku-bary.png', W, H, bar)
