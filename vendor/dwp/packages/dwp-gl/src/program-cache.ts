/**
 * 程序缓存（R2）：按名编译链接 GLSL 模板，缓存 program + uniform/attrib location。
 * 编译失败抛带 info log 的错误（demo/CI 定位用）。
 */
import { GL, type GLContext } from './gl-types.ts';

export interface Program {
  program: WebGLProgram;
  uniforms: Map<string, WebGLUniformLocation | null>;
  attribs: Map<string, number>;
}

export class ProgramCache {
  private cache = new Map<string, Program>();
  private gl: GLContext;
  constructor(gl: GLContext) { this.gl = gl; }

  get(name: string, vs: string, fs: string): Program {
    let p = this.cache.get(name);
    if (!p) { p = this.compile(name, vs, fs); this.cache.set(name, p); }
    return p;
  }

  private compile(name: string, vsSrc: string, fsSrc: string): Program {
    const gl = this.gl;
    const vs = this.shader(GL.VERTEX_SHADER, vsSrc, `${name}.vs`);
    const fs = this.shader(GL.FRAGMENT_SHADER, fsSrc, `${name}.fs`);
    const program = gl.createProgram();
    if (!program) throw new Error(`createProgram 失败: ${name}`);
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, GL.LINK_STATUS)) {
      throw new Error(`链接失败 ${name}: ${gl.getProgramInfoLog(program)}`);
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    return { program, uniforms: new Map(), attribs: new Map() };
  }

  private shader(type: number, src: string, label: string): WebGLShader {
    const gl = this.gl;
    const s = gl.createShader(type);
    if (!s) throw new Error(`createShader 失败: ${label}`);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, GL.COMPILE_STATUS)) {
      throw new Error(`编译失败 ${label}: ${gl.getShaderInfoLog(s)}`);
    }
    return s;
  }

  /** uniform location 惰性查询 + 缓存。 */
  u(p: Program, name: string): WebGLUniformLocation | null {
    let loc = p.uniforms.get(name);
    if (loc === undefined) { loc = this.gl.getUniformLocation(p.program, name); p.uniforms.set(name, loc); }
    return loc;
  }

  a(p: Program, name: string): number {
    let loc = p.attribs.get(name);
    if (loc === undefined) { loc = this.gl.getAttribLocation(p.program, name); p.attribs.set(name, loc); }
    return loc;
  }

  get size(): number { return this.cache.size; }
}
