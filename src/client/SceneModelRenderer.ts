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
import type { SceneModel, SceneModelLayer } from '../scene/SceneModel.ts'
import { sampleAnimation as samplePuppet, type PuppetAnimation } from '../scene/ScenePuppet.ts'
import { ParticleRuntime } from './ParticleRuntime.ts'

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
 */
function buildMeshCanvas(mesh: { vertices: { pos: [number, number, number]; uv: [number, number] }[]; indices: number[] }, tex: HTMLCanvasElement | ImageBitmap): { canvas: HTMLCanvasElement; originX: number; originY: number } {
  let mnx = Infinity
  let mny = Infinity
  let mxx = -Infinity
  let mxy = -Infinity
  for (const v of mesh.vertices) {
    const x = v.pos[0]
    const y = -v.pos[1] // y-up → y-down
    if (x < mnx) mnx = x
    if (y < mny) mny = y
    if (x > mxx) mxx = x
    if (y > mxy) mxy = y
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
    const u0 = a.uv[0] * tw
    const v0 = (1 - a.uv[1]) * th
    const u1 = b.uv[0] * tw
    const v1 = (1 - b.uv[1]) * th
    const u2 = cc.uv[0] * tw
    const v2 = (1 - cc.uv[1]) * th
    const x0 = a.pos[0]
    const y0 = -a.pos[1]
    const x1 = b.pos[0]
    const y1 = -b.pos[1]
    const x2 = cc.pos[0]
    const y2 = -cc.pos[1]
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

export class SceneModelRenderer {
  private el: HTMLCanvasElement | null = null
  private ctx: CanvasRenderingContext2D | null = null
  private model: SceneModel | null = null
  private base: HTMLImageElement | null = null
  private layerTextures = new Map<number, ImageBitmap>()
  /** 图层纹理的 Image 内容区域尺寸（tex 画布内左上角）；无则用位图原生尺寸 */
  private layerTexImage = new Map<number, [number, number]>()
  /** 图层世界变换（递归 parent 合并；局部 y-up 翻转） */
  private worldTransform = new Map<number, { ox: number; oy: number; sx: number; sy: number }>()
  /** 图层 id → 图层（链式查找 puppet 祖先用） */
  private byId = new Map<number, SceneModelLayer>()
  private runtimes = new Map<number, ParticleRuntime>()
  private particleTextures = new Map<number, ImageBitmap | HTMLCanvasElement>()
  /** puppet 动画状态：puppet 图层 id → { 动画, 播放时间 } */
  private puppetAnims = new Map<number, { anim: PuppetAnimation; time: number }>()
  /** 每帧计算的动画变换：puppet 图层 id → 平移/旋转 */
  private animXform = new Map<number, { dx: number; dy: number; rot: number }>()
  /** puppet 网格离屏渲染缓存：图层 id → { canvas, 模型原点 } */
  private meshCanvases = new Map<number, { canvas: HTMLCanvasElement; originX: number; originY: number }>()
  private dpr = 1
  private live = false
  private closed = false
  private rafId = 0
  private lastT = 0
  private blurPx = 0
  private scale = 1
  private monitor = ''
  private version = 0
  private handlers: SceneModelRendererHandlers

  constructor(handlers: SceneModelRendererHandlers = {}) {
    this.handlers = handlers
  }

  get isLive(): boolean {
    return this.live
  }

  start(monitor: string, version: number): void {
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
    for (const bmp of this.particleTextures.values()) { try { if ('close' in bmp) bmp.close() } catch { /* 忽略 */ } }
    this.particleTextures.clear()
    this.runtimes.clear()
    this.setLive(false)
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
    // 粒子系统：创建运行时 + 加载粒子纹理（引擎资产 /we-sync/asset/texture）
    for (const layer of model.layers) {
      if (layer.particle !== null && layer.particle.textureNames.length > 0) {
        this.runtimes.set(layer.id, new ParticleRuntime(layer.particle, model.particleRateScale, model.particleSizeScale))
        jobs.push(this.loadParticleTexture(layer.id, layer.particle.textureNames[0]))
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

  private async loadParticleTexture(layerId: number, name: string): Promise<void> {
    try {
      const res = await fetch('/we-sync/asset/texture?name=' + encodeURIComponent(name), { cache: 'no-store' })
      if (!res.ok) return
      const blob = await res.blob()
      const bmp = await createImageBitmap(blob)
      if (this.closed) { bmp.close(); return }
      // 径向软边合成：雾/雪等粒子纹理边缘柔和，避免巨型硬边方块叠加成白线
      const soft = makeSoftTexture(bmp)
      bmp.close()
      if (this.closed) return
      this.particleTextures.set(layerId, soft)
    } catch { /* 粒子纹理不可用：该粒子层不绘制 */ }
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
      // 循环周期 = t 峰值跨度；异常数据（多骨骼动画/解析失败，周期异常大）
      // 跳过不播放；播放速度按 3 秒周期近似（时长字段）
      let peak = 0
      for (let i = 1; i < kf.length; i++) if (kf[i].t > kf[peak].t) peak = i
      const period = kf[peak].t - kf[0].t
      if (period > 5_000_000) continue
      const t = period > 0 ? (st.time * period) / 3.0 : st.time * (kf.length - 1) / 3.0
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
      // 位置位移：变化分量相对首帧（场景单位，y-up）
      let dx = 0
      let dy = 0
      if (spans[0] > 0.5) dx += v[0] - base[0]
      if (spans[1] > 0.5) dy += v[1] - base[1]
      if (spans[6] > 0.5) dx += v[6] - base[6]
      if (spans[7] > 0.5) dy += v[7] - base[7]
      this.animXform.set(layerId, { dx, dy, rot })
    }
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

    // 图层（scene.json 数组顺序 = z-order）
    for (const layer of model.layers) {
      if (!layer.visible || layer.alpha <= 0) continue
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
      // 粒子层：运行时绘制（additive sprite）
      const rt = this.runtimes.get(layer.id)
      const ptex = this.particleTextures.get(layer.id)
      if (rt !== undefined && ptex !== undefined) {
        const wt = t ?? { ox: layer.origin[0], oy: layer.origin[1], sx: layer.scale[0] ?? 1, sy: layer.scale[1] ?? 1 }
        rt.draw(ctx, ox, oy, s, wt, ptex)
        continue
      }
      ctx.save()
      ctx.translate(px, py)
      ctx.rotate(((layer.angles[2] ?? 0) * Math.PI / 180) + arot)
      ctx.scale((t !== undefined ? t.sx : layer.scale[0] ?? 1) * s, (t !== undefined ? t.sy : layer.scale[1] ?? 1) * s)
      if (layer.alpha < 1) ctx.globalAlpha = Math.max(0, Math.min(1, layer.alpha))
      const bmp = this.layerTextures.get(layer.id) ?? null
      // puppet 网格蒙皮渲染（实验开关；模型空间顶点 → 离屏 canvas → 场景变换）
      if (model.puppetMeshRender && layer.puppet !== null && layer.puppet.mesh !== null && bmp !== null) {
        let mc = this.meshCanvases.get(layer.id)
        if (mc === undefined) {
          mc = buildMeshCanvas(layer.puppet.mesh, bmp)
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
        ctx.drawImage(bmp, 0, 0, sw, sh, -dw / 2, -dh / 2, dw, dh)
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
  }

  private onResize = (): void => {
    this.resize()
    // 动画循环每帧重绘，resize 后下一帧即生效
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
