// 用 sourcemap 弄清 lib/client.js 里那段旧脚手架代码来自哪个源文件
import { readFileSync } from 'node:fs'

const map = JSON.parse(readFileSync('lib/client.js.map', 'utf8'))
console.log('sources count=' + map.sources.length)
const idx = map.sources.findIndex((s) => /SceneModelRenderer/.test(s))
console.log('SceneModelRenderer source index=' + idx + ' name=' + map.sources[idx])
// sourcesContent 里是否含旧脚手架
if (Array.isArray(map.sourcesContent)) {
  map.sourcesContent.forEach((c, i) => {
    if (typeof c !== 'string') return
    const marks = []
    if (c.includes('10px system-ui')) marks.push('label-font')
    if (c.includes('rgba(120, 170, 255')) marks.push('placeholder-dot')
    if (c.includes('loadEffectTextures')) marks.push('NEW-mask-loading')
    if (c.includes('u_FlowYFromAlpha')) marks.push('NEW-flow-alpha')
    if (marks.length > 0) console.log('  [' + i + '] ' + map.sources[i] + '  ' + marks.join(','))
  })
} else {
  console.log('no sourcesContent in map')
}
// 磁盘上的源文件 vs map 里的源内容
const disk = readFileSync('src/client/SceneModelRenderer.ts', 'utf8')
const fromMap = map.sourcesContent?.[idx]
if (typeof fromMap === 'string') {
  console.log('map source length=' + fromMap.length + ' disk length=' + disk.length + ' identical=' + (fromMap === disk))
  console.log('map source has label code: ' + fromMap.includes('10px system-ui'))
  console.log('disk source has label code: ' + disk.includes('10px system-ui'))
}
