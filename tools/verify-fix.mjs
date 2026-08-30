// 验证修正后逻辑（Math.min 钳制，不累积乘法）
function simAlpha(hasAlpharandom, p_alpha_initial, fadeIn, fadeOut) {
  let p_alpha = p_alpha_initial
  // 模拟 60 帧，frac 从 0 到 0.5
  const results = []
  for (let f = 1; f <= 30; f++) {
    const frac = f / 60
    let a = hasAlpharandom ? 1 : p_alpha
    if (fadeIn > 0 && frac < fadeIn) a = Math.min(a, frac / fadeIn)
    if (fadeOut > 0) { const tail = 1 - frac; if (tail < fadeOut) a = Math.min(a, tail / fadeOut) }
    p_alpha = Math.max(0, Math.min(1, a))
    if (f % 6 === 0) results.push(frac.toFixed(2) + ':' + p_alpha.toFixed(3))
  }
  return results.join(' ')
}
console.log('雪花(无AR,p.alpha=1,fadeIn=0.1):', simAlpha(false, 1, 0.1, 0))
console.log('smoke2(无AR,p.alpha=0.02,fadeIn=0.2,fadeOut=0.8):', simAlpha(false, 0.02, 0.2, 0.8))
console.log('fog2(有AR,p.alpha=0.09,fade空):', simAlpha(true, 0.09, 0, 0))