/**
 * ScenePuppet —— WE _puppet.mdl 解析器（顶点网格 + 骨骼矩阵 + 动画）。
 *
 * 格式（经 3463520581 实测 + linux-wallpaperengine 参考交叉验证）：
 *   MDLV0023: 魔数后 json(材质)\0 + 变长填充 + 网格块：
 *             [4B ?][4B vertexBytes][顶点 80B×N][4B indexBytes][uint16 索引]
 *             顶点 80B = [pos3 f32 @0][44B 其他][weights4 f32 @56][uv2 f32 @72]
 *             （vertexBytes % 80、indexBytes % 6；网格块用扫描定位，边界=MDLS）
 *   MDLS0004: "MDLS0004\0" + u32@9 + u32@13 boneCount + u8@17 +
 *             骨骼定义 × count：{u32 u0, i32 parent, f32 f0, 矩阵 64B @+12}（76B）
 *   MDAT0001: "MDAT0001\0" + u32@9 + u16@13 count + u16@15 ? +
 *             条目 × count：{name\0 矩阵64B}（矩阵 = 名字起点 + strlen + 1）
 *             矩阵平移 = 具名骨骼位置（模型空间 y-up）→ attachment 锚点
 *   MDLA0006: "MDLA0006\0" + u32@9 + u32@13 animCount +
 *             每动画 {u32 id, f16 2B, name\0, loop\0, f32, u32, u32, u32 dataLen,
 *                     u8 extra, 数据 dataLen}
 *             帧 = [t:3B LE][8×f32]（36B）
 *   MDLE0002: "MDLE0002\0" + u32@9 + u32@13 byteCount + 矩阵 × (byteCount/64) @+17
 *             （姿势矩阵：静态壁纸 = bind；动画壁纸 = 当前姿势）
 *
 * 蒙皮语义（linux 参考一致）：静态渲染用 raw 顶点（bind 姿势）；
 * 动画蒙皮 skinPos = Σ w_i × pose_i × bindInv_i × pos。
 * 本模块仅 node 半使用（模型构建时解析），纯字节解析无 node API。
 */
export interface PuppetVertex {
  pos: [number, number, number]
  /** 4 个骨骼权重（f32 @56..68，对应骨骼 0..3） */
  weights: number[]
  uv: [number, number]
}

export interface PuppetMesh {
  vertices: PuppetVertex[]
  /** uint16 三角形索引（每 3 个一组） */
  indices: number[]
}

export interface PuppetBone {
  name: string
  /** 父骨骼索引（-1 = root，来自 MDLS 定义表） */
  parent: number
  /** MDLS bind 矩阵（16 f32 列主序）或 null */
  bind: number[] | null
  /** MDLE 姿势矩阵（16 f32 列主序）或 null */
  pose: number[] | null
}

export interface PuppetKeyframe {
  /** 相对时间（t 字段） */
  t: number
  /** 8 值：[pos.x pos.y pos.z][旋转 4][scale] */
  values: number[]
}

export interface PuppetAnimation {
  id: number
  name: string
  loop: boolean
  /** 驱动骨骼数（bones 字段） */
  boneCount: number
  keyframes: PuppetKeyframe[]
}

export interface PuppetModel {
  material: string
  bones: PuppetBone[]
  mesh: PuppetMesh | null
  animations: PuppetAnimation[]
  /** MDAT 具名骨骼位置（骨骼名 → [x,y,z]，y-up 模型空间，相对图片中心）；
   * 用于 attachment="head" 等部件的锚点偏移 */
  bonePositions: Record<string, [number, number, number]>
}

const f32At = (bytes: Uint8Array, q: number): number => {
  const v = (bytes[q] | (bytes[q + 1] << 8) | (bytes[q + 2] << 16) | (bytes[q + 3] << 24)) | 0
  return new Float32Array(new Int32Array([v]).buffer)[0]
}
const u32At = (bytes: Uint8Array, q: number): number => {
  return (bytes[q] | (bytes[q + 1] << 8) | (bytes[q + 2] << 16) | (bytes[q + 3] << 24)) >>> 0
}
const i32At = (bytes: Uint8Array, q: number): number => {
  return (bytes[q] | (bytes[q + 1] << 8) | (bytes[q + 2] << 16) | (bytes[q + 3] << 24)) | 0
}
const u16At = (bytes: Uint8Array, q: number): number => {
  return bytes[q] | (bytes[q + 1] << 8)
}

/** 解析 mdl；失败返回 null */
export function parsePuppetMdl(bytes: Uint8Array): PuppetModel | null {
  try {
    const len = bytes.length
    const find = (tag: string, from: number): number => {
      const t = new Uint8Array(tag.length)
      for (let i = 0; i < tag.length; i++) t[i] = tag.charCodeAt(i)
      let i = from
      while (i < len - tag.length) {
        let ok = true
        for (let k = 0; k < tag.length; k++) if (bytes[i + k] !== t[k]) { ok = false; break }
        if (ok) return i
        i++
      }
      return -1
    }

    // 魔数（MDLV0021/0023 变体；0023 有 json 材质）
    if (bytes.length < 16) return null
    let material = ''
    let p = 0
    const magic1 = (() => {
      let s = ''
      while (p < len && bytes[p] !== 0 && s.length < 32) { s += String.fromCharCode(bytes[p]); p++ }
      p++
      return s
    })()
    if (!magic1.startsWith('0023') && !magic1.startsWith('0021') && !magic1.startsWith('0020')) return null
    p += 12 // 跳过魔数后 3 个 DWORD
    if (p < len) {
      // 材质 json（string 至 null）
      let s = ''
      let q = p
      while (q < len && bytes[q] !== 0 && s.length < 4096) { s += String.fromCharCode(bytes[q]); q++ }
      if (s.includes('"name"') || s.includes('{')) material = s
      p = q + 1
    }

    const mdls = find('MDLS0004', 0)
    const mdat = find('MDAT0001', 0)
    const mdla = find('MDLA0006', 0)
    const mdle = find('MDLE0002', 0)

    // --- MDLV 顶点网格（仿 linux-wallpaperengine findPuppetMeshBlock：stride=80）---
    let mesh: PuppetMesh | null = null
    {
      const stride = 80
      const mdlsOffset = mdls >= 0 ? mdls : len
      for (let offset = 9; offset + 12 < mdlsOffset; offset++) {
        const candidateVertexBytes = u32At(bytes, offset + 4)
        const verticesOffset = offset + 8
        const indexLengthOffset = verticesOffset + candidateVertexBytes
        if (candidateVertexBytes === 0 || candidateVertexBytes % stride !== 0 || indexLengthOffset + 4 > mdlsOffset) continue
        const candidateIndexBytes = u32At(bytes, indexLengthOffset)
        const indicesOffset = indexLengthOffset + 4
        if (candidateIndexBytes === 0 || candidateIndexBytes % 6 !== 0 || indicesOffset + candidateIndexBytes > mdlsOffset) continue
        // 顶点数据合理性：索引范围检查 + 位置有限
        const vc = candidateVertexBytes / stride
        const idxCount = candidateIndexBytes / 2
        let valid = true
        let minX = Infinity
        for (let i = 0; i < vc; i++) {
          const vp = verticesOffset + i * stride
          const x = f32At(bytes, vp)
          if (!Number.isFinite(x)) { valid = false; break }
          if (x < minX) minX = x
        }
        if (!valid || !Number.isFinite(minX)) continue
        const maxIdx = vc - 1
        for (let i = 0; i < idxCount && valid; i++) {
          const v = u16At(bytes, indicesOffset + i * 2)
          if (v > maxIdx) valid = false
        }
        if (!valid) continue
        const vertices: PuppetVertex[] = []
        for (let i = 0; i < vc; i++) {
          const vp = verticesOffset + i * stride
          const weights: number[] = []
          for (let w = 0; w < 4; w++) weights.push(f32At(bytes, vp + 56 + w * 4))
          vertices.push({
            pos: [f32At(bytes, vp), f32At(bytes, vp + 4), f32At(bytes, vp + 8)],
            weights,
            uv: [f32At(bytes, vp + 72), f32At(bytes, vp + 76)],
          })
        }
        const indices: number[] = []
        for (let i = 0; i < idxCount; i++) indices.push(u16At(bytes, indicesOffset + i * 2))
        mesh = { vertices, indices }
        break
      }
    }

    // --- MDLS 骨骼定义（count@+13，定义表 @+18，76B/骨骼，矩阵 @+12）---
    let boneCount = 0
    const mdlsBones: Array<{ parent: number; bind: number[] }> = []
    if (mdls >= 0 && mdls + 18 + 76 <= len) {
      boneCount = u32At(bytes, mdls + 13)
      if (boneCount > 512) boneCount = 0
      let q = mdls + 18
      for (let i = 0; i < boneCount && q + 76 <= len; i++) {
        const parent = i32At(bytes, q + 4)
        const mp = q + 12
        const bind: number[] = []
        for (let k = 0; k < 16; k++) bind.push(f32At(bytes, mp + k * 4))
        mdlsBones.push({ parent, bind })
        q += 76
      }
    }

    // --- MDLE 姿势矩阵（byteCount@+13，矩阵 @+17）---
    let poseMatrices: number[] | null = null
    if (mdle >= 0 && mdle + 17 + 64 <= len) {
      const byteCount = u32At(bytes, mdle + 13)
      const count = byteCount / 64
      if (count >= 1 && count <= 512 && mdle + 17 + count * 64 <= len) {
        const mats: number[] = []
        for (let i = 0; i < count * 16; i++) mats.push(f32At(bytes, mdle + 17 + i * 4))
        poseMatrices = mats
      }
    }

    // --- MDAT 具名骨骼（count u16@+13，名字 @+17 起，矩阵 = 名字起点 + strlen + 1）---
    const bonePositions: Record<string, [number, number, number]> = {}
    const mdatNames: string[] = []
    if (mdat >= 0) {
      const mdatEnd = (() => {
        let e = len
        if (mdla >= 0 && mdla > mdat) e = Math.min(e, mdla)
        if (mdle >= 0 && mdle > mdat) e = Math.min(e, mdle)
        return e
      })()
      const mdatCount = u16At(bytes, mdat + 13)
      if (mdatCount > 0 && mdatCount <= 256) {
        let q = mdat + 17
        for (let i = 0; i < mdatCount && q + 65 <= mdatEnd; i++) {
          // 条目间可能有 1B pad（0x00）：跳过
          let skips = 0
          while (skips < 4 && q < mdatEnd && bytes[q] === 0 && q + 66 <= mdatEnd) { q++; skips++ }
          // 名字（ASCII）
          let nm = ''
          let s = q
          while (s < mdatEnd && bytes[s] !== 0 && bytes[s] >= 32 && bytes[s] < 127 && nm.length < 128) { nm += String.fromCharCode(bytes[s]); s++ }
          if (nm.length < 1 || s >= mdatEnd || bytes[s] !== 0) break
          const mp = s + 1
          if (mp + 64 > mdatEnd) break
          mdatNames.push(nm)
          bonePositions[nm] = [f32At(bytes, mp + 48), f32At(bytes, mp + 52), f32At(bytes, mp + 56)]
          q = mp + 64
        }
      } else {
        // 兜底：循环扫描名字（count 字段不可靠时）
        let q = mdat + 17
        let guard = 0
        while (q + 66 <= mdatEnd && guard++ < 256) {
          let nm = ''
          let s = q
          while (s < mdatEnd && bytes[s] !== 0 && bytes[s] >= 32 && bytes[s] < 127 && nm.length < 128) { nm += String.fromCharCode(bytes[s]); s++ }
          if (nm.length < 1 || s >= mdatEnd || bytes[s] !== 0) break
          const mp = s + 1
          if (mp + 64 > mdatEnd) break
          mdatNames.push(nm)
          bonePositions[nm] = [f32At(bytes, mp + 48), f32At(bytes, mp + 52), f32At(bytes, mp + 56)]
          q = mp + 64
        }
      }
    }

    // --- 组装骨骼 ---
    const bones: PuppetBone[] = []
    const total = Math.max(boneCount, mdatNames.length, poseMatrices !== null ? poseMatrices.length / 16 : 0)
    for (let i = 0; i < total; i++) {
      const mdlsB = mdlsBones[i]
      const pose = poseMatrices !== null && i * 16 + 15 < poseMatrices.length
        ? poseMatrices.slice(i * 16, i * 16 + 16)
        : null
      bones.push({
        name: mdatNames[i] ?? '',
        parent: mdlsB !== undefined ? mdlsB.parent : -1,
        bind: mdlsB !== undefined ? mdlsB.bind : null,
        pose,
      })
    }

    // --- MDLA 动画 ---
    const animations: PuppetAnimation[] = []
    if (mdla >= 0 && mdla + 17 <= len) {
      const animCount = Math.max(0, Math.min(64, u32At(bytes, mdla + 13)))
      let q = mdla + 17
      for (let a = 0; a < animCount && q + 8 <= len; a++) {
        const id = u32At(bytes, q); q += 4
        q += 4 // u32（id 后）
        let nm = ''
        while (q < len && bytes[q] !== 0 && nm.length < 128) { nm += String.fromCharCode(bytes[q]); q++ }
        q++
        let lp = ''
        while (q < len && bytes[q] !== 0 && lp.length < 128) { lp += String.fromCharCode(bytes[q]); q++ }
        q++
        if (nm === '' || q + 20 > len) break
        q += 4 // f32
        const bc = u32At(bytes, q); q += 4
        q += 4 // u32
        q += 4 // u32
        q += 4 // u32
        const dataLen = u32At(bytes, q); q += 4
        if (dataLen <= 0 || dataLen > len - q) break
        q++ // extra (1B)
        const kf = parseKeyframes(bytes, q, dataLen)
        q += kf.offset + dataLen
        animations.push({ id, name: nm, loop: lp === 'loop', boneCount: bc, keyframes: kf.keyframes })
      }
    }

    return { material, bones, mesh, animations, bonePositions }
  } catch {
    return null
  }
}

/**
 * 解析关键帧数据区：每帧 36B = [t:3B LE][8×f32][1B]。
 * 偏移探测：尝试 0..8 字节偏移，选质量最高的解析；
 * 质量 = t 单调峰得分 − 帧值合理性惩罚（NaN/巨大值 = 错位解析）。
 * 返回探测到的数据起点偏移（供调用方前进游标）。
 */
function parseKeyframes(bytes: Uint8Array, dataStart: number, dataLen: number): { keyframes: PuppetKeyframe[]; offset: number } {
  const len = bytes.length
  const frameCount = Math.floor(dataLen / 36)
  if (frameCount <= 0) return { keyframes: [], offset: 0 }
  let best: PuppetKeyframe[] = []
  let bestOff = 0
  let bestScore = -Infinity
  for (let off = 0; off <= 8 && dataStart + off + 36 <= len; off++) {
    const kf: PuppetKeyframe[] = []
    let bad = false
    let penalty = 0
    for (let f = 0; f < frameCount; f++) {
      const fp = dataStart + off + f * 36
      if (fp + 36 > len) { bad = true; break }
      const t = (bytes[fp] | (bytes[fp + 1] << 8) | (bytes[fp + 2] << 16)) >>> 0
      const values: number[] = []
      for (let k = 0; k < 8; k++) {
        const v = f32At(bytes, fp + 3 + k * 4)
        values.push(v)
        if (!Number.isFinite(v) || Math.abs(v) > 1e7) penalty += 10
        else if (Math.abs(v) > 1e5) penalty += 1
      }
      kf.push({ t, values })
    }
    if (bad) continue
    let peak = 0
    for (let i = 1; i < kf.length; i++) if (kf[i].t > kf[peak].t) peak = i
    let score = 0
    for (let i = 1; i <= peak; i++) if (kf[i].t >= kf[i - 1].t) score++
    for (let i = peak + 1; i < kf.length; i++) if (kf[i].t <= kf[i - 1].t) score++
    // 平铺惩罚：t 全等时所有偏移得分相同 → 用值合理性区分
    let tMin = Infinity
    let tMax = -Infinity
    for (const k of kf) { if (k.t < tMin) tMin = k.t; if (k.t > tMax) tMax = k.t }
    if (tMin === tMax) score -= frameCount * 0.5
    if (score - penalty > bestScore) { bestScore = score - penalty; best = kf; bestOff = off }
  }
  return { keyframes: best, offset: bestOff }
}

/** 按相对时间 t 在关键帧间线性插值（循环动画自动回卷处理） */
export function sampleAnimation(anim: PuppetAnimation, t: number): { values: number[]; t: number } | null {
  const kf = anim.keyframes
  if (kf.length === 0) return null
  if (kf.length === 1) return { values: kf[0].values, t: kf[0].t }
  let peak = 0
  for (let i = 1; i < kf.length; i++) if (kf[i].t > kf[peak].t) peak = i
  const period = kf[peak].t - kf[0].t
  if (period <= 0) {
    // t 常量或递减（ping-pong 回卷 / 编辑器导出）：按帧号线性播放
    const n = kf.length
    const idx = ((t % n) + n) % n
    const i0 = Math.floor(idx)
    const frac = idx - i0
    if (i0 + 1 >= n) return { values: kf[i0].values, t: i0 }
    return { values: kf[i0].values.map((v, k) => v + (kf[i0 + 1].values[k] - v) * frac), t: i0 + frac }
  }
  const startT = kf[0].t
  const curve: Array<{ p: number; values: number[] }> = []
  for (let i = 0; i <= peak; i++) curve.push({ p: kf[i].t - startT, values: kf[i].values })
  for (let i = peak; i < kf.length; i++) curve.push({ p: period - (kf[i].t - startT), values: kf[i].values })
  const mono: typeof curve = []
  let lastP = -Infinity
  for (const c of curve) {
    if (c.p >= lastP) { mono.push(c); lastP = c.p }
  }
  if (mono.length < 2) return { values: kf[0].values, t: kf[0].t }
  const prog = ((t % period) + period) % period
  let a = mono[0]
  for (let i = 1; i < mono.length; i++) {
    const b = mono[i]
    if (prog <= b.p) {
      const span = b.p - a.p
      const frac = span > 0 ? Math.min(1, Math.max(0, (prog - a.p) / span)) : 0
      return { values: a.values.map((v, k) => v + (b.values[k] - v) * frac), t: prog + startT }
    }
    a = b
  }
  return { values: mono[mono.length - 1].values, t: prog + startT }
}
