// 检查构建产物与源码是否一致：lib/client.js / tools/served-client.js 里有哪些标记
import { readFileSync, statSync } from 'node:fs'

const files = ['lib/client.js', 'tools/served-client.js', 'lib/index.js', '_dev/harness/dist/SceneModelRenderer.mjs']
const markers = [
  'u_FlowYFromAlpha', 'shakeOffset', 'class ShakeGL', 'applyShake2D', 'loadEffectTextures',
  'flowYFromAlpha', '10px system-ui, sans-serif', 'const label = "#" + layer.id',
  'rgba(120, 170, 255, 0.5)', 'fd[0] * dw',
]
for (const f of files) {
  let s
  try { s = readFileSync(f, 'utf8') } catch { console.log(f + ': MISSING'); continue }
  const st = statSync(f)
  console.log('=== ' + f + '  ' + (s.length / 1024).toFixed(1) + 'KB  mtime=' + st.mtime.toISOString() + ' ===')
  for (const m of markers) console.log('   ' + (s.includes(m) ? 'YES' : ' no') + '  ' + m)
}
// 源码里是否还有旧脚手架
const src = readFileSync('src/client/SceneModelRenderer.ts', 'utf8')
console.log('=== src/client/SceneModelRenderer.ts ===')
for (const m of ['10px system-ui', 'const label = ', 'rgba(120, 170, 255, 0.5)', 'loadEffectTextures', 'shakeOffset']) {
  console.log('   ' + (src.includes(m) ? 'YES' : ' no') + '  ' + m)
}
