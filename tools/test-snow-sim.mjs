// 完整模拟雪花粒子：spawnAt + update + collectGl 输出
function rand(a, b) { return a + Math.random() * (b - a) }
function randV3(mn, mx) { return [rand(mn[0], mx[0]), rand(mn[1], mx[1]), rand(mn[2], mx[2])] }

// 雪花预设 snowperspective
const preset = {
  emitter: { type: 'boxrandom', rate: 10, distanceMax: [2000, 1000, 0], distanceMin: 0, origin: [0,0,0] },
  initializers: {
    lifetime: [8, 20],
    size: [2, 30],
    sizeExponent: 1,
    velocityMin: [-10, -50, 0],
    velocityMax: [-37, -90, 0],
    colorMin: [255,255,255],
    colorMax: [95,98,100],
  },
  operators: {
    fade: { fadeIn: 0.1, fadeOut: 0 },
    oscillatePosition: { frequencyMin: 0.8, frequencyMax: 1, scaleMin: 20, scaleMax: 35, mask: [1, 0.5, 0] },
  },
  maxCount: 360,
  blending: 'additive',
  sizeScale: 1,
}

// spawnAt 模拟
function spawnAt(ini) {
  const life = rand(ini.lifetime[0], ini.lifetime[1])
  const size = (ini.size[0] + Math.pow(Math.random(), 1) * (ini.size[1] - ini.size[0])) * 1
  let vx = rand(ini.velocityMin[0], ini.velocityMax[0])
  let vy = rand(ini.velocityMin[1], ini.velocityMax[1])
  const alpha = rand(1, 1) // 无 alpharandom
  // boxrandom 发射区
  const dx = 1, dy = 1
  const x = (Math.random() * 2 - 1) * 2000 * dx
  const y = (Math.random() * 2 - 1) * 1000 * dy
  return { x, y, z: 0, vx, vy, life, maxLife: Math.max(0.001, life), size, baseSize: size, alpha, color: [255,255,255], rot: 0, angVel: 0, phase: Math.random() * 6.28 }
}

// update 模拟（核心 alpha）
function updateAlpha(p, frac, fade) {
  let a = p.alpha
  if (fade !== undefined) {
    const fadeIn = fade.fadeIn ?? 0
    const fadeOut = fade.fadeOut ?? 0
    if (fadeIn > 0 && frac < fadeIn) a *= Math.min(frac / fadeIn, 1)
    if (fadeOut > 0) {
      const tail = 1 - frac
      if (tail < fadeOut) a *= Math.min(tail / fadeOut, 1)
    }
  }
  return Math.max(0, Math.min(1, a))
}

const p = spawnAt(preset.initializers)
const alphaMid = updateAlpha(p, 0.5, preset.operators.fade)
const alphaEarly = updateAlpha(p, 0.05, preset.operators.fade)
console.log('雪花粒子 spawn:', JSON.stringify({ x: p.x.toFixed(1), y: p.y.toFixed(1), vx: p.vx.toFixed(1), vy: p.vy.toFixed(1), size: p.size.toFixed(1), alpha: p.alpha }))
console.log('寿命中期 alpha:', alphaMid)
console.log('寿命早期(5%) alpha:', alphaEarly)
console.log('位置在场景内:', Math.abs(p.x) <= 2000 && Math.abs(p.y) <= 1000)