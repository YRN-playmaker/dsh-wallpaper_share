/**
 * Canvas2D 降级执行器（design-runtime.md §4，R3）：无 WebGL2 时消费同一 RenderPlan。
 * 与 gl 执行器同源输入 → 布局/动画/粒子一致；差异：post pass 跳过（报 degraded）、
 * 粒子逐粒 stamp（上限 2000）。Canvas2D globalCompositeOperation 原生支持全部 12 混合。
 * 依赖注入 Ctx2D：浏览器喂真 2D context，Node 测试喂 Mock2D。
 */
import type { RenderPlan, RenderStep, RGBA } from 'dwp-core';

export interface Ctx2D {
  globalAlpha: number;
  globalCompositeOperation: string;
  fillStyle: string | CanvasGradient | CanvasPattern;
  font: string;
  textBaseline: string;
  textAlign: string;
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  drawImage(img: unknown, dx: number, dy: number, dw: number, dh: number): void;
  fillText(text: string, x: number, y: number): void;
}

export interface Canvas2DOptions {
  viewport: { w: number; h: number };
  dpr?: number;
  /** 取图片资源（宿主解码后提供）；缺失返回 null → 该层跳过并记 degraded。 */
  image(id: string): unknown | null;
  maxParticles?: number;
}

/** 协议混合名 → Canvas2D globalCompositeOperation（normal 即 source-over）。 */
const BLEND2D: Record<string, string> = {
  normal: 'source-over', lighter: 'lighter', multiply: 'multiply', screen: 'screen',
  overlay: 'overlay', darken: 'darken', lighten: 'lighten', 'color-dodge': 'color-dodge',
  'soft-light': 'soft-light', 'hard-light': 'hard-light', difference: 'difference', exclusion: 'exclusion',
};

const rgbaCss = (c: RGBA | number[]): string =>
  `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${c[3] ?? 1})`;

export class Canvas2DRenderer {
  private ctx: Ctx2D;
  private o: Required<Pick<Canvas2DOptions, 'dpr' | 'maxParticles'>> & Canvas2DOptions;

  constructor(ctx: Ctx2D, opts: Canvas2DOptions) {
    this.ctx = ctx;
    // 显式合并，避免 opts 里显式 undefined 覆盖默认值（{...opts} 的坑）
    this.o = {
      viewport: opts.viewport,
      image: opts.image,
      dpr: opts.dpr ?? 1,
      maxParticles: opts.maxParticles ?? 2000,
    };
  }

  /** 渲染一帧；返回被降级的项（pass 效果名 / 缺资源层 id）。 */
  render(plan: RenderPlan): { degraded: string[] } {
    const ctx = this.ctx, dpr = this.o.dpr;
    const degraded: string[] = [];
    const W = this.o.viewport.w * dpr, H = this.o.viewport.h * dpr;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = rgbaCss(plan.clear);
    ctx.fillRect(0, 0, W, H);

    for (const step of plan.steps) {
      switch (step.op) {
        case 'quad': this.quad(step, degraded); break;
        case 'particles': this.particles(step, degraded); break;
        case 'text': this.text(step); break;
        case 'pass': degraded.push(`pass:${step.effect}`); break;   // 降级：跳过全屏效果
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    return { degraded };
  }

  private quad(step: Extract<RenderStep, { op: 'quad' }>, degraded: string[]): void {
    const ctx = this.ctx, dpr = this.o.dpr, m = step.matrix;
    const w = step.verts[2]! - step.verts[0]!, h = step.verts[5]! - step.verts[1]!;
    ctx.setTransform(dpr * m[0]!, dpr * m[1]!, dpr * m[2]!, dpr * m[3]!, dpr * m[4]!, dpr * m[5]!);
    ctx.globalAlpha = step.alpha;
    ctx.globalCompositeOperation = BLEND2D[step.blend] ?? 'source-over';
    if (step.tex === '@solid') {
      const t = step.tint ?? [1, 1, 1, 1];
      ctx.fillStyle = rgbaCss(t);
      ctx.fillRect(-w / 2, -h / 2, w, h);
    } else {
      const img = this.o.image(step.tex);
      if (!img) { degraded.push(`layer:${step.layer}`); return; }
      ctx.drawImage(img, -w / 2, -h / 2, w, h);
    }
  }

  private particles(step: Extract<RenderStep, { op: 'particles' }>, degraded: string[]): void {
    if (step.count === 0) return;
    const img = this.o.image(step.tex);
    if (!img) { degraded.push(`layer:${step.layer}`); return; }
    const ctx = this.ctx, dpr = this.o.dpr, b = step.buffer, S = step.stride;
    const n = Math.min(step.count, this.o.maxParticles);
    if (step.count > this.o.maxParticles) degraded.push(`particles-capped:${step.layer}`);
    ctx.globalCompositeOperation = BLEND2D[step.blend] ?? 'source-over';
    for (let i = 0; i < n; i++) {
      const o = i * S;
      const x = b[o]!, y = b[o + 1]!, rot = b[o + 2]!, sw = b[o + 3]!, sh = b[o + 4]!, alpha = b[o + 5]!;
      const r = (rot * Math.PI) / 180, cs = Math.cos(r), sn = Math.sin(r);
      ctx.setTransform(dpr * cs, dpr * sn, -dpr * sn, dpr * cs, dpr * x, dpr * y);
      ctx.globalAlpha = alpha;
      ctx.drawImage(img, -sw / 2, -sh / 2, sw, sh);
    }
  }

  private text(step: Extract<RenderStep, { op: 'text' }>): void {
    const ctx = this.ctx, dpr = this.o.dpr, m = step.run.matrix, run = step.run;
    ctx.setTransform(dpr * m[0]!, dpr * m[1]!, dpr * m[2]!, dpr * m[3]!, dpr * m[4]!, dpr * m[5]!);
    ctx.globalAlpha = step.alpha;
    ctx.globalCompositeOperation = BLEND2D[step.blend] ?? 'source-over';
    ctx.font = run.font;
    ctx.textBaseline = run.baseline;
    ctx.textAlign = run.align;
    ctx.fillStyle = rgbaCss(run.color);
    ctx.fillText(run.text, 0, 0);
  }
}
