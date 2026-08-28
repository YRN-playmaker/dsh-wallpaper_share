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

/** TEXS 动画帧：在纹理中的像素矩形（x/y/w/h）与持续时长（秒） */
export interface TexFrameData {
  x: number
  y: number
  w: number
  h: number
  t: number
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
  /** TEXS 动画段帧表（GIF/序列帧/切分图片动画）；无则 null（静态纹理） */
  frames: TexFrameData[] | null
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

    // 读取所有 image 页的 mip0（GIF/多页序列帧纹理：每页是一帧或一组帧的位图）。
    // 每页布局：[mipCount i32] + 每级 [W][H][IsLZ4][DecBC][BC][bytes]。
    interface PageMip { w: number; h: number; isLz4: number; dec: number; data: Uint8Array }
    const readMip = (): PageMip | null => {
      if (pos + 20 > bytes.length) return null
      const mw = readI32(); const mh = readI32(); const lz = readI32(); const dc = readI32(); const bc = readI32()
      if (mw <= 0 || mh <= 0 || mw > 16384 || mh > 16384 || bc < 0 || pos + bc > bytes.length) return null
      const d = bytes.subarray(pos, pos + bc)
      pos += bc
      return { w: mw, h: mh, isLz4: lz, dec: dc, data: d }
    }
    const mipCount = readI32()
    if (mipCount <= 0 || mipCount > 32) return null
    const page0 = readMip()
    if (page0 === null) return null
    const dataOffset = pos - page0.data.length
    const pages: PageMip[] = [page0]
    for (let mm = 1; mm < mipCount; mm++) { if (readMip() === null) return null }
    for (let img = 1; img < imageCount; img++) {
      const mc = readI32()
      if (mc <= 0 || mc > 32) return null
      const pm = readMip()
      if (pm === null) return null
      pages.push(pm)
      for (let mm = 1; mm < mc; mm++) { if (readMip() === null) return null }
    }

    let kind: TexMipData['kind']
    if (imageFormat === FIF.PNG) kind = 'image-png'
    else if (imageFormat === FIF.JPEG) kind = 'image-jpeg'
    else kind = 'raw'

    // 解析 TEXS 帧表（保留 frameNumber = 所属 image 页索引，供多页重映射）。
    // 布局（参考 LWE TextureParser.parseAnimations）：
    //   "TEXS0001/2/3\0" + frameCount u32；TEXS0003 额外 gifWidth/gifHeight u32
    //   每帧：TEXS0001 = [frameNumber u32][frametime f32][x u32][y u32][w u32][?][?][h u32]
    //          TEXS0002/3 = [frameNumber u32][frametime f32][x f32][y f32][w1 f32][w2 f32][h2 f32][h1 f32]
    const parsedFrames: Array<{ x: number; y: number; w: number; h: number; t: number; page: number }> | null = (() => {
      if (pos + 9 > bytes.length) return null
      // 9 字节含结尾 null（如 "TEXS0003\0"）
      const magic3 = String.fromCharCode(bytes[pos], bytes[pos + 1], bytes[pos + 2], bytes[pos + 3], bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7], bytes[pos + 8])
      if (magic3 !== 'TEXS0001\u0000' && magic3 !== 'TEXS0002\u0000' && magic3 !== 'TEXS0003\u0000') return null
      let fp = pos + 9
      const readU32 = (): number => {
        const v = (bytes[fp] | (bytes[fp + 1] << 8) | (bytes[fp + 2] << 16) | (bytes[fp + 3] << 24)) >>> 0
        fp += 4
        return v
      }
      const readF32 = (): number => {
        // 按位重解释 int32 → float32（new Float32Array([v]) 是数值转换，会失真）
        const v = (bytes[fp] | (bytes[fp + 1] << 8) | (bytes[fp + 2] << 16) | (bytes[fp + 3] << 24))
        fp += 4
        return new Float32Array(new Int32Array([v]).buffer)[0]
      }
      const frameCount = readU32()
      if (frameCount <= 1 || frameCount > 4096) return null
      if (magic3 === 'TEXS0003\u0000') { readU32(); readU32() /* gifWidth/gifHeight */ }
      const out: Array<{ x: number; y: number; w: number; h: number; t: number; page: number }> = []
      for (let f = 0; f < frameCount && fp + 32 <= bytes.length; f++) {
        const page = readU32()
        const t = readF32()
        if (magic3 === 'TEXS0001\u0000') {
          const fx = readU32(); const fy = readU32(); const fw = readU32()
          readU32(); readU32()
          const fh = readU32()
          out.push({ x: fx, y: fy, w: fw, h: fh, t, page })
        } else {
          const fx = readF32(); const fy = readF32()
          const w1 = readF32(); const w2 = readF32(); const h2 = readF32(); const h1 = readF32()
          // w1/h1 为主尺寸（w2/h2 为镜像/偏移场景，取绝对值最大值）
          const fw = Math.max(Math.abs(w1), Math.abs(w2))
          const fh = Math.max(Math.abs(h1), Math.abs(h2))
          if (fw <= 0 || fh <= 0) return null
          out.push({ x: fx, y: fy, w: fw, h: fh, t, page })
        }
      }
      return out.length > 1 ? out : null
    })()

    // 解码一页 raw → RGBA（PNG/JPEG 页不在此解码，按原字节伺服）。
    const decodePageRgba = (p: PageMip): Uint8ClampedArray | null => {
      let d = p.data
      if (p.isLz4 === 1) { const raw = lz4Decompress(d, p.dec); if (raw === null) return null; d = raw }
      return kind === 'raw' ? decodeRawPixels(format, p.w, p.h, d) : null
    }

    // 多页序列帧：帧引用不同 image 页（page>0）→ 把所有 raw 页纵向拼成一张图集，
    // 每帧矩形按其所属页的 y 偏移重映射，使渲染端"单图裁剪"模型可用。
    const multiPage = kind === 'raw' && pages.length > 1 && parsedFrames !== null && parsedFrames.some((f) => f.page > 0)
    let w: number
    let h: number
    let rgba: Uint8ClampedArray | null
    let data: Uint8Array
    let frames: TexFrameData[] | null = null
    if (multiPage && parsedFrames !== null) {
      const pageRgba = pages.map(decodePageRgba)
      if (pageRgba.some((r) => r === null)) return null
      w = Math.max(...pages.map((p) => p.w))
      const yOff: number[] = []
      let acc = 0
      for (const p of pages) { yOff.push(acc); acc += p.h }
      h = acc
      rgba = new Uint8ClampedArray(w * h * 4)
      for (let i = 0; i < pages.length; i++) {
        const pr = pageRgba[i] as Uint8ClampedArray
        const pw = pages[i].w
        const ph = pages[i].h
        for (let y = 0; y < ph; y++) rgba.set(pr.subarray(y * pw * 4, (y + 1) * pw * 4), (yOff[i] + y) * w * 4)
      }
      data = page0.data
      frames = parsedFrames.map((f) => ({ x: f.x, y: f.y + (f.page < yOff.length ? yOff[f.page] : 0), w: f.w, h: f.h, t: f.t }))
    } else {
      const p0 = pages[0]
      w = p0.w
      h = p0.h
      let d = p0.data
      if (p0.isLz4 === 1) { const raw = lz4Decompress(d, p0.dec); if (raw === null) return null; d = raw }
      data = d
      rgba = kind === 'raw' ? decodeRawPixels(format, w, h, d) : null
      if (kind === 'raw' && rgba === null) return null
      frames = parsedFrames === null ? null : parsedFrames.map((f) => ({ x: f.x, y: f.y, w: f.w, h: f.h, t: f.t }))
    }

    // 丢弃"空帧"：矩形越界、或采样区域几乎全透明（alpha≈0）的帧。
    // WE 的 TEXS 偶有越界/占位垃圾帧（如昼夜壁纸夜空序列里混入的透明帧），
    // 若照常播放会让图层在该帧瞬间变透明 → 下层画面闪出（表现为"白天/黑夜快速衔接"）。
    // 通用判定（不针对具体壁纸）：按步长采样帧矩形内像素 alpha，不透明占比 < 5% 即视为空帧剔除。
    if (frames !== null) {
      const isBlankFrame = (fr: TexFrameData): boolean => {
        if (rgba === null) return false
        if (fr.x < 0 || fr.y < 0 || fr.x + fr.w > w || fr.y + fr.h > h) return true
        let opaque = 0
        let total = 0
        for (let y = 0; y < fr.h; y += 3) {
          for (let x = 0; x < fr.w; x += 3) {
            const s = ((fr.y + y) * w + (fr.x + x)) * 4
            if (rgba[s + 3] > 16) opaque++
            total++
          }
        }
        return total === 0 || opaque / total < 0.05
      }
      const kept = frames.filter((fr) => !isBlankFrame(fr))
      frames = kept.length > 1 ? kept : null
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
      frames,
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
