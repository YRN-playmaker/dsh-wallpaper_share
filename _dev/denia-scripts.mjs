// scene.json 脚本段调查：是否有脚本控制眨眼效果的启用/参数
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const OUT = resolve(import.meta.dirname, 'denia-out')
const s = readFileSync(resolve(OUT, 'scene.json.txt'), 'utf8')
const L = []
const re = /"script"/g
const idxs = []
let m
while ((m = re.exec(s)) !== null) idxs.push(m.index)
L.push(`script occurrences: ${idxs.length} / scene.json ${s.length} chars`)
const uniq = new Set()
for (const i of idxs) {
  const frag = s.slice(i, i + 200).replace(/\s+/g, ' ')
  if (!uniq.has(frag.slice(0, 80))) {
    uniq.add(frag.slice(0, 80))
    L.push('--- ' + i + ' --- ' + frag)
  }
}
// 顶层 scripts 数组
const top = s.match(/"scripts"[\s\S]{0,3000}/)
if (top !== null) {
  L.push('=== top-level scripts ===')
  L.push(top[0].slice(0, 3000))
}
// 是否有引用眨眼效果 id 430 的脚本
for (const key of ['430', 'eye', 'blink']) {
  const ii = s.indexOf(key)
  L.push(`first "${key}" at ${ii}: ` + (ii >= 0 ? s.slice(Math.max(0, ii - 150), ii + 150).replace(/\s+/g, ' ') : ''))
}
writeFileSync(resolve(OUT, 'scripts.txt'), L.join('\n'), 'utf8')
console.log('scripts.txt written')
