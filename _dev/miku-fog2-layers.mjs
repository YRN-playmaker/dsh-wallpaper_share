// fog2 粒子/材质原文 + Miku 图层结构（scene.json 关键层）
import { readFileSync } from 'node:fs'

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
  const read = (n) => {
    const e = entries.find((x) => x.name === n)
    if (!e) return null
    return buf.subarray(dataStart + e.offset, dataStart + e.offset + e.size)
  }
  return { read, entries }
}

const pkg = parsePkg(readFileSync('D:/SteamLibrary/steamapps/workshop/content/431960/3409595232/scene.pkg'))
console.log('=== particles/presets/fog2.json ===')
console.log(pkg.read('particles/presets/fog2.json').toString('utf8').slice(0, 1500))
console.log('\n=== materials/presets/fog2.json ===')
console.log(pkg.read('materials/presets/fog2.json').toString('utf8').slice(0, 800))
// Miku 图层（scene.json 找 导出初音 相关）
console.log('\n=== scene.json layers (Miku) ===')
const s = pkg.read('scene.json').toString('utf8')
// 找所有 layer 的 id/name/origin/size
const layerRe = /\{\s*"id"\s*:\s*(\d+)[\s\S]*?"name"\s*:\s*"([^"]*)"[\s\S]*?"origin"\s*:\s*"([\d.\s-]+)"[\s\S]*?"size"\s*:\s*"([\d.\s-]+)"/g
let m
let shown = 0
while ((m = layerRe.exec(s)) !== null && shown < 60) {
  console.log('#' + m[1] + ' ' + m[2] + ' origin=[' + m[3].trim().replace(/\s+/g, ',') + '] size=[' + m[4].trim().replace(/\s+/g, ',') + ']')
  shown++
}
