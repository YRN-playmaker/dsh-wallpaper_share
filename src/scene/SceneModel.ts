/**
 * SceneModel —— scene.json + pkg 条目 → 归一化图层模型（Phase 1 最小切片）。
 *
 * 纯数据转换（无 IO、无 node API），node 半构建后经 HTTP 交给浏览器渲染；
 * 类型定义同时供浏览器侧 SceneModelRenderer 使用。
 *
 * 覆盖范围（诚实标注）：
 *   - 图层树 + transform（origin/angles/scale/parallaxDepth）✅
 *   - visible 解析（bool / {user|script,value}）✅
 *   - 模型→材质→纹理引用链解析（best-effort）✅
 *   - 纹理（pkg 内嵌图片 + .tex 容器含 LZ4/DXT）✅（Phase 2a）
 *   - 粒子系统描述解析（发射器/初始化器/算子/渲染器/材质）✅（Phase C）
 *   - keyframe 动画 / shader / SceneScript 渲染：后续
 */
import {
  parseScenePkg,
  readSceneJson,
  parseJsonLike,
  parseVec3,
  parseVec2,
  resolveVisible,
  type ParsedPkg,
} from './ScenePkg.ts'
import { parsePuppetMdl, type PuppetModel } from './ScenePuppet.ts'

/** 粒子系统描述（源自 particles/*.json 预设 + instanceoverride） */
export interface ParticleSystemDesc {
  particleRef: string
  materialRef: string
  /** 材质 blending（"translucent"|"additive"|"opaque"），决定混合模式 */
  blending: string
  /** 材质 textures（如 ["particle/fog/fog1"]，相对 assets/materials/ 的 .tex） */
  textureNames: string[]
  maxCount: number
  startTime: number
  emitter: {
    type: string
    rate: number
    directions: [number, number, number]
    distanceMin: number
    distanceMax: number | [number, number, number]
    origin: [number, number, number]
  }
  initializers: {
    lifetime?: [number, number]
    size?: [number, number]
    /** sizerandom exponent：size 分布幂次（>1 偏向小值） */
    sizeExponent?: number
    velocityMin?: [number, number, number]
    velocityMax?: [number, number, number]
    colorMin?: [number, number, number]
    colorMax?: [number, number, number]
    alphaMin?: number
    alphaMax?: number
    turbulentVelocity?: { offset: number; scale: number }
    /** rotationrandom：随机初始旋转（弧度范围） */
    rotation?: [number, number]
    /** angularvelocityrandom：随机角速度（弧度/秒范围，取 z 分量） */
    angularVelocity?: [number, number]
  }
  operators: {
    gravity?: [number, number, number]
    /** movement drag：速度阻尼系数 */
    drag?: number
    /** angularmovement drag：角速度阻尼系数 */
    angularDrag?: number
    /** angularmovement force：角加速度（取 z 分量） */
    angularForce?: [number, number, number]
    alphaFade?: { fadeIn?: number; fadeOut?: number }
    turbulence?: { scale: number; speedMin: number; speedMax: number; phaseMax: number; mask: string }
    oscillateAlpha?: { frequencyMax: number; scaleMin: number }
    /** oscillateposition：位置正弦振荡（mask 为轴向） */
    oscillatePosition?: { frequencyMin: number; frequencyMax: number; scaleMin: number; scaleMax: number; mask: [number, number, number] }
    /** 尺寸变化算子（可多个，依次应用）；startTime/endTime 为寿命比例（0-1） */
    sizeChanges?: Array<{ startTime: number; endTime?: number; startValue: number; endValue: number }>
  }
  renderer: { type: string; length?: number }
  children: ParticleSystemDesc[]
}

export interface SceneModelLayer {
  id: number
  name: string
  kind: 'image' | 'particle' | 'effect' | 'unknown'
  visible: boolean
  /** 父图层 id（puppet 部件等层级结构）；null = 顶层（场景绝对坐标） */
  parent: number | null
  /** 图层尺寸（o.size "w h"）；null = 未声明（用纹理 Image 尺寸） */
  size: [number, number] | null
  /** 图层 alpha（0-1，缺省 1）；0 = 只作变换锚点不绘制（如 puppet 根） */
  alpha: number
  origin: [number, number, number]
  angles: [number, number, number]
  scale: [number, number, number]
  parallaxDepth: [number, number]
  copybackground?: boolean
  /** 模型条目名（如 models/eva.json）；无 image 的图层为 particle/effect/unknown */
  image?: string
  materialRefs: string[]
  textureRefs: string[]
  /** 可解码纹理条目名（jpg/png）；无则 null（.tex 由路由解码） */
  decodableTexture: string | null
  /** puppet 骨骼模型（模型带 puppet 字段时解析 _puppet.mdl） */
  puppet: PuppetModel | null
  /** animationlayers 引用的动画 id（决定播放 puppet 的哪个动画） */
  animationIds: number[]
  /** 骨骼挂载点（o.attachment，如 "head"/"Attachment"）；位置基于 parent 骨骼 */
  attachment: string | null
  /** 粒子系统描述（对象带 particle 字段时） */
  particle: ParticleSystemDesc | null
}

export interface SceneTextureInfo {
  name: string
  decodable: boolean
  size: number
}

export interface SceneCamera {
  center: [number, number, number]
  eye: [number, number, number]
  up: [number, number, number]
}

export interface SceneModel {
  /** 场景宽高（general.orthogonalprojection，缺省 1920×1080） */
  width: number
  height: number
  camera: SceneCamera
  /** general.clearcolor "r g b"（0-1）；无则 null */
  clearColor: [number, number, number] | null
  layers: SceneModelLayer[]
  textures: SceneTextureInfo[]
  layerCount: number
  decodableTextureCount: number
  /** 粒子发射率缩放（视觉校准项，CONFIG.particleRateScale） */
  particleRateScale: number
  /** 粒子尺寸缩放（视觉校准项，CONFIG.particleSizeScale） */
  particleSizeScale: number
  /** puppet 网格蒙皮渲染开关（CONFIG.puppetMeshRender） */
  puppetMeshRender: boolean
}

/** 从 scene.pkg 构建归一化图层模型；失败返回 null（调用方走 fallback） */
export function buildSceneModel(pkgBuf: Uint8Array, opts?: { particleRateScale?: number; particleSizeScale?: number; puppetMeshRender?: boolean }): SceneModel | null {
  const particleRateScale = opts?.particleRateScale ?? 1
  const particleSizeScale = opts?.particleSizeScale ?? 1
  const puppetMeshRender = opts?.puppetMeshRender ?? false
  let pkg: ParsedPkg
  try {
    pkg = parseScenePkg(pkgBuf)
  } catch {
    return null
  }
  const scene = readSceneJson(pkg)
  if (scene === null || typeof scene !== 'object') return null
  const objects = Array.isArray((scene as { objects?: unknown }).objects) ? (scene as { objects?: unknown }).objects as Record<string, unknown>[] : []
  const general = (scene as { general?: unknown }).general as Record<string, unknown> | undefined ?? {}
  const cameraRaw = (scene as { camera?: unknown }).camera as Record<string, unknown> | undefined ?? {}

  const proj = general.orthogonalprojection as { width?: unknown; height?: unknown } | undefined
  const width = toInt(proj?.width, 1920)
  const height = toInt(proj?.height, 1080)

  const clearRaw = typeof general.clearcolor === 'string' ? general.clearcolor : null
  const clearColor = clearRaw !== null ? parseColor3(clearRaw) : null

  const camera: SceneCamera = {
    center: parseVec3(cameraRaw.center, [0, 0, -1]),
    eye: parseVec3(cameraRaw.eye, [0, 0, 0]),
    up: parseVec3(cameraRaw.up, [0, 1, 0]),
  }

  const layers: SceneModelLayer[] = []
  for (const o of objects) {
    const image = typeof o.image === 'string' ? o.image : undefined
    const kind = resolveKind(o, image)
    const refs = image !== undefined ? resolveTextureRefs(pkg, image) : { materials: [], textures: [], decodable: null }
    const decodable = refs.decodable
    const puppet = image !== undefined ? resolvePuppet(pkg, image) : null
    const particle = typeof o.particle === 'string' ? resolveParticleSystem(pkg, o.particle, o) : null
    layers.push({
      id: toInt(o.id, 0),
      name: typeof o.name === 'string' ? o.name : '',
      kind,
      visible: resolveVisible(o.visible, true),
      parent: typeof o.parent === 'number' ? o.parent : null,
      size: parseSize(o.size),
      alpha: numOr(o.alpha, 1),
      origin: parseVec3(o.origin, [0, 0, 0]),
      angles: parseVec3(o.angles, [0, 0, 0]),
      scale: parseVec3(o.scale, [1, 1, 1]),
      parallaxDepth: parseVec2(o.parallaxDepth, [1, 1]),
      copybackground: typeof o.copybackground === 'boolean' ? o.copybackground : undefined,
      image,
      materialRefs: refs.materials,
      textureRefs: refs.textures,
      decodableTexture: decodable,
      puppet,
      animationIds: parseAnimationIds(o.animationlayers),
      attachment: typeof o.attachment === 'string' ? o.attachment : null,
      particle,
    })
  }

  const textures: SceneTextureInfo[] = []
  for (const e of pkg.entries) {
    if (/\.(tex|png|jpe?g)$/i.test(e.name)) {
      textures.push({ name: e.name, decodable: /\.(png|jpe?g)$/i.test(e.name), size: e.size })
    }
  }

  return {
    width,
    height,
    camera,
    clearColor,
    layers,
    textures,
    layerCount: layers.length,
    decodableTextureCount: textures.filter((t) => t.decodable).length,
    particleRateScale,
    particleSizeScale,
    puppetMeshRender,
  }
}

function resolveKind(o: Record<string, unknown>, image: string | undefined): SceneModelLayer['kind'] {
  if (image !== undefined) return 'image'
  const keys = Object.keys(o)
  if (keys.some((k) => /particle/i.test(k))) return 'particle'
  if (keys.some((k) => k === 'effect' || k === 'effects')) return 'effect'
  return 'unknown'
}

/** 沿 image → material → textures 解析纹理引用链（best-effort，容错） */
function resolveTextureRefs(pkg: ParsedPkg, imagePath: string): { materials: string[]; textures: string[]; decodable: string | null } {
  const materials: string[] = []
  const textures: string[] = []
  try {
    const modelBuf = pkg.read(imagePath)
    if (modelBuf !== null) {
      const model = parseJsonLike(modelBuf) as { material?: unknown }
      if (typeof model.material === 'string') {
        materials.push(model.material)
        const matBuf = pkg.read(model.material)
        if (matBuf !== null) {
          const mat = parseJsonLike(matBuf) as { passes?: Array<{ textures?: unknown }> }
          if (Array.isArray(mat.passes)) {
            for (const pass of mat.passes) {
              if (Array.isArray(pass.textures)) {
                for (const t of pass.textures) {
                  if (typeof t !== 'string') continue
                  // 纹理名 → 条目名（材料常见 materials/<name>.tex）
                  for (const cand of ['materials/' + t + '.tex', 'materials/' + t + '.png', t]) {
                    if (pkg.has(cand)) {
                      textures.push(cand)
                      break
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  } catch { /* 模型/材质解析失败：跳过引用链 */ }
  const decodable = textures.find((t) => /\.(png|jpe?g)$/i.test(t)) ?? null
  return { materials, textures, decodable }
}

/** 解析图层尺寸 "w h"（正数）；无/非法返回 null */
function parseSize(v: unknown): [number, number] | null {
  if (typeof v !== 'string') return null
  const parts = v.trim().split(/\s+/).map(Number)
  if (parts.length < 2 || !parts.slice(0, 2).every((n) => Number.isFinite(n) && n > 0)) return null
  return [parts[0], parts[1]]
}

/** 解析 animationlayers → 动画 id 列表 */
function parseAnimationIds(v: unknown): number[] {
  if (!Array.isArray(v)) return []
  const ids: number[] = []
  for (const a of v) {
    if (a !== null && typeof a === 'object' && typeof (a as { animation?: unknown }).animation === 'number') {
      ids.push((a as { animation: number }).animation)
    }
  }
  return ids
}

/** 解析 puppet 骨骼模型：模型 json 的 puppet 字段 → _puppet.mdl → PuppetModel */
function resolvePuppet(pkg: ParsedPkg, imagePath: string): PuppetModel | null {
  try {
    const modelBuf = pkg.read(imagePath)
    if (modelBuf === null) return null
    const model = parseJsonLike(modelBuf) as { puppet?: unknown }
    if (typeof model.puppet !== 'string') return null
    const mdlBuf = pkg.read(model.puppet)
    if (mdlBuf === null) return null
    return parsePuppetMdl(mdlBuf)
  } catch {
    return null
  }
}

function parseColor3(text: string): [number, number, number] {  const parts = text.trim().split(/\s+/).map(Number)
  if (parts.length < 3 || parts.some((n) => !Number.isFinite(n))) return [0, 0, 0]
  const max = Math.max(...parts)
  // WE clearcolor/ambientcolor 为 0-1 浮点；若 >1 视为 0-255
  const scale = max > 1.01 ? 1 / 255 : 1
  return [parts[0] * scale, parts[1] * scale, parts[2] * scale]
}

/** 解析粒子预设（particles/*.json）→ 归一化粒子系统描述（best-effort 容错） */
function resolveParticleSystem(pkg: ParsedPkg, ref: string, obj: Record<string, unknown>): ParticleSystemDesc | null {
  try {
    const buf = pkg.read(ref)
    if (buf === null) return null
    const preset = parseJsonLike(buf) as Record<string, unknown>
    const override = (obj.instanceoverride ?? {}) as Record<string, unknown>
    const matRef = typeof preset.material === 'string' ? preset.material : ''
    const textureNames: string[] = []
    let blending = 'translucent'
    if (matRef !== '') {
      try {
        const mat = parseJsonLike(pkg.read(matRef) as Uint8Array) as { passes?: Array<{ textures?: unknown; blending?: string }> }
        if (Array.isArray(mat.passes)) {
          for (const pass of mat.passes) {
            if (typeof pass.blending === 'string' && pass.blending !== '') blending = pass.blending
            if (Array.isArray(pass.textures)) {
              for (const t of pass.textures) {
                if (typeof t === 'string' && !textureNames.includes(t)) textureNames.push(t)
              }
            }
          }
        }
      } catch { /* 材质解析失败 */ }
    }

    const emitters = Array.isArray(preset.emitter) ? preset.emitter as Record<string, unknown>[] : []
    const em = emitters[0] ?? {}
    // rate：存原始值（视觉缩放由 runtime 按 CONFIG.particleRateScale 应用）。
    // 缺省时按 maxcount 推导。
    const maxcount = toInt(preset.maxcount, 40)
    const rate = em.rate !== undefined
      ? numOr(em.rate, 1)
      : (override.rate !== undefined ? numOr(override.rate, 1) : Math.max(1, Math.round(maxcount / 15)))
    const emitter = {
      type: typeof em.name === 'string' ? em.name : 'sphererandom',
      rate,
      directions: parseVec3(em.directions, [1, 1, 0]),
      distanceMin: numOr(em.distancemin, 0),
      distanceMax: typeof em.distancemax === 'string' && em.distancemax.includes(' ')
        ? parseVec3(em.distancemax, [1, 1, 1])
        : numOr(em.distancemax, 1),
      origin: parseVec3(em.origin, [0, 0, 0]),
    }

    const initializers: ParticleSystemDesc['initializers'] = {}
    const ops: ParticleSystemDesc['operators'] = {}
    const inits = Array.isArray(preset.initializer) ? preset.initializer as Record<string, unknown>[] : []
    for (const init of inits) {
      const name = typeof init.name === 'string' ? init.name : ''
      const mn = numOr(init.min, 0)
      const mx = numOr(init.max, 0)
      if (name === 'lifetimerandom') initializers.lifetime = [mn, mx]
      else if (name === 'sizerandom') { initializers.size = [mn, mx]; initializers.sizeExponent = numOr(init.exponent, 1) }
      else if (name === 'alpharandom') { initializers.alphaMin = mn; initializers.alphaMax = mx }
      else if (name === 'velocityrandom') { initializers.velocityMin = parseVec3(init.min, [0, 0, 0]); initializers.velocityMax = parseVec3(init.max, [0, 0, 0]) }
      else if (name === 'colorrandom') { initializers.colorMin = parseVec3(init.min, [1, 1, 1]); initializers.colorMax = parseVec3(init.max, [1, 1, 1]) }
      else if (name === 'turbulentvelocityrandom') initializers.turbulentVelocity = { offset: numOr(init.offset, -0.5), scale: numOr(init.scale, 0.1) }
      else if (name === 'rotationrandom') initializers.rotation = [mn, mx !== 0 ? mx : Math.PI * 2]
      else if (name === 'angularvelocityrandom') {
        const v = parseVec3(init.min, [0, 0, 0])
        const w = parseVec3(init.max, [0, 0, 0])
        initializers.angularVelocity = [v[2], w[2]]
      }
    }
    const operators = Array.isArray(preset.operator) ? preset.operator as Record<string, unknown>[] : []
    for (const op of operators) {
      const name = typeof op.name === 'string' ? op.name : ''
      if (name === 'movement') {
        ops.gravity = parseVec3(op.gravity, [0, 0, 0])
        ops.drag = numOr(op.drag, 0)
      } else if (name === 'angularmovement') {
        ops.angularDrag = numOr(op.drag, 0)
        ops.angularForce = parseVec3(op.force, [0, 0, 0])
      } else if (name === 'alphafade') ops.alphaFade = { fadeIn: numOr(op.fadeintime, 0), fadeOut: numOr(op.fadeouttime, 0) }
      else if (name === 'turbulence') ops.turbulence = { scale: numOr(op.scale, 0.002), speedMin: numOr(op.speedmin, 100), speedMax: numOr(op.speedmax, 150), phaseMax: numOr(op.phasemax, 5), mask: typeof op.mask === 'string' ? op.mask : '1 0 0' }
      else if (name === 'oscillatealpha') ops.oscillateAlpha = { frequencyMax: numOr(op.frequencymax, 20), scaleMin: numOr(op.scalemin, 0.7) }
      else if (name === 'oscillateposition') ops.oscillatePosition = {
        frequencyMin: numOr(op.frequencymin, 1),
        frequencyMax: numOr(op.frequencymax, 1),
        scaleMin: numOr(op.scalemin, 1),
        scaleMax: numOr(op.scalemax, 1),
        mask: parseVec3(op.mask, [1, 1, 0]),
      }
      else if (name === 'sizechange') {
        (ops.sizeChanges ??= []).push({
          startTime: numOr(op.starttime, 0),
          endTime: op.endtime !== undefined ? numOr(op.endtime, 1) : undefined,
          startValue: numOr(op.startvalue, 1),
          endValue: numOr(op.endvalue, 1),
        })
      }
    }

    const renderers = Array.isArray(preset.renderer) ? preset.renderer as Record<string, unknown>[] : []
    const rd = renderers[0] ?? {}
    const renderer = { type: typeof rd.name === 'string' ? rd.name : 'sprite', length: numOr(rd.length, undefined) }

    const children: ParticleSystemDesc[] = []
    if (Array.isArray(preset.children)) {
      for (const c of preset.children) {
        if (c !== null && typeof c === 'object' && typeof (c as { name?: unknown }).name === 'string') {
          const child = resolveParticleSystem(pkg, (c as { name: string }).name, obj)
          if (child !== null) children.push(child)
        }
      }
    }

    // instanceoverride 覆盖：colorn/alpha/brightness/lifetime/size/speed/count/rate
    if (typeof override.colorn === 'string') {
      const c = parseColor3(override.colorn)
      initializers.colorMin = c
      initializers.colorMax = c
    }
    if (typeof override.alpha === 'number') { initializers.alphaMin = override.alpha; initializers.alphaMax = override.alpha }
    if (typeof override.lifetime === 'number') initializers.lifetime = [override.lifetime, override.lifetime]
    if (typeof override.size === 'number') initializers.size = [override.size, override.size]
    if (typeof override.count === 'number') { /* count 为密度系数，近似按比例放大 rate */ }

    return {
      particleRef: ref,
      materialRef: matRef,
      blending,
      textureNames,
      maxCount: maxcount,
      startTime: numOr(preset.starttime, 0),
      emitter,
      initializers,
      operators: ops,
      renderer,
      children,
    }
  } catch {
    return null
  }
}

function numOr(v: unknown, def: number | undefined): number {
  if (v === undefined) return def as number
  const n = Number(v)
  return Number.isFinite(n) ? n : (def as number)
}

function toInt(v: unknown, def: number): number {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? Math.round(n) : def
}
