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
  /** 子粒子系统（children：如 rain_screen 的 static/fast 子雨滴） */
  private children: ParticleRuntime[] = []

  constructor(private desc: ParticleSystemDesc, private rateScale = 1, private sizeScale = 1) {
    this.rendererType = desc.renderer?.type ?? 'sprite'
    this.trailLength = desc.renderer?.length ?? 0
    this.trailMaxLength = desc.renderer?.maxlength ?? 0
    this.trailMinLength = desc.renderer?.minlength ?? 0
    for (const c of desc.children) {
      this.children.push(new ParticleRuntime(c, rateScale, sizeScale))
    }
  }

  /** SceneModelRenderer 加载纹理后注入（含 spritesheet 帧元数据） */
  setTexture(tex: ImageBitmap | HTMLCanvasElement, frames = 0, fw = 0, fh = 0): void {
    this.texture = tex
    this.frames = frames
    this.fw = fw
    this.fh = fh
  }

  /** 递归收集自身及所有子 runtime（供 SceneModelRenderer 逐层加载纹理） */
  collect(): Array<{ rt: ParticleRuntime; texName: string }> {
    const out: Array<{ rt: ParticleRuntime; texName: string }> = []
    const walk = (rt: ParticleRuntime): void => {
      if (rt.desc.textureNames.length > 0) out.push({ rt, texName: rt.desc.textureNames[0] })
      for (const c of rt.children) walk(c)
    }
    walk(this)
    return out
  }

  /** 纹理是否已就绪（自身或任一子 runtime）——用于区分"无粒子"与"纹理未加载" */
  get textureReady(): boolean {
    if (this.texture !== null) return true
    for (const c of this.children) if (c.textureReady) return true
    return false
  }

  /** 释放纹理（ImageBitmap.close）并递归子 runtime */
  dispose(): void {
    if (this.texture !== null && 'close' in this.texture) {
      try { (this.texture as ImageBitmap).close() } catch { /* 忽略 */ }
    }
    this.texture = null
    for (const c of this.children) c.dispose()
  }

  /** 是否存在 rope/ropetrail 线渲染器（需 Canvas 绘制，不能走 WebGL 实例化） */
  hasLineRenderer(): boolean {
    if (this.rendererType === 'rope' || this.rendererType === 'ropetrail') return true
    return this.children.some((c) => c.hasLineRenderer())
  }

  /**
   * 收集 sprite/spritetrail 粒子为 WebGL 实例化批次（每个 runtime 一个批次，
   * 含纹理/帧/混合/折射信息；rope/ropetrail 由调用方走 Canvas）。
   * 变换与 Canvas draw 一致：屏幕 x = px0 + p.x·lx·s，y = py0 − p.y·ly·s，
   * 尺寸不乘对象 scale；spritetrail 沿速度方向拉伸。
   */
  collectGl(lx: number, ly: number, px0: number, py0: number, s: number): Array<{
    particles: GlParticle[]
    tex: ImageBitmap | HTMLCanvasElement
    frames: number
    fw: number
    fh: number
    additive: boolean
    refract: boolean
  }> {
    const out: Array<{
      particles: GlParticle[]
      tex: ImageBitmap | HTMLCanvasElement
      frames: number
      fw: number
      fh: number
      additive: boolean
      refract: boolean
    }> = []
    const walk = (rt: ParticleRuntime): void => {
      if (rt.texture !== null && rt.rendererType !== 'rope' && rt.rendererType !== 'ropetrail') {
        const tex = rt.texture
        const frames = rt.frames
        const fw = rt.fw
        const fh = rt.fh
        const sprite = frames > 1 && fw > 0 && fh > 0
        const aspectTex = sprite ? fw / fh : tex.width / tex.height
        const list: GlParticle[] = []
        for (const p of rt.particles) {
          const x = px0 + p.x * lx * s
          const y = py0 - p.y * ly * s
          const ph = Math.max(2, p.size * s)
          const pw = ph * aspectTex
          let size = ph
          let aspect = aspectTex
          let rot = p.rot
          let alpha = p.alpha
          let gx = x
          let gy = y
          if (rt.rendererType === 'spritetrail') {
            // 官方 spritetrail（common_particles.h ComputeParticleTrailTangents）：
            //   stretch   = max(minLength, min(speed × length, maxLength))   // 场景 px
            //   拖尾长度  = particleSize × textureRatio × stretch            // 场景 px
            //   拖尾宽度  = particleSize；quad 居中于粒子，沿 normalize(velocity) 指向
            // 旧实现把 length 当"秒"，忽略纹理宽高比 → 12px 水珠；这里改成官方公式。
            const spd = Math.hypot(p.vx, p.vy)
            const maxL = rt.trailMaxLength > 0 ? rt.trailMaxLength : Infinity
            const minL = rt.trailMinLength > 0 ? rt.trailMinLength : 0
            const stretch = Math.max(minL, Math.min(spd * rt.trailLength, maxL))
            // 纹理宽高比 = 高/宽（genericparticle 用 g_Texture0Resolution.y/x）；单帧用 fh/fw
            const texRatio = sprite ? (fh > 0 ? fh / fw : 1) : (tex.height > 0 ? tex.height / tex.width : 1)
            const streakLen = ph * texRatio * stretch
            if (spd > 2 && streakLen > 2) {
              size = ph
              aspect = streakLen / ph
              rot = Math.atan2(-p.vy, p.vx)
              // 头在当前位置，尾沿反方向（过去位置）延伸 —— 偏移中心让头落在粒子处
              const dirx = spd > 0 ? p.vx / spd : 0
              const diry = spd > 0 ? -p.vy / spd : 0
              gx = x - 0.5 * streakLen * dirx
              gy = y - 0.5 * streakLen * diry
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
            frames,
            fw,
            fh,
            additive: rt.desc.blending === 'additive',
            refract: rt.desc.refract && rt.rendererType === 'sprite',
          })
        }
      }
      for (const c of rt.children) walk(c)
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

    // starttime：粒子系统延迟启动（如 magic_sparkle=15、Rain2=10）。未到时间只更新
    // 既有粒子（初始为空）与子 runtime，不发射。
    if (this.time >= this.desc.startTime) {
      // 发射（rate × 视觉缩放）
      this.acc += em.rate * this.rateScale * dt
      while (this.acc >= 1 && this.particles.length < this.desc.maxCount) {
        this.acc -= 1
        this.spawn(em, ini)
      }
    }

    // 更新
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
    for (const c of this.children) c.update(dt)
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
    for (const c of this.children) c.draw(ctx, ox, oy, s, t, bg)
  }

  /** 该粒子系统（含子粒子）是否使用折射材质 */
  hasRefract(): boolean {
    return this.desc.refract || this.children.some((c) => c.hasRefract())
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
    // ropetrail 渲染器（官方："draws a line along the path of each particle"）：
    // 沿每个粒子的位置历史画线（如流星/拖尾光带）。粒子本身不画 sprite。
    if (this.rendererType === 'ropetrail') {
      ctx.lineCap = 'round'
      for (const p of this.particles) {
        if (p.history.length < 2) continue
        ctx.strokeStyle = 'rgb(' + p.color[0] + ',' + p.color[1] + ',' + p.color[2] + ')'
        ctx.globalAlpha = Math.max(0, Math.min(1, p.alpha))
        ctx.lineWidth = Math.max(1, p.size * s)
        ctx.beginPath()
        for (let hi = 0; hi < p.history.length; hi++) {
          const hx = px0 + p.history[hi].x * lx * s
          const hy = py0 - p.history[hi].y * ly * s
          if (hi === 0) ctx.moveTo(hx, hy)
          else ctx.lineTo(hx, hy)
        }
        ctx.stroke()
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
      const x = px0 + p.x * lx * s
      const y = py0 - p.y * ly * s
      // 官方 CParticle：quad 渲染尺寸 = sizerandom × instanceOverride.size（size 属性
      // ×2 后），**不乘对象 scale**——对象 scale 只进 model matrix（发射区/位置）。
      // 纹理宽高比由 aspect 处理（shader 的 textureRatio = h/w 等效）。
      const pwBase = Math.max(2, p.size * s)
      const phBase = Math.max(2, p.size * s)
      // 帧区域宽高比（单帧内）；非序列帧用整张纹理宽高比（雾/风等非正方形纹理不拉伸变形）
      const fwPx = sprite ? fw : tex.width
      const fhPx = sprite ? fh : tex.height
      const aspect = fwPx / fhPx
      const pw = pwBase * aspect
      const ph = phBase
      const img = this.tinted(tex, p.color)
      ctx.globalAlpha = Math.max(0, Math.min(1, p.alpha))
      // REFRACT 折射：sprite 粒子（静态水珠/雨滴）用背景采样 + alpha 裁剪；
      // spritetrail（快速下落雨丝）保持拉伸，仅半透明近似（拉伸+折射组合暂不实现）。
      if (this.desc.refract && bg !== null && this.rendererType === 'sprite') {
        ctx.save()
        // 折射偏移：官方 refract_amount（负值）+ 法线；此处用径向凸透镜近似——
        // 偏移量与雨滴尺寸成正比（后续可接法线纹理逐块偏移）
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
      // spritetrail 渲染器（官方 common_particles.h）：
      //   stretch = max(minLength, min(speed × length, maxLength))
      //   拖尾长度 = particleSize × textureRatio × stretch；宽度 = particleSize
      // 沿运动方向拉成长丝，尾在反方向（过去位置），头在当前位置。
      const spd = Math.hypot(p.vx, p.vy)
      const maxL = this.trailMaxLength > 0 ? this.trailMaxLength : Infinity
      const minL = this.trailMinLength > 0 ? this.trailMinLength : 0
      const stretch = Math.max(minL, Math.min(spd * this.trailLength, maxL))
      const texRatio = sprite ? (fh > 0 ? fh / fw : 1) : (tex.height > 0 ? tex.height / tex.width : 1)
      const streakLen = ph * texRatio * stretch
      const stretched = this.rendererType === 'spritetrail' && spd > 2 && streakLen > 2
      if (stretched) {
        const len = Math.max(pw, streakLen)
        const wid = ph
        const ang = Math.atan2(-p.vy, p.vx)
        const dirx = spd > 0 ? p.vx / spd : 0
        const diry = spd > 0 ? -p.vy / spd : 0
        ctx.save()
        ctx.translate(x - 0.5 * len * dirx, y - 0.5 * len * diry)
        ctx.rotate(ang)
        if (sprite) {
          const frac = 1 - p.life / p.maxLife
          const frame = this.pickFrame(p, frac, frames)
          const col = frame % cols
          const row = Math.floor(frame / cols)
          ctx.drawImage(img, col * fw, row * fh, fw, fh, -len / 2, -wid / 2, len, wid)
        } else {
          ctx.drawImage(img, -len / 2, -wid / 2, len, wid)
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
  /** 帧选择：randomframe 出生随机帧后固定（静态水珠/雨滴）；否则按粒子年龄推进动画 */
  private pickFrame(p: Particle, frac: number, frames: number): number {
    if (this.desc.animationMode === 'randomframe') return p.frame % frames
    return (p.frame + Math.floor(frac * frames)) % frames
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

  private spawn(em: ParticleSystemDesc['emitter'], ini: ParticleSystemDesc['initializers']): void {
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
      const [dx, dy] = em.directions
      if (em.type === 'boxrandom') {
        const d = Array.isArray(em.distanceMax) ? em.distanceMax : [em.distanceMax, em.distanceMax, 0]
        x = (Math.random() * 2 - 1) * d[0] * 0.5
        y = (Math.random() * 2 - 1) * d[1] * 0.5
      } else {
        // sphererandom：椭圆体内体积均匀（半径²均匀 → 中心密度高），
        // directions 作为各轴半径缩放（如 fog1 "1 0.2 0" → x 宽 y 窄）
        const maxD = typeof em.distanceMax === 'number' ? em.distanceMax : Math.hypot(em.distanceMax[0], em.distanceMax[1])
        const ang = Math.random() * Math.PI * 2
        const rr = em.distanceMin + Math.sqrt(Math.random()) * Math.max(0, maxD - em.distanceMin)
        x = Math.cos(ang) * rr * dx
        y = Math.sin(ang) * rr * dy
      }
    }
    // emitter.origin 偏移（局部坐标，如 leaves2 origin="350 750 0" 从树上发射）
    x += em.origin[0]
    y += em.origin[1]
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
    // remapvalue(output=velocity)：速度重映射（rain_screen_fast 的下落速度噪声，
    // 范围如 -1200..-200）。优先级高于 velocityrandom。
    if (this.desc.operators.velocityRemap !== undefined) {
      const rm = this.desc.operators.velocityRemap
      vx = rand(rm.min[0], rm.max[0])
      vy = rand(rm.min[1], rm.max[1])
    } else if (ini.velocityMin !== undefined && ini.velocityMax !== undefined) {
      vx = rand(ini.velocityMin[0], ini.velocityMax[0])
      vy = rand(ini.velocityMin[1], ini.velocityMax[1])
    }
    if (ini.turbulentVelocity !== undefined) {
      const tv = ini.turbulentVelocity
      // WE 语义：随机方向湍流速度 ≈ scale × 1000（场景像素尺度）；
      // 旧实现 ×100 让 ember/smoke 几乎静止，拖尾渲染不出来
      vx += (Math.random() * 2 - 1) * Math.abs(tv.scale) * 1000
      vy += (Math.random() * 2 - 1) * Math.abs(tv.scale) * 1000
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
    this.particles.push({
      x,
      y,
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
    })
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
