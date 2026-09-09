/**
 * evaluate：CompiledDoc + FrameInput → RenderPlan（design-runtime.md §1/§2）。
 * 纯函数：不读墙钟/Math.random；时间、视口、时钟上下文、纹理尺寸全部显式注入。
 * v0.1 覆盖 solid/image/video/text/mesh(rigid) + scene 级效果 pass；particle → unsupported（R1.5）。
 */
import type { BlendName, FrameInput, Layer, RGBA, RenderPlan, RenderStep, TimeContext } from './types.ts';
import type { CompiledDoc, CompiledLayer } from './compile.ts';
import { boxMatrix, fitScale, mul, parseColor, quadUV, quadVerts, rotate, translate } from './layout.ts';
import { evalLayerAnimation, oscillateDelta, scrollValue, type CompiledAnim } from './anim.ts';
import { evalMesh } from './bones.ts';
import { emitParticleSteps, type SimState } from './particles.ts';
import { expandSceneEffects, foldLayerEffects, type EffectFold } from './effects.ts';
import { slotVerts, type PlanPool, type PlanSlot } from './pool.ts';
import { resolveColor, resolveNum, type VarTable } from './vars.ts';

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** tint 叠加：base × tint（预乘 alpha 空间，协议 §5.3）。tint 缺省直通。 */
function tintMul(base: RGBA, tint?: RGBA): RGBA {
  if (!tint) return base;
  return [base[0] * tint[0], base[1] * tint[1], base[2] * tint[2], base[3] * tint[3]];
}

interface EvalCtx {
  doc: CompiledDoc;
  input: FrameInput;
  t: number;                       // 已折叠 scene.loop 的时间
  vw: number; vh: number;          // 视口 px
  sx: number; sy: number;          // 设计px→视口px 缩放（fit）
  vars: VarTable;
}

export function evaluate(doc: CompiledDoc, input: FrameInput, sim?: SimState | null, pool?: PlanPool): RenderPlan {
  const { viewport } = input;
  const dpr = input.dpr ?? 1;
  const t = doc.loop && doc.loop > 0 ? ((input.t % doc.loop) + doc.loop) % doc.loop : input.t;
  const [sx, sy] = fitScale(doc.canvas.fit, doc.canvas.width, doc.canvas.height, viewport.w, viewport.h);
  const ctx: EvalCtx = { doc, input, t, vw: viewport.w, vh: viewport.h, sx, sy, vars: doc.vars };

  const slot = pool?.acquire();
  const steps: RenderStep[] = slot?.steps ?? [];
  const unsupported: RenderPlan['unsupported'] = slot?.unsupported ?? [];
  const clearColor = parseColor(resolveColor(doc.canvas.background, doc.vars) ?? '#000000');

  // 效果展开（R1.6）：scene 级 → pass 链 + view/alpha 折叠；图层级 → 可折叠进图层，像素级报 deferred
  const effects = doc.scene.effects ?? [];
  const sceneFx = expandSceneEffects(effects, t, doc.vars, viewport.w, viewport.h);

  // 粒子：一次性推进模拟到步号 k（有状态，需宿主传入 createSim 产物）
  const particleSteps = new Map<string, RenderStep>();
  if (sim) {
    for (const p of emitParticleSteps(sim, doc, doc.vars, t, viewport.w, viewport.h, sx, sy, input)) {
      particleSteps.set(p.layer, p.step as RenderStep);
    }
  }

  for (const cl of doc.layers) {
    const layer = cl.raw;
    if (layer.visible === false) continue;
    const fold = foldLayerEffects(effects, layer.id, t, doc.vars);
    if (fold.deferred.length) {
      unsupported.push({ id: layer.id, reason: `layer-effect-deferred (${[...new Set(fold.deferred)].join(',')})` });
    }
    if (layer.type === 'particle') {
      const ps = particleSteps.get(layer.id);
      if (ps) {
        applyParticleAlpha(ps, sceneFx.opacityMul * fold.alphaMul);
        steps.push(ps);
      } else {
        unsupported.push({ id: layer.id, reason: 'particle-sim-not-supplied (createSim)' });
      }
      continue;
    }
    const r = layer.type === 'mesh'
      ? resolveMeshLayer(layer, cl, ctx, fold, sceneFx.opacityMul, slot)
      : resolveLayer(layer, cl, ctx, fold, sceneFx.opacityMul, slot);
    if ('reason' in r) unsupported.push({ id: layer.id, reason: r.reason });
    else { steps.push(...r.steps); if (r.notes) unsupported.push(...r.notes); }
  }

  steps.push(...sceneFx.passes);
  return {
    planVersion: 1,
    view: [dpr, 0, 0, dpr, sceneFx.viewDX * dpr, sceneFx.viewDY * dpr],
    clear: clearColor, steps, unsupported,
  };
}

function applyParticleAlpha(step: RenderStep, mul: number) {
  if (mul === 1 || step.op !== 'particles') return;
  for (let i = 5; i < step.buffer.length; i += step.stride) step.buffer[i] *= mul;
}

// ---------- 基变换解析（图层动画：keyframes 绝对 / oscillate·scroll 相对基值，协议 §4.3） ----------

interface BaseTransform { offX: number; offY: number; rot: number; sclX: number; sclY: number; alpha: number }

function resolveBaseTransform(layer: Layer, anim: CompiledAnim | undefined, ctx: EvalCtx): BaseTransform {
  const { vars, t } = ctx;
  const num = (v: number | string | undefined, fb: number) =>
    v === undefined ? fb : typeof v === 'number' ? v : resolveNum(v, vars, fb);

  let offX = layer.offset?.[0] ?? 0, offY = layer.offset?.[1] ?? 0;
  let rot = typeof layer.rotation === 'object' ? 0 : resolveNum(layer.rotation, vars, 0);
  let sclX = resolveNum(layer.scale, vars, 1), sclY = sclX;
  let alpha = resolveNum(layer.alpha, vars, 1);

  const kv = evalLayerAnimation(anim, t, vars);
  if (kv['offset.x'] !== undefined) offX = num(kv['offset.x'], offX);
  if (kv['offset.y'] !== undefined) offY = num(kv['offset.y'], offY);
  if (kv.rotation !== undefined) rot = num(kv.rotation, rot);
  if (kv.scale !== undefined) { sclX = num(kv.scale, sclX); sclY = sclX; }
  if (kv['scale.x'] !== undefined) sclX = num(kv['scale.x'], sclX);
  if (kv['scale.y'] !== undefined) sclY = num(kv['scale.y'], sclY);
  if (kv.alpha !== undefined) alpha = num(kv.alpha, alpha);

  if (anim?.kind === 'oscillate' && anim.property) {
    const d = oscillateDelta(anim, t);
    switch (anim.property) {
      case 'offset.x': offX += d; break;
      case 'offset.y': offY += d; break;
      case 'rotation': rot += d; break;
      case 'scale': sclX += d; sclY += d; break;
      case 'scale.x': sclX += d; break;
      case 'scale.y': sclY += d; break;
      case 'alpha': alpha += d; break;
    }
  }
  if (anim?.kind === 'scroll' && anim.property) {
    if (anim.property === 'offset.x') offX = scrollValue(layer.offset?.[0] ?? 0, anim, t);
    else if (anim.property === 'offset.y') offY = scrollValue(layer.offset?.[1] ?? 0, anim, t);
  }
  return { offX, offY, rot, sclX, sclY, alpha: clamp01(alpha) };
}

// ---------- 普通图层 ----------

interface ResolvedOk { steps: RenderStep[]; notes?: Array<{ id: string; reason: string }> }
interface ResolvedSkip { reason: string }

function resolveLayer(layer: Layer, cl: CompiledLayer, ctx: EvalCtx,
                      fold: EffectFold, opacityMul: number, slot?: PlanSlot): ResolvedOk | ResolvedSkip {
  const { vars } = ctx;
  const bt = resolveBaseTransform(layer, cl.anim, ctx);
  const anchor = layer.anchor ?? [0.5, 0.5];
  const origin = layer.origin ?? [0.5, 0.5];
  const alpha = clamp01(bt.alpha * fold.alphaMul * opacityMul);
  const vertsOf = (w: number, h: number) => (slot ? slotVerts(slot, w, h) : quadVerts(w, h));

  let sizeW = layer.size?.[0], sizeH = layer.size?.[1];
  const kv = evalLayerAnimation(cl.anim, ctx.t, vars);
  const num = (v: number | string | undefined, fb: number) =>
    v === undefined ? fb : typeof v === 'number' ? v : resolveNum(v, vars, fb);
  if (kv['size.w'] !== undefined) sizeW = num(kv['size.w'], sizeW ?? 0);
  if (kv['size.h'] !== undefined) sizeH = num(kv['size.h'], sizeH ?? 0);
  if (cl.anim?.kind === 'oscillate') {
    const d = oscillateDelta(cl.anim, ctx.t);
    if (cl.anim.property === 'size.w') sizeW = (sizeW ?? 0) + d;
    if (cl.anim.property === 'size.h') sizeH = (sizeH ?? 0) + d;
  }
  let uvOffset: [number, number] | undefined;
  if (cl.anim?.kind === 'scroll' && cl.anim.property === 'uvOffset') {
    uvOffset = [scrollValue(0, cl.anim, ctx.t), 0];
  }

  let texW = sizeW, texH = sizeH;
  if (layer.type === 'text') {
    texW = sizeW ?? 0; texH = sizeH ?? 0;                    // 文本盒由执行器测量（core 不碰字体）
  } else if (texW === undefined || texH === undefined) {
    const path = layer.src ?? layer.texture;
    const natural = path ? ctx.input.assetSizes?.[path] : undefined;
    if (!natural) return { reason: `size:null 且宿主未注入纹理尺寸: ${path ?? layer.id}` };
    texW = natural.w; texH = natural.h;
  }
  const w = texW * ctx.sx, h = texH * ctx.sy;
  const cx = anchor[0] * ctx.vw + (bt.offX + fold.offX) * ctx.sx;
  const cy = anchor[1] * ctx.vh + (bt.offY + fold.offY) * ctx.sy;
  const matrix = boxMatrix(cx, cy, w, h, origin, bt.rot, bt.sclX, bt.sclY);
  const blend = (layer.blend ?? 'normal') as BlendName;

  switch (layer.type) {
    case 'solid': {
      const tint = tintMul(parseColor(resolveColor(layer.color, vars) ?? '#ffffff'), fold.tint);
      return { steps: [{ op: 'quad', layer: layer.id, tex: '@solid', verts: vertsOf(w, h), uv: quadUV(), matrix, blend, alpha, tint }] };
    }
    case 'image':
    case 'video': {
      return { steps: [{ op: 'quad', layer: layer.id, tex: layer.src ?? '', verts: vertsOf(w, h), uv: quadUV(), matrix, blend, alpha, ...(fold.tint ? { tint: fold.tint } : {}), ...(uvOffset ? { uvOffset } : {}) }] };
    }
    case 'text': {
      const text = formatPlaceholders(layer.value ?? '', ctx.input.timeContext);
      const { sizePx, font } = parseFont(layer.font ?? '16px sans-serif');
      const color = tintMul(parseColor(resolveColor(layer.color, vars) ?? '#ffffff'), fold.tint);
      return { steps: [{ op: 'text', layer: layer.id, blend, alpha,
        run: { text, font, sizePx, color, align: 'center', baseline: 'middle', matrix } }] };
    }
    default:
      return { reason: `未知图层类型: ${(layer as Layer).type}` };
  }
}

// ---------- mesh 图层（rigid puppet，§4.5） ----------

function resolveMeshLayer(layer: Layer, cl: CompiledLayer, ctx: EvalCtx,
                          fold: EffectFold, opacityMul: number, slot?: PlanSlot): ResolvedOk | ResolvedSkip {
  if (!cl.mesh) return { reason: 'mesh 编译缺失' };
  const bt = resolveBaseTransform(layer, cl.anim, ctx);
  const anchor = layer.anchor ?? [0.5, 0.5];
  const cx = anchor[0] * ctx.vw + (bt.offX + fold.offX) * ctx.sx;
  const cy = anchor[1] * ctx.vh + (bt.offY + fold.offY) * ctx.sy;
  const alpha = clamp01(bt.alpha * fold.alphaMul * opacityMul);
  // 图层整体矩阵：anchor 定位 + fit×layerScale（骨骼/部件的设计px局部坐标经此矩阵进视口px）
  let layerMatrix = mul(translate(cx, cy), rotate(bt.rot));
  layerMatrix = mul(layerMatrix, [bt.sclX * ctx.sx, 0, 0, bt.sclY * ctx.sy, 0, 0]);

  const quads = evalMesh(cl.mesh, ctx.t, ctx.vars, layerMatrix);
  const blend = (layer.blend ?? 'normal') as BlendName;
  const steps: RenderStep[] = [];
  const missing: string[] = [];
  let skinnedCount = 0;
  for (const q of quads) {
    if (q.skinned) { skinnedCount++; continue; }        // GPU 蒙皮为 v1.0 可选高级（mesh-skinned），R2+ 实现
    const nat = ctx.input.assetSizes?.[q.src];
    if (!nat) { missing.push(q.src); continue; }
    steps.push({
      op: 'quad', layer: layer.id, tex: q.src,
      verts: slot ? slotVerts(slot, nat.w, nat.h) : quadVerts(nat.w, nat.h), uv: quadUV(),
      matrix: q.matrix, blend, alpha: alpha * q.alpha,
      ...(fold.tint ? { tint: fold.tint } : {}),
    });
  }
  const notes: Array<{ id: string; reason: string }> = [];
  if (skinnedCount) notes.push({ id: layer.id, reason: `skinned-part-deferred ×${skinnedCount}` });
  if (missing.length) return { reason: `部件纹理尺寸未注入: ${missing.join(', ')}` };
  return { steps, notes };
}

// ---------- 时钟占位符（协议 §4.1 text 层） ----------

const pad = (n: number) => String(n).padStart(2, '0');

export function formatPlaceholders(value: string, ctx?: TimeContext): string {
  return value.replace(/\{(time|date):([^}]+)\}/g, (_all, kind: string, fmt: string) => {
    if (!ctx) return kind === 'time' ? '12:34' : '2026-01-01';   // 无宿主时钟 → 确定性样例（编辑器/测试态）
    return fmt
      .replaceAll('yyyy', String(ctx.year))
      .replaceAll('MM', pad(ctx.month))
      .replaceAll('dd', pad(ctx.day))
      .replaceAll('HH', pad(ctx.hour))
      .replaceAll('mm', pad(ctx.minute))
      .replaceAll('ss', pad(ctx.second))
      .replaceAll('weekday', ctx.weekday);
  });
}

/** CSS font 简写解析："700 220px 'Segoe UI', sans-serif" → sizePx=220，font 保留全串（执行器直接喂 ctx.font） */
export function parseFont(spec: string): { sizePx: number; font: string } {
  const m = /(\d+(?:\.\d+)?)px/.exec(spec);
  if (m) return { sizePx: parseFloat(m[1]), font: spec };
  return { sizePx: 16, font: spec };
}
