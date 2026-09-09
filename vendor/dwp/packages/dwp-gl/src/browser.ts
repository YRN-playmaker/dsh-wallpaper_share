/**
 * 浏览器侧真实 Provider（R2 落地）：把 DOM 资源喂进执行器。
 * 仅在浏览器运行（依赖 document/Image/HTMLVideoElement/OffscreenCanvas）；
 * Node 测试用桩替代，故本文件不进测试网。
 */
import { GL, type GLContext, type TextureProvider, type TexImageSource } from './gl-types.ts';
import type { TextProvider } from './renderer.ts';
import type { TextRun } from 'dwp-core';

/** 图片/视频纹理解码 + 上传缓存。key = 资源路径。 */
export class DomTextureProvider implements TextureProvider {
  private gl: GLContext;
  private map = new Map<string, { tex: WebGLTexture; w: number; h: number }>();
  /** 宿主预加载：图片解码完 / 视频首帧就绪后调用，把源登记进来。 */
  private sources = new Map<string, TexImageSourceLike>();

  constructor(gl: GLContext) { this.gl = gl; }

  registerImage(id: string, img: HTMLImageElement): void { this.sources.set(id, img); }
  registerVideo(id: string, video: HTMLVideoElement): void { this.sources.set(id, video); }
  registerCanvas(id: string, canvas: HTMLCanvasElement | OffscreenCanvas): void { this.sources.set(id, canvas as TexImageSourceLike); }
  /** 通用登记（mount 用 createImageBitmap 解码后喂入）。 */
  register(id: string, src: TexImageSourceLike): void { this.sources.set(id, src); }

  acquire(id: string): { tex: WebGLTexture; w: number; h: number } {
    const hit = this.map.get(id);
    if (hit) {
      // 视频每帧重传（尺寸不变则复用纹理对象）
      const src = this.sources.get(id);
      if (src && isVideo(src)) this.upload(hit, src);
      return hit;
    }
    const src = this.sources.get(id);
    if (!src) throw new Error(`纹理未预加载: ${id}`);
    const gl = this.gl;
    const tex = gl.createTexture()!;
    const rec = { tex, w: srcWidth(src), h: srcHeight(src) };
    gl.bindTexture(GL.TEXTURE_2D, tex);
    gl.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_MIN_FILTER, GL.LINEAR);
    gl.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_MAG_FILTER, GL.LINEAR);
    gl.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_WRAP_S, GL.CLAMP_TO_EDGE);
    gl.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_WRAP_T, GL.CLAMP_TO_EDGE);
    this.upload(rec, src);
    this.map.set(id, rec);
    return rec;
  }

  private upload(rec: { tex: WebGLTexture; w: number; h: number }, src: TexImageSourceLike): void {
    const gl = this.gl;
    gl.bindTexture(GL.TEXTURE_2D, rec.tex);
    gl.texImage2D(GL.TEXTURE_2D, 0, GL.RGBA, GL.RGBA, GL.UNSIGNED_BYTE, src as unknown as TexImageSource);
    rec.w = srcWidth(src); rec.h = srcHeight(src);
  }

  release(id: string): void {
    const rec = this.map.get(id);
    if (rec) { this.gl.deleteTexture(rec.tex); this.map.delete(id); }
  }
  dispose(): void { for (const id of [...this.map.keys()]) this.release(id); }
}

export type TexImageSourceLike = HTMLImageElement | HTMLVideoElement | HTMLCanvasElement | OffscreenCanvas | ImageBitmap;
const isVideo = (s: TexImageSourceLike): s is HTMLVideoElement => 'readyState' in s && 'videoWidth' in s;
const srcWidth = (s: TexImageSourceLike) => isVideo(s) ? s.videoWidth : (s as { width: number }).width;
const srcHeight = (s: TexImageSourceLike) => isVideo(s) ? s.videoHeight : (s as { height: number }).height;

/**
 * 文本光栅化（design-runtime.md §3.2）：离屏 Canvas2D 画整段 run（非逐字），
 * LRU 32 条缓存。字体缺失回退 sans-serif（Canvas 自动回退，上报交宿主）。
 */
export class CanvasTextProvider implements TextProvider {
  private gl: GLContext;
  private cache = new Map<string, { tex: WebGLTexture; w: number; h: number }>();
  private order: string[] = [];
  private limit: number;
  private canvas: OffscreenCanvas | HTMLCanvasElement;
  onFontFallback?: (requested: string) => void;

  constructor(gl: GLContext, opts: { maxCache?: number } = {}) {
    this.gl = gl;
    this.limit = opts.maxCache ?? 32;
    this.canvas = typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(1, 1)
      : document.createElement('canvas');
  }

  rasterize(run: TextRun): { tex: WebGLTexture; w: number; h: number } {
    const key = `${run.text}|${run.font}|${run.sizePx}|${run.color.join(',')}|${run.align}`;
    const hit = this.cache.get(key);
    if (hit) { this.touch(key); return hit; }

    const ctx = (this.canvas as HTMLCanvasElement).getContext('2d') as CanvasRenderingContext2D | null
      ?? (this.canvas as OffscreenCanvas).getContext('2d') as OffscreenCanvasRenderingContext2D | null;
    if (!ctx) throw new Error('无法获取 2D 上下文');
    ctx.font = run.font;
    const metrics = ctx.measureText(run.text);
    const w = Math.ceil(metrics.width) + 4;
    const h = Math.ceil(run.sizePx * 1.4);
    this.canvas.width = w; this.canvas.height = h;
    ctx.clearRect(0, 0, w, h);
    ctx.font = run.font;
    ctx.textBaseline = 'middle';
    ctx.textAlign = run.align;
    const [r, g, b, a] = run.color;
    ctx.fillStyle = `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${a})`;
    const x = run.align === 'center' ? w / 2 : run.align === 'right' ? w - 2 : 2;
    ctx.fillText(run.text, x, h / 2);

    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(GL.TEXTURE_2D, tex);
    gl.pixelStorei(GL.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(GL.TEXTURE_2D, 0, GL.RGBA, GL.RGBA, GL.UNSIGNED_BYTE, this.canvas as unknown as TexImageSource);
    gl.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_MIN_FILTER, GL.LINEAR);
    gl.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_MAG_FILTER, GL.LINEAR);
    gl.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_WRAP_S, GL.CLAMP_TO_EDGE);
    gl.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_WRAP_T, GL.CLAMP_TO_EDGE);
    const rec = { tex, w, h };
    this.cache.set(key, rec);
    this.touch(key);
    this.evict();
    return rec;
  }

  private touch(key: string) {
    this.order = this.order.filter(k => k !== key);
    this.order.push(key);
  }
  private evict() {
    while (this.order.length > this.limit) {
      const old = this.order.shift()!;
      const rec = this.cache.get(old);
      if (rec) { this.gl.deleteTexture(rec.tex); this.cache.delete(old); }
    }
  }
}
