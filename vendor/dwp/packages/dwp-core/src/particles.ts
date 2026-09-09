/**
 * 确定性粒子模拟（协议 §5.2 + design-runtime.md §1.1，R1.5）。
 * 核心不变量：状态(k) 是步号 k 的纯函数——
 *  - 固定 60Hz 步长（DT），k = floor(t×60)；
 *  - RNG = 计数器式派生：mulberry32(mix(seed, emitterIdx, k, spawnSeq))，可任意重放；
 *  - 回退/大跨度跳转 → 从最近 checkpoint 重放（checkpoint 每 300 步，环形 8 份）；
 *  - 模拟空间 = 设计像素（与视口无关 → 跨分辨率确定性），输出时经 fit 缩放烘进视口px。
 */
import type { CompiledDoc } from './compile.ts';
import type { Layer } from './types.ts';
import { resolveColor, resolveNum, type VarTable } from './vars.ts';

export const DT = 1 / 60;
const STRIDE = 8;                 // x,y,vx,vy,rot0,rotSpeed,life,lifeMax
const OUT_STRIDE = 8;             // x,y,rot,sizeW,sizeH,alpha,life01,reserved
const CHECKPOINT_EVERY = 300;
const CHECKPOINT_RING = 8;

function mix(...nums: number[]): number {
  let h = 2166136261;
  for (const n of nums) { h ^= n | 0; h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry32(a: number): () => number {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** [[fraction, value], ...] 分段线性（钳两端）。 */
export function curve(pairs: Array<[number, number]>, f: number): number {
  if (!pairs.length) return 0;
  if (f <= pairs[0][0]) return pairs[0][1];
  if (f >= pairs[pairs.length - 1][0]) return pairs[pairs.length - 1][1];
  for (let i = 1; i < pairs.length; i++) {
    if (f <= pairs[i][0]) {
      const [f0, v0] = pairs[i - 1], [f1, v1] = pairs[i];
      const u = f1 === f0 ? 0 : (f - f0) / (f1 - f0);
      return v0 + (v1 - v0) * u;
    }
  }
  return pairs[pairs.length - 1][1];
}

interface Checkpoint { k: number; count: number; data: Float32Array; acc: number; spawnSeq: number }

interface EmitterState {
  layerIndex: number;
  seed: number;                   // mix(全局 seed, layer.seed)——协议 §5.2 的 (seed, emitterId, 步序号) 派生
  lastK: number;
  count: number;
  data: Float32Array;             // 池（密集前缀 + swap-remove）
  acc: number;                    // 发射预算累加器
  spawnSeq: number;
  checkpoints: Checkpoint[];      // 环形
  outBufs: [Float32Array, Float32Array];   // 输出双缓冲（编辑器 60fps 零分配）
  outIdx: number;
}

export interface SimState { seed: number; emitters: EmitterState[] }

/** 收集 particle 图层（文档声明序）。 */
export function createSim(doc: CompiledDoc, seed: number): SimState | null {
  const emitters: EmitterState[] = [];
  for (const cl of doc.layers) {
    if (cl.raw.type !== 'particle') continue;
    const cap = Math.min(cl.raw.maxCount ?? 2000, 20000);
    emitters.push({
      layerIndex: cl.index, seed: mix(seed, cl.raw.seed ?? 0, cl.index), lastK: 0, count: 0,
      data: new Float32Array(cap * STRIDE), acc: 0, spawnSeq: 0, checkpoints: [],
      outBufs: [new Float32Array(0), new Float32Array(0)], outIdx: 0,
    });
  }
  return emitters.length ? { seed, emitters } : null;
}

function advanceEmitter(em: EmitterState, layer: Layer, toK: number, seed: number, emitterIdx: number,
                        vars: VarTable, canvasW: number, canvasH: number) {
  if (toK < em.lastK || toK - em.lastK > CHECKPOINT_EVERY) {
    // 回退或大跨度：从最近可用 checkpoint 重放
    let best: Checkpoint | null = null;
    for (const cp of em.checkpoints) {
      if (cp.k <= toK && (!best || cp.k > best.k)) best = cp;
    }
    if (best) {
      em.count = best.count; em.data.set(best.data); em.acc = best.acc; em.spawnSeq = best.spawnSeq;
      em.lastK = best.k;
    } else {
      em.count = 0; em.acc = 0; em.spawnSeq = 0; em.lastK = 0;   // 无可用 checkpoint：从头重放
    }
  }
  while (em.lastK < toK) {
    em.lastK++;
    stepOnce(em, layer, em.lastK, seed, emitterIdx, vars, canvasW, canvasH);
    if (em.lastK % CHECKPOINT_EVERY === 0) {
      em.checkpoints.push({ k: em.lastK, count: em.count, data: em.data.slice(), acc: em.acc, spawnSeq: em.spawnSeq });
      if (em.checkpoints.length > CHECKPOINT_RING) em.checkpoints.shift();
    }
  }
}

function stepOnce(em: EmitterState, layer: Layer, k: number, seed: number, emitterIdx: number,
                  vars: VarTable, canvasW: number, canvasH: number) {
  const cap = em.data.length / STRIDE;
  const emu = layer.emitter ?? { shape: 'point' as const };
  // 1) 发射
  const rate = resolveNum(emu.rate, vars, 0);
  em.acc += rate * DT;
  let n = Math.floor(em.acc);
  em.acc -= n;
  const boxW = (emu.size?.[0] ?? 0) * canvasW, boxH = (emu.size?.[1] ?? 0) * canvasH;
  const dir0 = resolveNum(layer.velocity?.direction, vars, 90);
  const spread = layer.velocity?.spread ?? 0;
  const sp0 = resolveNum(layer.velocity?.speed?.[0], vars, 100);
  const sp1 = resolveNum(layer.velocity?.speed?.[1], vars, sp0);
  const life0 = layer.life?.[0] ?? 1, life1 = layer.life?.[1] ?? life0;
  const spin = typeof layer.rotation === 'object' && layer.rotation.spin ? layer.rotation.spin : [0, 0];
  const spin0 = resolveNum(spin[0], vars, 0), spin1 = resolveNum(spin[1], vars, spin0);
  const rol0 = resolveNum(layer.rotationOverLife?.[0], vars, 0);
  const rol1 = resolveNum(layer.rotationOverLife?.[1], vars, rol0);

  while (n-- > 0 && em.count < cap) {
    const r = mulberry32(mix(em.seed, k, em.spawnSeq++));
    const i = em.count * STRIDE;
    const d = em.data;
    d[i] = emu.shape === 'box' ? (r() * 2 - 1) * boxW / 2 : 0;
    d[i + 1] = emu.shape === 'box' ? (r() * 2 - 1) * boxH / 2 : 0;
    const dir = (dir0 + (r() * 2 - 1) * spread) * Math.PI / 180;
    const sp = sp0 + (sp1 - sp0) * r();
    d[i + 2] = Math.cos(dir) * sp;
    d[i + 3] = Math.sin(dir) * sp;
    d[i + 4] = spin0 + (spin1 - spin0) * r();
    d[i + 5] = rol0 + (rol1 - rol0) * r();
    d[i + 6] = 0;
    d[i + 7] = life0 + (life1 - life0) * r();
    em.count++;
  }

  // 2) 积分 + 死亡回收（swap-remove 保持密集前缀）
  const g = layer.gravity ?? 0;
  const drag = layer.drag ?? 0;
  const dragK = Math.max(0, 1 - drag * DT);
  const d = em.data;
  let i = 0;
  while (i < em.count) {
    const b = i * STRIDE;
    d[b + 6] += DT;
    if (d[b + 6] >= d[b + 7]) {                       // 死亡：与末尾交换
      em.count--;
      if (i !== em.count) {
        const last = em.count * STRIDE;
        for (let f = 0; f < STRIDE; f++) d[b + f] = d[last + f];
      }
      continue;                                        // 换进来的粒子同步步
    }
    d[b + 3] += g * DT;
    d[b + 2] *= dragK; d[b + 3] *= dragK;
    d[b] += d[b + 2] * DT;
    d[b + 1] += d[b + 3] * DT;
    i++;
  }
}

/** 求值到步号 k 并产出 particles step（视口px烘焙）。 */
export function emitParticleSteps(
  sim: SimState, doc: CompiledDoc, vars: VarTable,
  t: number, vw: number, vh: number, sx: number, sy: number,
  input: { assetSizes?: Record<string, { w: number; h: number }> },
): Array<{ layer: string; step: any }> {
  const out: Array<{ layer: string; step: any }> = [];
  sim.emitters.forEach((em, ei) => {
    const cl = doc.layers[em.layerIndex];
    const layer = cl.raw;
    const k = Math.floor(t * 60 + 1e-9);
    advanceEmitter(em, layer, k, sim.seed, ei, vars, doc.canvas.width, doc.canvas.height);

    const anchor = layer.anchor ?? [0.5, 0.5];
    const cx = anchor[0] * vw + (layer.offset?.[0] ?? 0) * sx;
    const cy = anchor[1] * vh + (layer.offset?.[1] ?? 0) * sy;
    const tex = layer.texture ?? '';
    const nat = input.assetSizes?.[tex] ?? { w: 32, h: 32 };
    const align = typeof layer.rotation === 'object' && layer.rotation.alignToVelocity;
    const sol = (layer.sizeOverLife ?? [[0, 1], [1, 1]]) as Array<[number, number]>;
    const aol = (layer.alphaOverLife ?? [[0, 1], [1, 1]]) as Array<[number, number]>;
    const layerAlpha = resolveNum(layer.alpha, vars, 1);

    const need = em.count * OUT_STRIDE;
    em.outIdx ^= 1;
    let full = em.outBufs[em.outIdx];
    if (full.length < need) full = em.outBufs[em.outIdx] = new Float32Array(need);
    const buf = full.subarray(0, need);       // 精确长度视图（底层缓冲 grow-only 复用）
    const d = em.data;
    for (let i = 0; i < em.count; i++) {
      const b = i * STRIDE, o = i * OUT_STRIDE;
      const life01 = d[b + 6] / d[b + 7];
      let rot = d[b + 4] + d[b + 5] * d[b + 6];
      if (align) rot = Math.atan2(d[b + 3], d[b + 2]) * 180 / Math.PI;
      const sm = curve(sol, life01);
      buf[o] = cx + d[b] * sx;
      buf[o + 1] = cy + d[b + 1] * sy;
      buf[o + 2] = rot;
      buf[o + 3] = nat.w * sm * sx;
      buf[o + 4] = nat.h * sm * sy;
      buf[o + 5] = curve(aol, life01) * layerAlpha;
      buf[o + 6] = life01;
    }
    const colors = (layer.colorOverLife ?? []).length
      ? layer.colorOverLife!.map(c => String(resolveColor(c, vars) ?? '#ffffff'))
      : ['#ffffff', '#ffffff'];
    out.push({
      layer: layer.id,
      step: {
        op: 'particles', layer: layer.id, tex, buffer: buf, count: em.count, stride: OUT_STRIDE,
        blend: layer.blend ?? 'lighter',
        colorA: colors[0], colorB: colors[1] ?? colors[0],
      },
    });
  });
  return out;
}
