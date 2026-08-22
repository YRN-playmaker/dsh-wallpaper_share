/**
 * ParticleRuntime —— 浏览器侧粒子系统运行时（Phase C）。
 *
 * 数据源：SceneModel 的 ParticleSystemDesc（源自 WE particles/*.json 预设）：
 *   emitter（发射器：sphererandom/boxrandom + rate + 方向/距离/origin 偏移）
 *   initializers（寿命/尺寸/速度/颜色/alpha/旋转/角速度 随机范围）
 *   operators（重力 / alpha 淡入淡出 / 湍流 / alpha 振荡 / 尺寸变化）
 *   renderer（sprite / spritetrail —— 本实现以 sprite 近似）
 *
 * 坐标系：WE 粒子为局部 3D 坐标，**y 向上**（velocityrandom y 负值 = 向下落，
 * gravity "0 -10 0" = 向下加速）。绘制时把局部 y 翻转为屏幕 y 向下：
 *   屏幕 y = py0 - p.y * scale * s
 *
 * 诚实边界：多 emitter / children 子粒子 / oscillateposition / 序列帧动画
 * （animationmode=sequence）尚未实现；rate 单位按 /0.1s 推断（×4 折中）。
 */
import type { ParticleSystemDesc } from '../scene/SceneModel.ts'

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

  constructor(private desc: ParticleSystemDesc, private rateScale = 1, private sizeScale = 1) {}

  get count(): number {
    return this.particles.length
  }

  update(dt: number): void {
    this.time += dt
    const em = this.desc.emitter
    const ini = this.desc.initializers
    const ops = this.desc.operators

    // 发射（rate × 视觉缩放）
    this.acc += em.rate * this.rateScale * dt
    while (this.acc >= 1 && this.particles.length < this.desc.maxCount) {
      this.acc -= 1
      this.spawn(em, ini)
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
   */
  draw(ctx: CanvasRenderingContext2D, ox: number, oy: number, s: number, t: { ox: number; oy: number; sx: number; sy: number }, tex: ImageBitmap | HTMLCanvasElement): void {
    const lx = t.sx
    const ly = t.sy
    const px0 = ox + t.ox * s
    const py0 = oy + t.oy * s
    const additive = this.desc.blending === 'additive'
    ctx.save()
    if (additive) ctx.globalCompositeOperation = 'lighter'
    for (const p of this.particles) {
      const x = px0 + p.x * lx * s
      const y = py0 - p.y * ly * s
      const ps = Math.max(2, p.size * lx * s)
      // 保持纹理宽高比（雾/风等非正方形粒子纹理不拉伸变形）
      const aspect = tex.width / tex.height
      const pw = aspect >= 1 ? ps * aspect : ps
      const ph = aspect >= 1 ? ps : ps / aspect
      const img = this.tinted(tex, p.color)
      ctx.globalAlpha = Math.max(0, Math.min(1, p.alpha))
      if (p.rot !== 0) {
        ctx.save()
        ctx.translate(x, y)
        ctx.rotate(p.rot)
        ctx.drawImage(img, -pw / 2, -ph / 2, pw, ph)
        ctx.restore()
      } else {
        ctx.drawImage(img, x - pw / 2, y - ph / 2, pw, ph)
      }
    }
    ctx.restore()
  }

  /** 纹理染色（source-in 保留 alpha），按颜色缓存 */
  private tinted(tex: ImageBitmap | HTMLCanvasElement, color: [number, number, number]): HTMLCanvasElement {
    const key = color[0] + ',' + color[1] + ',' + color[2]
    const hit = this.tintCache.get(key)
    if (hit !== undefined) return hit
    const c = document.createElement('canvas')
    c.width = tex.width
    c.height = tex.height
    const g = c.getContext('2d')
    if (g !== null) {
      g.drawImage(tex, 0, 0)
      g.globalCompositeOperation = 'source-in'
      g.fillStyle = 'rgb(' + color[0] + ',' + color[1] + ',' + color[2] + ')'
      g.fillRect(0, 0, c.width, c.height)
    }
    this.tintCache.set(key, c)
    return c
  }

  private spawn(em: ParticleSystemDesc['emitter'], ini: ParticleSystemDesc['initializers']): void {
    let x = 0
    let y = 0
    const [dx, dy] = em.directions
    if (em.type === 'boxrandom') {
      const d = Array.isArray(em.distanceMax) ? em.distanceMax : [em.distanceMax, em.distanceMax, 0]
      x = (Math.random() * 2 - 1) * d[0] * 0.5
      y = (Math.random() * 2 - 1) * d[1] * 0.5
    } else {
      const maxD = typeof em.distanceMax === 'number' ? em.distanceMax : Math.hypot(em.distanceMax[0], em.distanceMax[1])
      const dist = em.distanceMin + Math.random() * Math.max(0, maxD - em.distanceMin)
      x = (Math.random() * 2 - 1) * dist * dx
      y = (Math.random() * 2 - 1) * dist * dy
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
    if (ini.velocityMin !== undefined && ini.velocityMax !== undefined) {
      vx = rand(ini.velocityMin[0], ini.velocityMax[0])
      vy = rand(ini.velocityMin[1], ini.velocityMax[1])
    }
    if (ini.turbulentVelocity !== undefined) {
      const tv = ini.turbulentVelocity
      vx += (Math.random() * 2 - 1) * Math.abs(tv.scale) * 100
      vy += (Math.random() * 2 - 1) * Math.abs(tv.scale) * 100
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
