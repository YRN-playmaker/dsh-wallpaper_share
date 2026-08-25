/**
 * SceneModelRenderer —— 浏览器子集渲染器（Phase 1 最小切片）。
 *
 * 数据源：Node 半解析的归一化 SceneModel（/we-sync/scene/model）：
 *   - 图层树 + transform（origin/angles/scale/parallaxDepth）
 *   - visible 解析
 *   - 纹理引用链；可解码（jpg/png）纹理经 /we-sync/scene/texture 加载
 *
 * 渲染（Canvas2D）：
 *   1) clearcolor 或预览图打底（cover 映射进场景坐标）
 *   2) 按 scene.json 数组顺序（z-order）逐图层绘制：
 *      - 有可解码纹理 → drawImage + transform
 *      - 无（TEX 待 Phase 2）→ 半透明占位块 + 图层名标注（先看图层效果）
 *
 * 诚实边界：Phase 1 不做 TEX 解码 / shader / 粒子 / keyframe 动画；
 * 静态合成，用于验证「真实 scene.json 图层树 + transform 能进 Harness」。
 */
import type { SceneModel, SceneModelLayer, LayerEffect } from '../scene/SceneModel.ts'
import { sampleAnimation as samplePuppet, type PuppetAnimation } from '../scene/ScenePuppet.ts'
import { ParticleRuntime } from './ParticleRuntime.ts'
import { ParticleGL } from './ParticleGL.ts'
import { WaterwavesGL, type WaterwavesParams } from './WaterwavesGL.ts'

export interface SceneModelRendererHandlers {
  onLiveChange?: (live: boolean) => void
}

const PLACEHOLDER_SIZE = 100 // 场景单位

/**
 * puppet 网格离屏渲染：把部件网格（三角形 + UV 纹理）渲染一次到离屏 canvas。
 * 模型空间（y-up，原点=图片中心）→ canvas 像素（y 向下）：
 *   x_c = x_m, y_c = -y_m（绘制时经场景变换把图片中心对齐图层锚点）。
 * UV v 翻转（模型 v-up → 纹理 v-down）。
 * 每三角形：clip 路径 + 仿射变换（UV 三角 → 位置三角）+ drawImage 纹理。
 * anim 可选：{rot, bx, by} = root 骨骼旋转（绕骨骼 0 bind 位置旋转的蒙皮）——
 * 顶点 skinPos = w0 × Rz(rot; bx,by) × pos + (1-w0) × pos（骨骼 1-3 权重静态 = raw）。
 */
function buildMeshCanvas(mesh: { vertices: { pos: [number, number, number]; uv: [number, number]; weights?: number[] }[]; indices: number[]; flipV?: boolean }, tex: HTMLCanvasElement | ImageBitmap, anim?: { rot: number; bx: number; by: number } | null): { canvas: HTMLCanvasElement; originX: number; originY: number } {
  // 蒙皮预计算：顶点位置数组（raw 或蒙皮后）
  const posArr: Array<[number, number]> = []
  if (anim !== undefined && anim !== null) {
    const c = Math.cos(anim.rot)
    const sn = Math.sin(anim.rot)
    const bx = anim.bx
    const by = anim.by
    for (const v of mesh.vertices) {
      const w0 = v.weights !== undefined ? v.weights[0] ?? 0 : 0
      const rx = bx + c * (v.pos[0] - bx) - sn * (v.pos[1] - by)
      const ry = by + sn * (v.pos[0] - bx) + c * (v.pos[1] - by)
      posArr.push([w0 * rx + (1 - w0) * v.pos[0], w0 * ry + (1 - w0) * v.pos[1]])
    }
  } else {
    for (const v of mesh.vertices) posArr.push([v.pos[0], v.pos[1]])
  }
  let mnx = Infinity
  let mny = Infinity
  let mxx = -Infinity
  let mxy = -Infinity
  for (const [x, y] of posArr) {
    const yy = -y // y-up → y-down
    if (x < mnx) mnx = x
    if (yy < mny) mny = yy
    if (x > mxx) mxx = x
    if (yy > mxy) mxy = yy
  }
  const c0 = document.createElement('canvas')
  c0.width = 1
  c0.height = 1
  if (!Number.isFinite(mnx) || mxx - mnx > 20000 || mxy - mny > 20000) return { canvas: c0, originX: 0, originY: 0 }
  const pad = 4
  const cw = Math.max(1, Math.ceil(mxx - mnx) + pad * 2)
  const ch = Math.max(1, Math.ceil(mxy - mny) + pad * 2)
  const c = document.createElement('canvas')
  c.width = cw
  c.height = ch
  const g = c.getContext('2d')
  if (g === null) return { canvas: c, originX: pad - mnx, originY: pad - mny }
  g.translate(pad - mnx, pad - mny) // 模型原点 (0,0) → (pad-mnx, pad-mny)
  const tw = tex.width
  const th = tex.height
  const verts = mesh.vertices
  const idx = mesh.indices
  for (let i = 0; i + 2 < idx.length; i += 3) {
    const a = verts[idx[i]]
    const b = verts[idx[i + 1]]
    const cc = verts[idx[i + 2]]
    if (a === undefined || b === undefined || cc === undefined) continue
    // UV v 方向按壁纸自适应（mesh.flipV：pos y 与 v 正相关才翻转）
    const fv = (val: number): number => (mesh.flipV ? 1 - val : val) * th
    const u0 = a.uv[0] * tw
    const v0 = fv(a.uv[1])
    const u1 = b.uv[0] * tw
    const v1 = fv(b.uv[1])
    const u2 = cc.uv[0] * tw
    const v2 = fv(cc.uv[1])
    const x0 = posArr[idx[i]][0]
    const y0 = -posArr[idx[i]][1]
    const x1 = posArr[idx[i + 1]][0]
    const y1 = -posArr[idx[i + 1]][1]
    const x2 = posArr[idx[i + 2]][0]
    const y2 = -posArr[idx[i + 2]][1]
    const det = (u1 - u0) * (v2 - v0) - (u2 - u0) * (v1 - v0)
    if (Math.abs(det) < 1e-9) continue
    g.save()
    g.beginPath()
    g.moveTo(x0, y0)
    g.lineTo(x1, y1)
    g.lineTo(x2, y2)
    g.closePath()
    g.clip()
    const m00 = ((x1 - x0) * (v2 - v0) - (x2 - x0) * (v1 - v0)) / det
    const m01 = ((u1 - u0) * (x2 - x0) - (u2 - u0) * (x1 - x0)) / det
    const m10 = ((y1 - y0) * (v2 - v0) - (y2 - y0) * (v1 - v0)) / det
    const m11 = ((u1 - u0) * (y2 - y0) - (u2 - u0) * (y1 - y0)) / det
    g.transform(m00, m10, m01, m11, x0 - m00 * u0 - m01 * v0, y0 - m10 * u0 - m11 * v0)
    g.drawImage(tex, 0, 0)
    g.restore()
  }
  return { canvas: c, originX: pad - mnx, originY: pad - mny }
}

/**
 * 粒子纹理径向软边合成：中心不衰减，边缘 30% 区间线性淡出到透明。
 * 用于雾/雪/光晕类粒子，避免硬边方块在大尺寸 + additive 下叠加成"白线"。
 */
function makeSoftTexture(src: ImageBitmap | HTMLCanvasElement): HTMLCanvasElement {
  const w = src.width
  const h = src.height
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d')
  if (g === null) return c
  g.drawImage(src, 0, 0)
  const cx = w / 2
  const cy = h / 2
  const r = Math.max(1, Math.min(w, h) / 2)
  const grad = g.createRadialGradient(cx, cy, r * 0.65, cx, cy, r)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.globalCompositeOperation = 'destination-in'
  g.fillStyle = grad
  g.fillRect(0, 0, w, h)
  return c
}

/**
 * waterwaves 效果（Canvas2D 条带近似），对照官方 shader：
 *   vert:  v_Direction = rotateVec2((0,1), θ) = (-sinθ, cosθ)   ← 传播方向
 *   frag:  distance = t*speed + dot(uv, v_Direction)*scale
 *          offset = (v_Direction.y, -v_Direction.x) = (cosθ, sinθ)  ← 扰动方向
 *          texCoord += sign(sin)^exp * |sin|^exp * strength² * offset * mask
 * 条带 = 等 phase 线（垂直 v_Direction，即沿 offset），带内沿 offset 整体平移；
 * 多个 waterwaves（ww1-ww4）扰动叠加；mask 限制扰动区域。
 */
function applyWaterwaves(src: HTMLCanvasElement | ImageBitmap, w: number, h: number, waves: WaterwavesParams[], time: number, mask?: HTMLCanvasElement | ImageBitmap | null): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d')
  if (g === null) return c
  // 主波（第一个）决定条带方向：扰动方向 offset = (cosθ, sinθ)
  const p0 = waves[0]
  const theta = p0.direction
  const offx = Math.cos(theta)
  const offy = Math.sin(theta)
  const bands = w * h > 900000 ? 32 : 48
  const horizontal = Math.abs(offx) >= Math.abs(offy)
  // mask 平均亮度（64×64 采样，每带一个值）
  let maskAvg: number[] | null = null
  if (mask !== null && mask !== undefined) {
    const mc = document.createElement('canvas')
    mc.width = 64
    mc.height = 64
    const mg = mc.getContext('2d')
    if (mg !== null) {
      mg.drawImage(mask, 0, 0, 64, 64)
      const img = mg.getImageData(0, 0, 64, 64)
      maskAvg = []
      for (let i = 0; i < bands; i++) {
        let sumR = 0
        let sumA = 0
        let cnt = 0
        if (horizontal) {
          const x0 = Math.floor((i / bands) * 64)
          const x1 = Math.max(x0 + 1, Math.floor(((i + 1) / bands) * 64))
          for (let x = x0; x < x1; x++) for (let y = 0; y < 64; y++) { sumR += img.data[(y * 64 + x) * 4]; sumA += img.data[(y * 64 + x) * 4 + 3]; cnt++ }
        } else {
          const y0 = Math.floor((i / bands) * 64)
          const y1 = Math.max(y0 + 1, Math.floor(((i + 1) / bands) * 64))
          for (let y = y0; y < y1; y++) for (let x = 0; x < 64; x++) { sumR += img.data[(y * 64 + x) * 4]; sumA += img.data[(y * 64 + x) * 4 + 3]; cnt++ }
        }
        // R8/RG88 解码为 alpha 语义（rgb=255, a=灰度）：R 恒 255 → 用 A 通道；
        // RGBA8888 黑白 mask：用 R 通道
        const useA = sumR >= cnt * 254
        maskAvg.push(cnt > 0 ? (useA ? sumA : sumR) / cnt / 255 : 0)
      }
    }
  }
  if (horizontal) {
    // 扰动主要沿 x → 垂直条带（沿传播方向分段），带内 dx 平移
    const bw = w / bands
    for (let i = 0; i < bands; i++) {
      const x0 = i * bw
      const cx = (x0 + bw / 2) / w
      let disp = 0
      for (const p of waves) {
        const s = p.strength * p.strength
        const e = Math.max(0.5, Math.min(4, p.exponent))
        // 传播投影：dot(uv, v_Direction)，v_Direction = (-sinθ, cosθ)
        const phase = time * p.speed + (cx * -Math.sin(p.direction) + 0.5 * Math.cos(p.direction)) * p.scale
        const val = Math.sin(phase)
        disp += Math.sign(val) * Math.pow(Math.abs(val), e) * s * Math.cos(p.direction) * w
      }
      disp *= maskAvg !== null ? maskAvg[i] : 1
      g.drawImage(src, x0, 0, bw + 0.5, h, x0 + disp, 0, bw + 0.5, h)
    }
  } else {
    // 扰动主要沿 y → 水平条带，带内 dy 平移
    const bh = h / bands
    for (let i = 0; i < bands; i++) {
      const y0 = i * bh
      const cy = (y0 + bh / 2) / h
      let disp = 0
      for (const p of waves) {
        const s = p.strength * p.strength
        const e = Math.max(0.5, Math.min(4, p.exponent))
        const phase = time * p.speed + (0.5 * -Math.sin(p.direction) + cy * Math.cos(p.direction)) * p.scale
        const val = Math.sin(phase)
        disp += Math.sign(val) * Math.pow(Math.abs(val), e) * s * Math.sin(p.direction) * h
      }
      disp *= maskAvg !== null ? maskAvg[i] : 1
      g.drawImage(src, 0, y0, w, bh + 0.5, 0, y0 + disp, w, bh + 0.5)
    }
  }
  return c
}

export class SceneModelRenderer {
  private el: HTMLCanvasElement | null = null
  private ctx: CanvasRenderingContext2D | null = null
  private model: SceneModel | null = null
  private base: HTMLImageElement | null = null
  private layerTextures = new Map<number, ImageBitmap>()
  /** 效果 mask 纹理（waterwaves/shake opacitymask）+ 通道模式（true=R8 alpha 语义用 A） */
  private effectMasks = new Map<number, { bmp: ImageBitmap; useA: boolean; flowDir: [number, number] }>()
  /** WebGL waterwaves 渲染器（惰性创建） */
  private wwGL: WaterwavesGL | null = null
  /** 图层纹理的 Image 内容区域尺寸（tex 画布内左上角）；无则用位图原生尺寸 */
  private layerTexImage = new Map<number, [number, number]>()
  /** 图层世界变换（递归 parent 合并；局部 y-up 翻转） */
  private worldTransform = new Map<number, { ox: number; oy: number; sx: number; sy: number }>()
  /** 图层 id → 图层（链式查找 puppet 祖先用） */
  private byId = new Map<number, SceneModelLayer>()
  private runtimes = new Map<number, ParticleRuntime>()
  /** 折射背景快照缓存（每帧只复制一次，多折射层共享） */
  private bgCache: HTMLCanvasElement | null = null
  /** WebGL 粒子实例化渲染器（叠加层） */
  private particleGL: ParticleGL | null = null
  private glCanvas: HTMLCanvasElement | null = null
  /** 每帧折射背景是否已上传 WebGL（只传一次） */
  private bgUploaded = false
  /** 静态图像层离屏缓存（无动画层只渲染一次，每帧合成） */
  private staticBg: HTMLCanvasElement | null = null
  private staticBgReady = false
  /** 前缀静态层 id 集合（只缓存 z-order 底部的连续静态层段，避免动态层被压序） */
  private staticPrefixIds = new Set<number>()
  /** WebGL 粒子渲染开关（坐标空间已修正，开启） */
  private static readonly USE_WEBGL_PARTICLES = true
  /** puppet 动画状态：puppet 图层 id → { 动画, 播放时间 } */
  private puppetAnims = new Map<number, { anim: PuppetAnimation; time: number }>()
  /** 每帧计算的动画变换：puppet 图层 id → 平移/旋转 */
  private animXform = new Map<number, { dx: number; dy: number; rot: number }>()
  /** puppet 网格离屏渲染缓存：图层 id → { canvas, 模型原点 } */
  private meshCanvases = new Map<number, { canvas: HTMLCanvasElement; originX: number; originY: number; animKey: string }>()
  private dpr = 1
  private live = false
  private closed = false
  private rafId = 0
  private lastT = 0
  /** 全局动画时间（秒，effects/粒子用） */
  private animTime = 0
  private blurPx = 0
  private scale = 1
  private monitor = ''
  private version = 0
  private handlers: SceneModelRendererHandlers
  /** 粒子层日志节流（layer.id → 上次时间） */
  private lastParticleLog = new Map<number, number>()

  constructor(handlers: SceneModelRendererHandlers = {}) {
    this.handlers = handlers
  }

  get isLive(): boolean {
    return this.live
  }

  start(monitor: string, version: number): void {
    // 同 monitor+version 已 live：只重新应用视觉效果，不重建画布/不重拉模型
    // （applyBackground 会在每次设置/任务状态变化时调用 start()）
    if (this.live && this.monitor === monitor && this.version === version && this.model !== null) {
      this.applyVisuals()
      return
    }
    this.stop()
    this.closed = false
    this.monitor = monitor
    this.version = version

    this.el = document.createElement('canvas')
    this.el.style.position = 'fixed'
    this.el.style.top = '0'
    this.el.style.left = '0'
    this.el.style.width = '100%'
    this.el.style.height = '100%'
    this.el.style.zIndex = '-2'
    this.el.style.pointerEvents = 'none'
    this.el.style.border = '0'
    document.body.appendChild(this.el)
    this.ctx = this.el.getContext('2d')
    // WebGL 粒子叠加层：**离屏渲染目标**，不参与 DOM 叠放——
    // 粒子按 z-order 在主画布内逐段合成（drawImage(glCanvas)），
    // 否则独立叠加层会盖住其后方的 image 层（如雨滴盖住窗框）。
    // 复用同一 canvas + 上下文：每次 start() 新建 WebGL 上下文会被浏览器逐出
    // （"Too many active WebGL contexts"），导致粒子静默消失。
    if (SceneModelRenderer.USE_WEBGL_PARTICLES && this.particleGL === null) {
      this.glCanvas = document.createElement('canvas')
      // 不 append 到 DOM：仅作离屏渲染目标
      this.particleGL = new ParticleGL(this.glCanvas)
      if (!this.particleGL.available) {
        this.particleGL.dispose()
        this.particleGL = null
        this.glCanvas = null
      }
    }
    this.resize()
    this.applyVisuals()

    window.addEventListener('resize', this.onResize)
    document.addEventListener('visibilitychange', this.onVisibility)

    void this.load()
  }

  stop(): void {
    this.closed = true
    if (this.rafId !== 0) { cancelAnimationFrame(this.rafId); this.rafId = 0 }
    window.removeEventListener('resize', this.onResize)
    document.removeEventListener('visibilitychange', this.onVisibility)
    if (this.el !== null) { this.el.remove(); this.el = null; this.ctx = null }
    // 保留 glCanvas/particleGL（上下文复用），只清纹理缓存
    if (this.particleGL !== null) this.particleGL.reset()
    this.model = null
    this.base = null
    for (const bmp of this.layerTextures.values()) { try { bmp.close() } catch { /* 忽略 */ } }
    this.layerTextures.clear()
    this.layerTexImage.clear()
    this.worldTransform.clear()
    this.byId.clear()
    this.puppetAnims.clear()
    this.animXform.clear()
    this.meshCanvases.clear()
    for (const v of this.effectMasks.values()) { try { if ('close' in v.bmp) v.bmp.close() } catch { /* 忽略 */ } }
    this.effectMasks.clear()
    if (this.wwGL !== null) { this.wwGL.reset() }
    for (const rt of this.runtimes.values()) rt.dispose()
    this.runtimes.clear()
    this.staticBg = null
    this.staticBgReady = false
    this.staticPrefixIds.clear()
    this.setLive(false)
  }

  /** 完全销毁（renderer 生命周期结束）：释放 WebGL 上下文 + 移除叠加画布 */
  destroy(): void {
    this.stop()
    if (this.particleGL !== null) { this.particleGL.dispose(); this.particleGL = null }
    if (this.glCanvas !== null) { this.glCanvas = null }
    if (this.wwGL !== null) { this.wwGL.dispose(); this.wwGL = null }
  }

  applyVisuals(blurPx?: number, scale?: number): void {
    if (blurPx !== undefined) this.blurPx = blurPx
    if (scale !== undefined) this.scale = scale
    if (this.el !== null) {
      this.el.style.filter = 'blur(' + Math.round(this.blurPx) + 'px)'
      this.el.style.transform = 'scale(' + this.scale.toFixed(3) + ')'
    }
  }

  // ---- 数据加载 ----
  private async load(): Promise<void> {
    if (this.closed) return
    let model: SceneModel
    try {
      const res = await fetch('/we-sync/scene/model?monitor=' + encodeURIComponent(this.monitor) + '&v=' + this.version, { cache: 'no-store' })
      if (!res.ok) throw new Error('model ' + res.status)
      model = await res.json() as SceneModel
    } catch {
      this.fail()
      return
    }
    if (this.closed) return
    this.model = model
    this.byId.clear()
    for (const l of model.layers) this.byId.set(l.id, l)
    this.computeWorldTransforms()
    this.setLive(true)

    // 预览图打底（异步，不阻塞图层渲染）
    void this.loadBase(model)
    // 图层纹理：按候选顺序尝试（decodable jpg/png 优先，然后 .tex——
    // 路由会解码 .tex（内嵌图片或 raw LZ4+DXT → PNG）；失败 → 该图层占位）
    const jobs: Array<Promise<void>> = []
    for (const layer of model.layers) {
      jobs.push(this.loadLayerTexture(layer))
    }
  /** 粒子系统：创建运行时 + 加载粒子纹理（引擎资产 /we-sync/asset/texture） */
    for (const layer of model.layers) {
      if (layer.particle !== null) {
        const rt = new ParticleRuntime(layer.particle, model.particleRateScale, model.particleSizeScale)
        this.runtimes.set(layer.id, rt)
        // WE Start Time 预模拟（官方语义：创建时预模拟，非延迟启动）
        rt.preSimulate()
        for (const sub of rt.collect()) {
          jobs.push(this.loadParticleTexture(sub.rt, sub.texName))
          if (sub.normalName !== null) {
            jobs.push(this.loadParticleNormalTexture(sub.rt, sub.normalName))
          }
        }
      }
    }
    // puppet 动画：所有带"真实逐帧动画"的层播放（装配根 alpha=0 锚点整体动画 +
    // 部件自身动画如头发/草/裙子摆动）。静态姿势表（帧值全同）跳过。
    for (const layer of model.layers) {
      if (layer.puppet === null || layer.puppet.animations.length === 0) continue
      const anim = layer.animationIds.length > 0
        ? layer.puppet.animations.find((a) => layer.animationIds.includes(a.id)) ?? layer.puppet.animations[0]
        : layer.puppet.animations[0]
      if (anim.keyframes.length < 2) continue
      // 静态姿势表检测：所有分量跨度 < 0.01 → 不播放
      const kf = anim.keyframes
      let maxSpan = 0
      for (let vi = 0; vi < 8; vi++) {
        let mn = Infinity
        let mx = -Infinity
        for (const k of kf) {
          const v = k.values[vi]
          if (!Number.isFinite(v)) continue
          if (v < mn) mn = v
          if (v > mx) mx = v
        }
        if (Number.isFinite(mn) && mx - mn > maxSpan) maxSpan = mx - mn
      }
      if (maxSpan < 0.01) continue
      this.puppetAnims.set(layer.id, { anim, time: 0 })
    }
    if (jobs.length > 0) await Promise.all(jobs)
    if (this.closed) return
    // 静态层离屏缓存（纹理就绪后构建一次）
    this.staticBg = null
    this.staticBgReady = false
    this.buildStaticBg()
    if (!this.closed) this.startAnimation()
  }

  /**
   * 递归合并 parent 层级变换（含 attachment 骨骼挂载）。
   * 顶层（无 parent）：WE 场景坐标 **y 向上** → 屏幕 y = 场景高 - origin.y。
   * 子图层：局部坐标 y 向上，父 scale 施加于子的位移与尺寸。
   * attachment（如 "head"/"Attachment"）：子层挂到 parent puppet 的具名骨骼，
   * 锚点 = parent 锚点 + 骨骼局部位置（y-up）+ 子层 origin。
   */
  private computeWorldTransforms(): void {
    const model = this.model
    if (model === null) return
    const H = model.height
    const byId = new Map<number, SceneModelLayer>()
    for (const l of model.layers) byId.set(l.id, l)
    const cache = new Map<number, { ox: number; oy: number; sx: number; sy: number }>()
    const walk = (l: SceneModelLayer): { ox: number; oy: number; sx: number; sy: number } => {
      const hit = cache.get(l.id)
      if (hit !== undefined) return hit
      let t: { ox: number; oy: number; sx: number; sy: number }
      const parent = l.parent !== null ? byId.get(l.parent) : undefined
      if (parent !== undefined) {
        const p = walk(parent)
        // attachment 骨骼局部位置（y-up 模型空间）；父 scale 施加
        const bp = l.attachment !== null && parent.puppet !== null
          ? parent.puppet.bonePositions?.[l.attachment]
          : undefined
        t = {
          ox: p.ox + p.sx * (l.origin[0] + (bp !== undefined ? bp[0] : 0)),
          oy: p.oy - p.sy * (l.origin[1] + (bp !== undefined ? bp[1] : 0)),
          sx: p.sx * (l.scale[0] ?? 1),
          sy: p.sy * (l.scale[1] ?? 1),
        }
      } else {
        t = { ox: l.origin[0], oy: H - l.origin[1], sx: l.scale[0] ?? 1, sy: l.scale[1] ?? 1 }
      }
      cache.set(l.id, t)
      return t
    }
    for (const l of model.layers) walk(l)
    this.worldTransform = cache
  }

  private async loadParticleTexture(rt: ParticleRuntime, name: string): Promise<void> {
    try {
      const res = await fetch('/we-sync/asset/texture?name=' + encodeURIComponent(name), { cache: 'no-store' })
      if (!res.ok) {
        console.warn('[particle tex] 加载失败', name, res.status)
        return
      }
      // spritesheet 序列帧元数据（后端从同名 .tex-json 解析；无则 frames=0 整张绘制）
      const frames = Number(res.headers.get('X-Sprite-Frames') ?? '0')
      const fw = Number(res.headers.get('X-Sprite-Width') ?? '0')
      const fh = Number(res.headers.get('X-Sprite-Height') ?? '0')
      const blob = await res.blob()
      const bmp = await createImageBitmap(blob)
      if (this.closed) { bmp.close(); return }
      // 径向软边仅用于小尺寸点状纹理（雪花/光点，<128px），避免硬边方块叠加成白线；
      // 大片纹理（雾/风，如 fog3）自带羽化形状，软边遮罩会破坏形状
      let tex: HTMLCanvasElement | ImageBitmap = bmp
      if (bmp.width < 128 && bmp.height < 128) {
        tex = makeSoftTexture(bmp)
        bmp.close()
      }
      if (this.closed) return
      rt.setTexture(tex, frames > 1 && fw > 0 && fh > 0 ? frames : 0, fw, fh)
    } catch (err) {
      console.warn('[particle tex] 加载/解码失败', name, err)
    }
  }

  /** 加载粒子折射法线纹理（REFRACT 材质第二个纹理，如 rain_drops_sheet_normal）。
   *  法线纹理不做软边处理（需要原始 R/G/A 通道做 shader 解压）。 */
  private async loadParticleNormalTexture(rt: ParticleRuntime, name: string): Promise<void> {
    try {
      const res = await fetch('/we-sync/asset/texture?name=' + encodeURIComponent(name), { cache: 'no-store' })
      if (!res.ok) {
        console.warn('[particle normal tex] 加载失败', name, res.status)
        return
      }
      const frames = Number(res.headers.get('X-Sprite-Frames') ?? '0')
      const fw = Number(res.headers.get('X-Sprite-Width') ?? '0')
      const fh = Number(res.headers.get('X-Sprite-Height') ?? '0')
      const blob = await res.blob()
      const bmp = await createImageBitmap(blob)
      if (this.closed) { bmp.close(); return }
      rt.setNormalTexture(bmp, frames > 1 && fw > 0 && fh > 0 ? frames : 0, fw, fh)
    } catch (err) {
      console.warn('[particle normal tex] 加载/解码失败', name, err)
    }
  }

  private async loadLayerTexture(layer: SceneModelLayer): Promise<void> {
    if (this.layerTextures.has(layer.id)) return
    const candidates = layer.decodableTexture !== null
      ? [layer.decodableTexture, ...layer.textureRefs.filter((t) => t !== layer.decodableTexture)]
      : layer.textureRefs
    for (const name of candidates) {
      if (this.closed) return
      const got = await this.fetchTexture(name)
      if (got === null) continue
      if (this.closed) { got.bmp.close(); return }
      this.layerTextures.set(layer.id, got.bmp)
      if (got.imgW > 0 && got.imgH > 0) this.layerTexImage.set(layer.id, [got.imgW, got.imgH])
      this.startAnimation()
      return
    }
    // 效果 mask 纹理（waterwaves/shake 的 opacitymask，独立于图层纹理）
    for (const e of layer.effects) {
      const m = e.type === 'waterwaves' || e.type === 'shake' ? e.mask : null
      if (m === null || this.effectMasks.has(layer.id)) continue
      try {
        // mask 引用（如 "masks/shake_mask_xxx"）规范化为 pkg 条目名 materials/<mask>.tex
        const maskName = m.startsWith('materials/') ? m : 'materials/' + m + '.tex'
        const res = await fetch('/we-sync/scene/texture?monitor=' + encodeURIComponent(this.monitor) + '&name=' + encodeURIComponent(maskName), { cache: 'no-store' })
        if (!res.ok) continue
        const blob = await res.blob()
        const bmp = await createImageBitmap(blob)
        if (this.closed) { bmp.close(); return }
        // 通道判断：R8/RG88 解码为 alpha 语义（rgb=255, a=灰度）→ 用 A 通道；
        // shake 的 direction map（RG 方向场）→ 平均方向（flowDir）
        let useA = false
        let flowDir: [number, number] = [0, -1]
        try {
          const tc = document.createElement('canvas')
          tc.width = 16
          tc.height = 16
          const tg = tc.getContext('2d')
          if (tg !== null) {
            tg.drawImage(bmp, 0, 0, 16, 16)
            const px = tg.getImageData(0, 0, 16, 16)
            let all255 = true
            let sr = 0
            let sg = 0
            let n = 0
            for (let i = 0; i < px.data.length; i += 4) {
              if (px.data[i] < 254) all255 = false
              sr += px.data[i]
              sg += px.data[i + 1]
              n++
            }
            useA = all255
            if (!all255 && n > 0) {
              // direction map：flowMask = (rg - 0.498) * 2（官方语义）
              flowDir = [(sr / n / 255 - 0.498) * 2, (sg / n / 255 - 0.498) * 2]
              const len = Math.hypot(flowDir[0], flowDir[1])
              if (len > 0.01) { flowDir[0] /= len; flowDir[1] /= len }
            }
          }
        } catch { /* 通道判断失败：默认 R */ }
        this.effectMasks.set(layer.id, { bmp, useA, flowDir })
        this.startAnimation()
      } catch { /* mask 加载失败：无 mask 全图扰动 */ }
    }
  }

  private async fetchTexture(name: string): Promise<{ bmp: ImageBitmap; imgW: number; imgH: number } | null> {
    try {
      const res = await fetch('/we-sync/scene/texture?monitor=' + encodeURIComponent(this.monitor) + '&name=' + encodeURIComponent(name), { cache: 'no-store' })
      if (!res.ok) return null
      const blob = await res.blob()
      const bmp = await createImageBitmap(blob)
      const imgW = Number(res.headers.get('X-WE-Image-W'))
      const imgH = Number(res.headers.get('X-WE-Image-H'))
      return {
        bmp,
        imgW: Number.isFinite(imgW) && imgW > 0 ? imgW : bmp.width,
        imgH: Number.isFinite(imgH) && imgH > 0 ? imgH : bmp.height,
      }
    } catch {
      return null
    }
  }

  private async loadBase(model: SceneModel): Promise<void> {
    try {
      const res = await fetch('/we-sync/preview?v=' + this.version, { cache: 'no-store' })
      if (!res.ok) return
      const blob = await res.blob()
      const img = new Image()
      img.src = URL.createObjectURL(blob)
      await new Promise<void>((resolve, reject) => { img.onload = () => resolve(); img.onerror = () => reject(new Error('preview decode')) })
      if (this.closed) { URL.revokeObjectURL(img.src); return }
      this.base = img
      this.startAnimation()
    } catch { /* 预览图不可用：用 clearcolor 打底 */ }
  }

  private fail(): void {
    this.setLive(false)
    this.closed = true
  }

  // ---- 渲染（持续动画循环） ----
  private startAnimation(): void {
    if (this.rafId === 0 && !document.hidden) {
      this.lastT = performance.now()
      this.rafId = requestAnimationFrame(this.draw)
    }
  }

  private draw = (): void => {
    this.rafId = 0
    if (this.closed || this.ctx === null || this.el === null) return
    const now = performance.now()
    const dt = Math.min(0.1, (now - this.lastT) / 1000)
    this.lastT = now
    this.animTime += dt
    // 背景快照每帧只复制一次（多个折射粒子层共享），避免每层整画布复制
    this.bgCache = null
    this.bgUploaded = false
    // 更新粒子（动画）
    for (const rt of this.runtimes.values()) rt.update(dt)
    this.updatePuppetAnims(dt)
    this.renderScene()
    // 持续动画循环
    this.rafId = requestAnimationFrame(this.draw)
  }

  /**
   * 更新 puppet 动画 → 部件变换（装配根整体呼吸 + 部件自身摆动）。
   * 帧值布局（实测）：[pos3][rotZ(v4)][scale3]；v4 摆动 = 绕 z 旋转（呼吸/头发/草）；
   * v0/v1（或 v6/v7，petal 类）变化 = 位置位移（相对首帧）。
   */
  private updatePuppetAnims(dt: number): void {
    this.animXform.clear()
    for (const [layerId, st] of this.puppetAnims) {
      st.time += dt
      const kf = st.anim.keyframes
      if (kf.length === 0) continue
      // 循环周期 = 目录项 duration（秒，官方时长）；fallback t 峰值跨度
      // 异常数据（多骨骼动画/解析失败，周期异常大）跳过不播放
      let peak = 0
      for (let i = 1; i < kf.length; i++) if (kf[i].t > kf[peak].t) peak = i
      const period = kf[peak].t - kf[0].t
      if (period > 5_000_000) continue
      const dur = st.anim.duration > 0 ? st.anim.duration : 3
      const t = period > 0 ? (st.time * period) / dur : st.time * (kf.length - 1) / dur
      const s = samplePuppet(st.anim, t)
      if (s === null) continue
      const v = s.values
      const base = st.anim.keyframes[0].values
      // 每分量跨度（用于位置位移判定；每帧算一次成本低）
      const spans = [0, 0, 0, 0, 0, 0, 0, 0]
      for (let vi = 0; vi < 8; vi++) {
        let mn = Infinity
        let mx = -Infinity
        for (const k of kf) {
          const val = k.values[vi]
          if (!Number.isFinite(val)) continue
          if (val < mn) mn = val
          if (val > mx) mx = val
        }
        if (Number.isFinite(mn)) spans[vi] = mx - mn
      }
      // 旋转：quat 接近单位 → 四元数 z 旋转；否则 v4 直接作为角度
      const qx = v[3]
      const qy = v[4]
      const qz = v[5]
      const qw = v[6]
      const qlen2 = qx * qx + qy * qy + qz * qz + qw * qw
      let rot: number
      if (Math.abs(qlen2 - 1) < 0.05) {
        rot = 2 * Math.atan2(qz, qw)
      } else {
        rot = v[4]
      }
      // 位置位移：v0 = y（模型 y-up，bind 验证）；v6/v7（petal 类）→ dx/dy
      let dx = 0
      let dy = 0
      if (spans[0] > 0.5) dy += v[0] - base[0]
      if (spans[6] > 0.5) dx += v[6] - base[6]
      if (spans[7] > 0.5) dy += v[7] - base[7]
      this.animXform.set(layerId, { dx, dy, rot })
    }
  }

  /** 静态图像层：无粒子、无效果、无动画（自身及祖先），可离屏缓存只渲染一次 */
  private isStaticImageLayer(layer: SceneModelLayer): boolean {
    if (layer.image === undefined || layer.particle !== null) return false
    if (layer.effects.length > 0 || layer.copybackground === true) return false
    let p: number | null = layer.id
    while (p !== null && this.byId.has(p)) {
      if (this.animXform.has(p)) return false
      p = this.byId.get(p)?.parent ?? null
    }
    return true
  }

  /** 构建静态层离屏缓存（场景坐标 canvas，模型加载后调用一次） */
  private buildStaticBg(): void {
    const model = this.model
    if (model === null) return
    const c = document.createElement('canvas')
    c.width = Math.max(1, Math.round(model.width))
    c.height = Math.max(1, Math.round(model.height))
    const g = c.getContext('2d')
    if (g === null) return
    // 只缓存 z-order 底部的连续静态层段（遇到第一个动态层即停止），
    // 保证动态层（puppet 骨骼等）不会被压到缓存层之下导致层序错乱。
    this.staticPrefixIds.clear()
    let prefixEnded = false
    for (const layer of model.layers) {
      if (prefixEnded) break
      if (!layer.visible || layer.alpha <= 0 || !this.isStaticImageLayer(layer)) { prefixEnded = true; continue }
      const t = this.worldTransform.get(layer.id)
      const bmp = this.layerTextures.get(layer.id) ?? null
      if (bmp === null || t === undefined) { prefixEnded = true; continue }
      this.staticPrefixIds.add(layer.id)
      g.save()
      g.translate(t.ox, t.oy)
      const rot = ((layer.angles[2] ?? 0) * Math.PI) / 180
      if (rot !== 0) g.rotate(rot)
      g.scale(t.sx, t.sy)
      if (layer.alpha < 1) g.globalAlpha = Math.max(0, Math.min(1, layer.alpha))
      const ti = this.layerTexImage.get(layer.id)
      const sw = ti !== undefined ? ti[0] : bmp.width
      const sh = ti !== undefined ? ti[1] : bmp.height
      const dw = layer.size !== null ? layer.size[0] : sw
      const dh = layer.size !== null ? layer.size[1] : sh
      g.drawImage(bmp, 0, 0, sw, sh, -dw / 2, -dh / 2, dw, dh)
      g.restore()
    }
    this.staticBg = c
    this.staticBgReady = true
  }

  private renderScene(): void {
    const ctx = this.ctx
    if (ctx === null || this.el === null) return
    const cw = this.el.clientWidth
    const ch = this.el.clientHeight
    if (cw === 0 || ch === 0) return
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    ctx.clearRect(0, 0, cw, ch)
    const model = this.model
    if (model === null) return

    // 打底：clearcolor → 预览图（cover 铺满画布）
    if (this.base !== null) {
      this.drawCoverBase(ctx, this.base, cw, ch)
    } else if (model.clearColor !== null) {
      ctx.fillStyle = 'rgb(' + Math.round(model.clearColor[0] * 255) + ',' + Math.round(model.clearColor[1] * 255) + ',' + Math.round(model.clearColor[2] * 255) + ')'
      ctx.fillRect(0, 0, cw, ch)
    }

    // 场景坐标 → 画布：cover 映射（场景空间 0..w × 0..h，y 向下）
    const s = Math.max(cw / model.width, ch / model.height)
    const ox = (cw - model.width * s) / 2
    const oy = (ch - model.height * s) / 2

    // 静态层离屏缓存合成（无动画大背景只渲染一次，每帧一次 drawImage）
    if (this.staticBgReady && this.staticBg !== null) {
      ctx.drawImage(this.staticBg, 0, 0, this.staticBg.width, this.staticBg.height, ox, oy, this.staticBg.width * s, this.staticBg.height * s)
    }

    // 图层（scene.json 数组顺序 = z-order）。
    // GL 粒子段：相邻的 GL 粒子层累积渲染到离屏 glCanvas，遇到 image 层（或循环结束）
    // 时整体合成到主画布——保证粒子与 image 层按 z-order 交错（如雨滴在窗框之下）。
    // 混合模式（additive/normal）不同也拆段：additive 段用 blendFuncSeparate(ONE,ONE,ZERO,ONE)
    // 画布 alpha 恒 0，合成必须用 'lighter'（src+dst 纯加法，source-over 会把 alpha=0 全丢弃）；
    // normal 段标准预乘 source-over 合成。
    let glSegment = false
    let glAdditive = false
    const flushGl = (): void => {
      if (glSegment && this.particleGL !== null && this.glCanvas !== null) {
        const prevOp = ctx.globalCompositeOperation
        if (glAdditive) ctx.globalCompositeOperation = 'lighter'
        ctx.drawImage(this.glCanvas, 0, 0, this.glCanvas.width, this.glCanvas.height, 0, 0, cw, ch)
        ctx.globalCompositeOperation = prevOp
        glSegment = false
        this.bgUploaded = false
      }
    }
    for (const layer of model.layers) {
      if (!layer.visible || layer.alpha <= 0) continue
      if (this.staticBgReady && this.staticPrefixIds.has(layer.id)) continue
      const t = this.worldTransform.get(layer.id)
      // puppet 动画：层自身动画绕自身锚点旋转/位移；否则绕最近的带动画祖先锚点旋转
      let ax = 0
      let ay = 0
      let arot = 0
      const selfXf = this.animXform.get(layer.id)
      if (selfXf !== undefined && t !== undefined) {
        ax = selfXf.dx
        ay = -selfXf.dy // 模型 y-up → 屏幕 y-down
        arot = selfXf.rot
      } else if (layer.parent !== null) {
        let anchorId: number | null = null
        let p: number | null = layer.parent
        while (p !== null && this.byId.has(p)) {
          if (this.animXform.has(p)) { anchorId = p; break }
          p = this.byId.get(p)?.parent ?? null
        }
        if (anchorId !== null && t !== undefined) {
          const xf = this.animXform.get(anchorId)
          const pt = this.worldTransform.get(anchorId)
          if (xf !== undefined && pt !== undefined) {
            const relx = t.ox - pt.ox
            const rely = t.oy - pt.oy
            const c = Math.cos(xf.rot)
            const sn = Math.sin(xf.rot)
            ax = pt.ox + c * relx - sn * rely - t.ox
            ay = pt.oy + sn * relx + c * rely - t.oy
            arot = xf.rot
          }
        }
      }
      const px = ox + ((t !== undefined ? t.ox : layer.origin[0]) + ax) * s
      const py = oy + ((t !== undefined ? t.oy : layer.origin[1]) + ay) * s
      // 粒子层：WebGL 实例化优先（sprite/spritetrail），rope/ropetrail 或 GL 不可用走 Canvas
      const rt = this.runtimes.get(layer.id)
      if (rt !== undefined) {
        const wt = t ?? { ox: layer.origin[0], oy: layer.origin[1], sx: layer.scale[0] ?? 1, sy: layer.scale[1] ?? 1 }
        if (this.particleGL !== null && this.el !== null && SceneModelRenderer.USE_WEBGL_PARTICLES && !rt.hasLineRenderer()) {
          // 上下文被浏览器逐出时 ParticleGL 内部 preventDefault + restoreContext 原地恢复
          // （不在这里新建 canvas/上下文——每次新建都会再次触发逐出，形成死循环）
          if (!this.particleGL.available) continue
          const batches = rt.collectGl(wt.sx, wt.sy, ox + wt.ox * s, oy + wt.oy * s, s)
          const now = performance.now()
          if (batches.length === 0) {
            // 无粒子/纹理仍在加载（低速率层如火花 0.75/s 多数帧本就无粒子）——
            // 纹理加载失败由 loadParticleTexture 单独告警，这里不再刷 warn
            continue
          }
          // 混合模式不同 → 先 flush 旧段再开新段（additive/normal 画布语义不同）
          const additive = batches[0].additive
          if (glSegment && glAdditive !== additive) flushGl()
          if (!glSegment) {
            glSegment = true
            glAdditive = additive
            this.bgUploaded = false
            this.particleGL.clear()
          }
          if (now - (this.lastParticleLog.get(layer.id) ?? 0) > 1000) {
            this.lastParticleLog.set(layer.id, now)
            console.log('[scene:GL] layer=' + layer.name, batches.map((b) => 'n=' + b.particles.length + (b.refract ? '/R' : '') + (b.additive ? '/A' : '')).join(' '))
          }
          for (const b of batches) {
            if (b.refract && !this.bgUploaded) {
              this.particleGL.uploadBackground(this.el)
              this.bgUploaded = true
              console.log('[scene:GL] bg uploaded', this.el.width + 'x' + this.el.height)
            }
            this.particleGL.render(
              b.particles,
              {
                viewW: this.el.clientWidth,
                viewH: this.el.clientHeight,
                additive: b.additive,
                refract: b.refract,
                frames: b.frames,
                fw: b.fw,
                fh: b.fh,
                refractAmount: b.refractAmount,
                trail: b.trail,
              },
              b.tex,
              b.normalTex,
              this.el.width,
              this.el.height,
            )
          }
          continue
        }
        // 非 GL 粒子层（rope/ropetrail）：先 flush GL 段，保证 z-order 交错
        flushGl()
        // 折射粒子：背景快照同帧复用（每帧只复制一次）
        let bg: HTMLCanvasElement | null = null
        if (rt.hasRefract() && this.el !== null) {
          if (this.bgCache === null) {
            this.bgCache = document.createElement('canvas')
            this.bgCache.width = this.el.width
            this.bgCache.height = this.el.height
            const bgctx = this.bgCache.getContext('2d')
            if (bgctx !== null) bgctx.drawImage(this.el, 0, 0)
          }
          bg = this.bgCache
        }
        rt.draw(ctx, ox, oy, s, wt, bg)
        continue
      }
      // image 层：先 flush GL 段，粒子才不会被盖在错误层级
      flushGl()
      ctx.save()
      ctx.translate(px, py)
      // 动画部件：旋转锚点 = 骨骼 0 bind 位置（模型空间 → 局部，y 翻转），
      // 官方骨骼旋转绕骨骼原点而非图层中心
      const animB0 = selfXf !== undefined && layer.puppet !== null ? layer.puppet.bones[0]?.bind ?? null : null
      const rotAngle = ((layer.angles[2] ?? 0) * Math.PI / 180) + arot
      if (animB0 !== null && animB0.length >= 15 && rotAngle !== 0) {
        const sxv = (t !== undefined ? t.sx : layer.scale[0] ?? 1) * s
        const syv = (t !== undefined ? t.sy : layer.scale[1] ?? 1) * s
        const bx = animB0[12] * sxv
        const by = -animB0[13] * syv
        ctx.translate(bx, by)
        ctx.rotate(rotAngle)
        ctx.translate(-bx, -by)
      } else {
        ctx.rotate(rotAngle)
      }
      ctx.scale((t !== undefined ? t.sx : layer.scale[0] ?? 1) * s, (t !== undefined ? t.sy : layer.scale[1] ?? 1) * s)
      if (layer.alpha < 1) ctx.globalAlpha = Math.max(0, Math.min(1, layer.alpha))
      const bmp = this.layerTextures.get(layer.id) ?? null
      // puppet 网格蒙皮渲染（实验开关；模型空间顶点 → 离屏 canvas → 场景变换）
      if (model.puppetMeshRender && layer.puppet !== null && layer.puppet.mesh !== null && bmp !== null) {
        // 动画部件：每帧按当前 root 骨骼旋转重建（蒙皮：绕骨骼 0 bind 位置旋转）
        const selfXf2 = this.animXform.get(layer.id)
        const b0 = layer.puppet.bones[0]?.bind ?? null
        const animSkin = selfXf2 !== undefined && b0 !== null && b0.length >= 15
          ? { rot: selfXf2.rot, bx: b0[12], by: b0[13] } as const
          : null
        const key = layer.id + ':' + (animSkin !== null ? animSkin.rot.toFixed(4) : 'static')
        let mc = this.meshCanvases.get(layer.id)
        if (mc === undefined || mc.animKey !== key) {
          const built = buildMeshCanvas(layer.puppet.mesh, bmp, animSkin)
          mc = { canvas: built.canvas, originX: built.originX, originY: built.originY, animKey: key }
          this.meshCanvases.set(layer.id, mc)
        }
        ctx.drawImage(mc.canvas, -mc.originX, -mc.originY)
      } else if (bmp !== null) {
        // 源 = 纹理 Image 内容区域（画布左上角）；目标 = 图层 size（缺省用 Image 尺寸）
        const ti = this.layerTexImage.get(layer.id)
        const sw = ti !== undefined ? ti[0] : bmp.width
        const sh = ti !== undefined ? ti[1] : bmp.height
        const dw = layer.size !== null ? layer.size[0] : sw
        const dh = layer.size !== null ? layer.size[1] : sh
        // 图层效果：waterwaves（逐像素 UV 场扰动，多个 ww 叠加）/ shake（整体平移）
        const effScale = model.effectStrengthScale ?? 1
        const wws = layer.effects
          .filter((e): e is Extract<LayerEffect, { type: 'waterwaves' }> => e.type === 'waterwaves')
          .map((e) => ({ ...e, strength: e.strength * effScale }))
        const shk = layer.effects.find((e) => e.type === 'shake')
        if (wws.length > 0) {
          const maskInfo = this.effectMasks.get(layer.id)
          let eff: HTMLCanvasElement | null = null
          // WebGL 逐像素 UV 场扰动（独立实现的数学等价 shader）；不可用时回退条带近似
          if (this.wwGL !== null || WaterwavesGL.available) {
            if (this.wwGL === null) this.wwGL = new WaterwavesGL()
            eff = this.wwGL.render(bmp, sw, sh, maskInfo !== undefined ? maskInfo.bmp : null, maskInfo !== undefined ? maskInfo.useA : false, wws, this.animTime, String(layer.id))
          }
          if (eff === null) {
            eff = applyWaterwaves(bmp, sw, sh, wws, this.animTime, maskInfo !== undefined ? maskInfo.bmp : null)
          }
          ctx.drawImage(eff, 0, 0, sw, sh, -dw / 2, -dh / 2, dw, dh)
        } else if (shk !== undefined && shk.type === 'shake') {
          // 官方 shake：offset = sin(speed×t)（标量波形），位移 = offset × strength² × flow 方向
          // （direction map 平均；无 flow 默认垂直）——单向位移，非圆周
          const maskInfo2 = this.effectMasks.get(layer.id)
          const fd = maskInfo2 !== undefined ? maskInfo2.flowDir : [0, -1]
          const offset = Math.sin(this.animTime * shk.speed)
          const amp = shk.strength * shk.strength * effScale
          const dx = offset * amp * fd[0] * dw
          const dy = offset * amp * fd[1] * dh
          ctx.drawImage(bmp, 0, 0, sw, sh, -dw / 2 + dx, -dh / 2 + dy, dw, dh)
        } else {
          ctx.drawImage(bmp, 0, 0, sw, sh, -dw / 2, -dh / 2, dw, dh)
        }
      } else {
        // 占位标记（effect/composelayer/无纹理图层）：极小圆点，避免像"错误控件"
        ctx.fillStyle = 'rgba(120, 170, 255, 0.5)'
        ctx.beginPath()
        ctx.arc(0, 0, 3, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.restore()
      // 图层名标注（画布坐标，保证可读）
      ctx.font = '10px system-ui, sans-serif'
      ctx.textBaseline = 'top'
      ctx.fillStyle = 'rgba(255,255,255,0.85)'
      ctx.strokeStyle = 'rgba(0,0,0,0.55)'
      const label = '#' + layer.id + ' ' + layer.name + ' [' + layer.kind + (this.layerTextures.has(layer.id) ? ' tex' : '') + ']'
      ctx.lineWidth = 3
      ctx.strokeText(label, px + 6, py + 6)
      ctx.fillText(label, px + 6, py + 6)
    }

    // 循环结束：flush 最后一段 GL 粒子（若 z-order 末尾是粒子层）
    flushGl()

    // 场景边界框（诊断用）
    ctx.strokeStyle = 'rgba(255,255,255,0.28)'
    ctx.lineWidth = 1
    ctx.strokeRect(ox, oy, model.width * s, model.height * s)
  }

  private drawCoverBase(ctx: CanvasRenderingContext2D, img: HTMLImageElement, cw: number, ch: number): void {
    const iw = img.naturalWidth
    const ih = img.naturalHeight
    if (iw === 0 || ih === 0) return
    const s = Math.max(cw / iw, ch / ih)
    const sw = cw / s
    const sh = ch / s
    ctx.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, 0, 0, cw, ch)
  }

  private resize(): void {
    if (this.el === null) return
    this.dpr = window.devicePixelRatio || 1
    const w = Math.max(1, Math.round(this.el.clientWidth * this.dpr))
    const h = Math.max(1, Math.round(this.el.clientHeight * this.dpr))
    if (this.el.width !== w) this.el.width = w
    if (this.el.height !== h) this.el.height = h
    if (this.glCanvas !== null) {
      if (this.glCanvas.width !== w) this.glCanvas.width = w
      if (this.glCanvas.height !== h) this.glCanvas.height = h
    }
  }

  private onResize = (): void => {
    this.resize()
    // 缩放后重建静态层缓存（避免画布尺寸变化后显示空白），并确保渲染循环运行
    this.staticBg = null
    this.staticBgReady = false
    if (this.model !== null) this.buildStaticBg()
    this.startAnimation()
  }

  private onVisibility = (): void => {
    if (document.hidden) {
      if (this.rafId !== 0) { cancelAnimationFrame(this.rafId); this.rafId = 0 }
    } else {
      this.startAnimation()
    }
  }

  private setLive(live: boolean): void {
    if (this.live === live) return
    this.live = live
    if (this.handlers.onLiveChange !== undefined) this.handlers.onLiveChange(live)
  }
}
