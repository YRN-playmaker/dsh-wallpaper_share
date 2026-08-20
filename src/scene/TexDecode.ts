/**
 * TEX 纹理块解码器（Phase 2a）—— 纯算法，node 半与浏览器半通用。
 *
 * 只负责把压缩块解码为 RGBA 像素，不关心 TEX 容器头部（见 SceneTex.ts）。
 * 算法为公开事实（Khronos/BC 规范），自研实现，无任何 GPL 代码。
 *
 * 支持：RGBA8888 / DXT1(BC1) / DXT5(BC3) / RGBA16F / R16F / L8(灰度)
 * BC7 尚未实现（需分区表常量，待表格来源确认后加入，见 TODO）。
 */

export type TexPixelFormat = 'rgba8888' | 'dxt1' | 'dxt3' | 'dxt5' | 'bc7' | 'rgba16f' | 'r16f' | 'l8' | 'r8' | 'rg88'

/** 从 4×4 块解码一整个 mip（宽高任意，块不足补边处按块边界取整） */
export function decodeMip(
  format: TexPixelFormat,
  data: Uint8Array,
  dataOffset: number,
  width: number,
  height: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4)
  switch (format) {
    case 'rgba8888': {
      // 逐像素直接拷贝
      for (let i = 0; i < width * height; i++) {
        const s = dataOffset + i * 4
        out[i * 4] = data[s]
        out[i * 4 + 1] = data[s + 1]
        out[i * 4 + 2] = data[s + 2]
        out[i * 4 + 3] = data[s + 3]
      }
      return out
    }
    case 'rgba16f': {
      for (let i = 0; i < width * height; i++) {
        const s = dataOffset + i * 8
        out[i * 4] = halfToByte(data, s)
        out[i * 4 + 1] = halfToByte(data, s + 2)
        out[i * 4 + 2] = halfToByte(data, s + 4)
        out[i * 4 + 3] = halfToByte(data, s + 6)
      }
      return out
    }
    case 'r16f': {
      for (let i = 0; i < width * height; i++) {
        const v = halfToByte(data, dataOffset + i * 2)
        out[i * 4] = v; out[i * 4 + 1] = v; out[i * 4 + 2] = v; out[i * 4 + 3] = 255
      }
      return out
    }
    case 'l8': {
      for (let i = 0; i < width * height; i++) {
        const v = data[dataOffset + i]
        out[i * 4] = v; out[i * 4 + 1] = v; out[i * 4 + 2] = v; out[i * 4 + 3] = 255
      }
      return out
    }
    case 'r8': {
      // 单通道 8 位 → alpha 通道（雾/粒子纹理：rgb=白，a=灰度）
      for (let i = 0; i < width * height; i++) {
        const v = data[dataOffset + i]
        out[i * 4] = 255; out[i * 4 + 1] = 255; out[i * 4 + 2] = 255; out[i * 4 + 3] = v
      }
      return out
    }
    case 'rg88': {
      // 双通道 8 位（R,G）：R 通道作 alpha（雾/粒子纹理）
      for (let i = 0; i < width * height; i++) {
        const v = data[dataOffset + i * 2]
        out[i * 4] = 255; out[i * 4 + 1] = 255; out[i * 4 + 2] = 255; out[i * 4 + 3] = v
      }
      return out
    }
    case 'dxt1': {
      const bw = Math.max(1, Math.ceil(width / 4))
      const bh = Math.max(1, Math.ceil(height / 4))
      for (let by = 0; by < bh; by++) {
        for (let bx = 0; bx < bw; bx++) {
          const blockOffset = dataOffset + (by * bw + bx) * 8
          if (blockOffset + 8 > data.length) break
          decodeDxt1Block(data, blockOffset, out, bx * 4, by * 4, width, height)
        }
      }
      return out
    }
    case 'dxt5': {
      const bw = Math.max(1, Math.ceil(width / 4))
      const bh = Math.max(1, Math.ceil(height / 4))
      for (let by = 0; by < bh; by++) {
        for (let bx = 0; bx < bw; bx++) {
          const blockOffset = dataOffset + (by * bw + bx) * 16
          if (blockOffset + 16 > data.length) break
          decodeDxt5Block(data, blockOffset, out, bx * 4, by * 4, width, height)
        }
      }
      return out
    }
    case 'dxt3': {
      const bw = Math.max(1, Math.ceil(width / 4))
      const bh = Math.max(1, Math.ceil(height / 4))
      for (let by = 0; by < bh; by++) {
        for (let bx = 0; bx < bw; bx++) {
          const blockOffset = dataOffset + (by * bw + bx) * 16
          if (blockOffset + 16 > data.length) break
          decodeDxt3Block(data, blockOffset, out, bx * 4, by * 4, width, height)
        }
      }
      return out
    }
    case 'bc7':
      throw new Error('BC7 decode not implemented yet')
  }
}

/** 单个 DXT1 块（8 字节）解码到输出（px,py 为该块左上角） */
export function decodeDxt1Block(
  data: Uint8Array,
  off: number,
  out: Uint8ClampedArray,
  px: number,
  py: number,
  width: number,
  height: number,
): void {
  const c0v = data[off] | (data[off + 1] << 8)
  const c1v = data[off + 2] | (data[off + 3] << 8)
  const c0 = rgb565(c0v)
  const c1 = rgb565(c1v)
  let c2: [number, number, number]
  let c3: [number, number, number]
  let transparent = false
  if (c0v > c1v) {
    c2 = [Math.round((2 * c0[0] + c1[0]) / 3), Math.round((2 * c0[1] + c1[1]) / 3), Math.round((2 * c0[2] + c1[2]) / 3)]
    c3 = [Math.round((c0[0] + 2 * c1[0]) / 3), Math.round((c0[1] + 2 * c1[1]) / 3), Math.round((c0[2] + 2 * c1[2]) / 3)]
  } else {
    c2 = [Math.round((c0[0] + c1[0]) / 2), Math.round((c0[1] + c1[1]) / 2), Math.round((c0[2] + c1[2]) / 2)]
    c3 = [0, 0, 0]
    transparent = true
  }
  for (let y = 0; y < 4; y++) {
    const row = data[off + 4 + y]
    for (let x = 0; x < 4; x++) {
      const idx = (row >> (x * 2)) & 3
      const tx = px + x
      const ty = py + y
      if (tx >= width || ty >= height) continue
      let r: number, g: number, b: number, a = 255
      if (idx === 0) { r = c0[0]; g = c0[1]; b = c0[2] }
      else if (idx === 1) { r = c1[0]; g = c1[1]; b = c1[2] }
      else if (idx === 2) { r = c2[0]; g = c2[1]; b = c2[2] }
      else { r = c3[0]; g = c3[1]; b = c3[2]; if (transparent) a = 0 }
      const o = (ty * width + tx) * 4
      out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = a
    }
  }
}

/** 单个 DXT5 块（16 字节）解码 */
export function decodeDxt5Block(
  data: Uint8Array,
  off: number,
  out: Uint8ClampedArray,
  px: number,
  py: number,
  width: number,
  height: number,
): void {
  const a0 = data[off]
  const a1 = data[off + 1]
  const alphas: number[] = [a0, a1]
  if (a0 > a1) {
    for (let i = 2; i < 8; i++) alphas[i] = Math.round(((8 - i) * a0 + (i - 1) * a1) / 7)
  } else {
    for (let i = 2; i < 6; i++) alphas[i] = Math.round(((6 - i) * a0 + (i - 1) * a1) / 5)
    alphas[6] = 0
    alphas[7] = 255
  }
  // alpha 索引：48 位（每像素 3 位），从 off+2 起连续打包
  const alphaIdx: number[] = []
  for (let p = 0; p < 16; p++) {
    const bit = p * 3
    const byte = off + 2 + (bit >> 3)
    const shift = bit & 7
    const lo = data[byte]
    const hi = byte + 1 < data.length ? data[byte + 1] : 0
    alphaIdx.push(((lo | (hi << 8)) >> shift) & 7)
  }
  // 颜色：DXT1 4 色模式
  const c0v = data[off + 8] | (data[off + 9] << 8)
  const c1v = data[off + 10] | (data[off + 11] << 8)
  const c0 = rgb565(c0v)
  const c1 = rgb565(c1v)
  const c2: [number, number, number] = [Math.round((2 * c0[0] + c1[0]) / 3), Math.round((2 * c0[1] + c1[1]) / 3), Math.round((2 * c0[2] + c1[2]) / 3)]
  const c3: [number, number, number] = [Math.round((c0[0] + 2 * c1[0]) / 3), Math.round((c0[1] + 2 * c1[1]) / 3), Math.round((c0[2] + 2 * c1[2]) / 3)]
  for (let y = 0; y < 4; y++) {
    const row = data[off + 12 + y]
    for (let x = 0; x < 4; x++) {
      const ci = (row >> (x * 2)) & 3
      const tx = px + x
      const ty = py + y
      if (tx >= width || ty >= height) continue
      let r: number, g: number, b: number
      if (ci === 0) { r = c0[0]; g = c0[1]; b = c0[2] }
      else if (ci === 1) { r = c1[0]; g = c1[1]; b = c1[2] }
      else if (ci === 2) { r = c2[0]; g = c2[1]; b = c2[2] }
      else { r = c3[0]; g = c3[1]; b = c3[2] }
      const o = (ty * width + tx) * 4
      const a = alphas[alphaIdx[y * 4 + x]]
      out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = a
    }
  }
}

/** 单个 DXT3 块（16 字节）：8 字节 4-bit alpha + DXT1 4-color 颜色 */
export function decodeDxt3Block(
  data: Uint8Array,
  off: number,
  out: Uint8ClampedArray,
  px: number,
  py: number,
  width: number,
  height: number,
): void {
  // alpha：每像素 4 位（16 像素 = 64 位 = 8 字节），每像素 alpha = nibble * 17
  const c0v = data[off + 8] | (data[off + 9] << 8)
  const c1v = data[off + 10] | (data[off + 11] << 8)
  const c0 = rgb565(c0v)
  const c1 = rgb565(c1v)
  // DXT3 颜色始终为 4 色模式
  const c2: [number, number, number] = [Math.round((2 * c0[0] + c1[0]) / 3), Math.round((2 * c0[1] + c1[1]) / 3), Math.round((2 * c0[2] + c1[2]) / 3)]
  const c3: [number, number, number] = [Math.round((c0[0] + 2 * c1[0]) / 3), Math.round((c0[1] + 2 * c1[1]) / 3), Math.round((c0[2] + 2 * c1[2]) / 3)]
  for (let y = 0; y < 4; y++) {
    const row = data[off + 12 + y]
    const alphaRow = data[off + y * 2] | (data[off + y * 2 + 1] << 8)
    for (let x = 0; x < 4; x++) {
      const ci = (row >> (x * 2)) & 3
      const tx = px + x
      const ty = py + y
      if (tx >= width || ty >= height) continue
      let r: number, g: number, b: number
      if (ci === 0) { r = c0[0]; g = c0[1]; b = c0[2] }
      else if (ci === 1) { r = c1[0]; g = c1[1]; b = c1[2] }
      else if (ci === 2) { r = c2[0]; g = c2[1]; b = c2[2] }
      else { r = c3[0]; g = c3[1]; b = c3[2] }
      const a = ((alphaRow >> (x * 4)) & 0x0f) * 17
      const o = (ty * width + tx) * 4
      out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = a
    }
  }
}

/** RGB565 → [r,g,b] 0-255 */
function rgb565(v: number): [number, number, number] {
  return [
    Math.round(((v >> 11) & 0x1f) * 255 / 31),
    Math.round(((v >> 5) & 0x3f) * 255 / 63),
    Math.round((v & 0x1f) * 255 / 31),
  ]
}

/** IEEE 754 半精度浮点 → 0-255 字节 */
function halfToByte(data: Uint8Array, off: number): number {
  const h = data[off] | (data[off + 1] << 8)
  const sign = (h >> 15) & 1
  const exp = (h >> 10) & 0x1f
  const mant = h & 0x3ff
  let f: number
  if (exp === 0) f = mant * 2 ** -24
  else if (exp === 31) f = mant === 0 ? Infinity : NaN
  else f = (1 + mant / 1024) * 2 ** (exp - 15)
  if (sign) f = -f
  if (!Number.isFinite(f)) return 0
  const v = Math.round(f * 255)
  return v < 0 ? 0 : v > 255 ? 255 : v
}
