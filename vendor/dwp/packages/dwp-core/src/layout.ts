/** 2D 仿射矩阵与颜色工具（DOMMatrix 序：x' = a·x + c·y + e；y' = b·x + d·y + f）。 */
import type { Mat6, RGBA } from './types.ts';

export const identity = (): Mat6 => [1, 0, 0, 1, 0, 0];

export function mul(m1: Mat6, m2: Mat6): Mat6 {
  const [a1, b1, c1, d1, e1, f1] = m1, [a2, b2, c2, d2, e2, f2] = m2;
  return [
    a1 * a2 + c1 * b2, b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2, b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1, b1 * e2 + d1 * f2 + f1,
  ];
}

export const translate = (x: number, y: number): Mat6 => [1, 0, 0, 1, x, y];
export const scale = (sx: number, sy: number): Mat6 => [sx, 0, 0, sy, 0, 0];
/** 角度制（协议 §3：rotation 用度）。 */
export function rotate(deg: number): Mat6 {
  const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return [c, s, -s, c, 0, 0];
}

export function applyPoint(m: Mat6, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

export function invert(m: Mat6): Mat6 | null {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
  const ia = d / det, ib = -b / det, ic = -c / det, id = a / det;
  return [ia, ib, ic, id, -(ia * e + ic * f), -(ib * e + id * f)];
}

/** 图层盒矩阵：中心 (cx,cy) 视口px、尺寸 (w,h)、origin 枢轴、rotation 度、scaleX/Y 倍率。 */
export function boxMatrix(cx: number, cy: number, w: number, h: number,
                          origin: [number, number], rotDeg: number, sclX: number, sclY: number = sclX): Mat6 {
  const px = (0.5 - origin[0]) * w, py = (0.5 - origin[1]) * h;   // 枢轴相对中心
  let m = translate(cx + px, cy + py);
  m = mul(m, rotate(rotDeg));
  m = mul(m, scale(sclX, sclY));
  m = mul(m, translate(-px, -py));
  return m;
}

/** 单位四边形 → 盒局部坐标（左上原点系，中心对齐 ±w/2,±h/2）。 */
export function quadVerts(w: number, h: number): Float32Array {
  return new Float32Array([-w / 2, -h / 2, w / 2, -h / 2, w / 2, h / 2, -w / 2, h / 2]);
}
/** 共享只读 UV（全 quad 恒等，plan 契约只读 → 单例省分配）。 */
export const QUAD_UV = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
export const quadUV = (): Float32Array => QUAD_UV;

// ---------- 颜色 ----------

const HEX = /^#([0-9a-fA-F]{3,8})$/;
const RGBA_RE = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/;

export function parseColor(input: string | number): RGBA {
  if (typeof input === 'number') {                  // 0xRRGGBB[AA]
    return [((input >> 16) & 255) / 255, ((input >> 8) & 255) / 255, (input & 255) / 255, 1];
  }
  const h = HEX.exec(input.trim());
  if (h) {
    const s = h[1];
    const at = (i: number, n: number) => parseInt(s.slice(i, i + n), 16) / (n === 1 ? 15 : 255);
    if (s.length === 3) return [at(0, 1), at(1, 1), at(2, 1), 1];
    if (s.length === 4) return [at(0, 1), at(1, 1), at(2, 1), at(3, 1)];
    if (s.length === 6) return [at(0, 2), at(2, 2), at(4, 2), 1];
    if (s.length === 8) return [at(0, 2), at(2, 2), at(4, 2), at(6, 2)];
  }
  const r = RGBA_RE.exec(input.trim());
  if (r) {
    const n = (v: string, d: number) => { const x = parseFloat(v); return Number.isFinite(x) ? x : d; };
    return [n(r[1], 0) / 255, n(r[2], 0) / 255, n(r[3], 0) / 255, r[4] !== undefined ? n(r[4], 1) : 1];
  }
  throw new Error(`无法解析颜色: ${input}`);
}

/** fit 策略 → 设计px→视口px 缩放（cover 等比铺满裁切 / contain 留边 / stretch 非等比）。 */
export function fitScale(fit: 'cover' | 'contain' | 'stretch',
                         dw: number, dh: number, vw: number, vh: number): [number, number] {
  if (fit === 'stretch') return [vw / dw, vh / dh];
  const a = vw / dw, b = vh / dh;
  const s = fit === 'cover' ? Math.max(a, b) : Math.min(a, b);
  return [s, s];
}
