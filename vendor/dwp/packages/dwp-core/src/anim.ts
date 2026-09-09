/**
 * 动画求值（协议 §4.3，三种 kind，无脚本）。
 * 语义约定：
 *  - keyframes：绝对值（帧表给出属性值本身）；
 *  - oscillate：base + amplitude · sin(2π t/period + phase)（相对基值）；
 *  - scroll：base + perSecond · t，若给 wrap 则折返 [0, wrap)（相对基值）。
 * t 为协议秒（可负？否——宿主保证 t ≥ 0；loop 由场景/轨道各自处理）。
 */
import type { Animation, KeyframeTrack } from './types.ts';
import { parseEasing, type Easing } from './easing.ts';
import type { VarTable } from './vars.ts';
import { resolveNum } from './vars.ts';

export interface CompiledTrack {
  property: string;
  times: number[];
  values: Array<number | string>;   // 字符串 = "$var"（求值时经 VarTable 解析）
  easing: Easing;
  loop: boolean;
  span: number;
}

export interface CompiledAnim {
  kind: 'keyframes' | 'oscillate' | 'scroll';
  tracks?: CompiledTrack[];                       // keyframes
  property?: string;                              // oscillate/scroll
  amplitude?: number; period?: number; phase?: number;
  perSecond?: number; wrap?: number;
}

const TWO_PI = Math.PI * 2;

export function compileAnimation(anim: Animation, pointer: string): CompiledAnim {
  switch (anim.kind) {
    case 'keyframes': {
      const tracks: CompiledTrack[] = [];
      for (const [property, tr] of Object.entries(anim.tracks ?? {})) {
        const frames = tr.frames;
        for (let i = 1; i < frames.length; i++) {
          if (frames[i][0] <= frames[i - 1][0]) {
            const err = new Error(`关键帧时间未递增（第 ${i} 帧）`) as Error & { code: string };
            err.code = 'non-monotonic-frames';
            throw err;
          }
        }
        tracks.push({
          property,
          times: frames.map(f => f[0]),
          values: frames.map(f => f[1]),
          easing: parseEasing(tr.easing),
          loop: tr.loop ?? false,
          span: frames[frames.length - 1][0],
        });
      }
      return { kind: 'keyframes', tracks };
    }
    case 'oscillate':
      return {
        kind: 'oscillate', property: anim.property,
        amplitude: anim.amplitude ?? 0, period: anim.period ?? 1, phase: anim.phase ?? 0,
      };
    case 'scroll':
      return { kind: 'scroll', property: anim.property, perSecond: anim.perSecond ?? 0, wrap: anim.wrap };
  }
}

/** keyframes 单轨求值（绝对值）。t 先按 loop 折叠到 [0, span]。 */
export function evalTrack(tr: CompiledTrack, t: number, vars: VarTable): number | string {
  const { times, values } = tr;
  let tt = t;
  if (tr.loop && tr.span > 0) tt = ((t % tr.span) + tr.span) % tr.span;
  if (tt <= times[0]) return resolveFrame(values[0], vars);
  if (tt >= times[times.length - 1]) return resolveFrame(values[values.length - 1], vars);
  let i = 0;
  while (i < times.length - 2 && tt > times[i + 1]) i++;
  const t0 = times[i], t1 = times[i + 1];
  const u = t1 === t0 ? 0 : (tt - t0) / (t1 - t0);
  const e = tr.easing(u);
  const a = resolveFrame(values[i], vars);
  const b = resolveFrame(values[i + 1], vars);
  if (typeof a === 'number' && typeof b === 'number') return a + (b - a) * e;
  return e < 0.5 ? a : b;                            // 颜色/字符串：阶跃（v1 不做颜色插值，见 README §4.3 注）
}

function resolveFrame(v: number | string, vars: VarTable): number | string {
  if (typeof v === 'string' && v.startsWith('$')) {
    const got = vars.get(v.slice(1));
    if (typeof got === 'number' || typeof got === 'string') return got;
  }
  return v;
}

/** oscillate 相对增量。 */
export function oscillateDelta(tr: CompiledAnim, t: number): number {
  return (tr.amplitude ?? 0) * Math.sin(TWO_PI * t / (tr.period ?? 1) + (tr.phase ?? 0));
}

/** scroll 绝对值（base + perSecond·t，可选 wrap 折叠到 [0, wrap)）。 */
export function scrollValue(base: number, tr: CompiledAnim, t: number): number {
  let v = base + (tr.perSecond ?? 0) * t;
  const w = tr.wrap;
  if (w !== undefined && w > 0) v = ((v % w) + w) % w;
  return v;
}

/**
 * 应用图层动画 → 返回属性增量/绝对值表。
 * 单 animation 对象：keyframes 可多轨；oscillate/scroll 单属性相对基值。
 */
export function evalLayerAnimation(
  anim: CompiledAnim | undefined, t: number, vars: VarTable,
): Partial<Record<string, number | string>> {
  const out: Partial<Record<string, number | string>> = {};
  if (!anim) return out;
  if (anim.kind === 'keyframes') {
    for (const tr of anim.tracks ?? []) out[tr.property] = evalTrack(tr, t, vars);
  }
  return out;
}
