// 验证最终逻辑：spawnAlpha 基准 + fadeFactor 从 1 重新计算（不累积）
function simAlpha(hasAlpharandom, spawnAlpha, fadeIn, fadeOut) {
  const results = []
  for (let f = 1; f <= 30; f++) {
    const frac = f / 60
    let a = hasAlpharandom ? 1 : spawnAlpha
    let fadeFactor = 1
    if (fadeIn > 0 && frac < fadeIn) fadeFactor = Math.min(fadeFactor, frac / fadeIn)
    if (fadeOut > 0) { const tail = 1 - frac; if (tail < fadeOut) fadeFactor = Math.min(fadeFactor, tail / fadeOut) }
    a *= fadeFactor
    const p_alpha = Math.max(0, Math.min(1, a))
    if (f % 6 === 0) results.push(frac.toFixed(2) + ':' + p_alpha.toFixed(3))
  }
  return results.join(' ')
}
console.log('雪花(无AR,spawn=1,fadeIn=0.1):', simAlpha(false, 1, 0.1, 0))
console.log('smoke2(无AR,spawn=0.02,fadeIn=0.2,fadeOut=0.8):', simAlpha(false, 0.02, 0.2, 0.8))
console.log('fog2(有AR,spawn=0.09,fade空):', simAlpha(true, 0.09, 0, 0))
console.log('smoke2 淡入淡出全寿命:', simAlpha(false, 0.02, 0.2, 0.8))