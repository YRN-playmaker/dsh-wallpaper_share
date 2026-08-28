/**
 * PuppetSkin —— Puppet 骨骼蒙皮数学（M_skin = M_global × M_inv_bind，4 权重）。
 *
 * 纯函数矩阵运算（无 node/browser API），ScenePuppet 解析 + SceneModelRenderer 渲染共用。
 *
 * 语义（规范）：
 *   绑定姿态：顶点 raw pos 即 bind 姿势（模型空间）。MDLS bind 矩阵 = 各骨骼全局矩阵。
 *   M_inv_bind_i = inverse(bindGlobal_i)
 *   运行帧：骨骼全局矩阵 = 动画变换 × bindGlobal（层级相乘），
 *   M_skin_i = M_global_i × M_inv_bind_i
 *   skinPos = Σ_{k=0..3} w_k × M_skin_{boneIdx[k]} × pos
 *
 * 静止（无动画）：M_global_i = bindGlobal_i → M_skin_i = I → skinPos = pos（不回归）。
 */

export type Mat4 = number[] // 16 f32，列主序（与 WE/generalparticle 一致）

export function mat4Identity(): Mat4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
}

/** 列主序 4×4 乘法：out = a × b */
export function mat4Mul(a: Mat4, b: Mat4): Mat4 {
  const o = new Array<number>(16)
  for (let c = 0; c < 4; c++) {
    const b0 = b[c * 4], b1 = b[c * 4 + 1], b2 = b[c * 4 + 2], b3 = b[c * 4 + 3]
    for (let r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b0 + a[4 + r] * b1 + a[8 + r] * b2 + a[12 + r] * b3
    }
  }
  return o
}

/** 4×4 求逆（伴随矩阵法，支持任意可逆矩阵含非均匀缩放；列主序） */
export function mat4Invert(m: Mat4): Mat4 | null {
  const a0 = m[0] * m[5] - m[4] * m[1]
  const a1 = m[0] * m[6] - m[4] * m[2]
  const a2 = m[0] * m[7] - m[4] * m[3]
  const a3 = m[1] * m[6] - m[5] * m[2]
  const a4 = m[1] * m[7] - m[5] * m[3]
  const a5 = m[2] * m[7] - m[6] * m[3]
  const b0 = m[8] * m[13] - m[12] * m[9]
  const b1 = m[8] * m[14] - m[12] * m[10]
  const b2 = m[8] * m[15] - m[12] * m[11]
  const b3 = m[9] * m[14] - m[13] * m[10]
  const b4 = m[9] * m[15] - m[13] * m[11]
  const b5 = m[10] * m[15] - m[14] * m[11]
  const det = a0 * b5 - a1 * b4 + a2 * b3 + a3 * b2 - a4 * b1 + a5 * b0
  if (Math.abs(det) < 1e-12) return null
  const id = 1 / det
  const o = new Array<number>(16)
  o[0] = (m[5] * b5 - m[6] * b4 + m[7] * b3) * id
  o[1] = (-m[1] * b5 + m[2] * b4 - m[3] * b3) * id
  o[2] = (m[13] * a5 - m[14] * a4 + m[15] * a3) * id
  o[3] = (-m[9] * a5 + m[10] * a4 - m[11] * a3) * id
  o[4] = (-m[4] * b5 + m[6] * b2 - m[7] * b1) * id
  o[5] = (m[0] * b5 - m[2] * b2 + m[3] * b1) * id
  o[6] = (-m[12] * a5 + m[14] * a2 - m[15] * a1) * id
  o[7] = (m[8] * a5 - m[10] * a2 + m[11] * a1) * id
  o[8] = (m[4] * b4 - m[5] * b2 + m[7] * b0) * id
  o[9] = (-m[0] * b4 + m[1] * b2 - m[3] * b0) * id
  o[10] = (m[12] * a4 - m[13] * a2 + m[15] * a0) * id
  o[11] = (-m[8] * a4 + m[9] * a2 - m[11] * a0) * id
  o[12] = (-m[4] * b3 + m[5] * b1 - m[6] * b0) * id
  o[13] = (m[0] * b3 - m[1] * b1 + m[2] * b0) * id
  o[14] = (-m[12] * a3 + m[13] * a1 - m[14] * a0) * id
  o[15] = (m[8] * a3 - m[9] * a1 + m[10] * a0) * id
  return o
}

/** 4×4 仿射（列主序）：T(x,y,z) × Rz(θ) × S(x,y,z)。平移单位、旋转单位、缩放单位。 */
export function mat4TRS(tx: number, ty: number, tz: number, rot: number, sx: number, sy: number, sz: number): Mat4 {
  const c = Math.cos(rot)
  const s = Math.sin(rot)
  // 列主序：col0=(c, s, 0, 0) col1=(-s, c, 0, 0) col2=(0,0,1,0) col3=(tx,ty,tz,1)
  return [c * sx, s * sx, 0, 0, -s * sy, c * sy, 0, 0, 0, 0, sz, 0, tx, ty, tz, 1]
}

/**
 * 由四元数构造旋转矩阵（列主序；用于 0013 老格式动画帧的 quat3）。
 * q = (qx, qy, qz, qw)，若传入 3 分量（w 缺省）则 w = sqrt(max(0, 1-|q|²))。
 * 返回 4×4 旋转矩阵（平移 0、缩放 1）。
 */
export function mat4FromQuat(qx: number, qy: number, qz: number, qw?: number): Mat4 {
  const qwv = qw !== undefined && Number.isFinite(qw)
    ? qw
    : Math.sqrt(Math.max(0, 1 - qx * qx - qy * qy - qz * qz))
  const x = qx
  const y = qy
  const z = qz
  const w = qwv
  // 列主序：col0 = R×ex, col1 = R×ey, col2 = R×ez
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0,
    2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0,
    2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0,
    0, 0, 0, 1,
  ]
}

/** T × R × S（T 平移、R 为任意 4×4 旋转、S 缩放），返回列主序 4×4。 */
export function mat4TRSQuat(tx: number, ty: number, tz: number, qx: number, qy: number, qz: number, qw: number | undefined, sx: number, sy: number, sz: number): Mat4 {
  const R = mat4FromQuat(qx, qy, qz, qw)
  // T × R × S（列主序）：col_c = R_c × s_c，col3 = t
  return [
    R[0] * sx, R[1] * sx, R[2] * sx, R[3],
    R[4] * sy, R[5] * sy, R[6] * sy, R[7],
    R[8] * sz, R[9] * sz, R[10] * sz, R[11],
    tx, ty, tz, 1,
  ]
}

/**
 * 由欧拉角（弧度，ZYX 顺序：R = Rz × Ry × Rx）构造旋转矩阵（列主序）。
 * 0013 老格式动画帧的旋转 3 分量实为欧拉角（弧度）而非四元数——
 * 睫毛等大幅旋转分量 |q| 可 > 1（如 -101° ≈ -1.77 rad），四元数解释必然错误。
 */
export function mat4FromEuler(rx: number, ry: number, rz: number): Mat4 {
  const c1 = Math.cos(rx), s1 = Math.sin(rx)
  const c2 = Math.cos(ry), s2 = Math.sin(ry)
  const c3 = Math.cos(rz), s3 = Math.sin(rz)
  // R = Rz × Ry × Rx（列主序）
  return [
    c2 * c3, c2 * s3, -s2, 0,
    s1 * s2 * c3 - c1 * s3, s1 * s2 * s3 + c1 * c3, s1 * c2, 0,
    c1 * s2 * c3 + s1 * s3, c1 * s2 * s3 - s1 * c3, c1 * c2, 0,
    0, 0, 0, 1,
  ]
}

/** T × R(欧拉角) × S：0013 老格式动画帧 [pos3][euler3][scale3]。 */
export function mat4TRSEuler(tx: number, ty: number, tz: number, rx: number, ry: number, rz: number, sx: number, sy: number, sz: number): Mat4 {
  const R = mat4FromEuler(rx, ry, rz)
  return [
    R[0] * sx, R[1] * sx, R[2] * sx, R[3],
    R[4] * sy, R[5] * sy, R[6] * sy, R[7],
    R[8] * sz, R[9] * sz, R[10] * sz, R[11],
    tx, ty, tz, 1,
  ]
}

/** 变换点：out = M × (x,y,z,1)，返回 [x,y,z]（w 齐次除） */
export function mat4TransformPoint(m: Mat4, x: number, y: number, z: number): [number, number, number] {
  const w = m[3] * x + m[7] * y + m[11] * z + m[15]
  const iw = w !== 0 ? 1 / w : 0
  return [
    (m[0] * x + m[4] * y + m[8] * z + m[12]) * iw,
    (m[1] * x + m[5] * y + m[9] * z + m[13]) * iw,
    (m[2] * x + m[6] * y + m[10] * z + m[14]) * iw,
  ]
}

/**
 * 计算各骨骼蒙皮矩阵 M_skin_i = M_global_i × M_inv_bind_i。
 *
 * @param binds 各骨骼全局 bind 矩阵（MDLS bind，16 f32 列主序；null = 单位绑定）
 * @param animMats 各骨骼动画全局矩阵（同长度；null = 该骨骼静止 → M_skin = I）
 * @returns 每骨骼 M_skin（16 f32）或 null（静止/不可逆 → 调用方按原始 pos）
 */
export function computeSkinMatrices(
  binds: Array<Mat4 | null>,
  animMats: Array<Mat4 | null>,
): Array<Mat4 | null> {
  const n = Math.max(binds.length, animMats.length)
  const out: Array<Mat4 | null> = []
  for (let i = 0; i < n; i++) {
    const anim = animMats[i] ?? null
    if (anim === null) { out.push(null); continue }
    // bind 缺失 = 单位绑定（M_inv_bind = I，M_skin = M_global）
    const bind = binds[i] ?? null
    if (bind === null) { out.push(anim); continue }
    const inv = mat4Invert(bind)
    if (inv === null) { out.push(null); continue }
    out.push(mat4Mul(anim, inv))
  }
  return out
}

/**
 * 蒙皮一个顶点：skinPos = Σ w_k × M_skin_{boneIdx[k]} × pos。
 * 骨骼索引越界/权重为 0 的项跳过；M_skin 为 null（静止骨骼）时该项 = 原始 pos。
 * 权重和 < 1 时余量归原始 pos（WE 顶点权重和通常 = 1）。
 */
export function skinVertex(
  pos: [number, number, number],
  weights: number[],
  boneIndices: number[],
  skin: Array<Mat4 | null>,
): [number, number, number] {
  let x = 0
  let y = 0
  let z = 0
  let wSum = 0
  const n = Math.min(weights.length, boneIndices.length, 4)
  for (let k = 0; k < n; k++) {
    const w = weights[k]
    if (!(w > 0)) continue
    const idx = boneIndices[k]
    const m = idx >= 0 && idx < skin.length ? skin[idx] : null
    if (m === null) {
      // 静止骨骼：原始 pos 参与
      x += w * pos[0]
      y += w * pos[1]
      z += w * pos[2]
    } else {
      const p = mat4TransformPoint(m, pos[0], pos[1], pos[2])
      x += w * p[0]
      y += w * p[1]
      z += w * p[2]
    }
    wSum += w
  }
  if (wSum < 1 && wSum > 0) {
    const rem = 1 - wSum
    x += rem * pos[0]
    y += rem * pos[1]
    z += rem * pos[2]
  }
  return [x, y, z]
}
