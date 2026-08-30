// 验证 served-client.js 中的 alpha 逻辑在两种 desc 下的输出
// 逻辑: let a = this.desc.hasAlpharandom ? 1 : p.alpha
function alphaOf(hasAlpharandom, p_alpha, frac, fadeIn, fadeOut) {
  let a = hasAlpharandom ? 1 : p_alpha
  if (fadeIn > 0 && frac < fadeIn) a *= Math.min(frac / fadeIn, 1)
  if (fadeOut > 0) {
    const tail = 1 - frac
    if (tail < fadeOut) a *= Math.min(tail / fadeOut, 1)
  }
  return Math.max(0, Math.min(1, a))
}
// 雪景远景: hasAlpharandom=false, p.alpha=1(无alpharandom/无override alpha), 无fade(fadeIn=0)
console.log('雪景远景(hasAR=false,p.alpha=1):', alphaOf(false, 1, 0.5, 0, 0), '(期望 1 可见)')
// 雾2: hasAlpharandom=true, p.alpha=0.09, fade空
console.log('雾2(hasAR=true,p.alpha=0.09):', alphaOf(true, 0.09, 0.5, 0, 0), '(期望 1 可见)')
// smoke2: hasAlpharandom=false, p.alpha=0.02, fade 0.2/0.8
console.log('smoke2(hasAR=false,p.alpha=0.02):', alphaOf(false, 0.02, 0.5, 0.2, 0.8), '(期望 0.02 淡)')