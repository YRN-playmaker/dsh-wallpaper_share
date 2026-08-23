/**
 * ParticleGL —— WebGL2 粒子实例化渲染器（替代 Canvas 2D 逐个 drawImage）。
 *
 * 原理（与官方 WE 的 D3D 实例化一致）：全部粒子数据放实例缓冲，
 * 一次 `drawArraysInstanced` 由 GPU 并行绘制；spritesheet 帧裁剪、
 * 颜色混合、REFRACT 背景折射全部在 shader 内完成。
 *
 * 渲染语义（v_Color × texture、rg88/r8 灰度、帧选择）参考 WE 官方
 * genericparticle.frag 与 linux-wallpaperengine（Almamu，GPL-3.0）——
 * 本文件为独立 TypeScript/GLSL 实现，与项目同为 GPL-3.0。
 */

export interface GlParticle {
  x: number        // 屏幕坐标（主画布像素）
  y: number
  size: number     // 渲染尺寸（全宽，px）
  rot: number      // 旋转（弧度）
  r: number        // 颜色 0-255
  g: number
  b: number
  a: number        // alpha 0-1
  frame: number    // spritesheet 帧（CPU 端已按 animationMode 选好）
  aspect: number   // 纹理宽高比（宽/高）
}

export interface GlRenderOptions {
  viewW: number
  viewH: number
  additive: boolean
  refract: boolean
  frames: number
  fw: number
  fh: number
}

const VERT = `#version 300 es
layout(location=0) in vec2 a_Pos;
layout(location=1) in vec2 a_Origin;
layout(location=2) in float a_Size;
layout(location=3) in float a_Rot;
layout(location=4) in vec4 a_Color;
layout(location=5) in float a_Frame;
layout(location=6) in float a_Aspect;
uniform vec2 u_Viewport;
out vec4 v_Color;
out vec2 v_QuadUv;
out float v_Frame;
void main() {
  vec2 corner = (a_Pos - 0.5) * vec2(a_Size * a_Aspect, a_Size);
  float c = cos(a_Rot);
  float s = sin(a_Rot);
  vec2 rc = vec2(corner.x * c - corner.y * s, corner.x * s + corner.y * c);
  vec2 p = a_Origin + rc;
  gl_Position = vec4(p.x / u_Viewport.x * 2.0 - 1.0, 1.0 - p.y / u_Viewport.y * 2.0, 0.0, 1.0);
  v_Color = a_Color;
  v_QuadUv = a_Pos;
  v_Frame = a_Frame;
}`

const FRAG = `#version 300 es
precision mediump float;
uniform sampler2D u_Tex;
uniform sampler2D u_Bg;
uniform vec4 u_FrameInfo;   // (frames, cols, fw/texW, fh/texH)
uniform float u_Refract;    // 0 | 1
uniform float u_RefractAmount;
uniform vec2 u_Viewport;    // CSS 像素尺寸（粒子 NDC）
uniform vec2 u_ViewportPx;  // 物理像素尺寸（gl_FragCoord 折射用）
in vec4 v_Color;
in vec2 v_QuadUv;
in float v_Frame;
out vec4 fragColor;
void main() {
  float frame = v_Frame;
  float col = mod(frame, u_FrameInfo.y);
  float row = floor(frame / u_FrameInfo.y);
  vec2 uv = (vec2(col, row) + v_QuadUv) * u_FrameInfo.zw;
  // 官方：color = v_Color * ConvertTexture0Format(sample)
  vec4 tex = texture(u_Tex, uv);
  vec4 color = vec4(v_Color.rgb, 1.0) * tex;
  color.a = v_Color.a * tex.a;
  if (u_Refract > 0.5) {
    // 折射：采样背景（凸透镜径向偏移近似；法线纹理驱动为后续）
    vec2 scrUv = gl_FragCoord.xy / u_ViewportPx;
    vec2 refr = (v_QuadUv - 0.5) * u_RefractAmount;
    color.rgb *= texture(u_Bg, vec2(scrUv.x, 1.0 - scrUv.y) + refr).rgb;
  }
  // 预乘 alpha 输出（画布 premultipliedAlpha:true）：
  //   normal 用 blendFunc(ONE, ONE_MINUS_SRC_ALPHA) —— 画布内正确累积，
  //   additive 用 blendFuncSeparate(ONE, ONE, ZERO, ONE) —— rgb 加法累积、
  //   alpha 恒 0，drawImage 到主画布时 src.rgb + dst.rgb 纯加法（背景不被衰减）。
  fragColor = vec4(color.rgb * color.a, color.a);
}`

export class ParticleGL {
  private gl: WebGL2RenderingContext | null = null
  private prog: WebGLProgram | null = null
  private vao: WebGLVertexArrayObject | null = null
  private instBuf: WebGLBuffer | null = null
  private quadBuf: WebGLBuffer | null = null
  private idxBuf: WebGLBuffer | null = null
  /** 上下文是否已被浏览器逐出（Too many WebGL contexts / webglcontextlost） */
  private lost = false
  /** WEBGL_lose_context 扩展：丢失后原地恢复（restoreContext），避免新建上下文死循环 */
  private loseExt: WEBGL_lose_context | null = null
  /** 恢复节流：两次 restore 之间至少间隔（避免立即再被逐出时疯狂重试） */
  private lastRestoreAt = 0
  private restoreTimer: ReturnType<typeof setTimeout> | null = null
  /** 纹理缓存（以纹理对象为 key，避免同尺寸不同内容冲突） */
  private texCache = new Map<object, WebGLTexture>()
  private bgTex: WebGLTexture | null = null
  private data: Float32Array
  private maxParticles = 8192
  private uViewport: WebGLUniformLocation | null = null
  private uViewportPx: WebGLUniformLocation | null = null
  private uFrameInfo: WebGLUniformLocation | null = null
  private uRefract: WebGLUniformLocation | null = null
  private uRefractAmount: WebGLUniformLocation | null = null
  /** draw 日志节流（全局 1 次/秒，避免每帧刷屏） */
  private lastDrawLog = 0
  /** 丢失日志节流：只记第一次与恢复成功 */
  private lostLogged = false
  /** 已显式释放（dispose）：不再自动恢复 */
  private disposed = false

  constructor(private canvas: HTMLCanvasElement) {
    // premultipliedAlpha:true：shader 预乘输出 + 正确混合，drawImage 合成不再二次衰减
    const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false })
    if (gl === null) return
    this.gl = gl
    this.loseExt = gl.getExtension('WEBGL_lose_context')
    this.data = new Float32Array(this.maxParticles * 10)
    if (!this.buildProgramAndBuffers()) return
    // 浏览器逐出旧上下文时自愈：preventDefault 保留上下文，
    // 稍后 restoreContext() 原地恢复（不新建 canvas/上下文——每次新建都会
    // 再次触发"Too many active WebGL contexts"逐出，形成 丢失→重建 死循环）。
    canvas.addEventListener('webglcontextlost', (e) => {
      if (this.disposed) return
      e.preventDefault()
      this.lost = true
      if (!this.lostLogged) {
        this.lostLogged = true
        console.warn('[ParticleGL] WebGL 上下文丢失，原地恢复中…')
      }
      this.scheduleRestore()
    })
    canvas.addEventListener('webglcontextrestored', () => {
      if (this.disposed) return
      this.lost = false
      this.lostLogged = false
      this.texCache.clear()
      this.bgTex = null
      this.buildProgramAndBuffers()
      console.warn('[ParticleGL] WebGL 上下文已恢复')
    })
  }

  /** 编译 program + 建缓冲；失败返回 false */
  private buildProgramAndBuffers(): boolean {
    const gl = this.gl
    if (gl === null) return false
    // 清除旧资源（重复调用安全）
    if (this.prog !== null) { gl.deleteProgram(this.prog); this.prog = null }
    if (this.vao !== null) { gl.deleteVertexArray(this.vao); this.vao = null }
    if (this.instBuf !== null) { gl.deleteBuffer(this.instBuf); this.instBuf = null }
    if (this.quadBuf !== null) { gl.deleteBuffer(this.quadBuf); this.quadBuf = null }
    if (this.idxBuf !== null) { gl.deleteBuffer(this.idxBuf); this.idxBuf = null }
    const prog = this.buildProgram(VERT, FRAG)
    if (prog === null) return false
    this.prog = prog
    this.uViewport = gl.getUniformLocation(prog, 'u_Viewport')
    this.uViewportPx = gl.getUniformLocation(prog, 'u_ViewportPx')
    this.uFrameInfo = gl.getUniformLocation(prog, 'u_FrameInfo')
    this.uRefract = gl.getUniformLocation(prog, 'u_Refract')
    this.uRefractAmount = gl.getUniformLocation(prog, 'u_RefractAmount')
    this.setupBuffers()
    return true
  }

  /** 上下文丢失后原地恢复（带 500ms 节流，避免立即再被逐出时疯狂重试） */
  private scheduleRestore(): void {
    if (this.restoreTimer !== null) return
    const wait = Math.max(500, 1500 - (performance.now() - this.lastRestoreAt))
    this.restoreTimer = setTimeout(() => {
      this.restoreTimer = null
      this.lastRestoreAt = performance.now()
      try {
        if (this.lost && this.loseExt !== null) this.loseExt.restoreContext()
      } catch { /* 恢复失败：事件循环下一轮再试 */ }
    }, wait)
  }

  get available(): boolean {
    return !this.lost && this.gl !== null && this.prog !== null
  }

  /** 每帧清空（透明），避免粒子残影 */
  clear(): void {
    const gl = this.gl
    if (gl === null || this.lost) return
    gl.viewport(0, 0, this.canvas.width, this.canvas.height)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
  }

  /** 场景切换时清空纹理缓存（保留上下文，避免每次 start() 新建 WebGL 上下文） */
  reset(): void {
    const gl = this.gl
    if (gl === null) return
    for (const t of this.texCache.values()) gl.deleteTexture(t)
    this.texCache.clear()
    if (this.bgTex !== null) { gl.deleteTexture(this.bgTex); this.bgTex = null }
  }

  /** 完全释放（renderer 生命周期结束）：删除 GPU 资源 + 显式丢失上下文 */
  dispose(): void {
    this.disposed = true
    if (this.restoreTimer !== null) { clearTimeout(this.restoreTimer); this.restoreTimer = null }
    const gl = this.gl
    if (gl === null) return
    try {
      const ext = gl.getExtension('WEBGL_lose_context')
      if (ext !== null) ext.loseContext()
    } catch { /* 扩展不可用：交给 GC */ }
    for (const t of this.texCache.values()) gl.deleteTexture(t)
    this.texCache.clear()
    if (this.bgTex !== null) { gl.deleteTexture(this.bgTex); this.bgTex = null }
    if (this.prog !== null) gl.deleteProgram(this.prog)
    if (this.vao !== null) gl.deleteVertexArray(this.vao)
    if (this.instBuf !== null) gl.deleteBuffer(this.instBuf)
    if (this.quadBuf !== null) gl.deleteBuffer(this.quadBuf)
    if (this.idxBuf !== null) gl.deleteBuffer(this.idxBuf)
    this.prog = null
    this.vao = null
    this.instBuf = null
    this.quadBuf = null
    this.idxBuf = null
    this.gl = null
    this.lost = true
  }

  private buildProgram(vertSrc: string, fragSrc: string): WebGLProgram | null {
    const gl = this.gl
    if (gl === null) return null
    const compile = (type: number, src: string): WebGLShader | null => {
      const sh = gl.createShader(type)
      if (sh === null) return null
      gl.shaderSource(sh, src)
      gl.compileShader(sh)
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        console.error('ParticleGL shader error:', gl.getShaderInfoLog(sh))
        gl.deleteShader(sh)
        return null
      }
      return sh
    }
    const vs = compile(gl.VERTEX_SHADER, vertSrc)
    const fs = compile(gl.FRAGMENT_SHADER, fragSrc)
    if (vs === null || fs === null) return null
    const prog = gl.createProgram()
    if (prog === null) return null
    gl.attachShader(prog, vs)
    gl.attachShader(prog, fs)
    gl.linkProgram(prog)
    gl.deleteShader(vs)
    gl.deleteShader(fs)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error('ParticleGL link error:', gl.getProgramInfoLog(prog))
      gl.deleteProgram(prog)
      return null
    }
    return prog
  }

  private setupBuffers(): void {
    const gl = this.gl
    if (gl === null || this.prog === null) return
    this.vao = gl.createVertexArray()
    gl.bindVertexArray(this.vao)

    // 静态 quad 角（4 顶点 + 6 索引）
    const quadVerts = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1])
    this.quadBuf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf)
    gl.bufferData(gl.ARRAY_BUFFER, quadVerts, gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)

    const idx = new Uint16Array([0, 1, 2, 0, 2, 3])
    this.idxBuf = gl.createBuffer()
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.idxBuf)
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW)

    // 实例缓冲：10 floats = origin(2) size(1) rot(1) color(4) frame(1) aspect(1)
    this.instBuf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instBuf)
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW)
    const stride = 10 * 4
    const loc = (i: number) => i
    gl.enableVertexAttribArray(loc(1))
    gl.vertexAttribPointer(loc(1), 2, gl.FLOAT, false, stride, 0)
    gl.vertexAttribDivisor(loc(1), 1)
    gl.enableVertexAttribArray(loc(2))
    gl.vertexAttribPointer(loc(2), 1, gl.FLOAT, false, stride, 8)
    gl.vertexAttribDivisor(loc(2), 1)
    gl.enableVertexAttribArray(loc(3))
    gl.vertexAttribPointer(loc(3), 1, gl.FLOAT, false, stride, 12)
    gl.vertexAttribDivisor(loc(3), 1)
    gl.enableVertexAttribArray(loc(4))
    gl.vertexAttribPointer(loc(4), 4, gl.FLOAT, false, stride, 16)
    gl.vertexAttribDivisor(loc(4), 1)
    gl.enableVertexAttribArray(loc(5))
    gl.vertexAttribPointer(loc(5), 1, gl.FLOAT, false, stride, 32)
    gl.vertexAttribDivisor(loc(5), 1)
    gl.enableVertexAttribArray(loc(6))
    gl.vertexAttribPointer(loc(6), 1, gl.FLOAT, false, stride, 36)
    gl.vertexAttribDivisor(loc(6), 1)

    gl.bindVertexArray(null)
  }

  /** 粒子纹理（ImageBitmap/Canvas → GL 纹理），以纹理对象为 key 缓存 */
  textureFor(source: ImageBitmap | HTMLCanvasElement): WebGLTexture | null {
    const gl = this.gl
    if (gl === null) return null
    const hit = this.texCache.get(source)
    if (hit !== undefined) return hit
    const tex = gl.createTexture()
    if (tex === null) return null
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    this.texCache.set(source, tex)
    return tex
  }

  /** 上传背景（主画布内容）为纹理，供折射采样 */
  uploadBackground(canvas: HTMLCanvasElement): void {
    const gl = this.gl
    if (gl === null) return
    if (this.bgTex === null) {
      this.bgTex = gl.createTexture()
      gl.bindTexture(gl.TEXTURE_2D, this.bgTex)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    } else {
      gl.bindTexture(gl.TEXTURE_2D, this.bgTex)
    }
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas)
  }

  /**
   * 实例化绘制一组粒子（同一纹理/混合模式）。
   * @param particles 粒子数据（最多 maxParticles 个）
   */
  render(particles: GlParticle[], opts: GlRenderOptions, tex: ImageBitmap | HTMLCanvasElement, viewPxW: number, viewPxH: number): void {
    const gl = this.gl
    if (gl === null || this.lost || this.prog === null || this.vao === null || this.instBuf === null) return
    const n = Math.min(particles.length, this.maxParticles)
    if (n === 0) return
    const glTex = this.textureFor(tex)
    if (glTex === null) return

    // 填实例数据
    let o = 0
    for (let i = 0; i < n; i++) {
      const p = particles[i]
      this.data[o++] = p.x
      this.data[o++] = p.y
      this.data[o++] = p.size
      this.data[o++] = p.rot
      this.data[o++] = p.r / 255
      this.data[o++] = p.g / 255
      this.data[o++] = p.b / 255
      this.data[o++] = p.a
      this.data[o++] = p.frame
      this.data[o++] = p.aspect
    }

    gl.useProgram(this.prog)
    gl.bindVertexArray(this.vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instBuf)
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.data.subarray(0, n * 10))

    // 粒子坐标是 CSS 像素（与主画布 ctx.setTransform(dpr) 前一致），NDC 用 CSS 尺寸；
    // gl_FragCoord 是物理像素，折射 UV 用物理尺寸
    gl.uniform2f(this.uViewport, opts.viewW, opts.viewH)
    gl.uniform2f(this.uViewportPx, viewPxW, viewPxH)
    const cols = opts.frames > 1 && opts.fw > 0 ? Math.max(1, Math.floor(tex.width / opts.fw)) : 1
    gl.uniform4f(this.uFrameInfo, opts.frames, cols, opts.fw > 0 ? opts.fw / tex.width : 1, opts.fh > 0 ? opts.fh / tex.height : 1)
    gl.uniform1f(this.uRefract, opts.refract ? 1 : 0)
    gl.uniform1f(this.uRefractAmount, 0.06)

    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, glTex)
    gl.uniform1i(gl.getUniformLocation(this.prog, 'u_Tex'), 0)
    if (opts.refract && this.bgTex !== null) {
      gl.activeTexture(gl.TEXTURE1)
      gl.bindTexture(gl.TEXTURE_2D, this.bgTex)
      gl.uniform1i(gl.getUniformLocation(this.prog, 'u_Bg'), 1)
    }

    gl.enable(gl.BLEND)
    if (opts.additive) {
      // 预乘加法：rgb 加法累积，alpha 保持 0 —— drawImage 到主画布时
      // src.rgb + dst.rgb 纯加法（射线雨/火花亮度不被 alpha 衰减）
      gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ZERO, gl.ONE)
    } else {
      // 预乘普通混合：画布内正确累积半透明粒子
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    }

    gl.drawElementsInstanced(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0, n)
    gl.bindVertexArray(null)
    const now = performance.now()
    if (n > 0 && now - this.lastDrawLog > 1000) {
      this.lastDrawLog = now
      console.log('[ParticleGL] draw n=' + n, 'refract=' + opts.refract, 'additive=' + opts.additive, 'tex=' + tex.width + 'x' + tex.height, 'frames=' + opts.frames, 'glError=' + gl.getError())
    }
  }
}
