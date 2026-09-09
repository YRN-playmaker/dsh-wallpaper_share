/**
 * 混合模式 → GL 状态（design-runtime.md §3.2，R2）。协议 §5.3：预乘 alpha 空间。
 * 6 个直接 GL（固定功能可达）+ 6 个 shader 合成（CSS separable/非分离混合，需 RT 后合成）。
 */
import { GL } from './gl-types.ts';
import type { BlendName } from 'dwp-core';

/** 直接混合的 GL 状态三元组。 */
export interface DirectBlend {
  sf: number; df: number;                 // blendFuncSeparate 的 RGB 因子（alpha 恒 ONE/ONE_MINUS_SRC_ALPHA）
  equation: number;                       // blendEquation
}

/** 固定功能可达的 6 个（预乘 alpha）。 */
export const DIRECT_BLEND: Partial<Record<BlendName, DirectBlend>> = {
  normal:    { sf: GL.ONE, df: GL.ONE_MINUS_SRC_ALPHA, equation: GL.FUNC_ADD },
  lighter:   { sf: GL.ONE, df: GL.ONE,                 equation: GL.FUNC_ADD },
  multiply:  { sf: GL.DST_COLOR, df: GL.ZERO,          equation: GL.FUNC_ADD },
  screen:    { sf: GL.ONE, df: GL.ONE_MINUS_SRC_COLOR, equation: GL.FUNC_ADD },
  darken:    { sf: GL.ONE, df: GL.ONE,                 equation: GL.MIN },
  lighten:   { sf: GL.ONE, df: GL.ONE,                 equation: GL.MAX },
};

/** 需 shader 合成的 6 个（CSS 非分离混合公式，见 shaders.ts compositeBlend）。 */
export const SHADER_BLEND: ReadonlySet<BlendName> = new Set<BlendName>([
  'overlay', 'color-dodge', 'soft-light', 'hard-light', 'difference', 'exclusion',
]);

export function isDirectBlend(b: BlendName): boolean {
  return b in DIRECT_BLEND;
}

/** 应用某混合到 GL（调用方已 enable(BLEND)）。 */
export function applyBlend(gl: { blendFuncSeparate: Function; blendEquation: Function }, b: BlendName): void {
  const d = DIRECT_BLEND[b] ?? DIRECT_BLEND.normal!;
  gl.blendFuncSeparate(d.sf, d.df, GL.ONE, GL.ONE_MINUS_SRC_ALPHA);
  gl.blendEquation(d.equation);
}
