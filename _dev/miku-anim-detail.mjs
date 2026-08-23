// 检查 Miku 动画 keyframe 实际 values + scene.json 全部图层（查重复 image/puppet）
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
for (const a of pm.animations) {
  console.log('=== 动画 id=' + a.id + ' name=[' + a.name + '] bones=' + a.boneCount + ' duration=' + a.duration + ' keyframes=' + a.keyframes.length)
  if (a.keyframes.length > 0) {
    const ts = a.keyframes.map((k) => k.t)
    console.log('  t: [' + Math.min(...ts) + ', ' + Math.max(...ts) + '] period=' + (Math.max(...ts) - Math.min(...ts)))
    const show = (label, k) => console.log('  ' + label + ' t=' + k.t + ' [' + k.values.map((v) => v.toFixed(4)).join(', ') + ']')
    show('首帧', a.keyframes[0])
    show('中帧', a.keyframes[Math.floor(a.keyframes.length / 2)])
    show('末帧', a.keyframes[a.keyframes.length - 1])
    // 变化大的分量索引
    let minV = new Array(8).fill(Infinity)
    let maxV = new Array(8).fill(-Infinity)
    for (const k of a.keyframes) for (let i = 0; i < 8; i++) {
      const v = k.values[i] ?? 0
      if (v < minV[i]) minV[i] = v
      if (v > maxV[i]) maxV[i] = v
    }
    console.log('  每分量范围: ' + maxV.map((m, i) => 'v' + i + '[' + minV[i].toFixed(2) + ',' + m.toFixed(2) + ']').join(' '))
  }
}
console.log()
console.log('--- scene.json 图层（含 image/puppet 引用）---')
const scene = Buffer.from(read('scene.json')).toString('utf8')
// 提取每个图层块的关键字段
const layerRe = /\{\s*"castshadow"[\s\S]*?(?=\n\t\t\},\n\t\t\{|\n\t\t\},\n\t\])/g
let idx = 0
let count = 0
while (true) {
  const s = scene.indexOf('"image"', idx)
  if (s < 0) break
  // 找该 image 所属图层块的 name
  const before = scene.slice(Math.max(0, s - 600), s)
  const nameM = /"name"\s*:\s*"([^"]+)"/.exec(before)
  const imgM = /"image"\s*:\s*"([^"]+)"/.exec(scene.slice(s))
  const animM = /"animation"\s*:\s*(\d+)/.exec(scene.slice(s, s + 800))
  console.log('图层: name=' + (nameM ? nameM[1] : '?') + ' image=' + (imgM ? imgM[1] : '?') + (animM ? ' animation=' + animM[1] : ' 无animation'))
  count++
  idx = s + 8
}
console.log('image 图层总数: ' + count)
