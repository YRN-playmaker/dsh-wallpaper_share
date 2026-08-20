// 贴图蒙皮渲染：asuna body 网格（stride=80 + MDLE 蒙皮）+ UV 采样纹理 → PNG
// 直接写文件（不经管道）。输出可量化统计供验证。
import { readFileSync, writeFileSync } from 'node:fs'
import zlib from 'node:zlib'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = fileURLToPath(import.meta.url).replace(/\\/g, '/')
const root = here.slice(0, here.lastIndexOf('/_dev/'))
const { decodeTex } = await import(pathToFileURL(join(root, 'src/scene/SceneTex.ts')).href)

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

const PKG = 'D:/SteamLibrary/steamapps/workshop/content/431960/3463520581/scene.pkg'
const pkg = parsePkg(PKG)

// scene.json → 找 asuna body 的纹理引用与 scene 尺寸
const sceneJsonRaw = pkg.read('scene.json')
let sceneJson = null
{
  const s = sceneJsonRaw.toString('utf8')
  const lb = s.lastIndexOf('{')
  const cut = s.lastIndexOf('}', s.lastIndexOf('}') - 1)
  try { sceneJson = JSON.parse(s.slice(0, cut + 1)) } catch { try { sceneJson = JSON.parse(s.slice(0, lb)) } catch (e) { console.log('scene.json parse fail: ' + e.message) } }
}
const jsonLayers = {}
if (sceneJson && sceneJson.layers) {
  for (const l of sceneJson.layers) jsonLayers[l.id] = l
}
console.log('scene ' + (sceneJson ? sceneJson.width + 'x' + sceneJson.height : '?') + ' layers=' + (sceneJson ? sceneJson.layers.length : '?'))

// 纹理名：直接扫 pkg 条目匹配 asuna body
const entries = []
{
  const buf = readFileSync(PKG)
  let pos = 16
  while (pos + 8 <= buf.length) {
    const nameLen = buf.readInt32LE(pos); pos += 4
    if (nameLen <= 0 || nameLen > 1024 || pos + nameLen + 8 > buf.length) break
    const name = buf.subarray(pos, pos + nameLen).toString('utf8'); pos += nameLen
    const offset = buf.readInt32LE(pos); pos += 4
    const size = buf.readInt32LE(pos); pos += 4
    if (offset < 0 || size < 0 || offset + size > buf.length) break
    entries.push({ name, offset, size })
  }
}
const texNames = []
for (const e of entries) if (e.name.includes('asuna body') && e.name.endsWith('.tex')) texNames.push(e.name)
console.log('asuna tex candidates: ' + JSON.stringify(texNames))

// 解码 asuna body 纹理（第一个 .tex）
const texBlob = pkg.read(texNames[0])
const tex = decodeTex(texBlob)
if (!tex) { console.log('tex decode FAIL'); process.exit(1) }
console.log('tex ' + texNames[0] + ': ' + tex.textureWidth + 'x' + tex.textureHeight + ' format=' + tex.format + ' mipCount=' + tex.mipCount + ' image=' + tex.imageWidth + 'x' + tex.imageHeight)
const tw = tex.textureWidth, th = tex.textureHeight
const texRgba = tex.mip0.rgba
if (!texRgba) { console.log('no rgba (image type)'); process.exit(1) }

// 网格 + MDLE 蒙皮
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
console.log('mesh vc=' + blk.vc + ' tri=' + blk.ib / 6)
const verts = []
for (let i = 0; i < blk.vc; i++) {
  const vo = blk.vo + i * stride
  // 静态（bind）渲染：raw 顶点（MDLE 是动画姿势矩阵；M×bindInv 当 M=bind 时恒等）
  const sx = m.readFloatLE(vo), sy = m.readFloatLE(vo + 4), sz = m.readFloatLE(vo + 8)
  const u = m.readFloatLE(vo + 72), v = m.readFloatLE(vo + 76)
  verts.push({ sx, sy, sz, u, v })
}
const idx = []
for (let i = 0; i < blk.ib / 2; i++) idx.push(m.readUInt16LE(blk.ilo + 4 + i * 2))

// 渲染：画布 = 纹理尺寸（模型空间 → 纹理像素，原点 = 图片中心）
const W = tw, H = th
console.log('canvas ' + W + 'x' + H)
const img = new Uint8Array(W * H * 4)
let covered = 0
const toX = (x) => W / 2 + x
const toY = (y) => H / 2 - y
for (let t = 0; t + 2 < idx.length; t += 3) {
  const A = verts[idx[t]], B = verts[idx[t + 1]], C = verts[idx[t + 2]]
  const ax = toX(A.sx), ay = toY(A.sy), bx = toX(B.sx), by = toY(B.sy), cx = toX(C.sx), cy = toY(C.sy)
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
      let u = l0 * A.u + l1 * B.u + l2 * C.u
      let v = l0 * A.v + l1 * B.v + l2 * C.v
      // v 翻转（y-up 模型 → 纹理 v-down）
      v = 1 - v
      u = u - Math.floor(u)
      v = v - Math.floor(v)
      const tx = Math.min(tw - 1, Math.max(0, Math.floor(u * tw)))
      const ty = Math.min(th - 1, Math.max(0, Math.floor(v * th)))
      const so = (ty * tw + tx) * 4
      const o = (y * W + x) * 4
      const a = texRgba[so + 3]
      if (a > 0) covered++
      img[o] = texRgba[so]; img[o + 1] = texRgba[so + 1]; img[o + 2] = texRgba[so + 2]; img[o + 3] = 255
    }
  }
}
writePNG('_dev/out-asuna-textured.png', W, H, img)
console.log('covered px (sampled nonzero alpha) = ' + covered)
console.log('mesh bounds: x[' + Math.min(...verts.map((q) => q.sx)).toFixed(1) + ',' + Math.max(...verts.map((q) => q.sx)).toFixed(1) + '] y[' + Math.min(...verts.map((q) => q.sy)).toFixed(1) + ',' + Math.max(...verts.map((q) => q.sy)).toFixed(1) + ']')
console.log('bone0=(' + bones[0][3][0].toFixed(1) + ',' + bones[0][3][1].toFixed(1) + ') texW=' + tw + ' texH=' + th)
