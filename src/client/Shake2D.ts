/**
 * Shake2D —— shake 效果的 Canvas2D 回退实现（WebGL 不可用时）。
 *
 * 语义与 `ShakeGL` 一致（逐像素 UV 位移 + 不透明度 mask 混合），
 * 只是用 ImageData 在 CPU 上双线性采样。为控制每帧开销：
 *   - 图层像素数 ≤ SHAKE_2D_PIXEL_BUDGET 时逐像素精确位移；
 *   - 超过预算的大图层先缩小到预算内，仍按每个位置的方向场形变，再放回原尺寸。
 *     不能用平均方向平移整层，否则头发的局部卷曲会变成人物整体滑动。
 * 纯图像处理，无 WebGL 依赖，也不触碰模块级可变状态。
 */

/** 逐像素位移的像素预算（约 1.5MP：单帧 CPU 采样约几毫秒） */
export const SHAKE_2D_PIXEL_BUDGET = 1_500_000

export interface Shake2DInput {
  /** 图层纹理（内容区左上角为原点，尺寸 sw×sh） */
  src: CanvasImageSource
  sw: number
  sh: number
  /** 方向场纹理（g_Texture1）；解码语义：x = .r，y = .a（RG88）或 .g（RGBA） */
  flow: CanvasImageSource | null
  flowYFromAlpha: boolean
  /** 不透明度 mask（g_Texture3）；解码语义：值 = .a（R8）或 .r（RGBA）；null = 无 MASK combo */
  mask: CanvasImageSource | null
  maskFromAlpha: boolean
  /** 官方标量位移系数（shake-math.shakeOffset） */
  offset: number
  /** scene.json 的 strength（位移 = offset × strength² × flowMask） */
  strength: number
  /** 方向场/mask 的内容尺寸（不包含 .tex 画布未用边距） */
  rects?: { flow?: { w: number; h: number }; mask?: { w: number; h: number } }
}

interface Raster {
  data: Uint8ClampedArray
  w: number
  h: number
}

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w))
  c.height = Math.max(1, Math.round(h))
  return c
}

function readPixels(src: CanvasImageSource, sw: number, sh: number, w: number, h: number): Raster | null {
  const c = makeCanvas(w, h)
  const g = c.getContext('2d')
  if (g === null) return null
  try {
    // 按内容区域裁剪再缩放到图层像素尺寸（.tex 画布常带未用边距）
    g.drawImage(src, 0, 0, sw, sh, 0, 0, c.width, c.height)
    const img = g.getImageData(0, 0, c.width, c.height)
    return { data: img.data, w: c.width, h: c.height }
  } catch {
    return null // 跨域污染等
  }
}

/** 纹理的完整画布尺寸（用于内容区域裁剪） */
function texSize(src: CanvasImageSource): [number, number] {
  const o = src as { width?: number; height?: number; naturalWidth?: number; naturalHeight?: number }
  const w = o.naturalWidth ?? o.width ?? 0
  const h = o.naturalHeight ?? o.height ?? 0
  return [w, h]
}

/** 双线性采样单通道（ch = 0..3） */
function sampleChannel(r: Raster, u: number, v: number, ch: number): number {
  const x = Math.min(r.w - 1, Math.max(0, u * r.w - 0.5))
  const y = Math.min(r.h - 1, Math.max(0, v * r.h - 0.5))
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const fx = x - x0
  const fy = y - y0
  const x1 = Math.min(r.w - 1, x0 + 1)
  const y1 = Math.min(r.h - 1, y0 + 1)
  const a = r.data[(y0 * r.w + x0) * 4 + ch] * (1 - fx) + r.data[(y0 * r.w + x1) * 4 + ch] * fx
  const b = r.data[(y1 * r.w + x0) * 4 + ch] * (1 - fx) + r.data[(y1 * r.w + x1) * 4 + ch] * fx
  return a * (1 - fy) + b * fy
}

/** 双线性采样 RGBA → out[0..3]（0..255） */
function sampleRGBA(r: Raster, u: number, v: number, out: Float32Array): void {
  const x = Math.min(r.w - 1, Math.max(0, u * r.w - 0.5))
  const y = Math.min(r.h - 1, Math.max(0, v * r.h - 0.5))
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const fx = x - x0
  const fy = y - y0
  const x1 = Math.min(r.w - 1, x0 + 1)
  const y1 = Math.min(r.h - 1, y0 + 1)
  for (let c = 0; c < 4; c++) {
    const a = r.data[(y0 * r.w + x0) * 4 + c] * (1 - fx) + r.data[(y0 * r.w + x1) * 4 + c] * fx
    const b = r.data[(y1 * r.w + x0) * 4 + c] * (1 - fx) + r.data[(y1 * r.w + x1) * 4 + c] * fx
    out[c] = a * (1 - fy) + b * fy
  }
}

/** 官方 `flowMask = (rg - 0.498) * 2`（u/v 为图层 UV） */
function flowMaskAt(flow: Raster, u: number, v: number, yFromAlpha: boolean, out: Float32Array): void {
  const chY = yFromAlpha ? 3 : 1
  out[0] = (sampleChannel(flow, u, v, 0) / 255 - 0.498) * 2
  out[1] = (sampleChannel(flow, u, v, chY) / 255 - 0.498) * 2
}

/** mask×方向场加权的平均 flowMask（仅用于诊断，不能替代局部形变；32×32 采样） */
export function shakeMeanFlow(flow: Raster, mask: Raster | null, yFromAlpha: boolean, maskFromAlpha: boolean): [number, number] {
  const S = 32
  const f = new Float32Array(2)
  let sx = 0
  let sy = 0
  for (let j = 0; j < S; j++) {
    for (let i = 0; i < S; i++) {
      const u = (i + 0.5) / S
      const v = (j + 0.5) / S
      flowMaskAt(flow, u, v, yFromAlpha, f)
      const m = mask !== null ? sampleChannel(mask, u, v, maskFromAlpha ? 3 : 0) / 255 : 1
      sx += f[0] * m
      sy += f[1] * m
    }
  }
  return [sx / (S * S), sy / (S * S)]
}

/** 应用 shake：返回新 canvas；无方向场 / 无法读像素时返回 null（调用方画原图）。 */
export function applyShake2D(input: Shake2DInput): HTMLCanvasElement | null {
  const { src, sw, sh, flow, mask } = input
  if (flow === null || sw < 1 || sh < 1) return null
  const out = makeCanvas(sw, sh)
  const g = out.getContext('2d')
  if (g === null) return null
  if (input.offset === 0 || input.strength === 0) {
    g.drawImage(src, 0, 0, sw, sh, 0, 0, out.width, out.height)
    return out
  }
  const scale = Math.min(1, Math.sqrt(SHAKE_2D_PIXEL_BUDGET / (out.width * out.height)))
  const w = Math.max(1, Math.min(SHAKE_2D_PIXEL_BUDGET, Math.floor(out.width * scale)))
  const h = Math.max(1, Math.min(Math.floor(SHAKE_2D_PIXEL_BUDGET / w), Math.floor(out.height * scale)))
  const srcR = readPixels(src, sw, sh, w, h)
  const flowR = readPixels(flow, input.rects?.flow?.w ?? (texSize(flow)[0] || w), input.rects?.flow?.h ?? (texSize(flow)[1] || h), w, h)
  if (srcR === null || flowR === null) return null
  const maskR = mask !== null ? readPixels(mask, input.rects?.mask?.w ?? (texSize(mask)[0] || w), input.rects?.mask?.h ?? (texSize(mask)[1] || h), w, h) : null
  if (mask !== null && maskR === null) return null
  const amp = input.strength * input.strength
  const off = input.offset
  const maskCh = input.maskFromAlpha ? 3 : 0

  const img = g.createImageData(w, h)
  const dst = img.data
  const sampled = new Float32Array(4)
  const f = new Float32Array(2)
  for (let y = 0; y < h; y++) {
    const v = (y + 0.5) / h
    for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / w
      const i = (y * w + x) * 4
      flowMaskAt(flowR, u, v, input.flowYFromAlpha, f)
      const tox = off * amp * f[0]
      const toy = off * amp * f[1]
      if (tox === 0 && toy === 0) {
        dst[i] = srcR.data[i]
        dst[i + 1] = srcR.data[i + 1]
        dst[i + 2] = srcR.data[i + 2]
        dst[i + 3] = srcR.data[i + 3]
        continue
      }
      sampleRGBA(srcR, u + tox, v + toy, sampled)
      const m = maskR !== null ? sampleChannel(maskR, u + tox, v + toy, maskCh) / 255 : 1
      dst[i] = srcR.data[i] * (1 - m) + sampled[0] * m
      dst[i + 1] = srcR.data[i + 1] * (1 - m) + sampled[1] * m
      dst[i + 2] = srcR.data[i + 2] * (1 - m) + sampled[2] * m
      dst[i + 3] = srcR.data[i + 3] * (1 - m) + sampled[3] * m
    }
  }
  if (w === out.width && h === out.height) {
    g.putImageData(img, 0, 0)
  } else {
    const scaled = makeCanvas(w, h)
    const sg = scaled.getContext('2d')
    if (sg === null) return null
    sg.putImageData(img, 0, 0)
    g.drawImage(scaled, 0, 0, out.width, out.height)
  }
  return out
}
