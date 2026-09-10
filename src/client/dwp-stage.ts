/**
 * DWP 渲染面（R4 client 半）：从 node 半伺服端点拉 scene + 资源，组装 PackageFiles，
 * 调 @dwp/web 的 mount() 把已装 .dwp 画到给定 <canvas>。
 * 浏览器专用（依赖 DOM/canvas/createImageBitmap），不进 Node 测试网；
 * 逻辑与 demo（dwp-runtime-web/demo）同源，复用同一 mount() → 像素一致。
 */
import { mount, collectAssetRefs, type Handle, type PackageFiles } from 'dwp-web';
import type { Scene, Manifest, VarValue } from 'dwp-core';
import { TINY_PNG } from './tiny-png.ts';

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export interface MountDwpOptions {
  fetchFn?: FetchFn;
  base?: string;
  params?: Record<string, VarValue>;
  autoplay?: boolean;
  forceCanvas2D?: boolean;
  /** 'hd' = 允许拉取场景声明的高档纹理（scene.dsh.hdAssets）；'sd'（缺省）= 用 1×1 占位图顶替它们 */
  quality?: 'sd' | 'hd';
  onDegrade?: (degraded: string[]) => void;
}

/**
 * 低档位用 1×1 全透明 PNG 顶替高档资源（字节见 tiny-png.ts，带回归测试）。
 * 为什么是"顶替"而不是"不传"：@dwp/web 的 loadAssets 对缺失资源直接抛错（整次挂载失败），
 * 所以必须给一个合法但极小的位图；这些图层在低档位 alpha 恒 0，画面上完全看不出来。
 */

/** 读取 scene 顶层的插件扩展字段 dsh.hdAssets（未知键 core 会忽略，这里防御式读取）。 */
function hdAssetsOf(scene: Scene): string[] {
  const ext = (scene as unknown as { dsh?: { hdAssets?: unknown } }).dsh
  const list = ext?.hdAssets
  return Array.isArray(list) ? list.filter((p): p is string => typeof p === 'string') : []
}

/** 拉取并挂载一个已装 DWP 到 canvas，返回可播放/截图/销毁的 Handle。 */
export async function mountDwp(canvas: HTMLCanvasElement, id: string, opts: MountDwpOptions = {}): Promise<Handle> {
  const fetchFn = opts.fetchFn ?? ((u: string, i?: RequestInit) => fetch(u, i));
  const base = opts.base ?? '/we-sync/dwp';
  const sceneRes = await fetchFn(`${base}/scene?id=${encodeURIComponent(id)}`, { cache: 'no-store' });
  if (!sceneRes.ok) throw new Error(`DWP scene 拉取失败 (${sceneRes.status})`);
  const scene = (await sceneRes.json()) as Scene;

  // manifest 尽力而为（params 默认值等）；拉不到不阻断（compile 允许 manifest 缺省）
  let manifest: Manifest | undefined
  try {
    const mres = await fetchFn(`${base}/manifest?id=${encodeURIComponent(id)}`, { cache: 'no-store' })
    if (mres.ok) manifest = (await mres.json()) as Manifest
  } catch { /* 无 manifest：走 scene 内联变量 */ }

  // 低档位：高档资源换成占位图 —— 不下载、不解码 8K 纹理（预览/捕获档才真的省）
  const stub = new Set(opts.quality === 'hd' ? [] : hdAssetsOf(scene))

  const files: PackageFiles = new Map();
  for (const ref of collectAssetRefs(scene)) {
    if (stub.has(ref.path)) { files.set(ref.path, new Blob([TINY_PNG], { type: 'image/png' })); continue }
    const r = await fetchFn(`${base}/file?id=${encodeURIComponent(id)}&name=${encodeURIComponent(ref.path)}`);
    if (r.ok) files.set(ref.path, await r.blob());   // 缺资源不阻断：mount 内部按缺资源降级
  }

  return mount(canvas, {
    scene,
    manifest,
    files,
    params: opts.params,
    autoplay: opts.autoplay,
    forceCanvas2D: opts.forceCanvas2D,
    onDegrade: opts.onDegrade,
  });
}
