// 列出 scene.json 图层概要 + animationlayers 原始结构（达妮娅）
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const OUT = resolve(import.meta.dirname, 'denia-out')
const scene = JSON.parse(readFileSync(resolve(OUT, 'scene.json'), 'utf8'))
const objs = scene.objects ?? []
const L = []
L.push(`scene objects=${objs.length}`)
L.push('')
const keys = new Set()
for (const o of objs) for (const k of Object.keys(o)) keys.add(k)
L.push('union keys: ' + [...keys].sort().join(', '))
L.push('')
L.push('=== 图层列表 ===')
objs.forEach((o, i) => {
  const anim = (o.animationlayers ?? []).map((a) => `${a.name ?? '?'}#${a.animation ?? '-'}(b=${a.blend ?? '-'},r=${a.rate ?? '-'},add=${a.additive ?? '-'},vis=${a.visible ?? '-'})`).join(' | ')
  L.push(`#${i} id=${o.id} name=${JSON.stringify(o.name)} image=${JSON.stringify(o.image ?? null)} parent=${o.parent ?? '-'} alpha=${o.alpha ?? '-'} visible=${o.visible ?? '-'} origin=${JSON.stringify(o.origin ?? null)} scale=${JSON.stringify(o.scale ?? null)} angles=${JSON.stringify(o.angles ?? null)} size=${JSON.stringify(o.size ?? null)}`)
  if (anim !== '') L.push(`     animationlayers: ${anim}`)
  const eff = (o.effects ?? []).map((e) => e.name ?? e.type ?? JSON.stringify(e)).join(',')
  if (eff !== '') L.push(`     effects: ${eff}`)
  if (o.attachment !== undefined) L.push(`     attachment: ${JSON.stringify(o.attachment)}`)
})
L.push('')
L.push('=== 含 animationlayers 的对象原始 JSON ===')
objs.forEach((o, i) => {
  if ((o.animationlayers ?? []).length > 0) L.push(`#${i} ${JSON.stringify(o.animationlayers)}`)
})
L.push('')
L.push('=== scene 顶层非 objects 字段 ===')
for (const k of Object.keys(scene)) if (k !== 'objects') L.push(`${k} = ${JSON.stringify(scene[k]).slice(0, 400)}`)
writeFileSync(resolve(OUT, 'layers.txt'), L.join('\n'), 'utf8')
console.log('layers.txt written, objects=' + objs.length)
