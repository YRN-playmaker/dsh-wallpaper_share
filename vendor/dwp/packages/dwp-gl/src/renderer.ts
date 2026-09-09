/**
 * WebGL2 执行器（R2）：RenderPlan → 绘制调用序列。
 * 依赖注入 GLContext + TextureProvider + TextProvider：浏览器喂真 context/DOM，
 * Node 测试喂 MockGL/桩——无 GPU 也能验证编排。
 *
 * 管线：图层渲入 scene RT（直接混合族内联；shader 合成族经 scratch+composite 折回 scene），
 * 再按 core 展开的 pass 链逐段渲染（target 名解析到 RT，'screen'=默认帧缓冲）。
 */
import { GL, type GLContext, type TextureProvider } from './gl-types.ts';
import { ProgramCache, type Program } from './program-cache.ts';
import { applyBlend, isDirectBlend, SHADER_BLEND } from './blend.ts';
import { m6ToMat3, viewMatrix, type Mat3 } from './mat3.ts';
import {
  QUAD_VS, QUAD_FS, PARTICLES_VS, PARTICLES_FS, FS_QUAD_VS, PASS_FRAGMENTS, COMPOSITE_FS,
} from './shaders.ts';
import type { RenderPlan, RenderStep, TextRun, RGBA } from 'dwp-core';

export interface RenderTarget { tex: WebGLTexture; fbo: WebGLFramebuffer | null; w: number; h: number }

export interface TextProvider {
  rasterize(run: TextRun): { tex: WebGLTexture; w: number; h: number };
}

export interface RendererOptions {
  dpr?: number;
  viewport: { w: number; h: number };   // CSS px
  textures: TextureProvider;
  text?: TextProvider;
}

const UNIT_QUAD = new Float32Array([
  -0.5, -0.5, 0, 0,  0.5, -0.5, 1, 0,  0.5, 0.5, 1, 1,
  -0.5, -0.5, 0, 0,  0.5, 0.5, 1, 1,  -0.5, 0.5, 0, 1,
]);
const UNIT_CORNER = new Float32Array([-0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, 0.5]);
const FULL_UV = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
const TRI = [0, 1, 2, 0, 2, 3];

export class Renderer {
  private gl: GLContext;
  private progs: ProgramCache;
  private dpr: number;
  private vp: { w: number; h: number };
  private textures: TextureProvider;
  private text?: TextProvider;
  private quadBuf: WebGLBuffer;
  private cornerBuf: WebGLBuffer;
  private partBuf: WebGLBuffer;
  private dynBuf: WebGLBuffer;
  private scratch = new Float32Array(36);
  private rts = new Map<string, RenderTarget>();
  private whiteTex: WebGLTexture;   // 1×1 白：solid 层经 tint 上色
  private W: number; H: number;

  constructor(gl: GLContext, opts: RendererOptions) {
    this.gl = gl;
    this.dpr = opts.dpr ?? 1;
    this.vp = opts.viewport;
    this.textures = opts.textures;
    this.text = opts.text;
    this.W = Math.round(opts.viewport.w * this.dpr);
    this.H = Math.round(opts.viewport.h * this.dpr);
    this.progs = new ProgramCache(gl);
    const mkBuf = (data: Float32Array) => {
      const b = gl.createBuffer()!;
      gl.bindBuffer(GL.ARRAY_BUFFER, b);
      gl.bufferData(GL.ARRAY_BUFFER, data, GL.STATIC_DRAW);
      return b;
    };
    this.quadBuf = mkBuf(UNIT_QUAD);
    this.cornerBuf = mkBuf(UNIT_CORNER);
    this.partBuf = gl.createBuffer()!;
    this.dynBuf = gl.createBuffer()!;
    // 1×1 不透明白纹理：solid 层绑定它，颜色全由 uTint 决定
    this.whiteTex = gl.createTexture()!;
    gl.bindTexture(GL.TEXTURE_2D, this.whiteTex);
    gl.texImage2D(GL.TEXTURE_2D, 0, GL.RGBA, 1, 1, 0, GL.RGBA, GL.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
    gl.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_MIN_FILTER, GL.NEAREST);
    gl.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_MAG_FILTER, GL.NEAREST);
    gl.disable(GL.DEPTH_TEST);
    gl.enable(GL.BLEND);
    gl.pixelStorei(GL.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  }

  /** 视口变化：更新尺寸并丢弃 RT（下次 render 按新尺寸重建）。 */
  resize(viewport: { w: number; h: number }, dpr = this.dpr): void {
    this.vp = viewport;
    this.dpr = dpr;
    this.W = Math.round(viewport.w * dpr);
    this.H = Math.round(viewport.h * dpr);
    for (const rt of this.rts.values()) { this.gl.deleteTexture(rt.tex); if (rt.fbo) this.gl.deleteFramebuffer(rt.fbo); }
    this.rts.clear();
  }

  render(plan: RenderPlan): void {
    const gl = this.gl;
    const uView = viewMatrix(plan.view, this.dpr, this.vp.w, this.vp.h);
    const scene = this.rt('scene', this.W, this.H);

    gl.bindFramebuffer(GL.FRAMEBUFFER, scene.fbo);
    gl.viewport(0, 0, scene.w, scene.h);
    gl.clearColor(plan.clear[0]! / 255, plan.clear[1]! / 255, plan.clear[2]! / 255, plan.clear[3]! / 255);
    gl.clear(GL.COLOR_BUFFER_BIT);

    let wroteScreen = false;
    for (const step of plan.steps) {
      switch (step.op) {
        case 'quad':
          if (isDirectBlend(step.blend)) this.drawQuad(step, scene, uView);
          else this.drawQuadComposited(step, scene, uView);
          break;
        case 'particles': this.drawParticles(step, scene, uView); break;
        case 'text': if (this.text) this.drawText(step, scene, uView); break;
        case 'pass': if (this.runPass(step, uView)) wroteScreen = true; break;
      }
    }

    if (!wroteScreen) this.blit(scene.tex);   // 无 pass 落到 screen → 把 scene 呈现到默认帧
  }

  // ---------- quad ----------

  private drawQuad(step: Extract<RenderStep, { op: 'quad' }>, rt: RenderTarget, uView: Mat3, texOverride?: WebGLTexture): void {
    const gl = this.gl;
    const p = this.progs.get('quad', QUAD_VS, QUAD_FS);
    gl.useProgram(p.program);
    gl.bindFramebuffer(GL.FRAMEBUFFER, rt.fbo);
    gl.viewport(0, 0, rt.w, rt.h);
    applyBlend(gl, step.blend);

    const v = step.verts, uv = step.uv, s = this.scratch;
    for (let i = 0; i < 6; i++) {
      const c = TRI[i]! * 2;
      s[i * 4] = v[c]!; s[i * 4 + 1] = v[c + 1]!; s[i * 4 + 2] = uv[c]!; s[i * 4 + 3] = uv[c + 1]!;
    }
    gl.bindBuffer(GL.ARRAY_BUFFER, this.dynBuf);
    gl.bufferData(GL.ARRAY_BUFFER, s, GL.DYNAMIC_DRAW);
    const aPos = this.progs.a(p, 'aPos'), aUv = this.progs.a(p, 'aUv');
    gl.enableVertexAttribArray(aPos); gl.vertexAttribPointer(aPos, 2, GL.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(aUv); gl.vertexAttribPointer(aUv, 2, GL.FLOAT, false, 16, 8);

    gl.uniformMatrix3fv(this.progs.u(p, 'uView'), false, Float32Array.from(uView));
    gl.uniformMatrix3fv(this.progs.u(p, 'uMtx'), false, Float32Array.from(m6ToMat3(step.matrix)));
    const tint = step.tint ?? [1, 1, 1, 1];
    gl.uniform4f(this.progs.u(p, 'uTint'), tint[0]!, tint[1]!, tint[2]!, tint[3]!);
    gl.uniform1f(this.progs.u(p, 'uAlpha'), step.alpha);
    const uo = step.uvOffset ?? [0, 0];
    gl.uniform2f(this.progs.u(p, 'uUvOffset'), uo[0], uo[1]);
    gl.activeTexture(GL.TEXTURE0);
    gl.bindTexture(GL.TEXTURE_2D, texOverride ?? (step.tex === '@solid' ? this.whiteTex : this.textures.acquire(step.tex).tex));
    gl.uniform1i(this.progs.u(p, 'uTex'), 0);
    gl.drawArrays(GL.TRIANGLES, 0, 6);
  }

  /** shader 合成混合：图层→scratch（透明底）→ composite(scratch,scene)→alt → 拷回 scene。 */
  private drawQuadComposited(step: Extract<RenderStep, { op: 'quad' }>, scene: RenderTarget, uView: Mat3): void {
    const gl = this.gl;
    const scratch = this.rt('scratch', this.W, this.H);
    gl.bindFramebuffer(GL.FRAMEBUFFER, scratch.fbo);
    gl.viewport(0, 0, scratch.w, scratch.h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(GL.COLOR_BUFFER_BIT);
    this.drawQuad({ ...step, blend: 'normal' }, scratch, uView);
    const alt = this.rt('compositeAlt', this.W, this.H);
    this.composite(scratch.tex, scene.tex, step.blend, alt);
    this.blitTo(alt.tex, scene);   // 结果写回 scene
  }

  private composite(src: WebGLTexture, dst: WebGLTexture, blend: string, out: RenderTarget): void {
    const gl = this.gl;
    const p = this.progs.get('composite', FS_QUAD_VS, COMPOSITE_FS);
    gl.useProgram(p.program);
    gl.bindFramebuffer(GL.FRAMEBUFFER, out.fbo);
    gl.viewport(0, 0, out.w, out.h);
    gl.disable(GL.BLEND);
    const mode = [...SHADER_BLEND].indexOf(blend as never);
    gl.uniform1i(this.progs.u(p, 'uMode'), Math.max(0, mode));
    gl.activeTexture(GL.TEXTURE0); gl.bindTexture(GL.TEXTURE_2D, src); gl.uniform1i(this.progs.u(p, 'uSrc'), 0);
    gl.activeTexture(GL.TEXTURE0 + 1); gl.bindTexture(GL.TEXTURE_2D, dst); gl.uniform1i(this.progs.u(p, 'uDst'), 1);
    gl.drawArrays(GL.TRIANGLES, 0, 3);
    gl.enable(GL.BLEND);
  }

  // ---------- particles ----------

  private drawParticles(step: Extract<RenderStep, { op: 'particles' }>, rt: RenderTarget, uView: Mat3): void {
    if (step.count === 0) return;
    const gl = this.gl;
    const p = this.progs.get('particles', PARTICLES_VS, PARTICLES_FS);
    gl.useProgram(p.program);
    gl.bindFramebuffer(GL.FRAMEBUFFER, rt.fbo);
    gl.viewport(0, 0, rt.w, rt.h);
    applyBlend(gl, step.blend);

    gl.bindBuffer(GL.ARRAY_BUFFER, this.cornerBuf);
    const aC = this.progs.a(p, 'aCorner');
    gl.enableVertexAttribArray(aC); gl.vertexAttribPointer(aC, 2, GL.FLOAT, false, 8, 0);

    gl.bindBuffer(GL.ARRAY_BUFFER, this.partBuf);
    gl.bufferData(GL.ARRAY_BUFFER, step.buffer, GL.STREAM_DRAW);
    const stride = step.stride * 4;
    const aA = this.progs.a(p, 'aA'), aB = this.progs.a(p, 'aB');
    gl.enableVertexAttribArray(aA); gl.vertexAttribPointer(aA, 4, GL.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(aB); gl.vertexAttribPointer(aB, 4, GL.FLOAT, false, stride, 16);
    gl.vertexAttribDivisor(aA, 1); gl.vertexAttribDivisor(aB, 1);

    gl.uniformMatrix3fv(this.progs.u(p, 'uView'), false, Float32Array.from(uView));
    gl.uniform4f(this.progs.u(p, 'uColorA'), ...rgba(step.colorA));
    gl.uniform4f(this.progs.u(p, 'uColorB'), ...rgba(step.colorB));
    gl.activeTexture(GL.TEXTURE0);
    gl.bindTexture(GL.TEXTURE_2D, this.textures.acquire(step.tex).tex);
    gl.uniform1i(this.progs.u(p, 'uTex'), 0);
    gl.drawArraysInstanced(GL.TRIANGLES, 0, 6, step.count);
    gl.vertexAttribDivisor(aA, 0); gl.vertexAttribDivisor(aB, 0);
  }

  // ---------- text ----------

  private drawText(step: Extract<RenderStep, { op: 'text' }>, rt: RenderTarget, uView: Mat3): void {
    const { tex, w, h } = this.text!.rasterize(step.run);
    const hw = w / 2, hh = h / 2;
    this.drawQuad({
      op: 'quad', layer: step.layer, tex: '',
      verts: new Float32Array([-hw, -hh, hw, -hh, hw, hh, -hw, hh]), uv: FULL_UV,
      matrix: step.run.matrix, blend: step.blend, alpha: step.alpha, tint: step.run.color,
    }, rt, uView, tex);
  }

  // ---------- pass 链 ----------

  /** 返回是否写到了默认帧缓冲（target==='screen'）。 */
  private runPass(step: Extract<RenderStep, { op: 'pass' }>, _uView: Mat3): boolean {
    const gl = this.gl;
    const fs = PASS_FRAGMENTS[step.template];
    if (!fs) return false;   // 未知模板：跳过（degraded 由上层从 plan.unsupported 读）
    const srcTex = this.texOf(step.inputs[0]!);
    const toScreen = step.target === 'screen';
    const out = toScreen ? this.screenRT() : this.rtFor(step.target);
    const p = this.progs.get(`pass:${step.template}`, FS_QUAD_VS, fs);
    gl.useProgram(p.program);
    gl.bindFramebuffer(GL.FRAMEBUFFER, out.fbo);
    gl.viewport(0, 0, out.w, out.h);
    gl.disable(GL.BLEND);
    gl.uniform2f(this.progs.u(p, 'uRes'), out.w, out.h);
    gl.uniform2f(this.progs.u(p, 'uTexel'), 1 / out.w, 1 / out.h);
    this.setPassUniforms(p, step);
    gl.activeTexture(GL.TEXTURE0);
    gl.bindTexture(GL.TEXTURE_2D, srcTex);
    gl.uniform1i(this.progs.u(p, 'uSrc'), 0);
    gl.drawArrays(GL.TRIANGLES, 0, 3);
    gl.enable(GL.BLEND);
    return toScreen;
  }

  private setPassUniforms(p: Program, step: Extract<RenderStep, { op: 'pass' }>): void {
    const gl = this.gl;
    const pr = step.params;
    const f = (k: string) => (typeof pr[k] === 'number' ? (pr[k] as number) : undefined);
    const set = (name: string, v: number | undefined) => { if (v !== undefined) gl.uniform1f(this.progs.u(p, name), v); };
    set('uAmp', f('amp')); set('uFreq', f('freq')); set('uSpeed', f('speed')); set('uT', f('t')); set('uMode', f('mode'));
    set('uRadius', f('radius')); set('uStrength', f('strength'));
    set('uKind', f('kind')); set('uIntensity', f('intensity')); set('uMix', f('mix')); set('uBrightness', f('brightness'));
    if (Array.isArray(pr.color)) { const c = pr.color as number[]; gl.uniform4f(this.progs.u(p, 'uColor'), c[0]!, c[1]!, c[2]!, c[3] ?? 1); }
  }

  // ---------- RT / 纹理解析 ----------

  private texOf(target: string): WebGLTexture {
    if (target === 'scene') return this.rt('scene', this.W, this.H).tex;
    return this.rtFor(target).tex;
  }

  /** core target 名 → RT（rtHalf/rtHalfB 半分辨率，其余全分辨率）。 */
  private rtFor(name: string): RenderTarget {
    const half = name === 'rtHalf' || name === 'rtHalfB';
    return this.rt(name, half ? Math.max(1, this.W >> 1) : this.W, half ? Math.max(1, this.H >> 1) : this.H);
  }

  private screenRT(): RenderTarget {
    return { tex: null as unknown as WebGLTexture, fbo: null, w: this.W, h: this.H };
  }

  private rt(name: string, w: number, h: number): RenderTarget {
    let rt = this.rts.get(name);
    if (rt && rt.w === w && rt.h === h) return rt;
    const gl = this.gl;
    if (rt) { gl.deleteTexture(rt.tex); gl.deleteFramebuffer(rt.fbo); }
    const tex = gl.createTexture()!;
    gl.bindTexture(GL.TEXTURE_2D, tex);
    gl.texImage2D(GL.TEXTURE_2D, 0, GL.RGBA, w, h, 0, GL.RGBA, GL.UNSIGNED_BYTE, null);
    gl.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_MIN_FILTER, GL.LINEAR);
    gl.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_MAG_FILTER, GL.LINEAR);
    gl.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_WRAP_S, GL.CLAMP_TO_EDGE);
    gl.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_WRAP_T, GL.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(GL.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(GL.FRAMEBUFFER, GL.COLOR_ATTACHMENT0, GL.TEXTURE_2D, tex, 0);
    rt = { tex, fbo, w, h };
    this.rts.set(name, rt);
    return rt;
  }

  private blit(tex: WebGLTexture): void { this.blitTo(tex, this.screenRT()); }
  private blitTo(tex: WebGLTexture, out: RenderTarget): void {
    const gl = this.gl;
    const p = this.progs.get('copy', FS_QUAD_VS, PASS_FRAGMENTS.blurCombine!);
    gl.useProgram(p.program);
    gl.bindFramebuffer(GL.FRAMEBUFFER, out.fbo);
    gl.viewport(0, 0, out.w, out.h);
    gl.disable(GL.BLEND);
    gl.activeTexture(GL.TEXTURE0);
    gl.bindTexture(GL.TEXTURE_2D, tex);
    gl.uniform1i(this.progs.u(p, 'uSrc'), 0);
    gl.drawArrays(GL.TRIANGLES, 0, 3);
    gl.enable(GL.BLEND);
  }

  dispose(): void {
    const gl = this.gl;
    for (const rt of this.rts.values()) { gl.deleteTexture(rt.tex); if (rt.fbo) gl.deleteFramebuffer(rt.fbo); }
    this.rts.clear();
    gl.deleteTexture(this.whiteTex);
    gl.deleteBuffer(this.quadBuf); gl.deleteBuffer(this.cornerBuf);
    gl.deleteBuffer(this.partBuf); gl.deleteBuffer(this.dynBuf);
  }
}

/** #rrggbb[aa] 或 RGBA[0..1] → 0..1 四分量。 */
function rgba(c: string | RGBA): [number, number, number, number] {
  if (Array.isArray(c)) return [c[0]!, c[1]!, c[2]!, c[3] ?? 1];
  const hex = c.replace('#', '');
  const n = (i: number) => parseInt(hex.slice(i, i + 2), 16) / 255;
  return [n(0)!, n(2)!, n(4)!, hex.length >= 8 ? n(6)! : 1];
}
