/**
 * NitroGL —— nitro 效果的 WebGL 逐像素实现。
 *
 * 许可说明：Wallpaper Engine 官方 nitro 效果（闭源商业资产）仅作**黑盒行为参考**
 * （观察参数语义与输出），本 shader 为**独立编写**的数学等价实现
 * （双噪声采样 + smoothstep 带通 + 颜色渐变 + mask 门控 + 混合——通用数学事实，
 * 不受版权保护）。不复制官方源码；未包含 linux-wallpaperengine（GPL）代码。
 *
 * 行为模型（观察所得）：底图上叠加两层随时间流动的噪声采样（clouds_256），
 * 两层乘积经 smoothstep 带通得到"烟雾密度"，颜色从 colorStart 渐变到 colorEnd，
 * 密度×multiply 为混合强度，mask 纹理（R8 alpha 语义）门控出现区域，
 * 最后以 Glow 混合模式（默认 22）叠加到底图。
 *
 * 本实现：WebGL 全屏 quad + fragment shader，一次渲染多个 nitro 叠加（≤4），
 * 图层纹理 / 噪声 / 各 mask 纹理缓存（首次上传，之后只更新 uniforms）。
 */
export type NitroParams = {
  colorStart: [number, number, number]
  colorEnd: [number, number, number]
  multiply: number
  ranges: [number, number]
  scales: [number, number]
  speeds: [number, number, number, number]
  smoothness: number
  useMask: boolean
}

const VERT_SRC = `
attribute vec2 a_Pos;
varying vec2 v_UV;
void main() {
  gl_Position = vec4(a_Pos, 0.0, 1.0);
  v_UV = a_Pos * 0.5 + 0.5;
}
`

// 独立实现的 nitro 数学等价（黑盒行为参考官方效果，代码为独立编写）。
const FRAG_SRC = `
precision mediump float;
varying vec2 v_Uv;
uniform sampler2D u_Src;    // 底图
uniform sampler2D u_Noise;  // 噪声（clouds_256，R 通道）
uniform sampler2D u_Mask0;
uniform sampler2D u_Mask1;
uniform sampler2D u_Mask2;
uniform sampler2D u_Mask3;
uniform float u_UseMask[4];
uniform float u_Aspect;     // 底图 高/宽（噪声纵横比补偿）
uniform float u_Clock;
uniform vec3 u_Color0[4];
uniform vec3 u_Color1[4];
uniform float u_Multiply[4];
uniform vec2 u_Ranges[4];
uniform vec2 u_Scales[4];
uniform vec4 u_Speeds[4];
uniform int u_Count;

vec4 sampleMask(int i, vec2 uv) {
  if (i == 0) return texture2D(u_Mask0, uv);
  if (i == 1) return texture2D(u_Mask1, uv);
  if (i == 2) return texture2D(u_Mask2, uv);
  return texture2D(u_Mask3, uv);
}

void main() {
  vec4 albedo = texture2D(u_Src, v_Uv);
  vec3 color = albedo.rgb;
  for (int i = 0; i < 4; i++) {
    if (i >= u_Count) break;
    // 两层动画噪声采样：尺度 + 时间流速，x 乘纵横比补偿
    vec2 nuvA = (v_Uv * u_Scales[i].x + u_Clock * u_Speeds[i].xy);
    nuvA.x *= u_Aspect;
    vec2 nuvB = (v_Uv * u_Scales[i].y + u_Clock * u_Speeds[i].zw);
    nuvB.x *= u_Aspect;
    nuvB = vec2(-nuvB.y, nuvB.x); // 第二层 90° 旋转（方向多样性）
    float nitro0 = texture2D(u_Noise, nuvA).r;
    float nitro1 = texture2D(u_Noise, nuvB).r;
    float remap = texture2D(u_Noise, v_Uv).r;
    // 核心噪声 + 两层乘积的带通（ranges 决定 band 宽度/中心）
    float coreNoise = smoothstep(nitro0, nitro1, 0.1 + remap * 0.8);
    float p = nitro0 * nitro1;
    float band = smoothstep(u_Ranges[i].y, u_Ranges[i].x, p) * smoothstep(u_Ranges[i].x, u_Ranges[i].y, p);
    float nitro = coreNoise * band * 4.0;
    vec3 nColor = mix(u_Color0[i], u_Color1[i], nitro);
    float blend = nitro * u_Multiply[i];
    if (u_UseMask[i] > 0.5) {
      // mask R8 解码后灰度在 alpha 通道
      blend *= sampleMask(i, v_Uv).a;
    }
    // 混合模式 22 Glow：BlendGlow(A,B)=BlendReflect(B,A)=min(B*B/(1-A),1)，
    // result = mix(A, glow, blend)。A==1 时避免除零返回 A。
    vec3 A = color;
    vec3 glow = (1.0 - A) > 0.001 ? min(nColor * nColor / max(1.0 - A, 0.001), 1.0) : A;
    color = mix(A, glow, clamp(blend, 0.0, 1.0));
  }
  gl_FragColor = vec4(max(0.0, color), albedo.a);
}
`

export class NitroGL {
  private canvas: HTMLCanvasElement | null = null
  private gl: WebGLRenderingContext | null = null
  private prog: WebGLProgram | null = null
  private locs: Record<string, WebGLUniformLocation | null> = {}
  private vbo: WebGLBuffer | null = null
  private texCache = new Map<string, WebGLTexture>()
  private curW = 0
  private curH = 0
  private loseExt: WEBGL_lose_context | null = null
  private lost = false
  private lostLogged = false
  private lastRestoreAt = 0

  private static cachedAvailable: boolean | null = null
  static get available(): boolean {
    if (NitroGL.cachedAvailable === null) {
      try {
        const c = document.createElement('canvas')
        NitroGL.cachedAvailable = !!(c.getContext('webgl') || c.getContext('experimental-webgl'))
      } catch {
        NitroGL.cachedAvailable = false
      }
    }
    return NitroGL.cachedAvailable
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
          console.warn('[nitro:GL] 上下文丢失，原地恢复中…')
        }
      })
      c.addEventListener('webglcontextrestored', () => {
        this.lost = false
        this.lostLogged = false
        this.texCache.clear()
        this.prog = null
        this.vbo = null
        console.warn('[nitro:GL] 上下文已恢复')
      })
      const compile = (type: number, src: string): WebGLShader | null => {
        const sh = gl.createShader(type)
        if (sh === null) return null
        gl.shaderSource(sh, src)
        gl.compileShader(sh)
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
          console.warn('nitro shader: ' + gl.getShaderInfoLog(sh))
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
      for (const name of ['u_Src', 'u_Noise', 'u_Mask0', 'u_Mask1', 'u_Mask2', 'u_Mask3', 'u_UseMask', 'u_Aspect', 'u_Clock', 'u_Color0', 'u_Color1', 'u_Multiply', 'u_Ranges', 'u_Scales', 'u_Speeds', 'u_Count']) {
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
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    this.texCache.set(key, tex)
    return tex
  }

  /**
   * 渲染多个 nitro 效果到离屏 WebGL canvas（逐像素叠加）。
   * src：图层纹理；noise：噪声纹理（clouds_256）；masks：各 nitro 的 mask（null = 无）。
   */
  render(src: TexImageSource, w: number, h: number, noise: HTMLCanvasElement | ImageBitmap | null, masks: Array<HTMLCanvasElement | ImageBitmap | null>, nitros: NitroParams[], time: number, key: string): HTMLCanvasElement | null {
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
    // 底图
    const tex = this.uploadTexture('tex:' + key, src, w, h)
    if (tex === null) return null
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.uniform1i(this.locs['u_Src'], 0)
    // 噪声（无则用底图占位，噪声采样为 0）
    let noiseTex: WebGLTexture | null = null
    if (noise !== null) {
      noiseTex = this.uploadTexture('noise:' + key, noise, noise.width, noise.height)
    } else {
      noiseTex = this.uploadTexture('noise:' + key, src, w, h)
    }
    if (noiseTex === null) return null
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, noiseTex)
    gl.uniform1i(this.locs['u_Noise'], 1)
    // masks（每 nitro 一个，最多 4）
    const n = Math.min(4, nitros.length)
    const maskNames = ['u_Mask0', 'u_Mask1', 'u_Mask2', 'u_Mask3']
    const maskUnits = [2, 3, 4, 5]
    const useMask: number[] = []
    for (let i = 0; i < 4; i++) {
      if (i < n && masks[i] !== null && masks[i] !== undefined) {
        const mtex = this.uploadTexture('mask' + i + ':' + key, masks[i] as TexImageSource, (masks[i] as { width: number }).width, (masks[i] as { height: number }).height)
        gl.activeTexture(gl.TEXTURE0 + maskUnits[i])
        gl.bindTexture(gl.TEXTURE_2D, mtex)
        gl.uniform1i(this.locs[maskNames[i]], maskUnits[i])
        useMask.push(1)
      } else {
        gl.uniform1i(this.locs[maskNames[i]], 0)
        useMask.push(0)
      }
    }
    gl.uniform1fv(this.locs['u_UseMask'], new Float32Array(useMask))
    // 参数
    gl.uniform1f(this.locs['u_Aspect'], h > 0 ? h / w : 1)
    gl.uniform1f(this.locs['u_Clock'], time)
    gl.uniform1i(this.locs['u_Count'], n)
    const c0: number[] = []
    const c1: number[] = []
    const mul: number[] = []
    const rg: number[] = []
    const sc: number[] = []
    const sp: number[] = []
    for (let i = 0; i < 4; i++) {
      if (i < n) {
        const p = nitros[i]
        c0.push(p.colorStart[0], p.colorStart[1], p.colorStart[2])
        c1.push(p.colorEnd[0], p.colorEnd[1], p.colorEnd[2])
        mul.push(p.multiply)
        rg.push(p.ranges[0], p.ranges[1])
        sc.push(p.scales[0], p.scales[1])
        sp.push(p.speeds[0], p.speeds[1], p.speeds[2], p.speeds[3])
      } else {
        c0.push(0, 0, 0)
        c1.push(1, 1, 1)
        mul.push(0)
        rg.push(0.3, 0.25)
        sc.push(1, 2)
        sp.push(0, 0, 0, 0)
      }
    }
    gl.uniform3fv(this.locs['u_Color0'], new Float32Array(c0))
    gl.uniform3fv(this.locs['u_Color1'], new Float32Array(c1))
    gl.uniform1fv(this.locs['u_Multiply'], new Float32Array(mul))
    gl.uniform2fv(this.locs['u_Ranges'], new Float32Array(rg))
    gl.uniform2fv(this.locs['u_Scales'], new Float32Array(sc))
    gl.uniform4fv(this.locs['u_Speeds'], new Float32Array(sp))
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
