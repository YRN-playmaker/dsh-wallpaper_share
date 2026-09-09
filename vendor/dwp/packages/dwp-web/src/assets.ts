/**
 * 资源加载（design-runtime.md §4，R3）：DWP 包文件 → 可绘制资源 + assetSizes。
 * 解 zip 在宿主做（share/editor），本层只吃 PackageFiles = Map<path, Blob|ArrayBuffer>；
 * 无 files 时按 baseUrl fetch（demo/在线预览）。图片 createImageBitmap，视频建 <video loop muted playsinline>。
 * 浏览器专用（依赖 createImageBitmap/document/URL），不进 Node 测试网。
 */
import type { Scene } from 'dwp-core';
import type { DomTextureProvider } from 'dwp-gl';

export type PackageFiles = Map<string, Blob | ArrayBuffer>;
type AssetKind = 'image' | 'video';

export interface AssetRef { path: string; kind: AssetKind }

/** 收集场景引用的资源路径（image/video 用 src，particle 用 texture 作 stamp）。 */
export function collectAssetRefs(scene: Scene): AssetRef[] {
  const seen = new Map<string, AssetRef>();
  for (const l of scene.layers ?? []) {
    if (l.type === 'image') add(seen, l.src, 'image');
    else if (l.type === 'video') add(seen, l.src, 'video');
    else if (l.type === 'particle') add(seen, l.texture, 'image');
    else if (l.type === 'mesh') for (const p of l.parts ?? []) add(seen, (p as { texture?: string }).texture, 'image');
  }
  return [...seen.values()];
}
function add(m: Map<string, AssetRef>, path: string | undefined, kind: AssetKind) {
  if (path && path !== '@solid' && !m.has(path)) m.set(path, { path, kind });
}

export interface LoadedAssets {
  sizes: Record<string, { w: number; h: number }>;
  registerInto(tex: DomTextureProvider): void;
  imageSource(id: string): unknown | null;
  playVideos(): void;
  pauseVideos(): void;
  dispose(): void;
}

export async function loadAssets(
  scene: Scene,
  opts: { files?: PackageFiles; baseUrl?: string } = {},
): Promise<LoadedAssets> {
  const refs = collectAssetRefs(scene);
  const sizes: Record<string, { w: number; h: number }> = {};
  const bitmaps = new Map<string, ImageBitmap>();
  const videos = new Map<string, HTMLVideoElement>();

  const blobOf = async (path: string): Promise<Blob> => {
    const hit = opts.files?.get(path) ?? opts.files?.get(normalize(path));
    if (hit) return hit instanceof Blob ? hit : new Blob([hit]);
    if (opts.baseUrl) {
      const res = await fetch(new URL(path, opts.baseUrl).href);
      if (!res.ok) throw new Error(`资源拉取失败 ${path}: ${res.status}`);
      return await res.blob();
    }
    throw new Error(`包内缺资源且无 baseUrl: ${path}`);
  };

  await Promise.all(refs.map(async (ref) => {
    const blob = await blobOf(ref.path);
    if (ref.kind === 'image') {
      const bmp = await createImageBitmap(blob);
      bitmaps.set(ref.path, bmp);
      sizes[ref.path] = { w: bmp.width, h: bmp.height };
    } else {
      const url = URL.createObjectURL(blob);
      const v = document.createElement('video');
      v.src = url; v.loop = true; v.muted = true; v.playsInline = true; v.preload = 'auto';
      await new Promise<void>((res) => {
        v.onloadedmetadata = () => res();
        v.onerror = () => res();   // 视频解码失败不阻断挂载（该层后续按缺资源降级）
      });
      videos.set(ref.path, v);
      sizes[ref.path] = { w: v.videoWidth || 0, h: v.videoHeight || 0 };
    }
  }));

  return {
    sizes,
    registerInto(tex) {
      for (const [id, bmp] of bitmaps) tex.register(id, bmp);
      for (const [id, v] of videos) tex.registerVideo(id, v);
    },
    imageSource(id) { return bitmaps.get(id) ?? videos.get(id) ?? null; },
    playVideos() { for (const v of videos.values()) void v.play().catch(() => {}); },
    pauseVideos() { for (const v of videos.values()) v.pause(); },
    dispose() {
      for (const b of bitmaps.values()) b.close?.();
      for (const [id, v] of videos) { v.pause(); v.src = ''; const u = v.currentSrc; if (u?.startsWith('blob:')) URL.revokeObjectURL(u); void id; }
    },
  };
}

const normalize = (p: string) => p.replace(/^\.\//, '').replace(/^\/+/, '');
