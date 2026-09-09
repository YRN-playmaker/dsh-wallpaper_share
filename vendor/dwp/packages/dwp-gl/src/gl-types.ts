/**
 * WebGL2 最小接口 + 标准枚举常量（design-runtime.md §3，R2）。
 * 执行器只依赖 GLContext 方法子集：浏览器喂真 WebGL2RenderingContext（结构兼容），
 * Node 测试喂 MockGL（录制调用序列）——无 GPU 也能验证绘制编排。
 * 常量值取自 WebGL2 规范（固定），不要求 context 暴露。
 */

export const GL = {
  // 缓冲 / 绘制
  ARRAY_BUFFER: 0x8892,
  STATIC_DRAW: 0x88e4,
  DYNAMIC_DRAW: 0x88e8,
  STREAM_DRAW: 0x88e0,
  TRIANGLES: 0x0004,
  FLOAT: 0x1406,
  UNSIGNED_INT: 0x1405,
  ELEMENT_ARRAY_BUFFER: 0x8893,
  // 状态
  BLEND: 0x0be2,
  DEPTH_TEST: 0x0b71,
  SCISSOR_TEST: 0x0c11,
  COLOR_BUFFER_BIT: 0x4000,
  // 混合因子 / 方程
  ZERO: 0,
  ONE: 1,
  SRC_ALPHA: 0x0302,
  ONE_MINUS_SRC_ALPHA: 0x0303,
  DST_COLOR: 0x0306,
  ONE_MINUS_SRC_COLOR: 0x0301,
  FUNC_ADD: 0x8006,
  MIN: 0x8007,
  MAX: 0x8008,
  // 着色器 / 程序
  VERTEX_SHADER: 0x8b31,
  FRAGMENT_SHADER: 0x8b30,
  COMPILE_STATUS: 0x8b81,
  LINK_STATUS: 0x8b82,
  // 纹理
  TEXTURE_2D: 0x0de1,
  TEXTURE0: 0x84c0,
  TEXTURE_MIN_FILTER: 0x2801,
  TEXTURE_MAG_FILTER: 0x2800,
  TEXTURE_WRAP_S: 0x2802,
  TEXTURE_WRAP_T: 0x2803,
  LINEAR: 0x2601,
  NEAREST: 0x2600,
  CLAMP_TO_EDGE: 0x812f,
  REPEAT: 0x2901,
  RGBA: 0x1908,
  UNSIGNED_BYTE: 0x1401,
  UNPACK_PREMULTIPLY_ALPHA_WEBGL: 0x9241,
  UNPACK_FLIP_Y_WEBGL: 0x9240,
  // 帧缓冲
  FRAMEBUFFER: 0x8d40,
  COLOR_ATTACHMENT0: 0x8ce0,
  FRAMEBUFFER_COMPLETE: 0x8cd5,
} as const;

/** 可被 WebGL2RenderingContext 结构化满足的最小方法集（+ WebGL2 的 VAO/instancing）。 */
export interface GLContext {
  createBuffer(): WebGLBuffer | null;
  deleteBuffer(b: WebGLBuffer | null): void;
  bindBuffer(target: number, b: WebGLBuffer | null): void;
  bufferData(target: number, data: ArrayBufferView | number, usage: number): void;

  createProgram(): WebGLProgram | null;
  deleteProgram(p: WebGLProgram | null): void;
  createShader(type: number): WebGLShader | null;
  deleteShader(s: WebGLShader | null): void;
  shaderSource(s: WebGLShader, src: string): void;
  compileShader(s: WebGLShader): void;
  getShaderParameter(s: WebGLShader, p: number): GLboolean | null;
  getShaderInfoLog(s: WebGLShader): string | null;
  attachShader(p: WebGLProgram, s: WebGLShader): void;
  linkProgram(p: WebGLProgram): void;
  getProgramParameter(p: WebGLProgram, q: number): GLboolean | number | null;
  getProgramInfoLog(p: WebGLProgram): string | null;
  useProgram(p: WebGLProgram | null): void;
  getUniformLocation(p: WebGLProgram, name: string): WebGLUniformLocation | null;
  getAttribLocation(p: WebGLProgram, name: string): number;
  uniform1f(loc: WebGLUniformLocation | null, v: number): void;
  uniform1i(loc: WebGLUniformLocation | null, v: number): void;
  uniform2f(loc: WebGLUniformLocation | null, x: number, y: number): void;
  uniform3f(loc: WebGLUniformLocation | null, x: number, y: number, z: number): void;
  uniform4f(loc: WebGLUniformLocation | null, x: number, y: number, z: number, w: number): void;
  uniformMatrix3fv(loc: WebGLUniformLocation | null, transpose: boolean, value: Float32Array): void;

  createVertexArray(): WebGLVertexArrayObject | null;
  bindVertexArray(v: WebGLVertexArrayObject | null): void;
  enableVertexAttribArray(i: number): void;
  vertexAttribPointer(i: number, size: number, type: number, norm: boolean, stride: number, offset: number): void;
  vertexAttribDivisor(i: number, divisor: number): void;

  createTexture(): WebGLTexture | null;
  deleteTexture(t: WebGLTexture | null): void;
  activeTexture(unit: number): void;
  bindTexture(target: number, t: WebGLTexture | null): void;
  texParameteri(target: number, p: number, v: number): void;
  texImage2D(target: number, level: number, internal: number, format: number, type: number, src: TexImageSource): void;
  texImage2D(target: number, level: number, internal: number, w: number, h: number, border: number,
             format: number, type: number, src: TexImageSource | ArrayBufferView | null): void;
  generateMipmap(target: number): void;
  pixelStorei(p: number, v: number | boolean): void;

  createFramebuffer(): WebGLFramebuffer | null;
  deleteFramebuffer(f: WebGLFramebuffer | null): void;
  bindFramebuffer(target: number, f: WebGLFramebuffer | null): void;
  framebufferTexture2D(target: number, attach: number, textarget: number, t: WebGLTexture | null, level: number): void;
  checkFramebufferStatus(target: number): number;

  viewport(x: number, y: number, w: number, h: number): void;
  clearColor(r: number, g: number, b: number, a: number): void;
  clear(mask: number): void;
  enable(cap: number): void;
  disable(cap: number): void;
  blendFunc(sf: number, df: number): void;
  blendFuncSeparate(srf: number, sdf: number, drf: number, ddf: number): void;
  blendEquation(mode: number): void;
  drawArrays(mode: number, first: number, count: number): void;
  drawArraysInstanced(mode: number, first: number, count: number, instanceCount: number): void;
}

/** 宿主提供的纹理源（图片/视频帧/文本 run）——执行器不假设 DOM，Node 测试可注入桩。 */
export type TexImageSource = unknown;

export interface TextureProvider {
  /** 返回已上传的纹理 + 尺寸；缺失应抛错（core 已保证 plan 引用可解析）。 */
  acquire(id: string): { tex: WebGLTexture; w: number; h: number };
  release(id: string): void;
}
