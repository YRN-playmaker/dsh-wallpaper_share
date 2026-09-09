/**
 * mount / Handle（design-runtime.md §4，R3）：把 core + gl/canvas2d + 资源 + 时钟
 * 组装成一个可挂载到 <canvas> 的壁纸实例。web 层唯一读墙钟处。
 *
 * 执行器选择：canvas.getContext('webgl2') 成功 → GL 路径；否则 → Canvas2D 降级
 * （消费同一 RenderPlan，post pass 记 degraded）。两者输入完全一致 → 布局/动画同源。
 * 浏览器专用，不进 Node 测试网（依赖 DOM/RAF/createImageBitmap）。
 */
import { compile, evaluate, setParam, createSim, createPool } from 'dwp-core';
import type { Scene, Manifest, CompiledDoc, FrameInput, TimeContext, VarValue } from 'dwp-core';
import { Renderer, DomTextureProvider, CanvasTextProvider, type GLContext } from 'dwp-gl';
import { Canvas2DRenderer, type Ctx2D } from './canvas2d.ts';
import { loadAssets, type LoadedAssets, type PackageFiles } from './assets.ts';
import { createClock, advance, seek as seekClock, play as clockPlay, pause as clockPause } from './clock.ts';

export interface MountOptions {
  scene: Scene;
  manifest?: Manifest;
  files?: PackageFiles;         // 解 zip 后的包文件（宿主提供）
  baseUrl?: string;             // 或按 URL 拉取（在线预览）
  params?: Record<string, VarValue>;
  dpr?: number;
  autoplay?: boolean;
  seed?: number;
  forceCanvas2D?: boolean;      // 跳过 WebGL2 探测，强制降级路径（测试/低配）
  onDegrade?: (degraded: string[]) => void;   // 降级项变化时回调
  onFrame?: (info: { t: number; fps: number; mode: 'gl' | 'canvas2d' }) => void;
}

export interface Handle {
  play(): void;
  pause(): void;
  seek(t: number): void;
  setParam(key: string, value: VarValue): void;
  resize(): void;
  snapshotAt(t: number): Promise<Blob>;
  dispose(): void;
  readonly mode: 'gl' | 'canvas2d';
}

interface Executor {
  render(plan: ReturnType<typeof evaluate>): string[];   // 返回执行器级 degraded（canvas2d pass 等）
  resize(w: number, h: number, dpr: number): void;
  dispose(): void;
}

export async function mount(canvas: HTMLCanvasElement, opts: MountOptions): Promise<Handle> {
  let doc = compile(opts.manifest, opts.scene);
  if (opts.params) for (const [k, v] of Object.entries(opts.params)) doc = setParam(doc, k, v);

  const assets: LoadedAssets = await loadAssets(opts.scene, { files: opts.files, baseUrl: opts.baseUrl });
  const dpr = opts.dpr ?? Math.min(window.devicePixelRatio || 1, 2);
  const sim = createSim(doc, opts.seed ?? 0);
  const pool = createPool();
  const clock = createClock({ playing: opts.autoplay ?? true });

  const gl = opts.forceCanvas2D ? null : canvas.getContext('webgl2', { alpha: false, antialias: true, premultipliedAlpha: true });
  let executor: Executor;
  let mode: 'gl' | 'canvas2d';

  if (gl) {
    mode = 'gl';
    const textures = new DomTextureProvider(gl as unknown as GLContext);
    assets.registerInto(textures);
    const text = new CanvasTextProvider(gl as unknown as GLContext);
    const renderer = new Renderer(gl as unknown as GLContext, {
      dpr, viewport: { w: canvas.clientWidth, h: canvas.clientHeight }, textures, text,
    });
    executor = {
      render: (plan) => { renderer.render(plan); return []; },
      resize: (w, h, d) => renderer.resize({ w, h }, d),
      dispose: () => { renderer.dispose(); textures.dispose(); },
    };
    assets.playVideos();
  } else {
    mode = 'canvas2d';
    const ctx = canvas.getContext('2d') as Ctx2D | null;
    if (!ctx) throw new Error('无法获取 WebGL2 或 2D 上下文');
    const renderer = new Canvas2DRenderer(ctx, {
      dpr, viewport: { w: canvas.clientWidth, h: canvas.clientHeight },
      image: (id) => assets.imageSource(id),
    });
    executor = {
      render: (plan) => renderer.render(plan).degraded,
      resize: (w, h, d) => { canvas.width = w * d; canvas.height = h * d; },
      dispose: () => {},
    };
    assets.playVideos();
  }

  let raf = 0;
  let last = performance.now();
  let vw = canvas.clientWidth, vh = canvas.clientHeight;
  let lastDegradedKey = '';
  let frames = 0, fpsAt = performance.now(), fps = 0;
  let frameErrors = 0;
  let glFallbackDone = false;

  function frameInput(t: number): FrameInput {
    return { t, viewport: { w: vw, h: vh }, dpr, timeContext: nowContext(), assetSizes: assets.sizes };
  }

  function drawFrame(t: number) {
    if (canvas.width !== vw * dpr || canvas.height !== vh * dpr) {
      canvas.width = vw * dpr; canvas.height = vh * dpr;
      executor.resize(vw, vh, dpr);
    }
    const plan = evaluate(doc, frameInput(t), sim, pool);
    const degraded = [...plan.unsupported.map(u => `${u.id}:${u.reason}`), ...executor.render(plan)];
    const key = degraded.join('|');
    if (key !== lastDegradedKey) { lastDegradedKey = key; opts.onDegrade?.(degraded); }
  }

  /** 运行期 GL 异常 → 一次性降级 Canvas2D：同一 canvas 的 context mode 固定（webgl2 后
   *  getContext('2d') 返回 null），故换一个新 canvas 元素原位替换（样式/属性复制），
   *  用同一 RenderPlan 继续渲染。降级失败抛错由调用方兜底。 */
  function swapToCanvas2D(err: unknown): void {
    const oldCanvas = canvas;
    const fresh = document.createElement('canvas') as HTMLCanvasElement;
    const style = oldCanvas.getAttribute('style') ?? '';
    if (style !== '') fresh.setAttribute('style', style)
    for (let i = 0; i < oldCanvas.attributes.length; i++) {
      const a = oldCanvas.attributes[i]!
      if (a.name === 'style') continue
      fresh.setAttribute(a.name, a.value)
    }
    executor.dispose()
    oldCanvas.replaceWith(fresh)
    const ctx = fresh.getContext('2d') as Ctx2D | null
    if (!ctx) throw new Error('无法获取 2D 上下文')
    canvas = fresh
    vw = fresh.clientWidth || oldCanvas.clientWidth || 0
    vh = fresh.clientHeight || oldCanvas.clientHeight || 0
    const renderer = new Canvas2DRenderer(ctx, {
      dpr, viewport: { w: vw, h: vh },
      image: (id) => assets.imageSource(id),
    })
    executor = {
      render: (plan) => renderer.render(plan).degraded,
      resize: (w, h, d) => { fresh.width = w * d; fresh.height = h * d; },
      dispose: () => {},
    }
    mode = 'canvas2d'
    console.warn('[dwp] GL 渲染异常，已降级 Canvas2D：', err)
    opts.onDegrade?.(['gl-fallback-canvas2d:' + ((err as Error)?.message ?? String(err))])
  }

  function loop(now: number) {
    const dt = (now - last) / 1000; last = now;
    vw = canvas.clientWidth; vh = canvas.clientHeight;
    const t = advance(clock, dt);
    try {
      drawFrame(t);
      frameErrors = 0;
    } catch (e) {
      frameErrors++;
      // 运行期 GL 异常：一次性降级 Canvas2D 后继续渲染，避免背景永久冻结
      if (mode === 'gl' && !glFallbackDone) {
        glFallbackDone = true;
        try { swapToCanvas2D(e); frameErrors = 0 }
        catch (fe) { console.error('[dwp] Canvas2D 降级失败：', fe) }
      }
      // 节流告警（首次 + 每 300 帧一次），循环继续 → 瞬时异常自愈，不静默黑屏
      if (frameErrors === 1 || frameErrors % 300 === 0) {
        console.error('[dwp] 渲染帧错误（跳过该帧，循环继续）：', e)
        opts.onDegrade?.(['frame-error:' + ((e as Error)?.message ?? String(e))])
      }
    }
    frames++;
    if (now - fpsAt >= 500) { fps = (frames * 1000) / (now - fpsAt); frames = 0; fpsAt = now; }
    opts.onFrame?.({ t, fps, mode });
    raf = requestAnimationFrame(loop);
  }
  if (opts.autoplay ?? true) raf = requestAnimationFrame(loop);
  else drawFrame(clock.t);   // 静态首帧

  return {
    get mode() { return mode },
    play() { clockPlay(clock); assets.playVideos(); if (!raf) { last = performance.now(); raf = requestAnimationFrame(loop); } },
    pause() { clockPause(clock); assets.pauseVideos(); if (raf) { cancelAnimationFrame(raf); raf = 0; } },
    seek(t) { seekClock(clock, t); drawFrame(clock.t); },
    setParam(key, value) { doc = setParam(doc, key, value); drawFrame(clock.t); },
    resize() { vw = canvas.clientWidth; vh = canvas.clientHeight; drawFrame(clock.t); },
    async snapshotAt(t) {
      const wasRaf = raf; if (raf) { cancelAnimationFrame(raf); raf = 0; }
      drawFrame(t);   // 同步渲染到 canvas，紧接 toBlob 取当前缓冲
      const blob = await new Promise<Blob>((res, rej) =>
        canvas.toBlob(b => (b ? res(b) : rej(new Error('toBlob 失败'))), 'image/png'));
      if (wasRaf) raf = requestAnimationFrame(loop);
      return blob;
    },
    dispose() {
      if (raf) cancelAnimationFrame(raf);
      executor.dispose();
      assets.dispose();
    },
  };
}

/** 墙钟 → TimeContext（web 层特权；core 不读时间）。 */
function nowContext(): TimeContext {
  const d = new Date();
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]!;
  return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate(),
    hour: d.getHours(), minute: d.getMinutes(), second: d.getSeconds(), weekday };
}
