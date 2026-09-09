/**
 * 2D 仿射 → GL 列主序 mat3（R2）。core 的 Mat6 = [a,b,c,d,e,f]（行向量约定：
 * x'=a·x+c·y+e, y'=b·x+d·y+f）→ 列主序 [a,b,0, c,d,0, e,f,1]。
 */

export type Mat3 = [number, number, number, number, number, number, number, number, number];

export const m6ToMat3 = (m: readonly number[]): Mat3 =>
  [m[0]!, m[1]!, 0, m[2]!, m[3]!, 0, m[4]!, m[5]!, 1];

/** 列主序 3×3 乘法 a·b。 */
export function m3Mul(a: Mat3, b: Mat3): Mat3 {
  const r = new Array(9) as Mat3;
  for (let c = 0; c < 3; c++) {
    for (let row = 0; row < 3; row++) {
      r[c * 3 + row] = a[row] * b[c * 3] + a[3 + row] * b[c * 3 + 1] + a[6 + row] * b[c * 3 + 2];
    }
  }
  return r;
}

/** 设备像素（y 向下，0..W/0..H）→ 裁剪空间（y 向上，-1..1）。 */
export function clipFromDevice(wDev: number, hDev: number): Mat3 {
  return [2 / wDev, 0, 0, 0, -2 / hDev, 0, -1, 1, 1];
}

/**
 * plan.view（CSS px → 设备 px，含 dpr + 相机平移）合成 clip 变换。
 * 返回 uView：CSS px → clip。
 */
export function viewMatrix(planView: readonly number[], dpr: number, vw: number, vh: number): Mat3 {
  const clip = clipFromDevice(vw * dpr, vh * dpr);
  const toDevice: Mat3 = [planView[0]!, planView[1]!, 0, planView[2]!, planView[3]!, 0, planView[4]!, planView[5]!, 1];
  return m3Mul(clip, toDevice);
}
