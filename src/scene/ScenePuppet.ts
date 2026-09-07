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
  /** 4 个骨骼索引（u16 LE @48,50,52,54），对应 4 组权重 */
  boneIndices: number[]
  uv: [number, number]
}

export interface PuppetMesh {
  vertices: PuppetVertex[]
  /** uint16 三角形索引（每 3 个一组） */
  indices: number[]
  /** UV v 方向自适应：pos y 与 uv.v 正相关（顶部采样立绘下部）→ 渲染需翻转 v */
  flipV: boolean
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
  /** 动画时长（秒，目录项 f32 字段；>0 时播放周期用此值） */
  duration: number
  keyframes: PuppetKeyframe[]
  /** 老格式（0013 魔数）：帧 = 9 f32 = [pos.x pos.y pos.z][quat.x quat.y quat.z][sx sy sz]，
   * duration 字段是帧率(fps)而非秒；位移轴 pos.x→dx, pos.y→dy */
  old13?: boolean
  /** 老格式逐骨骼关键帧：boneKeyframes[b] = 骨骼 b 的关键帧（各自数据块）。
   * 每帧 9 f32 = [pos3][quat3][scale3]，骨骼 0 的块直接用条目 dataLen，后续骨骼带
   * [u32 0][u32 dataLen] 头。骨骼 1+ 承载瞳孔缩放/眼睑旋转等独立动画。 */
  boneKeyframes?: PuppetKeyframe[][]
}

/** 骨骼 2D 世界位姿（角度 + 平移，模型空间 y-up） */
export interface PuppetBoneRT {
  angle: number
  tx: number
  ty: number
}

/** MDAT 锚点（attachment 挂载点，含骨骼索引 + 局部矩阵） */
export interface PuppetBoneAnchor {
  /** 锚点名（scene.json 对象 attachment 字段匹配） */
  name: string
  /** 锚定骨骼索引（< bones.length） */
  boneIdx: number
  /** 锚点矩阵（16 f32 列主序）；平移 = 骨骼局部偏移，按骨骼旋角旋转后加到骨骼世界位姿 */
  m: number[]
}

/** MDLA0006 新格式逐骨骼动画（9 列循环交错布局，官方 30fps 播放） */
export interface PuppetAnimV2 {
  /** MDLA 目录项 id（对应 scene.json animationlayers[].animation） */
  id: number
  name: string
  /** 循环帧数（官方 30fps 播放） */
  frameCount: number
  boneCount: number
  /**
   * 每骨骼每帧局部值 [px, py, rotZ]，平铺 number[]：
   * 索引 = bone × frameCount × 3 + frame × 3（+0 px / +1 py / +2 rotZ）。
   * 解析期急切解码（避免把原始 MDL 字节序列化到客户端）。
   */
  localFrames: number[]
}

export interface PuppetModel {
  material: string
  bones: PuppetBone[]
  mesh: PuppetMesh | null
  /** 0013 老格式逐帧动画（渲染层 legacy 路径） */
  animations: PuppetAnimation[]
  /** MDLA0006 新格式逐骨骼动画（渲染层主路径） */
  animsV2: PuppetAnimV2[]
  /** MDAT 具名骨骼锚点（attachment 挂载，跟随骨骼动画） */
  boneAnchors: PuppetBoneAnchor[]
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
/** 读取 [start, end) 区间 UTF-8 字符串（MDAT/MDLA 名字可为非 ASCII） */
const utf8At = (bytes: Uint8Array, start: number, end: number): string => {
  return new TextDecoder('utf-8').decode(bytes.subarray(start, end))
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
    if (!magic1.startsWith('0023') && !magic1.startsWith('0021') && !magic1.startsWith('0020') && !magic1.startsWith('0013')) return null
    p += 12 // 跳过魔数后 3 个 DWORD
    if (p < len) {
      // 材质 json（string 至 null）
      let s = ''
      let q = p
      while (q < len && bytes[q] !== 0 && s.length < 4096) { s += String.fromCharCode(bytes[q]); q++ }
      if (s.includes('"name"') || s.includes('{')) material = s
      p = q + 1
    }

    const mdls4 = find('MDLS0004', 0)
    const mdls3 = find('MDLS0003', 0)
    const mdls1 = find('MDLS0001', 0)
    const mdls = mdls4 >= 0 ? mdls4 : mdls3 >= 0 ? mdls3 : mdls1
    // 0001（老格式 0013 魔数）：布局同 0003（定义表 @+17，头 13B/骨骼）
    const mdlsIs3 = mdls >= 0 && mdls4 < 0
    const mdat = find('MDAT0001', 0)
    const mdla6 = find('MDLA0006', 0)
    const mdla1 = find('MDLA0001', 0)
    const mdla = mdla6 >= 0 ? mdla6 : mdla1
    const mdle = find('MDLE0002', 0)

    // --- MDLV 顶点网格（仿 linux-wallpaperengine findPuppetMeshBlock）---
    // 0020/0021/0023 格式：stride=80，自 offset 9 起扫描
    // 0013 老格式：stride=52，布局 [pos3 @0][boneIdx 4×u32 @12][weights 4×f32 @28][uv2 @44]
    const isOld13 = magic1.startsWith('0013')
    let mesh: PuppetMesh | null = null
    {
      const mdlsOffset = mdls >= 0 ? mdls : len
      const strides = isOld13 ? [52] : [80, 64]
      for (const stride of strides) {
        if (mesh !== null) break
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
          if (isOld13) {
            // 0013: [pos3 f32 @0][boneIdx 4×u32 @12][weights 4×f32 @28][uv2 f32 @44]
            const weights: number[] = []
            for (let w = 0; w < 4; w++) weights.push(f32At(bytes, vp + 28 + w * 4))
            const boneIndices: number[] = []
            for (let b = 0; b < 4; b++) boneIndices.push(u32At(bytes, vp + 12 + b * 4))
            vertices.push({
              pos: [f32At(bytes, vp), f32At(bytes, vp + 4), f32At(bytes, vp + 8)],
              weights,
              boneIndices,
              uv: [f32At(bytes, vp + 44), f32At(bytes, vp + 48)],
            })
          } else {
            const weights: number[] = []
            for (let w = 0; w < 4; w++) weights.push(f32At(bytes, vp + 56 + w * 4))
            const boneIndices: number[] = []
            for (let b = 0; b < 4; b++) boneIndices.push(u16At(bytes, vp + 48 + b * 2))
            vertices.push({
              pos: [f32At(bytes, vp), f32At(bytes, vp + 4), f32At(bytes, vp + 8)],
              weights,
              boneIndices,
              uv: [f32At(bytes, vp + 72), f32At(bytes, vp + 76)],
            })
          }
        }
        const indices: number[] = []
        for (let i = 0; i < idxCount; i++) indices.push(u16At(bytes, indicesOffset + i * 2))
        // v 方向自适应：pos y 与 uv.v 的相关性（顶部顶点采样立绘上部 = 负相关 → 不翻）
        let sy = 0
        let sv = 0
        let syv = 0
        let sy2 = 0
        let sv2 = 0
        const vn = vertices.length
        for (const v of vertices) {
          const y = v.pos[1]
          const vv = v.uv[1]
          sy += y; sv += vv; syv += y * vv; sy2 += y * y; sv2 += vv * vv
        }
        const denom = Math.sqrt(Math.max(1e-9, (vn * sy2 - sy * sy) * (vn * sv2 - sv * sv)))
        const r = (vn * syv - sy * sv) / denom
        mesh = { vertices, indices, flipV: r > 0 }
        break
        }
      }
    }

    // --- MDLS 骨骼定义 ---
    // 0004：count@+13，定义表 @+18，76B/骨骼（u0+parent+f0+矩阵@+12）
    // 0003（Miku 等）：定义表 @+17，头 13B（u0 4B+pad 1B+parent 4B+f0 4B），矩阵 @+13，
    //   矩阵后跟 json 属性块（\0 结尾，变长）——逐骨骼跳过 json
    let boneCount = 0
    const mdlsBones: Array<{ parent: number; bind: number[] }> = []
    if (mdls >= 0 && mdls + 18 + 76 <= len) {
      boneCount = u32At(bytes, mdls + 13)
      if (boneCount > 512) boneCount = 0
      if (mdlsIs3) {
        let q = mdls + 17
        for (let i = 0; i < boneCount && q + 77 <= len; i++) {
          const parent = i32At(bytes, q + 5)
          const mp = q + 13
          const bind: number[] = []
          for (let k = 0; k < 16; k++) bind.push(f32At(bytes, mp + k * 4))
          mdlsBones.push({ parent, bind })
          // 跳过 json 属性块（矩阵后到 \0）
          let j = mp + 64
          while (j < len && bytes[j] !== 0 && j < q + 4096) j++
          q = j + 1
        }
      } else {
        // 0004：骨骼定义 = [tmp u8/u16][type u32][parent i32][len u32][矩阵 len 字节][name\0]
        // （逆向自 wallpaper64.exe；tmp 大部分为 u8，带旋转/特殊骨骼为 u16 —— 用 len 合理性判别）。
        // parent@+5 / 矩阵@+13 与旧实现字段对齐一致（旧 q=mdls+18 时 parent@+4 / 矩阵@+12）。
        let p = mdls + 17
        for (let i = 0; i < boneCount && p + 12 <= len; i++) {
          let headExtra = 0
          let parent = i32At(bytes, p + 5)
          let entryLen = u32At(bytes, p + 9)
          if (entryLen === 0 || entryLen > 4096) {
            parent = i32At(bytes, p + 6)
            entryLen = u32At(bytes, p + 10)
            headExtra = 1
            if (entryLen === 0 || entryLen > 4096) break
          }
          p += 9 + headExtra + 4
          const bind: number[] = []
          for (let k = 0; k < 16; k++) bind.push(f32At(bytes, p + k * 4))
          mdlsBones.push({ parent: parent === -1 ? -1 : parent, bind })
          p += entryLen
          let j = p
          while (j < len && bytes[j] !== 0) j++
          p = j + 1
        }
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

    // --- MDAT 具名骨骼锚点（u16 count@+13，条目 = [u16 boneIdx][name\0][矩阵 64B]）---
    const boneAnchors: PuppetBoneAnchor[] = []
    if (mdat >= 0) {
      const mdatEnd = (() => {
        let e = len
        if (mdla >= 0 && mdla > mdat) e = Math.min(e, mdla)
        if (mdle >= 0 && mdle > mdat) e = Math.min(e, mdle)
        return e
      })()
      const mdatCount = u16At(bytes, mdat + 13)
      if (mdatCount > 0 && mdatCount <= 256) {
        let q = mdat + 15 // 第一条目的 boneIdx
        for (let i = 0; i < mdatCount && q + 2 <= mdatEnd; i++) {
          const boneIdx = u16At(bytes, q); q += 2
          let s = q
          while (s < mdatEnd && bytes[s] !== 0) s++
          if (s >= mdatEnd) break
          const nm = utf8At(bytes, q, s)
          if (nm.length < 1) break
          const mp = s + 1
          if (mp + 64 > mdatEnd) break
          const m: number[] = []
          for (let k = 0; k < 16; k++) m.push(f32At(bytes, mp + k * 4))
          boneAnchors.push({ name: nm, boneIdx, m })
          q = mp + 64
        }
      } else {
        // 兜底：count 字段不可靠时循环扫描
        let q = mdat + 15
        let guard = 0
        while (q + 66 <= mdatEnd && guard++ < 256) {
          const boneIdx = u16At(bytes, q); q += 2
          let s = q
          while (s < mdatEnd && bytes[s] !== 0) s++
          if (s >= mdatEnd) break
          const nm = utf8At(bytes, q, s)
          if (nm.length < 1) break
          const mp = s + 1
          if (mp + 64 > mdatEnd) break
          const m: number[] = []
          for (let k = 0; k < 16; k++) m.push(f32At(bytes, mp + k * 4))
          boneAnchors.push({ name: nm, boneIdx, m })
          q = mp + 64
        }
      }
    }

    // --- 组装骨骼 ---
    const bones: PuppetBone[] = []
    const total = Math.max(boneCount, poseMatrices !== null ? poseMatrices.length / 16 : 0)
    for (let i = 0; i < total; i++) {
      const mdlsB = mdlsBones[i]
      const pose = poseMatrices !== null && i * 16 + 15 < poseMatrices.length
        ? poseMatrices.slice(i * 16, i * 16 + 16)
        : null
      bones.push({
        name: '',
        parent: mdlsB !== undefined ? mdlsB.parent : -1,
        bind: mdlsB !== undefined ? mdlsB.bind : null,
        pose,
      })
    }

    // --- MDLA 动画 ---
    // 0006（新格式）：数据起点 dataLen 后 +1B extra，帧 = [t:3B][8×f32][1B] = 36B
    // 0001（老格式 0013 魔数）：数据起点 dataLen 后无 extra，帧 = 9×f32 = 36B（无 t 字段，
    //   时间用帧序号）
    const mdlaIs1 = mdla >= 0 && mdla6 < 0
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
        const duration = f32At(bytes, q); q += 4 // f32（动画时长秒 / 0013 帧率）
        const bc = u32At(bytes, q); q += 4 // u32（0013：帧计数字段 = 帧数-1?）
        q += 4 // u32
        const bc2 = u32At(bytes, q); q += 4 // 0013：真实骨骼数
        q += 4 // u32
        const dataLen = u32At(bytes, q); q += 4
        if (dataLen <= 0 || dataLen > len - q) break
        if (!mdlaIs1) q++ // 0006：extra (1B)
        let kf: { keyframes: PuppetKeyframe[]; offset: number }
        if (mdlaIs1) {
          // 0001：帧 = 9×f32 = 36B，无时间戳；按帧序号作为 t。
          // 0013 动画数据按骨骼分块：骨骼 0 直接用条目 dataLen（无头），
          // 骨骼 1..N 各带 [u32 0][u32 dataLen] 头 + dataLen 字节。
          const frames = Math.floor(dataLen / 36)
          const kfs: PuppetKeyframe[] = []
          if (frames > 0 && q + 36 <= len) {
            for (let f = 0; f < frames && q + (f + 1) * 36 <= len; f++) {
              const fp = q + f * 36
              const values: number[] = []
              let bad = false
              for (let k = 0; k < 9; k++) {
                const v = f32At(bytes, fp + k * 4)
                if (!Number.isFinite(v)) { bad = true; break }
                values.push(v)
              }
              if (bad) break
              kfs.push({ t: f, values })
            }
          }
          // 逐骨骼数据块：骨骼 0 无头；骨骼 1+ 有 [u32 0][u32 dataLen] 头
          const boneKeyframes: PuppetKeyframe[][] = [kfs]
          let bq = q + kfs.length * 36
          const realBoneCount = Math.min(bc2 > 0 ? bc2 : bc, 64)
          for (let b = 1; b < realBoneCount && bq + 8 <= len; b++) {
            const h0 = u32At(bytes, bq)
            const h1 = u32At(bytes, bq + 4)
            if (h0 !== 0 || h1 !== dataLen) break
            const bData = bq + 8
            const bk: PuppetKeyframe[] = []
            for (let f = 0; f < frames && bData + (f + 1) * 36 <= len; f++) {
              const fp = bData + f * 36
              const values: number[] = []
              let bad = false
              for (let k = 0; k < 9; k++) {
                const v = f32At(bytes, fp + k * 4)
                if (!Number.isFinite(v)) { bad = true; break }
                values.push(v)
              }
              if (bad) break
              bk.push({ t: f, values })
            }
            boneKeyframes.push(bk)
            bq = bData + bk.length * 36
          }
          kf = { keyframes: kfs, offset: bq - q }
          animations.push({
            id, name: nm, loop: lp === 'loop', boneCount: realBoneCount, duration,
            keyframes: kfs, old13: mdlaIs1, boneKeyframes,
          })
          q += kf.offset
          continue
        } else {
          kf = parseKeyframes(bytes, q, dataLen)
        }
        q += kf.offset
        animations.push({ id, name: nm, loop: lp === 'loop', boneCount: bc, duration, keyframes: kf.keyframes, old13: mdlaIs1 })
      }
    }

    // --- MDLA0006 新格式 9 列循环交错逐骨骼动画（渲染主路径；逆向定案，30fps）---
    // 布局：每动画 boneCount 段，每段 frameCount×36B（9 f32/帧）；骨骼 b 的
    //   pos = 段 b 帧 (frame+floor(2b/9))%frameCount 列 (2b)%9,(2b+1)%9
    //   rot = 段 b 帧 (frame+floor(2b/9)+floor((2b+5)/9))%frameCount 列 (2b+5)%9
    const animsV2: PuppetAnimV2[] = []
    if (mdla6 >= 0) {
      try {
        let p = mdla6 + 9
        p += 4 // 段总字节
        const animCount = Math.max(0, Math.min(64, u32At(bytes, p))); p += 4
        for (let a = 0; a < animCount && p + 12 <= len; a++) {
          const id = u32At(bytes, p); p += 4
          p += 4 // u32 0
          let s = p
          while (s < len && bytes[s] !== 0 && s - p < 128) s++
          if (s >= len) break
          const nm = utf8At(bytes, p, s)
          p = s + 1 // \0
          while (p < len && bytes[p] !== 0) p++ // loop 字符串
          if (p >= len) break
          p++
          // 扫描 f32 30.0 标记（0x41F00000 → 字节 F0 41）定位帧数
          while (p + 1 < len && !(bytes[p] === 0xf0 && bytes[p + 1] === 0x41)) p++
          p += 2
          const frameCount = u16At(bytes, p); p += 2
          p += 2 // u16 0
          p += 4 // u32 0
          const boneCount = u32At(bytes, p); p += 4
          p += 4 // u32 0
          const segBytes = u32At(bytes, p); p += 4
          if (boneCount > 512 || segBytes === 0 || segBytes > 0x100000) break
          const segs: number[] = []
          for (let b = 0; b < boneCount && p + (b + 1) * segBytes <= len; b++) segs.push(p + b * segBytes)
          if (segs.length === 0) break
          // 急切解码每骨骼每帧局部 [px, py, rotZ]（避免把原始 MDL 字节序列化到客户端）
          // 上限保护：异常大 frameCount（损坏/恶意 MDL）会导致 localFrames 爆内存
          const totalFrames = Math.max(1, Math.min(frameCount, 4096))
          const localFrames = new Array<number>(boneCount * totalFrames * 3).fill(0)
          for (let b = 0; b < boneCount; b++) {
            const segStart = segs[b]
            const b2 = 2 * b
            const posShift = Math.floor(b2 / 9)
            const posCol = b2 % 9
            const rotShift = Math.floor((b2 + 5) / 9)
            const rotCol = (b2 + 5) % 9
            for (let f = 0; f < totalFrames; f++) {
              const o = segStart + ((f + posShift) % totalFrames) * 36 + posCol * 4
              const o2 = segStart + ((f + posShift + rotShift) % totalFrames) * 36 + rotCol * 4
              let px = Number.NaN
              let py = Number.NaN
              let rotZ = Number.NaN
              if (o + 4 <= bytes.length && o2 + 4 <= bytes.length) {
                px = f32At(bytes, o)
                py = f32At(bytes, o + 4)
                rotZ = f32At(bytes, o2)
              }
              const base = b * totalFrames * 3 + f * 3
              localFrames[base] = px
              localFrames[base + 1] = py
              localFrames[base + 2] = rotZ
            }
          }
          animsV2.push({ id, name: nm, frameCount: totalFrames, boneCount, localFrames })
          p += segBytes * boneCount
        }
      } catch { /* 交错解析失败 → 渲染层回退 legacy animations */ }
    }

    return { material, bones, mesh, animations, animsV2, boneAnchors }
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

/**
 * 采样 MDLA0006 新格式（9 列循环交错）某帧的每骨骼世界位姿（parent 链 2D 累乘）。
 * 读值异常（越界/非有限/量级过大）的骨骼回退其 MDLS 局部 bind 矩阵（链乘继续，不炸）。
 * 与官方引擎一致：角度相加、平移 = 父平移 + Rz(父角度)·局部平移。
 */
export function samplePuppetRT(puppet: PuppetModel, animIdx: number, frame: number): Array<PuppetBoneRT | null> {
  const anim = puppet.animsV2[animIdx]
  if (anim === undefined) return []
  const bones = puppet.bones
  const nb = Math.max(bones.length, anim.boneCount)
  const out: Array<PuppetBoneRT | null> = new Array(nb)
  const totalFrames = Math.max(1, anim.frameCount)
  const f = ((frame % totalFrames) + totalFrames) % totalFrames
  for (let b = 0; b < nb; b++) {
    const bone = bones[b]
    const parent = bone !== undefined ? bone.parent : -1
    const base = b * totalFrames * 3 + f * 3
    const px = anim.localFrames[base]
    const py = anim.localFrames[base + 1]
    const rotZ = anim.localFrames[base + 2]
    if (Number.isFinite(px) && Number.isFinite(py) && Math.abs(px) < 10000 && Math.abs(py) < 10000 && Number.isFinite(rotZ)) {
      if (parent >= 0 && parent < nb && out[parent] !== null && out[parent] !== undefined) {
        const pa = out[parent]!.angle
        const pc = Math.cos(pa)
        const ps = Math.sin(pa)
        out[b] = { angle: pa + rotZ, tx: out[parent]!.tx + px * pc - py * ps, ty: out[parent]!.ty + px * ps + py * pc }
      } else {
        out[b] = { angle: rotZ, tx: px, ty: py }
      }
    } else {
      const bind = bone !== undefined ? bone.bind : null
      if (bind !== null && bind.length >= 16) {
        const ang = Math.atan2(bind[1], bind[0])
        if (parent >= 0 && parent < nb && out[parent] !== null && out[parent] !== undefined) {
          const pa = out[parent]!.angle
          const pc = Math.cos(pa)
          const ps = Math.sin(pa)
          out[b] = { angle: pa + ang, tx: out[parent]!.tx + bind[12] * pc - bind[13] * ps, ty: out[parent]!.ty + bind[12] * ps + bind[13] * pc }
        } else {
          out[b] = { angle: ang, tx: bind[12], ty: bind[13] }
        }
      } else {
        const pr = parent >= 0 && parent < nb ? (out[parent] ?? { angle: 0, tx: 0, ty: 0 }) : { angle: 0, tx: 0, ty: 0 }
        out[b] = { angle: pr.angle, tx: pr.tx, ty: pr.ty }
      }
    }
  }
  return out
}
