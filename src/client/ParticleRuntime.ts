/**
 * ParticleRuntime —— 浏览器侧粒子系统运行时（Phase C）。
 *
 * 数据源：SceneModel 的 ParticleSystemDesc（源自 WE particles/*.json 预设）。
 * 渲染语义（size/alpha/rate 单位、控制点线段、rope/spritetrail、REFRACT 折射、
 * spritesheet 帧）参考 Wallpaper Engine 官方 shader 语义与开源渲染器
 * linux-wallpaperengine（Almamu，GPL-3.0，本文件为独立 TypeScript 实现，同协议）。
 *
 * 坐标系：WE 粒子为局部 3D 坐标，**y 向上**（velocityrandom y 负值 = 向下落，
 * gravity "0 -10 0" = 向下加速）。绘制时把局部 y 翻转为屏幕 y 向下：
 *   屏幕 y = py0 - p.y * scale * s
 */
import type { ParticleSystemDesc } from '../scene/SceneModel.ts'
import type { GlParticle } from './ParticleGL.ts'

interface Particle {
  x: number
  y: number
  /** 深度（perspective rendering：发射区 z，局部坐标；影响屏幕缩放近大远小） */
  z: number
  vx: number
  vy: number
  life: number
  maxLife: number
  /** 出生尺寸（sizechange 线性插值的基准） */
  baseSize: number
  size: number
  alpha: number
  /** 颜色 tint（0-255） */
  color: [number, number, number]
  /** 旋转（弧度） */
  rot: number
  /** 角速度（弧度/秒） */
  angVel: number
  /** spritesheet 出生帧偏移（随机相位，0..frames-1） */
  frame: number
  /** ropetrail 路径历史（局部坐标，最近 N 帧位置） */
  history: { x: number; y: number }[]
  phase: number
  /** oscillateposition 相位（每粒子独立） */
  oscPhase: number
  /** oscillateposition 频率（每粒子独立） */
  oscFreq: number
}

export class ParticleRuntime {
  private particles: Particle[] = []
  private acc = 0
  private time = 0
  /** 纹理染色缓存（颜色 → 染色 canvas） */
  private tintCache = new Map<string, HTMLCanvasElement>()
  /** 渲染器类型（sprite | spritetrail | rope）：决定是否沿速度拉伸 */
  private rendererType: string
  /** spritetrail 的 length 参数（拖尾时长系数） */
  private trailLength: number
  /** spritetrail 的 maxlength 参数（拖尾最大长度，场景 px；speed×length 上限） */
  private trailMaxLength: number
  /** spritetrail 的 minlength 参数（拖尾最小长度，场景 px；速度过低时的下限） */
  private trailMinLength: number
  /** 控制点线段序列索引（mapsequencebetweencontrolpoints 分布用） */
  private seqIndex = 0
  /** 粒子纹理（由 SceneModelRenderer 加载后注入） */
  private texture: ImageBitmap | HTMLCanvasElement | null = null
  /** spritesheet 帧元数据 */
  private frames = 0
  private fw = 0
  private fh = 0
  /** 子粒子系统（children：如 rain_screen 的 static/fast 子雨滴）；
   *  type="eventfollow" 的子系在父粒子位置生成并跟随父粒子事件 */
  private children: Array<{ rt: ParticleRuntime; type: string | null }> = []
  /** 本 runtime 是否为 eventfollow 子系（自身不独立发射，只响应父粒子事件） */
  private eventFollow = false
  /** instantaneous 一次性爆发是否已生成（rate=0 + instantaneous 的系统只爆发一次） */
  private instantSpawned = false
  /** 折射法线纹理（材质第二个纹理，REFRACT 粒子用；RG88/RGBA8888n 布局通用解压 (a,g)） */
  private normalTexture: ImageBitmap | HTMLCanvasElement | null = null
  private normalFrames = 0
  private normalFw = 0
  private normalFh = 0

  constructor(private desc: ParticleSystemDesc, private rateScale = 1, private sizeScale = 1, eventFollow = false) {
    this.rendererType = desc.renderer?.type ?? 'sprite'
    this.trailLength = desc.renderer?.length ?? 0
    this.trailMaxLength = desc.renderer?.maxlength ?? 0
    this.trailMinLength = desc.renderer?.minlength ?? 0
    this.eventFollow = eventFollow
    for (const c of desc.children) {
      this.children.push({
        rt: new ParticleRuntime(c.desc, rateScale, sizeScale, c.type === 'eventfollow'),
        type: c.type,
      })
    }
  }

  /** WE Start Time 语义：创建时预模拟（非延迟启动），避免开场空屏。
   *  由 SceneModelRenderer 在根 runtime 上调用一次；子 runtime 随父 update 自然推进。 */
  preSimulate(): void {
    const target = this.desc.startTime
    if (target <= 0) return
    const step = 1 / 30
    let t = 0
    while (t < target) {
      const dt = Math.min(step, target - t)
      this.update(dt)
      t += dt
    }
  }

  /** SceneModelRenderer 加载纹理后注入（含 spritesheet 帧元数据） */
  setTexture(tex: ImageBitmap | HTMLCanvasElement, frames = 0, fw = 0, fh = 0): void {
    this.texture = tex
    this.frames = frames
    this.fw = fw
    this.fh = fh
  }

  /** 注入折射法线纹理（REFRACT 材质第二个纹理） */
  setNormalTexture(tex: ImageBitmap | HTMLCanvasElement, frames = 0, fw = 0, fh = 0): void {
    this.normalTexture = tex
    this.normalFrames = frames
    this.normalFw = fw
    this.normalFh = fh
  }

  /** 递归收集自身及所有子 runtime（供 SceneModelRenderer 逐层加载纹理） */
  collect(): Array<{ rt: ParticleRuntime; texName: string; normalName: string | null }> {
    const out: Array<{ rt: ParticleRuntime; texName: string; normalName: string | null }> = []
    const walk = (rt: ParticleRuntime): void => {
      if (rt.desc.textureNames.length > 0) {
        out.push({
          rt,
          texName: rt.desc.textureNames[0],
          normalName: rt.desc.refract && rt.desc.textureNames.length > 1 ? rt.desc.textureNames[1] : null,
        })
      }
      for (const c of rt.children) walk(c.rt)
    }
    walk(this)
    return out
  }

  /** 纹理是否已就绪（自身或任一子 runtime）——用于区分"无粒子"与"纹理未加载" */
  get textureReady(): boolean {
    if (this.texture !== null) return true
    for (const c of this.children) if (c.rt.textureReady) return true
    return false
  }

  /** 释放纹理（ImageBitmap.close）并递归子 runtime */
  dispose(): void {
    if (this.texture !== null && 'close' in this.texture) {
      try { (this.texture as ImageBitmap).close() } catch { /* 忽略 */ }
    }
    this.texture = null
    if (this.normalTexture !== null && 'close' in this.normalTexture) {
      try { (this.normalTexture as ImageBitmap).close() } catch { /* 忽略 */ }
    }
    this.normalTexture = null
    for (const c of this.children) c.rt.dispose()
  }

  /** 是否存在 rope/ropetrail 线渲染器（需 Canvas 绘制，不能走 WebGL 实例化） */
  hasLineRenderer(): boolean {
    if (this.rendererType === 'rope' || this.rendererType === 'ropetrail') return true
    return this.children.some((c) => c.rt.hasLineRenderer())
  }

  /**
   * 收集 sprite/spritetrail 粒子为 WebGL 实例化批次（每个 runtime 一个批次，
   * 含纹理/帧/混合/折射信息；rope/ropetrail 由调用方走 Canvas）。
   * 变换与 Canvas draw 一致：屏幕 x = px0 + p.x·lx·s，y = py0 − p.y·ly·s，
   * 尺寸不乘对象 scale；spritetrail 沿速度方向拉伸。
   * 官方 quad 语义（genericparticle.vert ComputeParticlePosition）：
   *   quad 宽度 = size，高度 = size × textureRatio（h/w），quad 居中于粒子。
   */
  collectGl(lx: number, ly: number, px0: number, py0: number, s: number): Array<{
    particles: GlParticle[]
    tex: ImageBitmap | HTMLCanvasElement
    normalTex: ImageBitmap | HTMLCanvasElement | null
    frames: number
    fw: number
    fh: number
    additive: boolean
    refract: boolean
    refractAmount: number
    trail: boolean
  }> {
    const out: Array<{
      particles: GlParticle[]
      tex: ImageBitmap | HTMLCanvasElement
      normalTex: ImageBitmap | HTMLCanvasElement | null
      frames: number
      fw: number
      fh: number
      additive: boolean
      refract: boolean
      refractAmount: number
      trail: boolean
    }> = []
    const walk = (rt: ParticleRuntime): void => {
      if (rt.texture !== null && rt.rendererType !== 'rope' && rt.rendererType !== 'ropetrail') {
        const tex = rt.texture
        const frames = rt.frames
        const fw = rt.fw
        const fh = rt.fh
        const sprite = frames > 1 && fw > 0 && fh > 0
        // 官方 textureRatio = h/w（非 sprite：g_Texture0Resolution.y/x；sprite：frameH/frameW）
        const texRatio = sprite ? (fh > 0 ? fh / fw : 1) : (tex.height > 0 ? tex.height / tex.width : 1)
        const list: GlParticle[] = []
        for (const p of rt.particles) {
          // perspective rendering：按粒子深度 z（发射区）近大远小——
          // 位置（相对层中心收缩）、尺寸、速度统一 × depthFactor（z 负 = 深处）
          const df = rt.desc.perspective ? rt.depthFactor(p) : 1
          const x = px0 + p.x * lx * s * df
          const y = py0 - p.y * ly * s * df
          // 官方 quad 顶点经 g_ModelViewProjectionMatrix → 尺寸乘 layer scale（lx/ly）。
          // 宽度（沿屏幕 x/quad right 轴）× lx，高度（沿屏幕 y/quad up 轴）× ly。
          const pwBase = Math.max(2, p.size * s * df) // 局部 quad 宽度 = size × 透视
          const pw = pwBase * lx                     // 屏幕宽度 = size × lx
          let size = pw
          let aspect = texRatio * (ly / lx)          // 屏幕高度 = size × lx × (texRatio × ly/lx) = size × texRatio × ly
          let rot = p.rot
          let alpha = p.alpha
          let gx = x
          let gy = y
          if (rt.rendererType === 'spritetrail') {
            // 官方 spritetrail（common_particles.h ComputeParticleTrailTangents）：
            //   stretch   = max(minLength, min(局部速度 × length, maxLength))  ← 局部速度
            //   up = 速度方向 × stretch；quad 沿速度拉伸（uvs-0.5 双向居中）
            //   屏幕拖尾长度 = size × textureRatio × stretch × |屏幕速度|/|局部速度|
            //   屏幕速度 = 局部速度 × layer scale × 透视
            const localSpd = Math.hypot(p.vx, p.vy)
            const svx = p.vx * lx * df
            const svy = p.vy * ly * df
            const spd = Math.hypot(svx, svy)
            const maxL = rt.trailMaxLength > 0 ? rt.trailMaxLength : Infinity
            const minL = rt.trailMinLength > 0 ? rt.trailMinLength : 0
            const stretch = Math.max(minL, Math.min(localSpd * rt.trailLength, maxL))
            const spdScale = localSpd > 0.001 ? spd / localSpd : 1
            const streakLen = pwBase * texRatio * stretch * spdScale
            if (spd > 2 && streakLen > 2) {
              size = pw
              aspect = streakLen / pw              // 长度/宽度
              // GL 顶点着色器 corner = (宽, 长) 经 R(rot) 旋转：
              // 长轴（corner.y）须指向屏幕速度方向 → rot = atan2(-svx, svy)
              // （旧 atan2(-svy, svx) 把长轴转到水平 → 雨滴横躺"太扁"）
              rot = Math.atan2(-svx, svy)
              gx = x
              gy = y                               // 居中于粒子（WE 语义）
            }
          }
          if (rt.desc.refract && rt.rendererType === 'spritetrail') alpha *= 0.5
          const frac = 1 - p.life / p.maxLife
          const frame = rt.pickFrame(p, frac, frames)
          list.push({
            x: gx, y: gy, size, rot,
            r: p.color[0], g: p.color[1], b: p.color[2],
            a: Math.max(0, Math.min(1, alpha)),
            frame, aspect,
          })
        }
        if (list.length > 0) {
          out.push({
            particles: list,
            tex,
            normalTex: rt.desc.refract ? rt.normalTexture : null,
            frames,
            fw,
            fh,
            additive: rt.desc.blending === 'additive',
            refract: rt.desc.refract && rt.rendererType === 'sprite',
            refractAmount: rt.desc.refractAmount,
            trail: rt.rendererType === 'spritetrail',
          })
        }
      }
      for (const c of rt.children) walk(c.rt)
    }
    walk(this)
    return out
  }

  get count(): number {
    return this.particles.length
  }

  update(dt: number): void {
    this.time += dt
    const em = this.desc.emitter
    const ini = this.desc.initializers
    const ops = this.desc.operators

    // instantaneous：系统创建时立即生成（rate=0 的一次性爆发，如 sparktrails=100）。
    // eventfollow 子系不在此爆发（由 eventFollowUpdate 在父粒子位置生成）。
    if (!this.instantSpawned && !this.eventFollow && em.instantaneous > 0) {
      this.instantSpawned = true
      for (let i = 0; i < em.instantaneous && this.particles.length < this.desc.maxCount; i++) {
        this.spawn(em, ini)
      }
    }

    // starttime 门控：WE 的 Start Time 是"创建时预模拟"（preSimulate 已把系统推进到
    // 稳态）；实时运行中 time 已越过 startTime，这里保持门控只防止重复发射。
    const newEvents: Array<Particle> = []
    if (this.time >= this.desc.startTime && !this.eventFollow) {
      // 发射（rate × 视觉缩放）
      this.acc += em.rate * this.rateScale * dt
      while (this.acc >= 1 && this.particles.length < this.desc.maxCount) {
        this.acc -= 1
        const p = this.spawn(em, ini)
        if (p !== null) newEvents.push(p)
      }
    }

    // 更新自身粒子
    this.updateParticles(dt)

    // 子粒子：eventfollow/eventspawn 在父粒子位置生成（含瞬时爆发）；
    // eventspawn 与 eventfollow 语义相同（在父事件位置生成），区别在于 eventspawn
    // 子系通常 rate=0、instantaneous>0 一次性爆发（如 spark→sparktrails）。
    // 普通子粒子（type=null）独立更新。
    for (const c of this.children) {
      if (c.type === 'eventfollow' || c.type === 'eventspawn') c.rt.eventFollowUpdate(this.particles, newEvents, dt)
      else c.rt.update(dt)
    }
  }

  /**
   * eventfollow 子粒子更新：在父粒子位置生成。
   *  - 瞬时爆发：每个父粒子出生事件在其位置生成 instantaneous 个（如 shootingstarglow=1）
   *  - 连续发射：rate × dt 分布在存活父粒子上（如 rain_screen_fast_child）
   * 子粒子自身仍按各自算子更新（alphafade/sizechange 等），位置继承父粒子出生点。
   */
  private eventFollowUpdate(parents: Particle[], newEvents: Particle[], dt: number): void {
    this.time += dt
    const em = this.desc.emitter
    const ini = this.desc.initializers
    if (!this.instantSpawned) this.instantSpawned = true
    for (const ev of newEvents) {
      for (let i = 0; i < em.instantaneous && this.particles.length < this.desc.maxCount; i++) {
        const o = this.emitterOffset(em)
        this.spawnAt(ini, ev.x + o.x, ev.y + o.y, ev.z + o.z)
      }
    }
    this.acc += em.rate * this.rateScale * dt
    while (this.acc >= 1 && this.particles.length < this.desc.maxCount) {
      this.acc -= 1
      const par = parents.length > 0 ? parents[Math.floor(Math.random() * parents.length)] : null
      const o = this.emitterOffset(em)
      this.spawnAt(ini, (par !== null ? par.x : 0) + o.x, (par !== null ? par.y : 0) + o.y, (par !== null ? par.z : 0) + o.z)
    }
    this.updateParticles(dt)
    for (const c of this.children) {
      if (c.type === 'eventfollow' || c.type === 'eventspawn') c.rt.eventFollowUpdate(this.particles, [], dt)
      else c.rt.update(dt)
    }
  }

  /** 更新自身粒子：移动 / 算子（重力/阻尼/振荡/尺寸变化/透明度）/ 寿命过滤 */
  private updateParticles(dt: number): void {
    const ops = this.desc.operators
    const g = ops.gravity ?? [0, 0, 0]
    const drag = ops.drag ?? 0
    const angDrag = ops.angularDrag ?? 0
    const angForce = ops.angularForce ?? [0, 0, 0]
    const fade = ops.alphaFade
    const osc = ops.oscillateAlpha
    const oscPos = ops.oscillatePosition
    const sizeChanges = ops.sizeChanges ?? []
    const turb = ops.turbulence
    for (const p of this.particles) {
      p.life -= dt
      const frac = 1 - p.life / p.maxLife
      p.x += p.vx * dt
      p.y += p.vy * dt
      // ropetrail 路径历史（记录移动后的位置，最多 24 点）
      p.history.push({ x: p.x, y: p.y })
      if (p.history.length > 24) p.history.shift()
      p.vx += g[0] * dt
      p.vy += g[1] * dt
      // movement drag：速度阻尼
      if (drag > 0) {
        p.vx *= Math.max(0, 1 - drag * dt)
        p.vy *= Math.max(0, 1 - drag * dt)
      }
      // angularmovement：角速度阻尼 + 角加速度
      if (angDrag > 0) p.angVel *= Math.max(0, 1 - angDrag * dt)
      p.angVel += angForce[2] * dt
      p.rot += p.angVel * dt
      // oscillateposition：位置正弦振荡（每粒子独立频率/相位）
      if (oscPos !== undefined) {
        const sw = Math.sin(this.time * p.oscFreq + p.oscPhase)
        p.x += sw * oscPos.mask[0] * dt
        p.y += sw * oscPos.mask[1] * dt
      }
      if (turb !== undefined) {
        const phase = this.time * (turb.speedMin + (turb.speedMax - turb.speedMin) * 0.5) + p.phase
        p.x += Math.sin(phase) * turb.scale * 100 * dt
        p.y += Math.cos(phase * 0.7) * turb.scale * 100 * dt
      }
      let a = 1
      if (fade !== undefined) {
        const fadeIn = fade.fadeIn ?? 0
        const fadeOut = fade.fadeOut ?? 0
        if (fadeIn > 0 && frac < fadeIn) a = Math.min(a, frac / fadeIn)
        if (fadeOut > 0) {
          const tail = 1 - frac
          if (tail < fadeOut) a = Math.min(a, tail / fadeOut)
        }
      }
      if (osc !== undefined) {
        const s = Math.sin(this.time * osc.frequencyMax * Math.PI * 2 + p.phase)
        a *= osc.scaleMin + (1 - osc.scaleMin) * Math.max(0, s)
      }
      // sizechange：寿命比例区间内从 startValue 线性变到 endValue（相对出生尺寸）
      for (const sc of sizeChanges) {
        if (frac >= sc.startTime) {
          const span = Math.max(0.0001, (sc.endTime ?? 1) - sc.startTime)
          const t = Math.min(1, Math.max(0, (frac - sc.startTime) / span))
          p.size = p.baseSize * (sc.startValue + (sc.endValue - sc.startValue) * t)
        }
      }
      p.alpha = Math.max(0, Math.min(1, a))
    }
    this.particles = this.particles.filter((p) => p.life > 0)
  }

  /**
   * 绘制（局部坐标 → 世界变换 → 画布）。
   * 混合模式按材质 blending：translucent → alpha 混合（source-over，雾/雪等半透明）；
   * additive → 'lighter'（光效/火花）。t 为图层世界变换（含 parent 合并）。
   * 粒子局部 y 向上 → 绘制时翻转。粒子颜色按 colorrandom 染色（缓存染色纹理）。
   * spritesheet 序列帧（frames>1）：按粒子年龄取帧（出生随机相位），从位图中裁剪
   * 对应帧区域绘制——避免整张 8×8 帧矩阵被画出来（雾/烟 64 帧序列纹理）。
   */
  draw(ctx: CanvasRenderingContext2D, ox: number, oy: number, s: number, t: { ox: number; oy: number; sx: number; sy: number }, bg: HTMLCanvasElement | null = null): void {
    const tex = this.texture
    const frames = this.frames
    const fw = this.fw
    const fh = this.fh
    const lx = t.sx
    const ly = t.sy
    const px0 = ox + t.ox * s
    const py0 = oy + t.oy * s
    if (tex !== null) {
      this.drawSelf(ctx, ox, oy, s, t, tex, frames, fw, fh, lx, ly, px0, py0, bg)
    }
    for (const c of this.children) c.rt.draw(ctx, ox, oy, s, t, bg)
  }

  /** 该粒子系统（含子粒子）是否使用折射材质 */
  hasRefract(): boolean {
    return this.desc.refract || this.children.some((c) => c.rt.hasRefract())
  }

  /** 绘制自身粒子（tex 非空时） */
  private drawSelf(ctx: CanvasRenderingContext2D, ox: number, oy: number, s: number, t: { ox: number; oy: number; sx: number; sy: number }, tex: ImageBitmap | HTMLCanvasElement, frames: number, fw: number, fh: number, lx: number, ly: number, px0: number, py0: number, bg: HTMLCanvasElement | null): void {
    const additive = this.desc.blending === 'additive'
    const sprite = frames > 1 && fw > 0 && fh > 0
    const cols = sprite ? Math.max(1, Math.floor(tex.width / fw)) : 1
    ctx.save()
    if (additive) ctx.globalCompositeOperation = 'lighter'
    // rope 渲染器（官方："draws a line between each particle" + 光束纹理沿线 UV 重复）：
    // 每段用 beam 纹理（细长发光束）染色后沿线拉伸绘制，形成放电闪电光带；
    // 粒子本身不画 sprite。
    if (this.rendererType === 'rope') {
      const pts = this.particles
      if (pts.length >= 2) {
        for (let i = 1; i < pts.length; i++) {
          const a = pts[i - 1]
          const b = pts[i]
          const ax = px0 + a.x * lx * s
          const ay = py0 - a.y * ly * s
          const bx = px0 + b.x * lx * s
          const by = py0 - b.y * ly * s
          const dx = bx - ax
          const dy = by - ay
          const segLen = Math.hypot(dx, dy)
          if (segLen < 0.5) continue
          const img = this.tinted(tex, b.color)
          ctx.save()
          ctx.translate(ax, ay)
          ctx.rotate(Math.atan2(dy, dx))
          ctx.globalAlpha = Math.max(0, Math.min(1, b.alpha))
          const w = Math.max(1, b.size * s)
          // beam 纹理长轴(高)沿线，短轴(宽)为线宽
          ctx.drawImage(img, 0, 0, tex.width, tex.height, -segLen / 2, -w / 2, segLen, w)
          ctx.restore()
        }
      }
      ctx.restore()
      return
    }
    // ropetrail 渲染器（官方 genericropeparticle："draws a line along the path of
    // each particle" + 光束纹理沿线拉伸）：沿每个粒子的位置历史用光束纹理绘制
    // 纹理化轨迹（如流星 drop 纹理的软边光带）。粒子本身不画 sprite。
    if (this.rendererType === 'ropetrail') {
      for (const p of this.particles) {
        const hist = p.history
        if (hist.length < 2) continue
        const img = this.tinted(tex, p.color)
        const w = Math.max(1, p.size * s)
        for (let hi = 1; hi < hist.length; hi++) {
          const a = hist[hi - 1]
          const b = hist[hi]
          const ax = px0 + a.x * lx * s
          const ay = py0 - a.y * ly * s
          const bx = px0 + b.x * lx * s
          const by = py0 - b.y * ly * s
          const dx = bx - ax
          const dy = by - ay
          const segLen = Math.hypot(dx, dy)
          if (segLen < 0.5) continue
          ctx.save()
          ctx.translate(ax, ay)
          ctx.rotate(Math.atan2(dy, dx))
          ctx.globalAlpha = Math.max(0, Math.min(1, p.alpha))
          // 官方 rope：纹理 v 轴沿线（dest 高 = 段长），u 轴为线宽
          ctx.drawImage(img, 0, 0, tex.width, tex.height, 0, -w / 2, segLen, w)
          ctx.restore()
        }
      }
      ctx.restore()
      return
    }
    // 网页端性能：每层每帧最多渲染 400 个粒子（折射 ×2 drawImage 更贵）。Canvas 2D
    // 上万粒子逐个 drawImage 会让 CPU/GPU 双高掉帧。
    let drawn = 0
    const DRAW_LIMIT = 400
    for (const p of this.particles) {
      if (drawn >= DRAW_LIMIT) break
      drawn++
      // perspective rendering：位置（相对层中心）、尺寸、速度统一 × depthFactor
      const df = this.desc.perspective ? this.depthFactor(p) : 1
      const x = px0 + p.x * lx * s * df
      const y = py0 - p.y * ly * s * df
      // 官方 genericparticle.vert：quad 宽度 = size，高度 = size × textureRatio（h/w），
      // quad 顶点经 g_ModelViewProjectionMatrix → 尺寸乘 layer scale（lx/ly）。
      const pwBase = Math.max(2, p.size * s * df)
      // 帧区域宽高比（单帧内）；非序列帧用整张纹理宽高比
      const fwPx = sprite ? fw : tex.width
      const fhPx = sprite ? fh : tex.height
      const texRatio = fhPx / fwPx
      const pw = pwBase * lx      // 屏幕宽度 = size × layerScale.x
      const ph = pwBase * texRatio * ly // 屏幕高度 = size × (h/w) × layerScale.y
      const img = this.tinted(tex, p.color)
      ctx.globalAlpha = Math.max(0, Math.min(1, p.alpha))
      // REFRACT 折射：sprite 粒子（静态水珠/雨滴）用背景采样 + alpha 裁剪；
      // spritetrail（快速下落雨丝）保持拉伸，仅半透明近似（拉伸+折射组合暂不实现）。
      if (this.desc.refract && bg !== null && this.rendererType === 'sprite') {
        ctx.save()
        // 折射偏移：官方 refract_amount（负值）+ 法线；此处用径向凸透镜近似——
        // 偏移量与雨滴尺寸成正比（WebGL 路径用真实法线贴图）
        const off = pw * 0.06
        ctx.drawImage(bg, x - pw / 2 + off, y - ph / 2 + off, pw, ph, x - pw / 2, y - ph / 2, pw, ph)
        ctx.globalCompositeOperation = 'destination-in'
        ctx.drawImage(img, x - pw / 2, y - ph / 2, pw, ph)
        ctx.restore()
        continue
      }
      if (this.desc.refract && this.rendererType === 'spritetrail') {
        ctx.globalAlpha *= 0.5
      }
      // spritetrail 渲染器（官方 common_particles.h ComputeParticleTrailTangents）：
      //   stretch = max(minLength, min(局部速度 × length, maxLength))  ← 局部速度
      //   屏幕拖尾长度 = size × textureRatio × stretch × |屏幕速度|/|局部速度|
      const localSpd = Math.hypot(p.vx, p.vy)
      const svx = p.vx * lx * df
      const svy = p.vy * ly * df
      const spd = Math.hypot(svx, svy)
      const maxL = this.trailMaxLength > 0 ? this.trailMaxLength : Infinity
      const minL = this.trailMinLength > 0 ? this.trailMinLength : 0
      const stretch = Math.max(minL, Math.min(localSpd * this.trailLength, maxL))
      const spdScale = localSpd > 0.001 ? spd / localSpd : 1
      const streakLen = pwBase * texRatio * stretch * spdScale
      const stretched = this.rendererType === 'spritetrail' && spd > 2 && streakLen > 2
      if (stretched) {
        const len = streakLen
        const wid = pw
        // Canvas rotate 顺时针（屏幕 y 向下）：dest (wid, len) 的 len 轴
        // 经 rotate(θ) 后指向 (sinθ, cosθ)，须 = 屏幕速度方向 → θ = atan2(svx, svy)
        // （旧 atan2(-svy, svx) 把 len 轴转到水平 → 雨滴横躺"太扁"）
        const ang = Math.atan2(svx, svy)
        ctx.save()
        ctx.translate(x, y)
        ctx.rotate(ang)
        // dest (wid, len)：纹理 v 轴沿线（拖尾），u 轴为宽度（官方 UV 布局）
        if (sprite) {
          const frac = 1 - p.life / p.maxLife
          const frame = this.pickFrame(p, frac, frames)
          const col = frame % cols
          const row = Math.floor(frame / cols)
          ctx.drawImage(img, col * fw, row * fh, fw, fh, -wid / 2, -len / 2, wid, len)
        } else {
          ctx.drawImage(img, -wid / 2, -len / 2, wid, len)
        }
        ctx.restore()
      } else if (p.rot !== 0) {
        ctx.save()
        ctx.translate(x, y)
        ctx.rotate(p.rot)
        if (sprite) {
          const frac = 1 - p.life / p.maxLife
          const frame = this.pickFrame(p, frac, frames)
          const col = frame % cols
          const row = Math.floor(frame / cols)
          ctx.drawImage(img, col * fw, row * fh, fw, fh, -pw / 2, -ph / 2, pw, ph)
        } else {
          ctx.drawImage(img, -pw / 2, -ph / 2, pw, ph)
        }
        ctx.restore()
      } else {
        if (sprite) {
          const frac = 1 - p.life / p.maxLife
          const frame = this.pickFrame(p, frac, frames)
          const col = frame % cols
          const row = Math.floor(frame / cols)
          ctx.drawImage(img, col * fw, row * fh, fw, fh, x - pw / 2, y - ph / 2, pw, ph)
        } else {
          ctx.drawImage(img, x - pw / 2, y - ph / 2, pw, ph)
        }
      }
    }
    ctx.restore()
  }

  /** 纹理染色（source-in 保留 alpha），按颜色缓存 */
  /**
   * 帧选择（官方 genericparticle.vert ComputeSpriteFrame）：
   *  - randomframe：粒子出生随机帧后固定（静态水珠/雨滴）
   *  - 序列（默认，animationmode null/""/sequence）：从第 0 帧开始按寿命推进，
   *    速度 × sequenceMultiplier（particles-general "Sequence multiplier"）。
   *    旧实现给序列模式加随机起始帧 → 雾/烟每团动画相位错乱，此处修正。
   */
  /**
   * 透视深度因子（perspective rendering — particles-general "Perspective rendering"）。
   * 2D 场景中粒子按 z 深度近大远小：depthFactor = 1 / (1 + max(0, -z) / focal)，
   * 其中 focal = (场景高/2) / tan(fov/2)，z 负 = 场景方向（远）。
   * 粒子位置（向层中心收缩）、尺寸、速度统一 × depthFactor。
   */
  private depthFactor(p: Particle): number {
    const depth = Math.max(0, -p.z)
    return this.desc.perspectiveFocal / (this.desc.perspectiveFocal + depth)
  }

  private pickFrame(p: Particle, frac: number, frames: number): number {
    if (this.desc.animationMode === 'randomframe') return p.frame % frames
    const mult = this.desc.sequenceMultiplier > 0 ? this.desc.sequenceMultiplier : 1
    const idx = Math.floor(frac * frames * mult)
    return Math.max(0, Math.min(frames - 1, idx))
  }

  private tinted(tex: ImageBitmap | HTMLCanvasElement, color: [number, number, number]): HTMLCanvasElement {
    const key = color[0] + ',' + color[1] + ',' + color[2]
    const hit = this.tintCache.get(key)
    if (hit !== undefined) return hit
    const c = document.createElement('canvas')
    c.width = tex.width
    c.height = tex.height
    const g = c.getContext('2d')
    if (g !== null) {
      // 官方 shader：color = v_Color * texture.rgb（乘法，保留灰度纹理的明暗形状，
      // 雨滴/雾/光束的 RG88/R8 灰度细节）。旧 source-in 把 rgb 整体替换成纯色，
      // 丢失纹理形状（如雨滴变成无纹理的半透明圆点）。
      g.drawImage(tex, 0, 0)
      g.globalCompositeOperation = 'multiply'
      g.fillStyle = 'rgb(' + color[0] + ',' + color[1] + ',' + color[2] + ')'
      g.fillRect(0, 0, c.width, c.height)
      // 恢复纹理 alpha（multiply 不改变 alpha，但保险起见 source-in 重画一次纹理 alpha）
      g.globalCompositeOperation = 'destination-in'
      g.drawImage(tex, 0, 0)
    }
    this.tintCache.set(key, c)
    return c
  }

  /** 发射器随机位置（发射区 + origin，含 sign 符号限制）→ spawnAt（返回生成的粒子） */
  private spawn(em: ParticleSystemDesc['emitter'], ini: ParticleSystemDesc['initializers']): Particle | null {
    let x = 0
    let y = 0
    // 控制点线段（mapsequencebetweencontrolpoints）：粒子沿 origin→cp1 线段按序列分布，
    // rope 连线即"闪电包裹背景线段"（discharge）。mirror 往返，repeat 单向循环。
    if (this.desc.controlPointLine !== null && this.desc.sequenceCount > 0) {
      const [cpx, cpy] = this.desc.controlPointLine
      const n = Math.max(1, Math.round(this.desc.sequenceCount))
      const period = this.desc.sequenceMirror ? Math.max(1, 2 * (n - 1)) : n
      const idx = this.seqIndex % period
      const pos = this.desc.sequenceMirror ? (idx <= n - 1 ? idx : period - idx) : idx
      const t = n > 1 ? pos / (n - 1) : 0
      x = cpx * t
      y = cpy * t
      this.seqIndex++
      // 序列分布粒子不叠加 emitter 随机位置；速度仍由 velocityrandom 决定（放电抖动）
    } else {
      const o = this.emitterOffset(em)
      x = o.x
      y = o.y
      const z = o.z
      return this.spawnAt(ini, x, y, z)
    }
    return this.spawnAt(ini, x, y, 0)
  }

  /**
   * 发射区随机偏移（boxrandom/sphererandom + origin + sign 符号限制）。
   * eventfollow/eventspawn 子系在父粒子位置叠加此偏移（子系发射区相对父粒子）。
   * z 为发射区深度（sphererandom dirs.z × 半径，perspective rendering 用）。
   */
  private emitterOffset(em: ParticleSystemDesc['emitter']): { x: number; y: number; z: number } {
    let x = 0
    let y = 0
    let z = 0
    const [dx, dy, dz] = em.directions
    if (em.type === 'boxrandom') {
      // 官方 boxrandom：Distance Max = 距中心最大距离 → 盒范围 ±distanceMax（无 0.5 折半）
      const d = Array.isArray(em.distanceMax) ? em.distanceMax : [em.distanceMax, em.distanceMax, 0]
      x = (Math.random() * 2 - 1) * d[0]
      y = (Math.random() * 2 - 1) * d[1]
      z = (Math.random() * 2 - 1) * (d[2] ?? 0)
    } else {
      // sphererandom：椭圆体内均匀（半径²均匀 → 中心密度高），
      // directions 作为各轴半径缩放（如 fog1 "1 0.2 0" → x 宽 y 窄；
      // rainperspective "1 0.25 1" → z 深度 ±distMax 用于透视雨）
      const maxD = typeof em.distanceMax === 'number' ? em.distanceMax : Math.hypot(em.distanceMax[0], em.distanceMax[1])
      const ang = Math.random() * Math.PI * 2
      const rr = em.distanceMin + Math.sqrt(Math.random()) * Math.max(0, maxD - em.distanceMin)
      x = Math.cos(ang) * rr * dx
      y = Math.sin(ang) * rr * dy
      // z 深度：±rr × dirs.z（3D 球体深度；perspective rendering 近大远小）
      z = (Math.random() * 2 - 1) * rr * (dz ?? 0)
    }
    // 发射区符号（官方 emitter Sign：0=双向，1=只正，-1=只负；如 sparktrails "0 1 0"）
    if (em.sign !== undefined) {
      if (em.sign[0] === 1) x = Math.abs(x)
      else if (em.sign[0] === -1) x = -Math.abs(x)
      if (em.sign[1] === 1) y = Math.abs(y)
      else if (em.sign[1] === -1) y = -Math.abs(y)
      if (em.sign[2] === 1) z = Math.abs(z)
      else if (em.sign[2] === -1) z = -Math.abs(z)
    }
    // emitter.origin 偏移（局部坐标，如 leaves2 origin="350 750 0" 从树上发射）
    return { x: x + em.origin[0], y: y + em.origin[1], z: z + em.origin[2] }
  }

  /** 在指定位置生成粒子（eventfollow 子系在父粒子位置调用）；z 为发射区深度（perspective） */
  private spawnAt(ini: ParticleSystemDesc['initializers'], x: number, y: number, z: number): Particle | null {
    const life = rand(ini.lifetime ?? [1, 1])
    // size：sizerandom 分布（exponent 幂次 >1 偏向小值）× 视觉缩放
    let size: number
    if (ini.size !== undefined) {
      const [smn, smx] = ini.size
      const exp = ini.sizeExponent ?? 1
      size = (smn + Math.pow(Math.random(), exp) * Math.max(0, smx - smn)) * this.sizeScale
    } else {
      size = 32 * this.sizeScale
    }
    let vx = 0
    let vy = 0
    // 速度来源优先级：velocityRemap（operator）> velocityrandom（initializer）>
    // emitter speedmin/speedmax（发射器球面随机方向速度，如 sparktrails 0..1024 火花四溅）
    if (this.desc.operators.velocityRemap !== undefined) {
      const rm = this.desc.operators.velocityRemap
      vx = rand(rm.min[0], rm.max[0])
      vy = rand(rm.min[1], rm.max[1])
    } else if (ini.velocityMin !== undefined && ini.velocityMax !== undefined) {
      vx = rand(ini.velocityMin[0], ini.velocityMax[0])
      vy = rand(ini.velocityMin[1], ini.velocityMax[1])
    } else if (this.desc.emitter.speedMin !== undefined && this.desc.emitter.speedMax !== undefined) {
      // 官方 emitter speed（particles-emitter "Speed Min/Max"）：粒子以球面随机方向
      // × rand(speedMin, speedMax) 的初始速度出生（2D 场景取 xy 平面方向）
      const speed = rand(this.desc.emitter.speedMin, this.desc.emitter.speedMax)
      const ang = Math.random() * Math.PI * 2
      vx = Math.cos(ang) * speed
      vy = Math.sin(ang) * speed
    }
    if (ini.turbulentVelocity !== undefined) {
      const tv = ini.turbulentVelocity
      // 官方 turbulentvelocityrandom（particles-initializer "Turbulent velocity random"）：
      //   方向 = normalize(forward × offset + noise(phase, time×timescale) × scale)
      //   速度 = 方向 × rand(speedMin, speedMax)
      // scale 控制方向发散度（1=全方向 / 0=沿 forward 直线 / 2=可自我缠绕）；
      // 噪声使相邻相位粒子的方向连续变化 → "一阵阵风"的烟流效果（非纯随机乱蹦）。
      const spd = tv.speedMin !== undefined && tv.speedMax !== undefined
        ? rand(tv.speedMin, tv.speedMax)
        : (tv.speedMin ?? tv.speedMax ?? 100)
      const phase = tv.phaseMin !== undefined && tv.phaseMax !== undefined
        ? rand(tv.phaseMin, tv.phaseMax)
        : Math.random() * 2 - 1
      const ts = tv.timescale ?? 0.1
      const t = this.time * ts
      // 简化值噪声：多频 sin 组合（phase 连续 → 方向连续），范围 ≈ [-1, 1]
      const nx = Math.sin(phase * 1.7 + t * 0.7) * 0.7 + Math.sin(phase * 3.1 + t * 1.3) * 0.3
      const ny = Math.sin(phase * 2.3 + t * 1.1) * 0.7 + Math.sin(phase * 4.9 + t * 0.8) * 0.3
      const nz = Math.sin(phase * 1.3 + t * 0.5) * 0.7 + Math.sin(phase * 3.7 + t * 1.7) * 0.3
      // forward = 屏幕法线 +z（2D 场景）；可见湍流 = scale × noise 的 xy 分量
      let dx = tv.scale * nx
      let dy = tv.scale * ny
      const dz = tv.offset + tv.scale * nz
      const len = Math.hypot(dx, dy, dz)
      if (len > 0.0001) { dx /= len; dy /= len }
      vx += dx * spd
      vy += dy * spd
    }
    const alpha = rand(ini.alphaMin ?? 1, ini.alphaMax ?? 1)
    // 颜色：colorrandom min/max 分量随机（0-255）
    let cr = 255
    let cg = 255
    let cb = 255
    if (ini.colorMin !== undefined && ini.colorMax !== undefined) {
      cr = Math.round(rand(ini.colorMin[0], ini.colorMax[0]))
      cg = Math.round(rand(ini.colorMin[1], ini.colorMax[1]))
      cb = Math.round(rand(ini.colorMin[2], ini.colorMax[2]))
    }
    // 旋转 + 角速度
    const rot = ini.rotation !== undefined ? rand(ini.rotation[0], ini.rotation[1]) : 0
    const angVel = ini.angularVelocity !== undefined ? rand(ini.angularVelocity[0], ini.angularVelocity[1]) : 0
    // overbright（genericparticle g_Overbright）：颜色亮度系数（材质 ui_editor_properties_overbright）
    const ob = this.desc.overbright > 0 ? this.desc.overbright : 1
    cr = Math.min(255, Math.round(cr * ob))
    cg = Math.min(255, Math.round(cg * ob))
    cb = Math.min(255, Math.round(cb * ob))
    // oscillateposition 每粒子独立频率/相位
    const osc = this.desc.operators.oscillatePosition
    const oscFreq = osc !== undefined ? rand(osc.frequencyMin, osc.frequencyMax) : 0
    const oscPhase = Math.random() * Math.PI * 2
    const p: Particle = {
      x,
      y,
      z,
      vx,
      vy,
      life,
      maxLife: Math.max(0.001, life),
      baseSize: size,
      size,
      alpha,
      color: [cr, cg, cb],
      rot,
      angVel,
      frame: Math.floor(Math.random() * 64),
      history: [{ x, y }],
      phase: Math.random() * Math.PI * 2,
      oscPhase,
      oscFreq,
    }
    this.particles.push(p)
    return p
  }
}

function rand(a: number | [number, number], b?: number): number {
  if (Array.isArray(a)) {
    const [mn, mx] = a
    return mn + Math.random() * Math.max(0, mx - mn)
  }
  if (b === undefined) return a
  return a + Math.random() * Math.max(0, b - a)
}
