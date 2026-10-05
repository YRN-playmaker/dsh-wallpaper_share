// 定位 warnedNoTexture 字段声明/使用，以及 lib/client.js（用户实际运行的构建）里的情况
import { readFileSync } from 'node:fs'

const src = readFileSync('src/client/SceneModelRenderer.ts', 'utf8')
const lines = src.split(/\r?\n/)
console.log('=== 源码里所有 warnedNoTexture 出现 ===')
lines.forEach((l, i) => { if (l.includes('warnedNoTexture')) console.log('  ' + (i + 1) + ': ' + l.trim()) })
console.log('=== 源码里 class 字段声明（warned*） ===')
lines.forEach((l, i) => { if (/private\s+warned/.test(l)) console.log('  ' + (i + 1) + ': ' + l.trim()) })
for (const f of ['lib/client.js', 'lib/client.js.map', 'tools/served-client.js']) {
  const s = readFileSync(f, 'utf8')
  console.log('=== ' + f + ' ===')
  console.log('  warnedNoTexture 出现次数: ' + (s.match(/warnedNoTexture/g) ?? []).length)
  console.log('  含 10px system-ui（旧调试标注）: ' + s.includes('10px system-ui'))
}
