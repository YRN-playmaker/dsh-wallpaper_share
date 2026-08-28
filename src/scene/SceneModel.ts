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
  /** 材质 REFRACT 折射（雨滴/玻璃：采样背景折射变形，视觉透明） */
  refract: boolean
  /** REFRACT 折射强度（材质 ui_editor_properties_refract_amount，可为负） */
  refractAmount: number
  /** 动画模式（animationmode）："randomframe" = 粒子出生随机帧后固定（静态水珠） */
  animationMode: string | null
  /** 材质 overbright（genericparticle 的 g_Overbright，颜色亮度系数） */
  overbright: number
  /** 材质 textures（如 ["particle/fog/fog1"]，相对 assets/materials/ 的 .tex） */
  textureNames: string[]
  maxCount: number
  /** 预设是否有 alpharandom 初始器（有 alpharandom 的粒子：alpha 覆盖为 1 保持可见；
   * 无 alpharandom 的烟雾/火花：用真实 alpha 实现 instanceoverride 淡效果） */
  hasAlpharandom: boolean
  /** starttime：创建时预模拟秒数（官方语义，见 particles-general "Start Time"） */
  startTime: number
  /** 预设 flags bit0：worldspace（粒子忽略粒子系统自身的位移/旋转，仅用自身坐标） */
  worldSpace: boolean
  /**
   * 预设 flags bit2：perspective rendering（particles-general "Perspective rendering"）。
   * 2D 场景中开启深度：粒子按发射区 z 深度近大远小（位置/尺寸/速度 × depthFactor）。
   * 如 "Rain perspective"（sphererandom dirs.z=1, distMax=1024）雨幕；leaves 树叶飘落。
   */
  perspective: boolean
  /** 透视焦距（像素）：depthFactor = 1 / (1 + max(0, -z) / focal)，focal = (h/2)/tan(fov/2) */
  perspectiveFocal: number
  emitter: {
    type: string
    rate: number
    /** instantaneous：系统创建时立即生成的粒子数（rate=0 的一次性爆发，常用于子粒子） */
    instantaneous: number
    directions: [number, number, number]
    distanceMin: number
    distanceMax: number | [number, number, number]
    origin: [number, number, number]
    /** emitter 初始速度范围（无 velocityrandom 时的球面随机方向速度；如 sparktrails 0..1024） */
    speedMin?: number
    speedMax?: number
    /** 发射区符号（sign "x y z"：0=双向，1=只正，-1=只负；如 sparktrails "0 1 0" 只在 y 上方生成） */
    sign?: [number, number, number]
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
    /**
     * turbulentvelocityrandom：噪声驱动的湍流速度（烟流"一阵阵风"效果）。
     * direction = normalize(forward × offset + noise(phase, time·timescale) × scale)，
     * velocity = direction × rand(speedMin, speedMax)。
     * scale 控制方向发散度（1 = 全方向，0 = 沿 forward 直线）；
     * offset 为 forward 方向的定向偏移；timescale 为噪声时间速度。
     */
    turbulentVelocity?: {
      offset: number
      scale: number
      speedMin?: number
      speedMax?: number
      phaseMin?: number
      phaseMax?: number
      timescale?: number
    }
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
    /** remapvalue(output=velocity)：速度重映射范围（噪声输出，rain_screen_fast 用） */
    velocityRemap?: { min: [number, number, number]; max: [number, number, number] }
  }
  renderer: { type: string; length?: number; maxlength?: number; minlength?: number }
  /** spritesheet 序列播放速度倍数（sequence multiplier，如 smoke1=2 帧速×2） */
  sequenceMultiplier: number
  /** 子粒子系统（children：rain_screen 的 static/fast 子雨滴）；type 为预设 children[].type
   *  （"eventfollow" = 在父粒子位置生成并跟随父粒子事件；undefined = 独立于父系统原点） */
  children: Array<{ desc: ParticleSystemDesc; type: string | null }>
  /** 控制点线段（mapsequencebetweencontrolpoints）：粒子沿 cp0(原点)→cp1 线段分布。
   *  局部坐标；worldSpace 时 cp1 = 世界坐标 - origin。如 discharge 的"闪电包裹线段"。 */
  controlPointLine: [number, number] | null
  /** 线段上的序列点数（mapsequence count） */
  sequenceCount: number
  /** 序列往返（limitbehavior mirror） */
  sequenceMirror: boolean
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
  /** 昼夜自动切换（SceneScript 用 engine.timeOfDay + smoothStep(START_HOUR,END_HOUR) 控 alpha）。
   *  渲染时按本地时长的日出/日落小时计算该层的昼夜 alpha 因子（夜间 1 / 白天 0）。
   *  缺省 undefined = 无昼夜脚本，用静态 alpha。 */
  dayNight?: { dayStartH: number; dayEndH: number; nightWhenStart: boolean; nightWhenEnd: boolean }
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
  /** 图层效果（o.effects：waterwaves/shake/opacity/bloom 等，shader 类在浏览器用 2D 近似） */
  effects: LayerEffect[]
}

export type LayerEffect =
  | { type: 'waterwaves'; direction: number; speed: number; scale: number; strength: number; exponent: number; mask: string | null }
  | { type: 'shake'; bounds: [number, number]; friction: [number, number]; speed: number; strength: number; mask: string | null }
  | { type: 'opacity'; alpha: number }
  | { type: 'bloom'; gamma: number; opacity: number; radius: number; strength: number; threshold: number }
  | { type: 'nitro'; colorStart: [number, number, number]; colorEnd: [number, number, number]; multiply: number; ranges: [number, number]; scales: [number, number]; speeds: [number, number, number, number]; smoothness: number; mask: string | null; noise: string | null }
  | { type: 'unknown' }

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
  /** 图层效果强度缩放（CONFIG.effectStrengthScale；waterwaves/shake 幅度全局系数） */
  effectStrengthScale: number
  /** puppet 网格蒙皮渲染开关（CONFIG.puppetMeshRender） */
  puppetMeshRender: boolean
}

/** 从 scene.pkg 构建归一化图层模型；失败返回 null（调用方走 fallback） */
export function buildSceneModel(pkgBuf: Uint8Array, opts?: { particleRateScale?: number; particleSizeScale?: number; effectStrengthScale?: number; puppetMeshRender?: boolean }): SceneModel | null {
  const particleRateScale = opts?.particleRateScale ?? 1
  const particleSizeScale = opts?.particleSizeScale ?? 1
  const effectStrengthScale = opts?.effectStrengthScale ?? 1
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

  // 透视焦距（perspective rendering = 粒子深度近大远小）：
  //   focal = (height/2) / tan(fov/2)，fov 默认 50
  const fovDeg = numOr(general.fov, 50)
  const fovRad = fovDeg * Math.PI / 180
  const perspectiveFocal = (height / 2) / Math.tan(fovRad / 2)

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
    const particle = typeof o.particle === 'string' ? resolveParticleSystem(pkg, o.particle, o, perspectiveFocal) : null
    layers.push({
      id: toInt(o.id, 0),
      name: typeof o.name === 'string' ? o.name : '',
      kind,
      visible: resolveVisible(o.visible, true),
      parent: typeof o.parent === 'number' ? o.parent : null,
      size: parseSize(o.size),
      alpha: numOr(o.alpha, 1),
      dayNight: parseDayNightAlpha(o.alpha),
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
      effects: parseLayerEffects(o),
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
    effectStrengthScale,
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

function parseColor3(text: string): [number, number, number] {
  const parts = text.trim().split(/\s+/).map(Number)
  if (parts.length < 3 || parts.some((n) => !Number.isFinite(n))) return [0, 0, 0]
  const max = Math.max(...parts)
  // WE clearcolor/ambientcolor 为 0-1 浮点；若 >1 视为 0-255
  const scale = max > 1.01 ? 1 / 255 : 1
  return [parts[0] * scale, parts[1] * scale, parts[2] * scale]
}

/** 解析图层效果（o.effects：waterwaves/shake/opacity/bloom，取 passes[0].constantshadervalues）。
 *  visible 语义：布尔 false / value:false → 不应用；SceneScript 脚本控制（无明确 value）→
 *  无法评估，默认不应用（如 3151551777 的 shownight 条件效果）；缺失或 true → 应用。 */
function parseLayerEffects(o: Record<string, unknown>): LayerEffect[] {
  const raw = o.effects
  if (!Array.isArray(raw)) return []
  const out: LayerEffect[] = []
  for (const e of raw) {
    if (e === null || typeof e !== 'object') continue
    const obj = e as Record<string, unknown>
    // visible 过滤
    const vis = obj.visible
    if (typeof vis === 'boolean') {
      if (!vis) continue
    } else if (vis !== null && typeof vis === 'object') {
      const vobj = vis as Record<string, unknown>
      // SceneScript 控制（如 3151551777 的 shownight 条件效果）：无法评估 → 保守跳过
      if (vobj.script !== undefined) continue
      const vval = vobj.value
      if (typeof vval === 'boolean' && !vval) continue
    }
    const file = typeof obj.file === 'string' ? obj.file : ''
    const passes = Array.isArray(obj.passes) ? obj.passes as Record<string, unknown>[] : []
    const pass0 = passes[0] ?? {}
    const csv = (pass0.constantshadervalues ?? {}) as Record<string, unknown>
    // mask 纹理：passes[0].textures[1]（g_Texture1 opacitymask，非 null 时）
    const textures = Array.isArray(pass0.textures) ? pass0.textures as unknown[] : []
    const mask = textures.length > 1 && typeof textures[1] === 'string' && textures[1] !== '' ? textures[1] : null
    const n = (v: unknown, d: number): number => {
      const x = Number(v)
      return Number.isFinite(x) ? x : d
    }
    const v2 = (v: unknown, d: [number, number]): [number, number] => {
      if (typeof v === 'string') {
        const p = v.trim().split(/\s+/).map(Number)
        if (p.length >= 2 && p.every((x) => Number.isFinite(x))) return [p[0], p[1]]
      }
      return d
    }
    if (file.includes('waterwaves')) {
      out.push({
        type: 'waterwaves',
        direction: n(csv.direction, 0),
        speed: n(csv.speed, 5),
        scale: n(csv.scale, 200),
        strength: n(csv.strength, 0.1),
        exponent: n(csv.exponent, 1),
        mask,
      })
    } else if (file.includes('shake')) {
      out.push({
        type: 'shake',
        bounds: v2(csv.bounds, [0, 1]),
        friction: v2(csv.friction, [1, 1]),
        speed: n(csv.speed, 1),
        strength: n(csv.strength, 0.1),
        mask,
      })
    } else if (file.includes('opacity')) {
      out.push({ type: 'opacity', alpha: n(csv.alpha, 1) })
    } else if (file.includes('bloom')) {
      out.push({
        type: 'bloom',
        gamma: n(csv.gamma, 1),
        opacity: n(csv.opacity, 1),
        radius: n(csv.radius, 5),
        strength: n(csv.strength, 0.3),
        threshold: n(csv.threshold, 0),
      })
    } else if (file.includes('nitro')) {
      // nitro 效果：流动彩色烟雾（带 mask 遮罩 + 噪声纹理）——底图颜色混合
      // 纹理布局：textures[0]=null(底图), textures[1]=噪声(clouds_256), textures[2]=mask
      const noise = textures.length > 1 && typeof textures[1] === 'string' && textures[1] !== '' ? textures[1] : null
      const mask = textures.length > 2 && typeof textures[2] === 'string' && textures[2] !== '' ? textures[2] : null
      const v2 = (v: unknown, d: [number, number]): [number, number] => {
        if (typeof v === 'string') {
          const p = v.trim().split(/\s+/).map(Number)
          if (p.length >= 2 && p.every((x) => Number.isFinite(x))) return [p[0], p[1]]
        }
        return d
      }
      const v4 = (v: unknown, d: [number, number, number, number]): [number, number, number, number] => {
        if (typeof v === 'string') {
          const p = v.trim().split(/\s+/).map(Number)
          if (p.length >= 4 && p.every((x) => Number.isFinite(x))) return [p[0], p[1], p[2], p[3]]
        }
        return d
      }
      out.push({
        type: 'nitro',
        colorStart: parseColor3(typeof csv.colorstart === 'string' ? csv.colorstart : '0 0.5 1'),
        colorEnd: parseColor3(typeof csv.colorend === 'string' ? csv.colorend : '1 1 1'),
        multiply: n(csv.multiply, 1),
        ranges: v2(csv.bounds, [0.3, 0.25]),
        scales: v2(csv.scale, [1, 2]),
        speeds: v4(csv.speed, [-0.1, 0.7, 0.1, -0.5]),
        smoothness: n(csv.smoothness, 1),
        mask,
        noise,
      })
    } else {
      out.push({ type: 'unknown' })
    }
  }
  return out
}

/** 解析粒子预设（particles/*.json）→ 归一化粒子系统描述（best-effort 容错） */
function resolveParticleSystem(pkg: ParsedPkg, ref: string, obj: Record<string, unknown>, perspectiveFocal: number): ParticleSystemDesc | null {
  try {
    const buf = pkg.read(ref)
    if (buf === null) return null
    const preset = parseJsonLike(buf) as Record<string, unknown>
    const override = (obj.instanceoverride ?? {}) as Record<string, unknown>
    const matRef = typeof preset.material === 'string' ? preset.material : ''
    const textureNames: string[] = []
    let blending = 'translucent'
    let overbright = 1
    let refract = false
    let refractAmount = 0
    let hasAlpharandom = false
    if (matRef !== '') {
      try {
        const mat = parseJsonLike(pkg.read(matRef) as Uint8Array) as { passes?: Array<{ textures?: unknown; blending?: string; constantshadervalues?: Record<string, unknown>; combos?: Record<string, unknown> }> }
        if (Array.isArray(mat.passes)) {
          for (const pass of mat.passes) {
            if (typeof pass.blending === 'string' && pass.blending !== '') blending = pass.blending
            // REFRACT 折射（雨滴/玻璃水滴）：透过粒子采样背景折射变形 → 视觉透明
            if (pass.combos !== undefined && typeof pass.combos === 'object' && (pass.combos.REFRACT as unknown as number) === 1) refract = true
            const csv = pass.constantshadervalues
            if (csv !== undefined && typeof csv === 'object') {
              const ob = Number(csv.ui_editor_properties_overbright)
              if (Number.isFinite(ob) && ob > 0) overbright = ob
              // 折射强度（官方 g_RefractAmount，可为负，如 rain_screen -0.1）
              const ra = Number(csv.ui_editor_properties_refract_amount)
              if (Number.isFinite(ra)) refractAmount = ra
            }
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
    // rate：预设值（每秒粒子数），instanceoverride.rate 为**乘数**（火花 5×0.15=0.75/s
    // 慢闪烁、Rain2 700×1.96 密集）。旧实现把 override.rate 当缺省回退，导致闪烁过快。
    // maxCount 上限：GL 实例化一次 drawArraysInstanced 可承载数千粒子，
    // Canvas 2D 路径有 DRAW_LIMIT（400/层）兜底。5000 兼顾密度与流畅度
    // （Rain_1 maxcount=5000：clamp 过低导致雨滴稀疏、覆盖不全）。
    const maxcount = Math.min(toInt(preset.maxcount, 40), 5000)
    let rate = em.rate !== undefined
      ? numOr(em.rate, 1)
      : Math.max(1, Math.round(maxcount / 15))
    if (typeof override.rate === 'number' && override.rate > 0) rate *= override.rate
    const emitter = {
      type: typeof em.name === 'string' ? em.name : 'sphererandom',
      rate,
      instantaneous: toInt(em.instantaneous, 0),
      directions: parseVec3(em.directions, [1, 1, 0]),
      distanceMin: numOr(em.distancemin, 0),
      distanceMax: typeof em.distancemax === 'string' && em.distancemax.includes(' ')
        ? parseVec3(em.distancemax, [1, 1, 1])
        : numOr(em.distancemax, 1),
      origin: parseVec3(em.origin, [0, 0, 0]),
      // emitter 初始速度（speedmin/speedmax）：sphererandom/boxrandom 在无 velocityrandom
      // 时也用球面随机方向 × speed 生成初始速度（如 sparktrails 0..1024 火花四溅）
      speedMin: em.speedmin !== undefined ? numOr(em.speedmin, 0) : undefined,
      speedMax: em.speedmax !== undefined ? numOr(em.speedmax, 0) : undefined,
      // 发射区符号（sign）：sparktrails "0 1 0" → y 只正（火花从父粒子上方爆发）
      sign: em.sign !== undefined ? parseVec3(em.sign, [0, 0, 0]) : undefined,
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
      else if (name === 'alpharandom') { initializers.alphaMin = mn; initializers.alphaMax = mx; hasAlpharandom = true }
      else if (name === 'velocityrandom') { initializers.velocityMin = parseVec3(init.min, [0, 0, 0]); initializers.velocityMax = parseVec3(init.max, [0, 0, 0]) }
      else if (name === 'colorrandom') {
        // max 缺失（官方只给 min）= 固定颜色（如 fog2 "255 255 255" 白色雾）
        const cmn = parseVec3(init.min, [1, 1, 1])
        initializers.colorMin = cmn
        initializers.colorMax = init.max !== undefined ? parseVec3(init.max, cmn) : cmn
      }
      else if (name === 'turbulentvelocityrandom') {
        // 噪声驱动湍流速度（particles-initializer "Turbulent velocity random"）：
        //   speedmin/speedmax = 速度范围；scale = 方向发散度；offset = forward 偏移；
        //   phasemin/phasemax = 每粒子相位；timescale = 噪声时间速度（noise speed）
        const smin = init.speedmin !== undefined ? numOr(init.speedmin, 0) : undefined
        const smax = init.speedmax !== undefined ? numOr(init.speedmax, 0) : undefined
        initializers.turbulentVelocity = {
          // offset 沿模型 +Y（发射主方向）的定向偏移；正 = 沿 +Y（图层角度旋转后成喷流方向），
          // 负 = 反方向。默认 0.5（WE 默认偏移使 smoke 类粒子沿自身方向喷出）。
          offset: init.offset !== undefined ? numOr(init.offset, 0.5) : 0.5,
          scale: init.scale !== undefined ? numOr(init.scale, 0.1) : 0.1,
          speedMin: smin,
          speedMax: smax,
          phaseMin: init.phasemin !== undefined ? numOr(init.phasemin, 0) : undefined,
          phaseMax: init.phasemax !== undefined ? numOr(init.phasemax, 1) : undefined,
          timescale: init.timescale !== undefined ? numOr(init.timescale, 0.1) : undefined,
        }
      }
      else if (name === 'rotationrandom') {
        // WE 官方 rotationrandom 的 min/max 为 vec3 字符串（如 "0 0 6"），
        // 取 z 分量（绕屏幕法线旋转，即 sprite 在屏幕面上的旋转角）
        const rmn = parseVec3(init.min, [0, 0, 0])
        const rmx = parseVec3(init.max, [0, 0, 0])
        const rz = rmx[2] !== 0 ? rmx[2] : Math.PI * 2
        initializers.rotation = [rmn[2] !== 0 ? rmn[2] : 0, Math.max(rz, rmn[2])]
      }
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
      else if (name === 'remapvalue' && typeof op.output === 'string' && op.output === 'velocity') {
        ops.velocityRemap = {
          min: parseVec3(op.outputrangemin, [0, 0, 0]),
          max: parseVec3(op.outputrangemax, [0, 0, 0]),
        }
      }
    }

    const renderers = Array.isArray(preset.renderer) ? preset.renderer as Record<string, unknown>[] : []
    const rd = renderers[0] ?? {}
    const renderer = { type: typeof rd.name === 'string' ? rd.name : 'sprite', length: numOr(rd.length, undefined), maxlength: numOr(rd.maxlength, undefined), minlength: numOr(rd.minlength, undefined) }
    // sequence multiplier：spritesheet 序列播放速度倍数（particles-general "Sequence multiplier"，
    // 如 smoke1=2 → 帧速 ×2；null/0 → 1）
    const seqMultRaw = preset.sequencemultiplier
    const sequenceMultiplier = typeof seqMultRaw === 'number' && Number.isFinite(seqMultRaw) && seqMultRaw > 0 ? seqMultRaw : 1

    const children: Array<{ desc: ParticleSystemDesc; type: string | null }> = []
    if (Array.isArray(preset.children)) {
      for (const c of preset.children) {
        if (c !== null && typeof c === 'object' && typeof (c as { name?: unknown }).name === 'string') {
          const child = resolveParticleSystem(pkg, (c as { name: string }).name, obj, perspectiveFocal)
          if (child !== null) {
            children.push({
              desc: child,
              // children[].type：eventfollow = 在父粒子位置生成并跟随父粒子事件
              type: typeof (c as { type?: unknown }).type === 'string' ? (c as { type: string }).type : null,
            })
          }
        }
      }
    }

    // instanceoverride 覆盖：colorn/alpha/brightness/lifetime/size/speed/count/rate
    // colorn 为 0-1 浮点（parseColor3 归一化），需乘 255 与 colorrandom 的 0-255 单位统一，
    // 否则 ParticleRuntime 按 0-255 取整会把颜色压成近黑（如 fog 0.55 → 1）。
    if (typeof override.colorn === 'string') {
      const c = parseColor3(override.colorn)
      initializers.colorMin = [c[0] * 255, c[1] * 255, c[2] * 255]
      initializers.colorMax = [c[0] * 255, c[1] * 255, c[2] * 255]
    }
    // instanceoverride.alpha 为 alpha 乘数（官方 CParticle：alpha = alpharandom × override，
    // 不 clamp——fog 0.15-0.2 × 2 = 0.3-0.4）。旧实现 clamp 成 1 使雾偏淡。
    if (typeof override.alpha === 'number') {
      const f = Math.max(0, override.alpha)
      if (initializers.alphaMin !== undefined && initializers.alphaMax !== undefined) {
        initializers.alphaMin *= f
        initializers.alphaMax *= f
      } else {
        initializers.alphaMin = f
        initializers.alphaMax = f
      }
    }
    // instanceoverride.lifetime/size/speed/count 均为乘数（fog1: size 2/speed 3/count 2）：
    // 旧实现把 size 覆盖成绝对值 [2,2] 导致粒子 2px、count 完全忽略。
    if (typeof override.lifetime === 'number') {
      const f = override.lifetime
      if (initializers.lifetime !== undefined) initializers.lifetime = [initializers.lifetime[0] * f, initializers.lifetime[1] * f]
      else initializers.lifetime = [f, f]
    }
    if (typeof override.size === 'number') {
      const f = override.size
      if (initializers.size !== undefined) initializers.size = [initializers.size[0] * f, initializers.size[1] * f]
      else initializers.size = [32 * f, 32 * f]
    }
    if (typeof override.speed === 'number') {
      const f = override.speed
      if (initializers.velocityMin !== undefined && initializers.velocityMax !== undefined) {
        initializers.velocityMin = [initializers.velocityMin[0] * f, initializers.velocityMin[1] * f, initializers.velocityMin[2] * f]
        initializers.velocityMax = [initializers.velocityMax[0] * f, initializers.velocityMax[1] * f, initializers.velocityMax[2] * f]
      }
    }
    if (typeof override.count === 'number' && override.count > 0) emitter.rate *= override.count

    // 控制点线段 + 序列初始器（mapsequencebetweencontrolpoints）：
    // discharge 的闪电是粒子沿 origin→controlpoint1 线段分布 + rope 连线包裹背景线段。
    let controlPointLine: [number, number] | null = null
    let sequenceCount = 0
    let sequenceMirror = false
    const cps = Array.isArray(preset.controlpoint) ? preset.controlpoint as Record<string, unknown>[] : []
    const cp1 = cps.find((c) => (c as { id?: unknown }).id === 1)
    if (cp1 !== undefined) {
      const flags = numOr(cp1.flags, 0)
      const rawOff = override.controlpoint1 !== undefined
        ? override.controlpoint1
        : cp1.offset
      if (typeof rawOff === 'string') {
        const off = parseVec3(rawOff, [0, 0, 0])
        if ((flags & 2) !== 0) {
          // worldSpace：cp1 局部 = 世界坐标 - 粒子系统 origin（官方 CParticle 语义，不除 scale）
          const originW = parseVec3(obj.origin, [0, 0, 0])
          controlPointLine = [off[0] - originW[0], off[1] - originW[1]]
        } else {
          controlPointLine = [off[0], off[1]]
        }
      }
    }
    for (const init of inits) {
      if (typeof (init as { name?: unknown }).name === 'string' && (init as { name: string }).name === 'mapsequencebetweencontrolpoints') {
        sequenceCount = numOr((init as { count?: unknown }).count, 0)
        sequenceMirror = (init as { limitbehavior?: unknown }).limitbehavior === 'mirror'
      }
    }

    return {
      particleRef: ref,
      materialRef: matRef,
      blending,
      refract,
      refractAmount,
      animationMode: typeof preset.animationmode === 'string' ? preset.animationmode : null,
      overbright,
      textureNames,
      maxCount: maxcount,
      hasAlpharandom,
      startTime: numOr(preset.starttime, 0),
      worldSpace: (numOr(preset.flags, 0) & 1) !== 0,
      // flags bit2 = perspective rendering（2D 场景深度，近大远小）
      perspective: (numOr(preset.flags, 0) & 4) !== 0,
      perspectiveFocal,
      emitter,
      initializers,
      operators: ops,
      renderer,
      sequenceMultiplier,
      children,
      controlPointLine,
      sequenceCount,
      sequenceMirror,
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

/**
 * 检测图层 alpha 的 SceneScript：若依赖 engine.timeOfDay 且含 START_HOUR/END_HOUR，
 * 提取日出/日落小时作为昼夜自动切换（auto 模式）依据。
 *
 * 模式（WE 常见 day/night 脚本）：
 *   Math.max(WEMath.smoothStep(START_HOUR/24, (START_HOUR-ε)/24, engine.timeOfDay),
 *            WEMath.smoothStep((END_HOUR-ε)/24,  END_HOUR/24,  engine.timeOfDay))
 *   语义：夜间（<START 或 >END）→ 1（夜空层显示），白天（START..END）→ 0（夜空层隐藏）。
 *
 * 返回 null = 无昼夜脚本（用静态 alpha）；否则给出日出/日落小时与两端是夜还是昼。
 */
function parseDayNightAlpha(v: unknown): { dayStartH: number; dayEndH: number; nightWhenStart: boolean; nightWhenEnd: boolean } | undefined {
  if (typeof v !== 'object' || v === null) return undefined
  const script = (v as { script?: unknown }).script
  if (typeof script !== 'string') return undefined
  // 必须依赖 engine.timeOfDay（真实时钟驱动）
  if (!script.includes('engine') || !script.includes('timeOfDay')) return undefined
  let startH = 7
  let endH = 18
  let hasStart = false
  let hasEnd = false
  const sh = /START_HOUR\s*=\s*([0-9.]+)/.exec(script)
  if (sh !== null) { startH = Number(sh[1]); hasStart = true }
  const eh = /END_HOUR\s*=\s*([0-9.]+)/.exec(script)
  if (eh !== null) { endH = Number(eh[1]); hasEnd = true }
  if (!hasStart || !hasEnd) return undefined
  if (startH < 0 || startH > 24 || endH < 0 || endH > 24) return undefined
  // 判断两端是"夜(1)"还是"昼(0)"：按脚本里 smoothStep 的相位。默认 START 前为夜、END 后为夜。
  // 若脚本含 `1 - smoothStep(...)` 或起始项相位反向，则两端为昼、中间为夜。
  const negated = /1\s*-\s*WEMath\.smoothStep/.test(script)
  return {
    dayStartH: startH,
    dayEndH: endH,
    nightWhenStart: !negated, // 默认 START 前夜晚、END 后夜晚
    nightWhenEnd: !negated,
  }
}

function toInt(v: unknown, def: number): number {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? Math.round(n) : def
}
