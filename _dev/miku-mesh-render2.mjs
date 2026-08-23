// 简易 PNG 解码（zlib inflate + unfilter）→ Miku 网格 UV 采样渲染
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
  const read = (n) => {
    const e = entries.find((x) => x.name === n)
    if (!e) return null
    return buf.subarray(dataStart + e.offset, dataStart + e.offset + e.size)
  }
  return { read }
}

function decodePNG(buf) {
  if (buf[0] !== 0x89 || buf[1] !== 0x50) return null
  let pos = 8
  let w = 0, h = 0, bitDepth = 0, colorType = 0
  const idat = []
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('ascii', pos + 4, pos + 8)
    const data = buf.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4)
      bitDepth = data[8]; colorType = data[9]
    } else if (type === 'IDAT') idat.push(data)
    pos += 12 + len
  }
  if (w === 0 || h === 0 || bitDepth !== 8 || (colorType !== 6 && colorType !== 2 && colorType !== 0)) return null
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
      else if (filter === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
        v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff
      }
      cur[x] = v
    }
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4
      if (channels === 4) {
        out[o] = cur[x * 4]; out[o + 1] = cur[x * 4 + 1]; out[o + 2] = cur[x * 4 + 2]; out[o + 3] = cur[x * 4 + 3]
      } else if (channels === 3) {
        out[o] = cur[x * 3]; out[o + 1] = cur[x * 3 + 1]; out[o + 2] = cur[x * 3 + 2]; out[o + 3] = 255
      } else {
        out[o] = cur[x]; out[o + 1] = cur[x]; out[o + 2] = cur[x]; out[o + 3] = 255
      }
    }
    prev.set(cur)
  }
  return { w, h, rgba: out }
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
  ihdr[8] = 8; ihdr[9] = 6
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ])
  writeFileSync(path, png)
}

const pkg = parsePkg(readFileSync('D:/SteamLibrary/steamapps/workshop/content/431960/3409595232/scene.pkg'))
const tex = decodeTex(pkg.read('materials/导出初音.tex'))
const png = decodePNG(tex.mip0.data)
console.log('png decoded: ' + png.w + 'x' + png.h)
const rgba = png.rgba
const tw = png.w, th = png.h
const pm = parsePuppetMdl(pkg.read('models/导出初音_puppet.mdl'))
const mesh = pm.mesh
const W = 360, H = 360
const img = new Uint8Array(W * H * 4)
const mnx = -1400, mxx = 1300, mny = -1250, mxy = 850
const sx = (W - 20) / (mxx - mnx)
const toX = (x) => 10 + (x - mnx) * sx
const toY = (y) => H - 10 - (y - mny) * sx
let covered = 0
let sampled = 0
for (let t = 0; t + 2 < mesh.indices.length; t += 3) {
  const a = mesh.vertices[mesh.indices[t]], b = mesh.vertices[mesh.indices[t + 1]], c = mesh.vertices[mesh.indices[t + 2]]
  const ax = toX(a.pos[0]), ay = toY(a.pos[1]), bx = toX(b.pos[0]), by = toY(b.pos[1]), cx = toX(c.pos[0]), cy = toY(c.pos[1])
  const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
  if (Math.abs(area) < 1e-3) continue
  const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx)))
  const maxX = Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx)))
  const minY = Math.max(0, Math.floor(Math.min(ay, by, cy)))
  const maxY = Math.min(H - 1, Math.ceil(Math.max(ay, by, cy)))
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const Px = x + 0.5, Py = y + 0.5
      const w0 = (bx - Px) * (cy - Py) - (by - Py) * (cx - Px)
      const w1 = (cx - Px) * (ay - Py) - (cy - Py) * (ax - Px)
      const w2 = (ax - Px) * (by - Py) - (ay - Py) * (bx - Px)
      const ok = area > 0 ? (w0 >= 0 && w1 >= 0 && w2 >= 0) : (w0 <= 0 && w1 <= 0 && w2 <= 0)
      if (!ok) continue
      const inv = 1 / area
      const l0 = w0 * inv, l1 = w1 * inv, l2 = w2 * inv
      let u = l0 * a.uv[0] + l1 * b.uv[0] + l2 * c.uv[0]
      let v = l0 * a.uv[1] + l1 * b.uv[1] + l2 * c.uv[1]
      v = 1 - v
      u = u - Math.floor(u)
      v = v - Math.floor(v)
      const tx = Math.min(tw - 1, Math.max(0, Math.floor(u * tw)))
      const ty = Math.min(th - 1, Math.max(0, Math.floor(v * th)))
      const so = (ty * tw + tx) * 4
      sampled++
      if (rgba[so + 3] > 10) covered++
      const o = (y * W + x) * 4
      img[o] = rgba[so]; img[o + 1] = rgba[so + 1]; img[o + 2] = rgba[so + 2]; img[o + 3] = 255
    }
  }
}
writePNG('_dev/out-miku-mesh.png', W, H, img)
let texOpaque = 0
for (let i = 3; i < rgba.length; i += 4) if (rgba[i] > 10) texOpaque++
console.log('sampled=' + sampled + ' covered=' + covered + ' (' + (sampled ? Math.round(covered / sampled * 100) : 0) + '%)')
console.log('texture opaque: ' + (texOpaque / (tw * th) * 100).toFixed(1) + '%')
