/**
 * puppet / mesh（协议 §4.5，R1.4）：骨骼链 + 刚性部件 + clip。
 * - bind.offset = 父骨骼局部坐标系设计像素；骨骼全局矩阵 = 父链 2D 仿射复合（纯函数）；
 * - clip track 复用 §4.3 三种 kind 与同一求值器（core 无第二套动画系统）；
 * - v1.0 每 mesh 同时只有一个 active clip（规则 3）。
 */
import type { Animation, Bone, Clip, Layer, Mat6, Part, Vec2 } from './types.ts';
import { compileAnimation, evalTrack, oscillateDelta, scrollValue, type CompiledAnim } from './anim.ts';
import { mul, rotate, scale as mscale, translate } from './layout.ts';
import { DocumentError } from './errors.ts';
import { resolveNum, type VarTable } from './vars.ts';

export type BoneProp = 'offset.x' | 'offset.y' | 'rotation' | 'scale' | 'scale.x' | 'scale.y';

export interface CompiledBone { name: string; parent: string | null; offset: Vec2; rotation: number }
export interface CompiledPart { src: string; bone: string; offset: Vec2; rotation: number; order: number; alpha: number; index: number; skinned: boolean }
export interface CompiledClipTrack { bone: string; prop: BoneProp; anim: CompiledAnim }
export interface CompiledClip { name: string; loop: boolean; span: number; tracks: CompiledClipTrack[] }

export interface CompiledMesh {
  bones: CompiledBone[];                    // 拓扑序（父先于子）
  parts: CompiledPart[];                    // 已按 order 稳定排序
  activeClip?: CompiledClip;
}

const TRACK_KEY = /^([a-zA-Z][a-zA-Z0-9_-]*)\.(offset\.[xy]|rotation|scale(?:\.[xy])?)$/;

export function compileMesh(layer: Layer, ptr: string): { mesh?: CompiledMesh; errors: DocumentError[] } {
  const errors: DocumentError[] = [];
  const bones = layer.bones ?? [];
  const parts = layer.parts ?? [];
  const clips = layer.clips ?? [];

  // ---- 骨骼：唯一名 / 父存在 / 无环 / 拓扑排序 ----
  const byName = new Map<string, CompiledBone>();
  const compiled: CompiledBone[] = [];
  bones.forEach((b: Bone, i) => {
    const p = `${ptr}/bones/${i}`;
    if (byName.has(b.name)) {
      errors.push(new DocumentError('dup-bone-name', p, `骨骼名重复: ${b.name}`));
      return;
    }
    if (b.parent != null && !byName.has(b.parent) && !bones.some((x, j) => j > i && x.name === b.parent)) {
      errors.push(new DocumentError('bone-parent-missing', p, `骨骼 ${b.name} 的父不存在: ${b.parent}`));
    }
    byName.set(b.name, {
      name: b.name, parent: b.parent ?? null,
      offset: [b.bind?.offset?.[0] ?? 0, b.bind?.offset?.[1] ?? 0],
      rotation: b.bind?.rotation ?? 0,
    });
  });
  // 拓扑序（Kahn）；环 → 报错。父缺失的骨骼按根处理（错误已单独上报，不重复报环）
  const indeg = new Map<string, number>();
  const children = new Map<string, string[]>();
  for (const [name, b] of byName) {
    const parentOk = b.parent != null && byName.has(b.parent);
    indeg.set(name, parentOk ? 1 : 0);
    if (parentOk) children.set(b.parent!, [...(children.get(b.parent!) ?? []), name]);
  }
  let queue = [...byName.keys()].filter(n => indeg.get(n) === 0);
  while (queue.length) {
    const n = queue.shift()!;
    compiled.push(byName.get(n)!);
    for (const c of children.get(n) ?? []) {
      indeg.set(c, indeg.get(c)! - 1);
      if (indeg.get(c) === 0) queue.push(c);
    }
  }
  if (compiled.length !== byName.size) {
    errors.push(new DocumentError('bone-cycle', `${ptr}/bones`, '骨骼父子关系存在环'));
  }

  // ---- 部件：绑骨存在 ----
  const compiledParts: CompiledPart[] = parts.map((pt: Part, i) => {
    const p = `${ptr}/parts/${i}`;
    if (!byName.has(pt.bone)) {
      errors.push(new DocumentError('part-bone-missing', p, `部件 ${pt.src} 绑定的骨骼不存在: ${pt.bone}`));
    }
    return {
      src: pt.src, bone: pt.bone,
      offset: [pt.offset?.[0] ?? 0, pt.offset?.[1] ?? 0] as [number, number],
      rotation: pt.rotation ?? 0, order: pt.order ?? 0, alpha: pt.alpha ?? 1, index: i,
      skinned: !!pt.mesh,
    };
  }).sort((a, b) => a.order - b.order || a.index - b.index);   // 规则 4：order 稳定排序

  // ---- clip：≤1 active（规则 3）+ track key 形态 ----
  const active = clips.filter(c => c.active === true);
  if (active.length > 1) {
    errors.push(new DocumentError('multi-active-clip', `${ptr}/clips`, `v1.0 只允许一个 active clip，收到 ${active.length} 个`));
  }
  let activeClip: CompiledClip | undefined;
  if (active.length === 1) {
    const clip = active[0];
    const tracks: CompiledClipTrack[] = [];
    let span = 0;
    for (const [key, anim] of Object.entries(clip.tracks ?? {})) {
      const m = TRACK_KEY.exec(key);
      const p = `${ptr}/clips/${clip.name}/tracks/${key}`;
      if (!m) {
        errors.push(new DocumentError('bad-clip-track', p, `track key 需为 "骨名.offset.x|offset.y|rotation|scale[.x|.y]"，收到: ${key}`));
        continue;
      }
      const [, bone, prop] = m;
      if (!byName.has(bone)) {
        errors.push(new DocumentError('clip-track-bone-missing', p, `track 引用骨骼不存在: ${bone}`));
        continue;
      }
      try {
        const compiledAnim = compileClipTrack(prop as BoneProp, anim, p);
        for (const tr of compiledAnim.tracks ?? []) span = Math.max(span, tr.span);
        tracks.push({ bone, prop: prop as BoneProp, anim: compiledAnim });
      } catch (e) {
        errors.push(new DocumentError((e as Error & { code?: string }).code ?? 'bad-clip-track', p, (e as Error).message));
      }
    }
    activeClip = { name: clip.name, loop: clip.loop !== false, span, tracks };
  }

  if (errors.length) return { errors };
  return { mesh: { bones: compiled, parts: compiledParts, activeClip }, errors };
}

/** clip 单轨直写形态（§4.5 示例）：keyframes 用顶层 frames；oscillate/scroll 的 property 由 track key 提供。 */
function compileClipTrack(prop: BoneProp, anim: Animation, ptr: string): CompiledAnim {
  if (anim.kind === 'keyframes') {
    if (!anim.frames) {
      const err = new Error('clip track 的 keyframes 必须直写 frames（不接受嵌套 tracks）') as Error & { code: string };
      err.code = 'bad-clip-track';
      throw err;
    }
    return compileAnimation({
      kind: 'keyframes',
      tracks: { [prop]: { easing: anim.easing, loop: anim.loop, frames: anim.frames } },
    }, ptr);
  }
  return compileAnimation({ ...anim, property: prop } as Animation, ptr);
}

// ---------- 运行期 ----------

export interface MeshPartQuad { src: string; matrix: Mat6; alpha: number; skinned: boolean }

/**
 * 求值 mesh 图层 → 部件四边形（设计px局部，matrix 已含 layerMatrix 与父链）。
 * layerMatrix：mesh 图层整体变换（anchor/fit/layer 动画），部件尺寸用 assetSizes 自然尺寸。
 */
export function evalMesh(mesh: CompiledMesh, t: number, vars: VarTable, layerMatrix: Mat6): MeshPartQuad[] {
  interface BoneState { offX: number; offY: number; rot: number; sclX: number; sclY: number }
  const state = new Map<string, BoneState>();
  for (const b of mesh.bones) state.set(b.name, { offX: b.offset[0], offY: b.offset[1], rot: b.rotation, sclX: 1, sclY: 1 });

  const clip = mesh.activeClip;
  if (clip) {
    const tt = clip.loop && clip.span > 0 ? ((t % clip.span) + clip.span) % clip.span : t;
    for (const tr of clip.tracks) {
      const s = state.get(tr.bone)!;
      const base = tr.prop === 'offset.x' ? s.offX : tr.prop === 'offset.y' ? s.offY : tr.prop === 'rotation' ? s.rot : 1;
      if (tr.anim.kind === 'keyframes') {
        const v = evalTrack(tr.anim.tracks![0], tt, vars);
        const n = typeof v === 'number' ? v : resolveNum(v, vars, base);
        applyBoneProp(s, tr.prop, n, false);
      } else if (tr.anim.kind === 'oscillate') {
        applyBoneProp(s, tr.prop, base + oscillateDelta(tr.anim, tt), false);
      } else if (tr.anim.kind === 'scroll') {
        applyBoneProp(s, tr.prop, scrollValue(base, tr.anim, tt), false);
      }
    }
  }

  // 父链复合（mesh.bones 已拓扑序）
  const world = new Map<string, Mat6>();
  for (const b of mesh.bones) {
    const s = state.get(b.name)!;
    let local = mul(translate(s.offX, s.offY), rotate(s.rot));
    local = mul(local, mscale(s.sclX, s.sclY));
    const parentWorld = b.parent ? world.get(b.parent)! : layerMatrix;
    world.set(b.name, mul(parentWorld, local));
  }

  return mesh.parts.map(pt => {
    const boneWorld = world.get(pt.bone) ?? layerMatrix;
    const m = mul(mul(boneWorld, translate(pt.offset[0], pt.offset[1])), rotate(pt.rotation));
    return { src: pt.src, matrix: m, alpha: pt.alpha, skinned: pt.skinned };
  });
}

function applyBoneProp(s: { offX: number; offY: number; rot: number; sclX: number; sclY: number },
                       prop: BoneProp, value: number, _relative: boolean) {
  switch (prop) {
    case 'offset.x': s.offX = value; break;
    case 'offset.y': s.offY = value; break;
    case 'rotation': s.rot = value; break;
    case 'scale': s.sclX = value; s.sclY = value; break;
    case 'scale.x': s.sclX = value; break;
    case 'scale.y': s.sclY = value; break;
  }
}
