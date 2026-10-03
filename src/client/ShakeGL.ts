/**
 * ShakeGL —— shake 效果的 WebGL 逐像素实现（官方 shader 的数学等价版本）。
 *
 * 许可说明：Wallpaper Engine 官方效果（闭源商业资产）仅作**黑盒行为参考**；
 * 本 shader 为独立编写的等价实现（UV 位移 = 标量波形 × 强度² × 方向场，
 * 再按不透明度 mask 与原图混合——通用数学事实，不受版权保护）。
 * 不复制官方源码，也未包含 linux-wallpaperengine（GPL）代码。
 *
 * 官方 `shaders/effects/shake.frag` 行为（见 src/client/shake-math.ts 的推导）：
 *   flowMask      = (flow.rg - 0.498) * 2          // g_Texture1 = 方向场（flowmask）
 *   texCoordOffset = offset * strength² * flowMask
 *   color         = src(uv + texCoordOffset)
 *   mask          = g_Texture3(uv + texCoordOffset).r   // 不透明度 mask（MASK combo）
 *   color         = mix(src(uv), color, mask)
 *
 * 本实现要点：
 *   - 方向场按原始 UV 采样，不透明度 mask 按位移后的 UV 采样；
 *   - 纹理不翻转上传，在 shader 中显式转换画布与图像的 y 方向；
 *   - 静态图层/方向场/mask 缓存，串联 pass 的 canvas 输入每帧重新上传。
 */

export interface ShakeGLParams {
  /** 官方标量位移系数（由 shake-math.shakeOffset 计算，0..1 脉冲或 -1..1 摆动） */
  offset: number
  /** scene.json 的 strength（位移 = offset × strength² × flowMask） */
  strength: number
}

/** 纹理的内容区域（image 尺寸）：.tex 画布常带未用边距（如 256×384 画布 / 201×355 图像） */
export interface ShakeTexRect {
  w: number
  h: number
}

const VERT_SRC = `
attribute vec2 a_Pos;
varying vec2 v_UV;
void main() {
  gl_Position = vec4(a_Pos, 0.0, 1.0);
  v_UV = a_Pos * 0.5 + 0.5;
}
`

const FRAG_SRC = `
precision highp float;
// 独立实现的 shake（UV 位移 + 不透明度 mask 混合），行为参考官方效果（黑盒观察）。
uniform sampler2D u_Src;
uniform sampler2D u_Flow;
uniform sampler2D u_Mask;
uniform float u_UseMask;
uniform float u_FlowYFromAlpha;   // 方向场 y 分量取自 A 通道（RG88 解码语义）
uniform float u_MaskFromAlpha;    // mask 值取自 A 通道（R8 解码语义）
uniform float u_Offset;
uniform float u_Amp;
// 各纹理内容区域比例（image 尺寸 / 画布尺寸）：图层 UV → 纹理 UV
uniform vec2 u_SrcRect;
uniform vec2 u_FlowRect;
uniform vec2 u_MaskRect;
varying vec2 v_UV;

// 图层 UV（内容区 0..1）→ 纹理 UV（纹理不做翻转上传：v=0 = 图像第一行）
vec2 rectUv(vec2 imgUv, vec2 rect) {
  return imgUv * rect;
}

void main() {
  // 纹理按「不做翻转」上传（UNPACK_FLIP_Y_WEBGL = 0）：
  // 纹理 v=0 对应图像第一行（上）→ 这里显式把画布 UV（y 向上）转成图像 UV（y 向下）。
  // 不能依赖 UNPACK_FLIP_Y_WEBGL：ImageBitmap 源（本渲染器的图层纹理）在 Chrome 里
  // 会被忽略、canvas 源会被应用，两者不一致（实测）。
  vec2 imgUv = vec2(v_UV.x, 1.0 - v_UV.y);
  vec4 f = texture2D(u_Flow, rectUv(imgUv, u_FlowRect));
  float fy = u_FlowYFromAlpha > 0.5 ? f.a : f.g;
  vec2 flowMask = (vec2(f.r, fy) - vec2(0.498)) * 2.0;
  vec2 texOffset = u_Offset * u_Amp * u_Amp * flowMask;
  // 官方语义：位移量在图像空间（y 向下）叠加
  vec2 sImg = imgUv + texOffset;
  vec4 base = texture2D(u_Src, rectUv(imgUv, u_SrcRect));
  vec4 shaken = texture2D(u_Src, rectUv(sImg, u_SrcRect));
  if (u_UseMask > 0.5) {
    vec4 m = texture2D(u_Mask, rectUv(sImg, u_MaskRect));
    float mv = u_MaskFromAlpha > 0.5 ? m.a : m.r;
    gl_FragColor = mix(base, shaken, mv);
  } else {
    gl_FragColor = shaken;
  }
}
`

/** 内容区域比例 = image 尺寸 / 纹理画布尺寸（未给出时视为整张纹理 = 1） */
function rectRatio(rect: ShakeTexRect | undefined, tex: TexImageSource): [number, number] {
  const tw = (tex as { width?: number }).width ?? 0
  const th = (tex as { height?: number }).height ?? 0
  if (rect === undefined || tw <= 0 || th <= 0) return [1, 1]
  return [Math.min(1, rect.w / tw), Math.min(1, rect.h / th)]
}

export class ShakeGL {
  private canvas: HTMLCanvasElement | null = null
  private gl: WebGLRenderingContext | null = null
  private prog: WebGLProgram | null = null
  private locs: Record<string, WebGLUniformLocation | null> = {}
  private vbo: WebGLBuffer | null = null
  private texCache = new Map<string, WebGLTexture>()
  private curW = 0
  private curH = 0
  private lost = false
  private lostLogged = false
  private loseExt: WEBGL_lose_context | null = null
  private lastRestoreAt = 0

  /** WebGL 是否可用（惰性缓存，避免每次访问都新建探针上下文） */
  private static cachedAvailable: boolean | null = null
  static get available(): boolean {
    if (ShakeGL.cachedAvailable === null) {
      try {
        const c = document.createElement('canvas')
        ShakeGL.cachedAvailable = !!(c.getContext('webgl') || c.getContext('experimental-webgl'))
      } catch {
        ShakeGL.cachedAvailable = false
      }
    }
    return ShakeGL.cachedAvailable
  }

  private ensure(): boolean {
    if (this.gl !== null && this.prog !== null && !this.lost) return true
    if (this.lost) {
      const now = performance.now()
      if (this.canvas !== null && this.loseExt !== null && now - this.lastRestoreAt > 1000) {
        this.lastRestoreAt = now
        try { this.loseExt.restoreContext() } catch { /* 恢复失败：下一轮重试 */ }
      }
      return false
    }
    try {
      const c = this.canvas ?? document.createElement('canvas')
      const gl = (c.getContext('webgl') || c.getContext('experimental-webgl')) as WebGLRenderingContext | null
      if (gl === null) return false
      this.canvas = c
      this.gl = gl
      this.loseExt = gl.getExtension('WEBGL_lose_context')
      c.addEventListener('webglcontextlost', (e) => {
        e.preventDefault()
        this.lost = true
        if (!this.lostLogged) {
          this.lostLogged = true
          console.warn('[shake:GL] 上下文丢失，原地恢复中…')
        }
      })
      c.addEventListener('webglcontextrestored', () => {
        this.lost = false
        this.lostLogged = false
        this.texCache.clear()
        this.prog = null
        this.vbo = null
        console.warn('[shake:GL] 上下文已恢复')
      })
      const compile = (type: number, src: string): WebGLShader | null => {
        const sh = gl.createShader(type)
        if (sh === null) return null
        gl.shaderSource(sh, src)
        gl.compileShader(sh)
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
          console.warn('shake shader: ' + gl.getShaderInfoLog(sh))
          return null
        }
        return sh
      }
      const vs = compile(gl.VERTEX_SHADER, VERT_SRC)
      const fs = compile(gl.FRAGMENT_SHADER, FRAG_SRC)
      if (vs === null || fs === null) return false
      const prog = gl.createProgram()
      if (prog === null) return false
      gl.attachShader(prog, vs)
      gl.attachShader(prog, fs)
      gl.linkProgram(prog)
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return false
      this.prog = prog
      gl.useProgram(prog)
      for (const name of ['u_Src', 'u_Flow', 'u_Mask', 'u_UseMask', 'u_FlowYFromAlpha', 'u_MaskFromAlpha', 'u_Offset', 'u_Amp', 'u_SrcRect', 'u_FlowRect', 'u_MaskRect']) {
        this.locs[name] = gl.getUniformLocation(prog, name)
      }
      const aPos = gl.getAttribLocation(prog, 'a_Pos')
      this.vbo = gl.createBuffer()
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo)
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
      gl.enableVertexAttribArray(aPos)
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)
      return true
    } catch {
      return false
    }
  }

  private uploadTexture(key: string, src: TexImageSource): WebGLTexture | null {
    const gl = this.gl
    if (gl === null) return null
    const hit = this.texCache.get(key)
    // 多 pass 的输入是上一 pass 的 canvas，画布对象不变但像素每帧都变。
    // 只缓存纹理对象，不能把第一次上传的画面永久当作后续 pass 的输入。
    const dynamic = (typeof HTMLCanvasElement !== 'undefined' && src instanceof HTMLCanvasElement)
      || (typeof OffscreenCanvas !== 'undefined' && src instanceof OffscreenCanvas)
    if (hit !== undefined && !dynamic) return hit
    const tex = hit ?? gl.createTexture()
    if (tex === null) return null
    gl.bindTexture(gl.TEXTURE_2D, tex)
    // 统一「不做翻转」上传：ImageBitmap 源的 FLIP_Y 在 Chrome 里会被忽略，
    // 依赖它会导致输出上下颠倒；方向转换在着色器里显式完成。
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0)
    // 解码后的 mask PNG 带 alpha：不预乘，保证方向场两个通道可读
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    this.texCache.set(key, tex)
    return tex
  }

  /**
   * 渲染 shake 到离屏 WebGL canvas。
   * @param src           图层纹理（或 spritesheet 当前帧）
   * @param flow          方向场纹理（g_Texture1；null = 无 → 视为无位移场，直接返回原图）
   * @param flowYFromAlpha 方向场 y 分量是否在 A 通道（RG88 解码后 .r/.a）
   * @param mask          不透明度 mask（g_Texture3；null = 无 MASK combo）
   * @param maskFromAlpha mask 值是否在 A 通道（R8 解码后）
   */
  render(
    src: TexImageSource,
    w: number,
    h: number,
    flow: TexImageSource | null,
    flowYFromAlpha: boolean,
    mask: TexImageSource | null,
    maskFromAlpha: boolean,
    params: ShakeGLParams,
    key: string,
    rects?: { src?: ShakeTexRect; flow?: ShakeTexRect; mask?: ShakeTexRect },
  ): HTMLCanvasElement | null {
    if (flow === null) return null
    if (!this.ensure()) return null
    const gl = this.gl
    const prog = this.prog
    if (gl === null || prog === null || this.canvas === null) return null
    if (this.curW !== w || this.curH !== h) {
      this.canvas.width = w
      this.canvas.height = h
      this.curW = w
      this.curH = h
    }
    gl.viewport(0, 0, w, h)
    gl.useProgram(prog)
    const tex = this.uploadTexture('tex:' + key, src)
    const ftex = this.uploadTexture('flow:' + key, flow)
    if (tex === null || ftex === null) return null
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.uniform1i(this.locs['u_Src'], 0)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, ftex)
    gl.uniform1i(this.locs['u_Flow'], 1)
    gl.uniform1f(this.locs['u_FlowYFromAlpha'], flowYFromAlpha ? 1 : 0)
    if (mask !== null) {
      const mtex = this.uploadTexture('mask:' + key, mask)
      if (mtex === null) return null
      gl.activeTexture(gl.TEXTURE2)
      gl.bindTexture(gl.TEXTURE_2D, mtex)
      gl.uniform1i(this.locs['u_Mask'], 2)
      gl.uniform1f(this.locs['u_UseMask'], 1)
      gl.uniform1f(this.locs['u_MaskFromAlpha'], maskFromAlpha ? 1 : 0)
    } else {
      gl.uniform1f(this.locs['u_UseMask'], 0)
    }
    // 内容区域比例（未传 rect 时 = 整张纹理 = 1）
    const srcRect = rectRatio(rects?.src, src)
    const flowRect = rectRatio(rects?.flow, flow)
    const maskRect = mask !== null ? rectRatio(rects?.mask, mask) : [1, 1]
    gl.uniform2f(this.locs['u_SrcRect'], srcRect[0], srcRect[1])
    gl.uniform2f(this.locs['u_FlowRect'], flowRect[0], flowRect[1])
    gl.uniform2f(this.locs['u_MaskRect'], maskRect[0], maskRect[1])
    gl.uniform1f(this.locs['u_Offset'], params.offset)
    gl.uniform1f(this.locs['u_Amp'], params.strength)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    return this.canvas
  }

  /** 场景切换时清空纹理缓存（保留上下文） */
  reset(): void {
    if (this.gl === null) return
    for (const t of this.texCache.values()) this.gl.deleteTexture(t)
    this.texCache.clear()
    this.curW = 0
    this.curH = 0
  }

  /** 完全释放（renderer 生命周期结束） */
  dispose(): void {
    const gl = this.gl
    if (gl === null) return
    try {
      const ext = gl.getExtension('WEBGL_lose_context')
      if (ext !== null) ext.loseContext()
    } catch { /* 扩展不可用：交给 GC */ }
    for (const t of this.texCache.values()) gl.deleteTexture(t)
    this.texCache.clear()
    if (this.prog !== null) gl.deleteProgram(this.prog)
    if (this.vbo !== null) gl.deleteBuffer(this.vbo)
    this.gl = null
    this.prog = null
    this.vbo = null
    this.canvas = null
    this.curW = 0
    this.curH = 0
  }
}
