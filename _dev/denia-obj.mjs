// 转储指定图层的原始 JSON（达妮娅眨眼效果调查）
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const OUT = resolve(import.meta.dirname, 'denia-out')
const scene = JSON.parse(readFileSync(resolve(OUT, 'scene.json'), 'utf8'))
const objs = scene.objects
const want = process.argv[2] !== undefined ? process.argv[2].split(',').map(Number) : [10, 15, 16]
const L = []
for (const i of want) {
  L.push(`===== objects[${i}] =====`)
  L.push(JSON.stringify(objs[i], null, 1))
  L.push('')
}
writeFileSync(resolve(OUT, 'obj-raw.txt'), L.join('\n'), 'utf8')
console.log('obj-raw.txt written for ' + want.join(','))
