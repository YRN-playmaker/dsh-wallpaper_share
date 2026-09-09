/**
 * 效果展开（design-runtime.md §3.3，R1.6）：core 侧展开，gl 侧只有模板。
 * - scene 效果 → pass 链（≤8 模板：distort / blurDown / blurX / blurY / blurCombine / chromatic / overlay）；
 * - 可折叠效果（无 RTT）：opacity→alpha、pulse→alpha、tint→color、scroll/shake→平移（scene 级进 view）；
 * - 图层级像素效果（waterwaves/blur/…）→ deferred（R2 执行器 RTT 隔离）。
 * 参数归一化：spec 自由 params → 模板 uniforms（数值化，$var 解析，颜色→RGBA）。
 */
import type { Effect, EffectName, RGBA, RenderStep } from './types.ts';
import { parseColor } from './layout.ts';
import { resolveColor, resolveNum, type VarTable } from './vars.ts';

export type PassTemplate = 'distort' | 'blurDown' | 'blurX' | 'blurY' | 'blurCombine' | 'chromatic' | 'overlay';

export interface EffectFold {
  alphaMul: number;               // opacity × pulse
  tint?: RGBA;                    // tint（后写覆盖）
  offX: number; offY: number;     // scroll/shake 平移（设计px）
  deferred: EffectName[];         // 需 RTT 的图层级像素效果
}

export interface SceneExpansion {
  passes: RenderStep[];
  viewDX: number; viewDY: number; // 视口px（折进 plan.view）
  opacityMul: number;             // 折进所有 step alpha
}

const num = (v: unknown, vars: VarTable, fb: number) =>
  typeof v === 'number' || typeof v === 'string' ? resolveNum(v, vars, fb) : fb;
const col = (v: unknown, vars: VarTable, fb: string): RGBA =>
  parseColor(resolveColor(typeof v === 'string' ? v : undefined, vars) ?? fb);

/** 确定性伪噪声（shake）：双正弦积——无 RNG，跨实现逐位一致。 */
function shakeOffset(intensity: number, speed: number, t: number): [number, number] {
  const w = 2 * Math.PI * speed * t;
  return [
    intensity * Math.sin(w) * Math.sin(w * 0.61 + 1.3),
    intensity * Math.cos(w * 0.83 + 0.7) * Math.sin(w * 0.47 + 2.1),
  ];
}

/** pulse 亮度/透明度因子：min + (max-min)·(0.5+0.5·sin(2πt/speed))，core 侧烘焙。 */
function pulseFactor(p: Record<string, unknown>, vars: VarTable, t: number): number {
  const speed = num(p.speed, vars, 1);
  const min = num(p.min, vars, 0.6), max = num(p.max, vars, 1);
  return min + (max - min) * (0.5 + 0.5 * Math.sin(2 * Math.PI * t / Math.max(speed, 1e-6)));
}

// ---------- 图层级折叠 ----------

export function foldLayerEffects(effects: Effect[], layerId: string, t: number, vars: VarTable): EffectFold {
  const fold: EffectFold = { alphaMul: 1, offX: 0, offY: 0, deferred: [] };
  for (const fx of effects) {
    if (fx.target !== layerId) continue;
    const p = fx.params ?? {};
    switch (fx.type) {
      case 'opacity': fold.alphaMul *= Math.min(1, Math.max(0, num(p.value, vars, 1))); break;
      case 'pulse': fold.alphaMul *= pulseFactor(p, vars, t); break;
      case 'tint': fold.tint = col(p.color, vars, '#ffffff'); break;
      case 'scroll': {
        const sx = num(Array.isArray(p.speed) ? (p.speed as number[])[0] : p.speed, vars, 0);
        const sy = num(Array.isArray(p.speed) ? (p.speed as number[])[1] : 0, vars, 0);
        fold.offX += sx * t; fold.offY += sy * t; break;
      }
      case 'shake': {
        const [dx, dy] = shakeOffset(num(p.intensity ?? p.amplitude, vars, 10), num(p.speed, vars, 3), t);
        fold.offX += dx; fold.offY += dy; break;
      }
      default: fold.deferred.push(fx.type);   // 像素级：需 RTT（R2）
    }
  }
  return fold;
}

// ---------- scene 级展开 ----------

export function expandSceneEffects(effects: Effect[], t: number, vars: VarTable, vw: number, vh: number): SceneExpansion {
  const scene = effects.filter(fx => fx.target === 'scene');
  const passes: RenderStep[] = [];
  let viewDX = 0, viewDY = 0, opacityMul = 1;

  // 先折叠非 pass 效果，再排 pass 链
  const passFx: Array<{ template: PassTemplate; effect: EffectName; params: Record<string, number | number[]> }> = [];
  for (const fx of scene) {
    const p = fx.params ?? {};
    switch (fx.type) {
      case 'opacity': opacityMul *= Math.min(1, Math.max(0, num(p.value, vars, 1))); break;
      case 'scroll': {
        const sx = num(Array.isArray(p.speed) ? (p.speed as number[])[0] : p.speed, vars, 0);
        const sy = num(Array.isArray(p.speed) ? (p.speed as number[])[1] : 0, vars, 0);
        viewDX += sx * t; viewDY += sy * t; break;
      }
      case 'shake': {
        const [dx, dy] = shakeOffset(num(p.intensity ?? p.amplitude, vars, 10), num(p.speed, vars, 3), t);
        viewDX += dx; viewDY += dy; break;
      }
      case 'waterwaves': case 'waterripple': {
        const strength = num(p.strength, vars, 0.5);
        const scale = num(p.scale, vars, 24);
        passFx.push({
          template: 'distort', effect: fx.type,
          params: {
            mode: fx.type === 'waterripple' ? 1 : 0,
            amp: strength * 20,                       // strength 0..1 → 视口px 位移幅度
            freq: 2 * Math.PI / scale,                // 波长 px → 角频率
            speed: num(p.speed, vars, 1), t,
          },
        }); break;
      }
      case 'blur': {
        const radius = num(p.radius, vars, 8);
        const r = radius / Math.max(vw, 1);           // 归一化半径
        passFx.push({ template: 'blurDown', effect: 'blur', params: {} });
        passFx.push({ template: 'blurX', effect: 'blur', params: { radius: r } });
        passFx.push({ template: 'blurY', effect: 'blur', params: { radius: r } });
        passFx.push({ template: 'blurCombine', effect: 'blur', params: { radius: r } });
        break;
      }
      case 'chromatic':
        passFx.push({ template: 'chromatic', effect: 'chromatic', params: { strength: num(p.strength, vars, 0.005) } });
        break;
      case 'vignette':
        passFx.push({ template: 'overlay', effect: 'vignette', params: { kind: 0, intensity: num(p.intensity, vars, 0.5), color: Array.from(col(p.color, vars, '#000000')) } });
        break;
      case 'filmgrain':
        passFx.push({ template: 'overlay', effect: 'filmgrain', params: { kind: 1, intensity: num(p.intensity, vars, 0.1), speed: num(p.speed, vars, 8), t } });
        break;
      case 'tint':
        passFx.push({ template: 'overlay', effect: 'tint', params: { kind: 2, color: Array.from(col(p.color, vars, '#ffffff')), mix: num(p.mix, vars, 0.5) } });
        break;
      case 'pulse':
        passFx.push({ template: 'overlay', effect: 'pulse', params: { kind: 3, brightness: pulseFactor(p, vars, t) } });
        break;
      default:
        break;   // 未知 scene 效果：白名单外 compile 已拦，这里不重复报
    }
  }

  // pass 链：ping-pong 目标，blur 用半分辨率 rtHalf/rtHalfB，最后一 pass 落 screen
  let cur = 'scene';
  passFx.forEach((f, i) => {
    const last = i === passFx.length - 1;
    let target: string;
    if (f.template === 'blurDown') target = 'rtHalf';
    else if (f.template === 'blurX') target = 'rtHalfB';
    else if (f.template === 'blurY') target = 'rtHalf';
    else if (last) target = 'screen';
    else target = i % 2 === 0 ? 'rt0' : 'rt1';
    passes.push({ op: 'pass', effect: f.effect, template: f.template, params: f.params, inputs: [cur], target });
    cur = target;
  });

  return { passes, viewDX, viewDY, opacityMul };
}
