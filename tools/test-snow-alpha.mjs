// 模拟雪花粒子的 alpha 计算，对比新旧逻辑
function rand(mn, mx) { return mn + Math.random() * (mx - mn) }

// 雪花预设：无 alpharandom，无 instanceoverride.alpha
// spawnAt: alpha = rand(alphaMin ?? 1, alphaMax ?? 1) = rand(1,1) = 1
const alphaMin = undefined
const alphaMax = undefined
const alpha = rand(alphaMin ?? 1, alphaMax ?? 1)
console.log('spawnAt alpha:', alpha)

// updateParticles: alphafade fadeintime=0.1
const fade = { fadeIn: 0.1, fadeOut: 0 }
const frac = 0.5 // 粒子寿命中间段

// 旧逻辑：let a = 1
let a_old = 1
if (fade !== undefined) {
  const fadeIn = fade.fadeIn ?? 0
  const fadeOut = fade.fadeOut ?? 0
  if (fadeIn > 0 && frac < fadeIn) a_old = Math.min(a_old, frac / fadeIn)
  if (fadeOut > 0) {
    const tail = 1 - frac
    if (tail < fadeOut) a_old = Math.min(a_old, tail / fadeOut)
  }
}
console.log('旧逻辑 a:', a_old)

// 新逻辑：let a = p.alpha
let a_new = alpha
if (fade !== undefined) {
  const fadeIn = fade.fadeIn ?? 0
  const fadeOut = fade.fadeOut ?? 0
  if (fadeIn > 0 && frac < fadeIn) a_new *= Math.min(frac / fadeIn, 1)
  if (fadeOut > 0) {
    const tail = 1 - frac
    if (tail < fadeOut) a_new *= Math.min(tail / fadeOut, 1)
  }
}
console.log('新逻辑 a:', a_new)

console.log('相同:', a_old === a_new)