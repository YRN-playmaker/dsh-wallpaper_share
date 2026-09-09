/**
 * 缓动（协议 §4.3：linear | ease | ease-in | ease-in-out | cubic-bezier(a,b,c,d)）。
 * CSS 语义：x=时间进度 0..1 → y=值进度；控制点 x 钳制 [0,1]，y 可超界（回弹）。
 */
export type Easing = (x: number) => number;

export const linear: Easing = (x) => x;

/** 标准 CSS cubic-bezier 求值：Newton-Raphson（4 轮）+ 二分兜底。 */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): Easing {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t;
  const sampleDX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {                    // Newton-Raphson
      const err = sampleX(t) - x;
      if (Math.abs(err) < 1e-7) return sampleY(t);
      const d = sampleDX(t);
      if (Math.abs(d) < 1e-7) break;
      t -= err / d;
    }
    let lo = 0, hi = 1; t = x;                        // 二分兜底
    while (hi - lo > 1e-7) {
      const v = sampleX(t);
      if (Math.abs(v - x) < 1e-7) break;
      if (v < x) lo = t; else hi = t;
      t = (lo + hi) / 2;
    }
    return sampleY(t);
  };
}

const BEZ = /^cubic-bezier\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)$/;

export function parseEasing(spec: string | undefined): Easing {
  if (spec === undefined || spec === '' || spec === 'linear') return linear;
  switch (spec) {
    case 'ease': return cubicBezier(0.25, 0.1, 0.25, 1.0);
    case 'ease-in': return cubicBezier(0.42, 0, 1.0, 1.0);
    case 'ease-out': return cubicBezier(0, 0, 0.58, 1.0);
    case 'ease-in-out': return cubicBezier(0.42, 0, 0.58, 1.0);
  }
  const m = BEZ.exec(spec.trim());
  if (m) {
    const [x1, y1, x2, y2] = m.slice(1, 5).map(Number);
    if (x1 < 0 || x1 > 1 || x2 < 0 || x2 > 1) throw new Error(`cubic-bezier x 必须在 [0,1]: ${spec}`);
    return cubicBezier(x1, y1, x2, y2);
  }
  throw new Error(`未知 easing: ${spec}`);
}
