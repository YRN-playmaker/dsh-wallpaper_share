/**
 * SceneTex —— Wallpaper Engine .tex 纹理容器完整解码器。
 *
 * 格式（已实测破解 + repkg(MIT, notscuffed) 源码语义确认，参考文件见
 * _dev/reference/）：
 *   Magic1 "0005\0" + Magic2 "TEXI0001\0"（null 终止字符串）
 *   Header（7 × int32 raw）：
 *     Format（TexFormat：0=RGBA8888, 4=DXT5, 6=DXT3, 7=DXT1, 8=RG88, 9=R8）
 *     Flags（TexFlags：2=ClampUVs …）、TextureWidth、TextureHeight、
 *     ImageWidth、ImageHeight、UnkInt0
 *   ImageContainer：
 *     "TEXB0003\0" / "TEXB0004\0" + imageCount（int32）
 *     TEXB0003：ImageFormat（FreeImageFormat：13=PNG, 2=JPEG, -1=raw）
 *     TEXB0004：ImageFormat + isVideoMp4
 *     每个 image：mipmapCount + 每级 [W][H][IsLZ4][DecompressedBytesCount]
 *       [byteCount][bytes]
 *       - ImageFormat 为图片格式：bytes = 完整 PNG/JPEG 文件
 *       - ImageFormat 为 raw：bytes = LZ4 压缩流 → 解压为 Header.Format
 *         的像素数据（DXT1/DXT3/DXT5/RGBA8888/RG88/R8）
 *
 * 本模块仅被 node 半使用（路由），因此可依赖 node:zlib（PNG 编码）。
 */
import { deflateSync } from 'node:zlib'
import { decodeMip, type TexPixelFormat } from './TexDecode.ts'

/** Header.Format（TexFormat） */
export const TEX_FORMAT = {
  RGBA8888: 0,
  DXT5: 4,
  DXT3: 6,
  DXT1: 7,
  RG88: 8,
  R8: 9,
} as const

/** 容器 ImageFormat（FreeImageFormat 子集） */
export const FIF = {
  UNKNOWN: -1,
  JPEG: 2,
  PNG: 13,
} as const

export interface TexMipData {
  width: number
  height: number
  /** image 类型：内嵌图片（可直接 serve）；raw 类型：LZ4 解压后的压缩像素 */
  kind: 'image-png' | 'image-jpeg' | 'raw'
  /** 图片字节（image）或解压后的像素字节（raw） */
  data: Uint8Array
  /** 数据相对 .tex 字节的起始偏移（仅 image 类型用于按文件区间伺服） */
  dataOffset: number
  /** raw 类型：已解码的 RGBA8888 像素 */
  rgba: Uint8ClampedArray | null
}

export interface DecodedTex {
  format: number
  flags: number
  textureWidth: number
  textureHeight: number
  imageWidth: number
  imageHeight: number
  containerMagic: string
  imageFormat: number
  mipCount: number
  mip0: TexMipData | null
}

/** 解析 .tex 容器；返回 null 表示无法解析 */
export function decodeTex(bytes: Uint8Array): DecodedTex | null {
  try {
    let pos = 0
    const readNString = (): string => {
      let s = ''
      while (pos < bytes.length) {
        const c = bytes[pos++]
        if (c === 0) break
        s += String.fromCharCode(c)
      }
      return s
    }
    const readI32 = (): number => {
      const v = (bytes[pos] | (bytes[pos + 1] << 8) | (bytes[pos + 2] << 16) | (bytes[pos + 3] << 24))
      pos += 4
      return v
    }

    const magic1 = readNString()
    const magic2 = readNString()
    // 两种变体：workshop pkg 内 "0005"；WE assets 引擎资产 "TEXV0005"
    if ((magic1 !== '0005' && magic1 !== 'TEXV0005') || magic2 !== 'TEXI0001') return null

    const format = readI32()
    const flags = readI32()
    const textureWidth = readI32()
    const textureHeight = readI32()
    const imageWidth = readI32()
    const imageHeight = readI32()
    readI32() // UnkInt0

    const containerMagic = readNString()
    if (containerMagic !== 'TEXB0001' && containerMagic !== 'TEXB0002' && containerMagic !== 'TEXB0003' && containerMagic !== 'TEXB0004') return null
    const imageCount = readI32()
    let imageFormat: number = FIF.UNKNOWN
    // TEXB0001/0002：无 ImageFormat 字段（老版本，直接跟 mip 数据）
    if (containerMagic === 'TEXB0003') imageFormat = readI32()
    else if (containerMagic === 'TEXB0004') { imageFormat = readI32(); readI32() /* isVideoMp4 */ }
    if (imageCount <= 0 || imageCount > 100) return null

    // 只取第一个 image 的 mip0（渲染只需最高清 mip）
    const mipCount = readI32()
    if (mipCount <= 0 || mipCount > 32) return null

    const w = readI32()
    const h = readI32()
    const isLz4 = readI32()
    const decompressed = readI32()
    const byteCount = readI32()
    if (w <= 0 || h <= 0 || w > 16384 || h > 16384 || byteCount < 0 || pos + byteCount > bytes.length) return null
    const dataOffset = pos
    let data = bytes.subarray(pos, pos + byteCount)
    pos += byteCount

    // LZ4 解压（raw 纹理）
    let rgba: Uint8ClampedArray | null = null
    if (isLz4 === 1) {
      const raw = lz4Decompress(data, decompressed)
      if (raw === null) return null
      data = raw
    }

    let kind: TexMipData['kind']
    if (imageFormat === FIF.PNG) kind = 'image-png'
    else if (imageFormat === FIF.JPEG) kind = 'image-jpeg'
    else kind = 'raw'

    // raw：LZ4 解压后为 Header.Format 像素数据 → 解码为 RGBA
    if (kind === 'raw') {
      rgba = decodeRawPixels(format, w, h, data)
      if (rgba === null) return null
    }

    return {
      format,
      flags,
      textureWidth,
      textureHeight,
      imageWidth,
      imageHeight,
      containerMagic,
      imageFormat,
      mipCount,
      mip0: { width: w, height: h, kind, data, dataOffset, rgba },
    }
  } catch {
    return null
  }
}

/** raw 像素解码：DXT1/DXT3/DXT5/RGBA8888/R8 → RGBA8888 */
function decodeRawPixels(format: number, w: number, h: number, data: Uint8Array): Uint8ClampedArray | null {
  let fmt: TexPixelFormat
  switch (format) {
    case TEX_FORMAT.DXT1: fmt = 'dxt1'; break
    case TEX_FORMAT.DXT3: fmt = 'dxt3'; break
    case TEX_FORMAT.DXT5: fmt = 'dxt5'; break
    case TEX_FORMAT.RGBA8888: fmt = 'rgba8888'; break
    // R8 单通道、RG88 双通道（雾/粒子纹理）→ alpha 通道（rgb=白）
    case TEX_FORMAT.R8: fmt = 'r8'; break
    case TEX_FORMAT.RG88: fmt = 'rg88'; break
    default: return null
  }
  try {
    return decodeMip(fmt, data, 0, w, h)
  } catch {
    return null
  }
}

/**
 * 把 mip0 转成可直接伺服/解码的字节：
 *   image-png → 原 PNG 字节；image-jpeg → 原 JPEG 字节；raw → RGBA → PNG
 */
export function texMipToPng(tex: DecodedTex): Uint8Array | null {
  const m0 = tex.mip0
  if (m0 === null) return null
  if (m0.kind === 'image-png' || m0.kind === 'image-jpeg') return m0.data
  if (m0.rgba === null) return null
  return rgbaToPng(m0.rgba, m0.width, m0.height)
}

/** mip0 的 MIME（image 类型返回图片 MIME；raw 返回 image/png） */
export function texMimeOf(tex: DecodedTex): string | null {
  const m0 = tex.mip0
  if (m0 === null) return null
  if (m0.kind === 'image-png') return 'image/png'
  if (m0.kind === 'image-jpeg') return 'image/jpeg'
  return 'image/png'
}

// ---------- LZ4 块解压（标准格式） ----------
export function lz4Decompress(src: Uint8Array, expectedLen: number): Uint8Array | null {
  const out = new Uint8Array(expectedLen)
  let ip = 0
  let op = 0
  const end = src.length
  while (ip < end) {
    const token = src[ip++]
    let litLen = token >> 4
    if (litLen === 15) {
      let b: number
      do {
        if (ip >= end) return null
        b = src[ip++]
        litLen += b
      } while (b === 255)
    }
    if (op + litLen > expectedLen || ip + litLen > end) return null
    for (let i = 0; i < litLen; i++) out[op++] = src[ip++]
    if (ip >= end) break
    if (ip + 2 > end) return null
    const offset = src[ip] | (src[ip + 1] << 8)
    ip += 2
    if (offset === 0 || offset > op) return null
    let matchLen = token & 0x0f
    if (matchLen === 15) {
      let b: number
      do {
        if (ip >= end) return null
        b = src[ip++]
        matchLen += b
      } while (b === 255)
    }
    matchLen += 4
    for (let i = 0; i < matchLen; i++) {
      out[op] = out[op - offset]
      op++
      if (op > expectedLen) return null
    }
  }
  if (op !== expectedLen) return null
  return out
}

// ---------- PNG 编码（node:zlib） ----------
const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c }
  return t
})()
function crc32(buf: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const len = new Uint8Array(4)
  len[0] = (data.length >>> 24) & 0xff; len[1] = (data.length >>> 16) & 0xff; len[2] = (data.length >>> 8) & 0xff; len[3] = data.length & 0xff
  const td = new Uint8Array(4 + data.length)
  for (let i = 0; i < 4; i++) td[i] = type.charCodeAt(i)
  td.set(data, 4)
  const crc = new Uint8Array(4)
  const c = crc32(td)
  crc[0] = (c >>> 24) & 0xff; crc[1] = (c >>> 16) & 0xff; crc[2] = (c >>> 8) & 0xff; crc[3] = c & 0xff
  const out = new Uint8Array(4 + td.length + 4)
  out.set(len, 0); out.set(td, 4); out.set(crc, 4 + td.length)
  return out
}
function rgbaToPng(rgba: Uint8ClampedArray, w: number, h: number): Uint8Array {
  const ihdr = new Uint8Array(13)
  ihdr[0] = (w >>> 24) & 0xff; ihdr[1] = (w >>> 16) & 0xff; ihdr[2] = (w >>> 8) & 0xff; ihdr[3] = w & 0xff
  ihdr[4] = (h >>> 24) & 0xff; ihdr[5] = (h >>> 16) & 0xff; ihdr[6] = (h >>> 8) & 0xff; ihdr[7] = h & 0xff
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  const raw = new Uint8Array(h * (1 + w * 4))
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 4)] = 0
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 4
      const d = y * (1 + w * 4) + 1 + x * 4
      raw[d] = rgba[s]; raw[d + 1] = rgba[s + 1]; raw[d + 2] = rgba[s + 2]; raw[d + 3] = rgba[s + 3]
    }
  }
  const idat = deflateSync(Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength), { level: 6 })
  const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ih = pngChunk('IHDR', ihdr)
  const id = pngChunk('IDAT', new Uint8Array(idat))
  const ie = pngChunk('IEND', new Uint8Array(0))
  const out = new Uint8Array(sig.length + ih.length + id.length + ie.length)
  out.set(sig, 0); out.set(ih, sig.length); out.set(id, sig.length + ih.length); out.set(ie, sig.length + ih.length + id.length)
  return out
}
