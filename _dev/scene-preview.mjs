// B 阶段：场景合成预览 —— 复刻浏览器 SceneModelRenderer 的光栅化逻辑（node 侧）
// 用真实 SceneModel + 真实 PNG 纹理，按图层 transform（translate/rotate/scale）合成，
// 输出 PNG 供目视验证与 transform 校准。
// 说明：node 无 JPEG 解码器，JPEG 纹理图层以占位轮廓显示（浏览器里会被正常贴图）。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { inflateSync, deflateSync } from 'node:zlib'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = fileURLToPath(import.meta.url).replace(/\\/g, '/')
const root = here.slice(0, here.lastIndexOf('/_dev/'))
const { buildSceneModel } = await import(pathToFileURL(join(root, 'src/scene/SceneModel.ts')).href)
const { parseScenePkg } = await import(pathToFileURL(join(root, 'src/scene/ScenePkg.ts')).href)
const { decodeTex } = await import(pathToFileURL(join(root, 'src/scene/SceneTex.ts')).href)

const OUT = join(here.slice(0, here.lastIndexOf('/')), '_png')
mkdirSync(OUT, { recursive: true })

// ---------- PNG 解码（纯 node：zlib inflate + 反滤波）----------
function decodePng(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let pos = 8
  let width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0
  const idat = []
  while (pos + 8 <= bytes.length) {
    const len = view.getUint32(pos)
    const type = String.fromCharCode(bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7])
    if (type === 'IHDR') {
      width = view.getUint32(pos + 8); height = view.getUint32(pos + 12)
      bitDepth = bytes[pos + 16]; colorType = bytes[pos + 17]; interlace = bytes[pos + 20]
    } else if (type === 'IDAT') {
      idat.push(bytes.subarray(pos + 8, pos + 8 + len))
    } else if (type === 'IEND') break
    pos += 12 + len
  }
  if (bitDepth !== 8 || colorType !== 6 && colorType !== 2 && colorType !== 0 && colorType !== 4) {
    throw new Error('unsupported PNG: bitDepth=' + bitDepth + ' colorType=' + colorType)
  }
  const raw = inflateSync(Buffer.concat(idat))
  const bpp = colorType === 6 ? 4 : colorType === 4 ? 2 : colorType === 2 ? 3 : 1
  const stride = width * bpp
  const out = new Uint8ClampedArray(width * height * 4)
  const prev = new Uint8Array(stride)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    const cur = new Uint8Array(stride)
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0
      const b = prev[x]
      const c = x >= bpp ? prev[x - bpp] : 0
      let v = line[x]
      if (filter === 1) v = (v + a) & 0xff
      else if (filter === 2) v = (v + b) & 0xff
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 0xff
      else if (filter === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
        const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c
        v = (v + pr) & 0xff
      }
      cur[x] = v
    }
    for (let x = 0; x < width; x++) {
      const s = x * bpp
      const d = (y * width + x) * 4
      if (colorType === 6) { out[d] = cur[s]; out[d + 1] = cur[s + 1]; out[d + 2] = cur[s + 2]; out[d + 3] = cur[s + 3] }
      else if (colorType === 2) { out[d] = cur[s]; out[d + 1] = cur[s + 1]; out[d + 2] = cur[s + 2]; out[d + 3] = 255 }
      else if (colorType === 4) { const g = cur[s]; out[d] = g; out[d + 1] = g; out[d + 2] = g; out[d + 3] = cur[s + 1] }
      else { const g = cur[s]; out[d] = g; out[d + 1] = g; out[d + 2] = g; out[d + 3] = 255 }
    }
    prev.set(cur)
  }
  return { width, height, rgba: out }
}

// ---------- PNG 写出 ----------
const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c }
  return t
})()
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
function rgbaToPng(rgba, w, h) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  const raw = Buffer.alloc(h * (1 + w * 4))
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 4)] = 0
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 4
      const d = y * (1 + w * 4) + 1 + x * 4
      raw[d] = rgba[s]; raw[d + 1] = rgba[s + 1]; raw[d + 2] = rgba[s + 2]; raw[d + 3] = rgba[s + 3]
    }
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))])
}

// ---------- 主流程 ----------
const WS = 'D:/SteamLibrary/steamapps/workshop/content/431960'
const TARGET = process.argv[2] ?? '2865923273'
const pkgBuf = readFileSync(join(WS, TARGET, 'scene.pkg'))
const pkg = parseScenePkg(new Uint8Array(pkgBuf))
const model = buildSceneModel(new Uint8Array(pkgBuf))
if (model === null) { console.error('model null'); process.exit(1) }

// 加载 PNG 纹理（node 可解码）；JPEG 纹理标记为不可解码
const textures = new Map()
const textureWarn = []
for (const layer of model.layers) {
  for (const ref of layer.textureRefs) {
    if (textures.has(ref)) break
    const entry = pkg.entries.find((e) => e.name === ref)
    if (!entry) continue
    const texBytes = pkg.read(ref)
    const tex = texBytes ? decodeTex(texBytes) : null
    if (tex !== null && tex.mip0 !== null && tex.mip0.type === 'png') {
      try {
        textures.set(ref, { ...decodePng(tex.mip0.data), name: ref })
        break
      } catch { textureWarn.push(ref + '(png-decode-fail)') }
    } else if (tex !== null && tex.mip0 !== null && tex.mip0.type === 'jpeg') {
      textureWarn.push(ref + '(jpeg,node 不可解码→浏览器正常)')
      break
    }
  }
}

// 光栅化（输出缩放到 ≤1280×720）
const os = Math.min(1, 1280 / model.width, 720 / model.height)
const OW = Math.max(1, Math.round(model.width * os))
const OH = Math.max(1, Math.round(model.height * os))

let texturedLayers = 0
let placeholderLayers = 0
// 图层顺序：正序（数组序，后画在上=默认假设）与反序（先画在上）各出一张，供与真实壁纸比对定 z-order
for (const reversed of [false, true]) {
  const suffix = reversed ? 'reverse' : 'normal'
  const buf = new Uint8ClampedArray(OW * OH * 4)
  if (model.clearColor !== null) {
    for (let i = 0; i < OW * OH; i++) {
      buf[i * 4] = model.clearColor[0] * 255; buf[i * 4 + 1] = model.clearColor[1] * 255; buf[i * 4 + 2] = model.clearColor[2] * 255; buf[i * 4 + 3] = 255
    }
  }
  const layerList = reversed ? [...model.layers].reverse() : model.layers
  for (const layer of layerList) {
    if (!layer.visible) continue
    const tex = layer.textureRefs.map((r) => textures.get(r)).find((t) => t !== undefined) ?? null
    const [ox, oy] = layer.origin
    const theta = (layer.angles[2] ?? 0) * Math.PI / 180
    const sx = layer.scale[0] ?? 1
    const sy = layer.scale[1] ?? 1
    const cosT = Math.cos(theta)
    const sinT = Math.sin(theta)
    const iSx = sx === 0 ? 0 : 1 / sx
    const iSy = sy === 0 ? 0 : 1 / sy
    if (tex !== null) {
      texturedLayers++
      const tw = tex.width
      const th = tex.height
      for (let Y = 0; Y < OH; Y++) {
        for (let X = 0; X < OW; X++) {
          const wx = X / os
          const wy = Y / os
          const dx = wx - ox
          const dy = wy - oy
          const rx = dx * cosT + dy * sinT
          const ry = -dx * sinT + dy * cosT
          const lx = rx * iSx + tw / 2
          const ly = ry * iSy + th / 2
          if (lx < 0 || ly < 0 || lx >= tw || ly >= th) continue
          const sx0 = Math.min(tw - 1, Math.floor(lx))
          const sy0 = Math.min(th - 1, Math.floor(ly))
          const s = (sy0 * tw + sx0) * 4
          const a = tex.rgba[s + 3] / 255
          const d = (Y * OW + X) * 4
          if (a >= 0.99) {
            buf[d] = tex.rgba[s]; buf[d + 1] = tex.rgba[s + 1]; buf[d + 2] = tex.rgba[s + 2]; buf[d + 3] = 255
          } else if (a > 0) {
            buf[d] = Math.round(buf[d] * (1 - a) + tex.rgba[s] * a)
            buf[d + 1] = Math.round(buf[d + 1] * (1 - a) + tex.rgba[s + 1] * a)
            buf[d + 2] = Math.round(buf[d + 2] * (1 - a) + tex.rgba[s + 2] * a)
            buf[d + 3] = 255
          }
        }
      }
    } else {
      placeholderLayers++
      const px = Math.round(ox * os)
      const py = Math.round(oy * os)
      for (let dy = -40; dy <= 40; dy++) {
        for (let dx = -40; dx <= 40; dx++) {
          if (dx * dx + dy * dy < 1600 && Math.abs(dx) < 40 && Math.abs(dy) < 40) {
            const X = px + dx, Y = py + dy
            if (X < 0 || Y < 0 || X >= OW || Y >= OH) continue
            const d = (Y * OW + X) * 4
            buf[d] = 120; buf[d + 1] = 170; buf[d + 2] = 255; buf[d + 3] = 255
          }
        }
      }
    }
  }
  const pngPath = join(OUT, 'scene-preview-' + TARGET + '-' + suffix + '.png')
  writeFileSync(pngPath, rgbaToPng(buf, OW, OH))
  console.log('wrote', pngPath)
}
console.log('model:', model.width + 'x' + model.height, 'layers:', model.layerCount, 'output:', OW + 'x' + OH)
console.log('textured layers:', texturedLayers, '| placeholder layers:', placeholderLayers)
console.log('texture notes:', textureWarn.length ? textureWarn.join('; ') : 'none')
