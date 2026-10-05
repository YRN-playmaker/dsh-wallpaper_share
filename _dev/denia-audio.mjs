// "audioresponse" 在 scene.json 里的绑定上下文 + 各效果 pass 的 combos 一览
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const OUT = resolve(import.meta.dirname, 'denia-out')
const s = readFileSync(resolve(OUT, 'scene.json.txt'), 'utf8')
const L = []
const i = s.indexOf('audioresponse')
L.push('=== audioresponse context ===')
L.push(s.slice(Math.max(0, i - 900), i + 500).replace(/\s+/g, ' '))
L.push('')
L.push('=== 所有 combos 出现处 ===')
const re = /"combos"[\s\S]{0,200}?\}/g
let m
while ((m = re.exec(s)) !== null) L.push(m[0].replace(/\s+/g, ' '))
writeFileSync(resolve(OUT, 'audio-bind.txt'), L.join('\n'), 'utf8')
console.log('audio-bind.txt written')
