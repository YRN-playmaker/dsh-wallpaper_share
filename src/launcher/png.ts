/**
 * 最小 PNG 编码器（launcher 兜底预览卡）：纯 node:zlib，零依赖。
 * 只服务一条链路：launcher 安装完成而客户端没有回传 canvas 预览时，
 * 服务端本地合成一张渐变卡（无文字渲染能力，客户端版才有标题字）。
 * 输入 RGBA 像素 → 输出合法 PNG 字节（color type 6, 8bit, filter 0）。
 */
import { deflateSync } from 'node:zlib'

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = (c & 1) !== 0 ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
    t[n] = c >>> 0
  }
  return t
})()

function crc32(bytes: Uint8Array): number {
  let c = 0xFFFFFFFF
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 0xFF]! ^ (c >>> 8)
  return (c ^ 0xFFFFFFFF) >>> 0
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length, false)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(data, 8)
  // CRC 覆盖 type + data
  const crcInput = out.subarray(4, 8 + data.length)
  view.setUint32(8 + data.length, crc32(crcInput), false)
  return out
}

/** RGBA 像素 → PNG 字节。rgba.length 必须 === width*height*4。 */
export function encodePngRgba(width: number, height: number, rgba: Uint8Array): Uint8Array {
  if (rgba.length !== width * height * 4) throw new Error(`PNG 编码失败: 像素长度不符 (期望 ${width * height * 4}, 实得 ${rgba.length})`)
  // 每行前置 filter byte 0（None）
  const stride = width * 4
  const raw = new Uint8Array((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1)
  }
  const ihdr = new Uint8Array(13)
  const iv = new DataView(ihdr.buffer)
  iv.setUint32(0, width, false)
  iv.setUint32(4, height, false)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  // compression/filter/interlace 均为 0（默认填充）
  const sig = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
  const idat = new Uint8Array(deflateSync(Buffer.from(raw)))
  return new Uint8Array(Buffer.concat([
    Buffer.from(sig),
    Buffer.from(chunk('IHDR', ihdr)),
    Buffer.from(chunk('IDAT', idat)),
    Buffer.from(chunk('IEND', new Uint8Array(0))),
  ]))
}

/** hsl(0..360, 0..1, 0..1) → [r,g,b] 0..255 */
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const hp = ((h % 360) + 360) % 360 / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  let r = 0, g = 0, b = 0
  if (hp < 1) { r = c; g = x } else if (hp < 2) { r = x; g = c } else if (hp < 3) { g = c; b = x } else if (hp < 4) { g = x; b = c } else if (hp < 5) { r = x; b = c } else { r = c; b = x }
  const m = l - c / 2
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)]
}

function hashHue(text: string): number {
  let h = 0
  for (let i = 0; i < text.length; i++) h = ((h * 31) + text.charCodeAt(i)) >>> 0
  return h % 360
}

/**
 * 服务端兜底预览卡：640x360 渐变底 + 大圆形徽章（按标题 hash 取色）。
 * 无文字（服务端没有字体栈）；客户端安装流程默认会回传带标题的 canvas 卡覆盖它。
 */
export function fallbackCardPng(title: string, width = 640, height = 360): Uint8Array {
  const hue = hashHue(title)
  const [r1, g1, b1] = hslToRgb(hue, 0.55, 0.22)
  const [r2, g2, b2] = hslToRgb(hue + 40, 0.6, 0.42)
  const rgba = new Uint8Array(width * height * 4)
  const cx = width * 0.5
  const cy = height * 0.44
  const rad = Math.min(width, height) * 0.30
  for (let y = 0; y < height; y++) {
    const ty = y / height
    for (let x = 0; x < width; x++) {
      const tx = x / width
      // 对角渐变
      const k = (tx * 0.6 + ty * 0.4)
      let r = Math.round(r1 + (r2 - r1) * k)
      let g = Math.round(g1 + (g2 - g1) * k)
      let b = Math.round(b1 + (b2 - b1) * k)
      // 徽章：圆形内提亮，边缘 2px 抗锯齿
      const dx = x - cx, dy = y - cy
      const dist = Math.sqrt(dx * dx + dy * dy)
      const alpha = Math.min(1, Math.max(0, (rad - dist) / 2))
      if (alpha > 0) {
        r = Math.round(r * (1 - alpha) + Math.min(255, r + 60) * alpha)
        g = Math.round(g * (1 - alpha) + Math.min(255, g + 60) * alpha)
        b = Math.round(b * (1 - alpha) + Math.min(255, b + 60) * alpha)
      }
      const o = (y * width + x) * 4
      rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; rgba[o + 3] = 255
    }
  }
  return encodePngRgba(width, height, rgba)
}
