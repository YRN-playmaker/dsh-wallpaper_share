/**
 * WaterwavesGL —— waterwaves 效果的 WebGL 逐像素实现。
 *
 * 许可说明：Wallpaper Engine 官方效果（闭源商业资产）仅作**黑盒行为参考**
 * （观察参数语义与输出），本 shader 为**独立编写**的数学等价实现
 * （正弦波沿方向传播 + 垂直扰动 + mask 门控——通用数学事实，不受版权保护）。
 * 不复制官方源码；未包含 linux-wallpaperengine（GPL）代码。
 *
 * 行为模型（观察所得）：波相位沿 (-sinθ, cosθ) 方向随空间/时间变化，
 * 扰动沿 (cosθ, sinθ) 垂直方向，幅度 = strength² 的指数波形，mask 门控。
 * 本实现：WebGL 全屏 quad + fragment shader（支持 1-4 个波叠加 + mask），
 * 逐像素 UV 场扰动；图层纹理与 mask 纹理缓存（首次上传，之后只更新 uniforms）。
 */
export type WaterwavesParams = { direction: number; speed: number; scale: number; strength: number; exponent: number }

const VERT_SRC = `
attribute vec2 a_Pos;
varying vec2 v_UV;
void main() {
  gl_Position = vec4(a_Pos, 0.0, 1.0);
  v_UV = a_Pos * 0.5 + 0.5;
}
`

const FRAG_SRC = `
precision mediump float;
// 独立实现的水波扰动（数学事实：沿某方向传播的正弦波 + 垂直方向扰动）。
// 行为参考 Wallpaper Engine 官方 waterwaves 效果（黑盒观察），代码为独立编写。
uniform sampler2D u_Src;
uniform sampler2D u_MaskTex;
uniform float u_UseMask;
uniform float u_MaskAlpha;
uniform float u_Clock;
uniform vec4 u_Params[4]; // x=方向角, y=速度, z=尺度, w=强度
uniform float u_Power[4]; // 波形指数
uniform int u_Count;
varying vec2 v_Uv;
void main() {
  vec2 uv = v_Uv;
  float gate = 1.0;
  if (u_UseMask > 0.5) {
    vec4 m = texture2D(u_MaskTex, uv);
    gate = u_MaskAlpha > 0.5 ? m.a : m.r;
  }
  vec2 total = vec2(0.0);
  for (int i = 0; i < 4; i++) {
    if (i >= u_Count) break;
    vec4 p = u_Params[i];
    float sinA = sin(p.x);
    float cosA = cos(p.x);
    // 波相位沿 (-sinA, cosA) 方向随空间与时间变化
    float phase = u_Clock * p.y + (uv.x * -sinA + uv.y * cosA) * p.z;
    float wave = sin(phase);
    // 扰动沿 (cosA, sinA)，幅度为强度平方的指数波形
    float amp = pow(abs(wave), u_Power[i]) * sign(wave) * p.w * p.w;
    total += amp * vec2(cosA, sinA);
  }
  uv += total * gate;
  gl_FragColor = texture2D(u_Src, uv);
}
`

export class WaterwavesGL {
  private canvas: HTMLCanvasElement | null = null
  private gl: WebGLRenderingContext | null = null
  private prog: WebGLProgram | null = null
  private locs: Record<string, WebGLUniformLocation | null> = {}
  private vbo: WebGLBuffer | null = null
  private texCache = new Map<string, WebGLTexture>()
  private curW = 0
  private curH = 0
  /** 上下文被逐出后的原地恢复扩展 */
  private loseExt: WEBGL_lose_context | null = null
  private lost = false
  private lostLogged = false
  private lastRestoreAt = 0

  /** WebGL 是否可用（惰性缓存，避免每次访问都新建探针上下文） */
  private static cachedAvailable: boolean | null = null
  static get available(): boolean {
    if (WaterwavesGL.cachedAvailable === null) {
      try {
        const c = document.createElement('canvas')
        WaterwavesGL.cachedAvailable = !!(c.getContext('webgl') || c.getContext('experimental-webgl'))
      } catch {
        WaterwavesGL.cachedAvailable = false
      }
    }
    return WaterwavesGL.cachedAvailable
  }

  private ensure(): boolean {
    if (this.gl !== null && this.prog !== null && !this.lost) return true
    // 丢失中：等 webglcontextrestored 事件（handler 清空 prog/vbo 并重建），
    // 或主动尝试 restoreContext（节流 1s）；不在此处新建 canvas（会再次触发逐出死循环）
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
          console.warn('[waterwaves:GL] 上下文丢失，原地恢复中…')
        }
      })
      c.addEventListener('webglcontextrestored', () => {
        this.lost = false
        this.lostLogged = false
        this.texCache.clear()
        this.prog = null
        this.vbo = null
        console.warn('[waterwaves:GL] 上下文已恢复')
      })
      const compile = (type: number, src: string): WebGLShader | null => {
        const sh = gl.createShader(type)
        if (sh === null) return null
        gl.shaderSource(sh, src)
        gl.compileShader(sh)
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
          console.warn('waterwaves shader: ' + gl.getShaderInfoLog(sh))
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
      for (const name of ['u_Src', 'u_MaskTex', 'u_UseMask', 'u_MaskAlpha', 'u_Clock', 'u_Params', 'u_Power', 'u_Count']) {
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

  private uploadTexture(key: string, src: TexImageSource, w: number, h: number): WebGLTexture | null {
    const gl = this.gl
    if (gl === null) return null
    const hit = this.texCache.get(key)
    if (hit !== undefined) return hit
    const tex = gl.createTexture()
    if (tex === null) return null
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    this.texCache.set(key, tex)
    return tex
  }

  /**
   * 渲染 waterwaves 效果到离屏 WebGL canvas（逐像素 UV 场扰动）。
   * src：图层纹理；mask：mask 纹理（null = 无）；maskUseA：mask 用 A 通道（R8 alpha 语义）。
   */
  render(src: TexImageSource, w: number, h: number, mask: HTMLCanvasElement | ImageBitmap | null, maskUseA: boolean, waves: WaterwavesParams[], time: number, key: string): HTMLCanvasElement | null {
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
    // 纹理
    const tex = this.uploadTexture('tex:' + key, src, w, h)
    if (tex === null) return null
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.uniform1i(this.locs['u_Src'], 0)
    if (mask !== null) {
      const mtex = this.uploadTexture('mask:' + key, mask, 0, 0)
      gl.activeTexture(gl.TEXTURE1)
      gl.bindTexture(gl.TEXTURE_2D, mtex)
      gl.uniform1i(this.locs['u_MaskTex'], 1)
      gl.uniform1f(this.locs['u_UseMask'], 1)
      gl.uniform1f(this.locs['u_MaskAlpha'], maskUseA ? 1 : 0)
    } else {
      gl.uniform1f(this.locs['u_UseMask'], 0)
    }
    // 参数
    gl.uniform1f(this.locs['u_Clock'], time)
    const wv: number[] = []
    const ex: number[] = []
    const n = Math.min(4, waves.length)
    for (let i = 0; i < 4; i++) {
      if (i < n) {
        wv.push(waves[i].direction, waves[i].speed, waves[i].scale, waves[i].strength)
        ex.push(Math.max(0.5, Math.min(4, waves[i].exponent)))
      } else {
        wv.push(0, 0, 0, 0)
        ex.push(1)
      }
    }
    gl.uniform4fv(this.locs['u_Params'], new Float32Array(wv))
    gl.uniform1fv(this.locs['u_Power'], new Float32Array(ex))
    gl.uniform1i(this.locs['u_Count'], n)
    // 绘制
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    return this.canvas
  }

  /** 场景切换时清空纹理缓存（保留上下文，避免每次 start() 新建 WebGL 上下文） */
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
