// 检查 Miku 全部动画的 keyframe 变化幅度（pos/rot/scale），确认是否静态
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = fileURLToPath(import.meta.url).replace(/\\/g, '/')
const root = here.slice(0, here.lastIndexOf('/_dev/'))
const { parsePuppetMdl } = await import(pathToFileURL(join(root, 'src/scene/ScenePuppet.ts')).href)

function parsePkg(buf) {
  let pos = 16
  const entries = []
  while (pos + 8 <= buf.length) {
    const nameLen = buf.readInt32LE(pos); pos += 4
    if (nameLen <= 0 || nameLen > 1024 || pos + nameLen + 8 > buf.length) break
    const name = buf.subarray(pos, pos + nameLen).toString('utf8'); pos += nameLen
    const offset = buf.readInt32LE(pos); pos += 4
    const size = buf.readInt32LE(pos); pos += 4
    if (offset < 0 || size < 0 || offset + size > buf.length) break
    entries.push({ name, offset, size })
  }
  const dataStart = pos
  return (n) => { const e = entries.find((x) => x.name === n); if (!e) return null; return buf.subarray(dataStart + e.offset, dataStart + e.offset + e.size) }
}

const read = parsePkg(readFileSync('D:/SteamLibrary/steamapps/workshop/content/431960/3409595232/scene.pkg'))
const pm = parsePuppetMdl(read('models/导出初音_puppet.mdl'))
console.log('动画数: ' + pm.animations.length)
let staticCount = 0
let dynamic = []
for (const a of pm.animations) {
  // 每个 keyframe 8 值：[px py pz][q4][scale]
  let minV = new Array(8).fill(Infinity)
  let maxV = new Array(8).fill(-Infinity)
  for (const k of a.keyframes) {
    for (let i = 0; i < 8; i++) {
      const v = k.values[i] ?? 0
      if (v < minV[i]) minV[i] = v
      if (v > maxV[i]) maxV[i] = v
    }
  }
  const range = maxV.map((m, i) => m - minV[i])
  const maxRange = Math.max(...range)
  if (maxRange < 1e-4) staticCount++
  else dynamic.push({ id: a.id, name: a.name, bones: a.boneCount, frames: a.keyframes.length, maxRange, range: range.map((r) => r.toFixed(4)) })
}
console.log('全静态动画: ' + staticCount + '/' + pm.animations.length)
console.log('非静态动画: ' + dynamic.length)
for (const d of dynamic.slice(0, 40)) {
  console.log('  id=' + d.id + ' ' + d.name + ' bones=' + d.bones + ' frames=' + d.frames + ' maxRange=' + d.maxRange.toFixed(4) + ' range=[' + d.range.join(',') + ']')
}
