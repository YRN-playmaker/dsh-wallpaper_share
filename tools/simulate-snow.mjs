// 用服务端返回的真实雪花 desc 模拟粒子生命周期
// 数据来自 /we-sync/scene/model 响应（3409595232 雪景远景层）
const desc = {
  particleRef: 'particles/presets/snowperspective.json',
  blending: 'additive',
  textureNames: ['particle/chromaticdot'],
  maxCount: 360,
  hasAlpharandom: false,
  startTime: 15,
  worldSpace: false,
  perspective: false,
  emitter: { type: 'boxrandom', rate: 16.92, instantaneous: 0, directions: [1,1,0], distanceMin: 0, distanceMax: [2000,1000,0], origin: [0,0,0] },
  initializers: {
    lifetime: [8, 20],
    size: [2, 30],
    sizeExponent: 1,
    velocityMin: [-10,-50,0],
    velocityMax: [-37,-90,0],
    colorMin: [255,255,255],
    colorMax: [95,98,100],
  },
  operators: {
    alphaFade: { fadeIn: 0.1, fadeOut: 0 },
    oscillatePosition: { frequencyMin: 0.8, frequencyMax: 1, scaleMin: 20, scaleMax: 35, mask: [1,0.5,0] },
  },
  renderer: { type: 'sprite' },
}

function rand(a, b) { return a + Math.random() * (b - a) }
function randV3(mn, mx) { return [rand(mn[0],mx[0]), rand(mn[1],mx[1]), rand(mn[2],mx[2])] }

// --- spawnAt 模拟（对齐 ParticleRuntime.spawnAt） ---
function spawn(em, ini) {
  const life = rand(ini.lifetime[0], ini.lifetime[1])
  let size = 32
  if (ini.size !== undefined) {
    const [smn, smx] = ini.size
    size = (smn + Math.pow(Math.random(), 1) * Math.max(0, smx - smn))
  }
  let vx = 0, vy = 0
  if (ini.velocityMin !== undefined && ini.velocityMax !== undefined) {
    vx = rand(ini.velocityMin[0], ini.velocityMax[0])
    vy = rand(ini.velocityMin[1], ini.velocityMax[1])
  }
  const alpha = rand(ini.alphaMin ?? 1, ini.alphaMax ?? 1) // 雪花: 1
  // boxrandom 发射区
  const dx = 1, dy = 1
  const x = (Math.random() * 2 - 1) * em.distanceMax[0] * dx
  const y = (Math.random() * 2 - 1) * em.distanceMax[1] * dy
  const z = (Math.random() * 2 - 1) * em.distanceMax[2]
  const cmin = ini.colorMin ?? [255,255,255]
  const cmax = ini.colorMax ?? cmin
  return { x, y, z, vx, vy, life, maxLife: Math.max(0.001, life), size, baseSize: size, alpha, color: randV3(cmin, cmax), rot: 0, phase: Math.random() * 6.28 }
}

// --- updateParticles 模拟（alpha 逻辑 + 寿命） ---
function updateParticle(p, dt, ops) {
  p.life -= dt
  if (p.life <= 0) return false
  const frac = 1 - p.life / p.maxLife
  // alpha
  let a = desc.hasAlpharandom ? 1 : p.alpha
  const fade = ops.alphaFade
  if (fade !== undefined) {
    const fadeIn = fade.fadeIn ?? 0
    const fadeOut = fade.fadeOut ?? 0
    if (fadeIn > 0 && frac < fadeIn) a *= Math.min(frac / fadeIn, 1)
    if (fadeOut > 0) { const tail = 1 - frac; if (tail < fadeOut) a *= Math.min(tail / fadeOut, 1) }
  }
  p.alpha = Math.max(0, Math.min(1, a))
  return true
}

// --- 主流程 ---
const particles = []
let acc = 0
let time = 0
// preSimulate 15s
const step = 1/30
while (time < desc.startTime) {
  const dt = Math.min(step, desc.startTime - time)
  time += dt
  acc += desc.emitter.rate * dt
  while (acc >= 1 && particles.length < desc.maxCount) { acc -= 1; particles.push(spawn(desc.emitter, desc.initializers)) }
  for (let i = particles.length - 1; i >= 0; i--) if (!updateParticle(particles[i], dt, desc.operators)) particles.splice(i, 1)
}
console.log('preSimulate 后粒子数:', particles.length)
// 模拟 30 秒实时
for (let f = 0; f < 30 * 60; f++) {
  const dt = 1/60
  time += dt
  acc += desc.emitter.rate * dt
  while (acc >= 1 && particles.length < desc.maxCount) { acc -= 1; particles.push(spawn(desc.emitter, desc.initializers)) }
  for (let i = particles.length - 1; i >= 0; i--) if (!updateParticle(particles[i], dt, desc.operators)) particles.splice(i, 1)
}
console.log('30s 后粒子数:', particles.length)
const alphas = particles.map(p => p.alpha)
console.log('alpha 范围:', Math.min(...alphas).toFixed(3), '-', Math.max(...alphas).toFixed(3))
const visible = particles.filter(p => p.alpha > 0.01).length
console.log('alpha>0.01 的粒子:', visible, '/', particles.length)
// 位置是否在场景内
const inScene = particles.filter(p => Math.abs(p.x) <= 2000 && Math.abs(p.y) <= 1000).length
console.log('场景内粒子:', inScene, '/', particles.length)