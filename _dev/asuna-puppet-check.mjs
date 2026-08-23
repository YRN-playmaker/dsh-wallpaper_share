// 检查 3463520581（asuna/kirito）的 ASUNA PUPPET 图层：模型 JSON、纹理、图层定义
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
  return (n) => { const e = entries.find((x) => x.name === n); if (!e) return null; return buf.subarray(dataStart + e.offset, dataStart + e.offset + e.size) }
}

const read = parsePkg(readFileSync('D:/SteamLibrary/steamapps/workshop/content/431960/3463520581/scene.pkg'))
// ASUNA PUPPET 模型 JSON
for (const n of ['models/ASUNA PUPPET.json', 'models/puppet.json', 'models/puppet - Copy.json', 'models/KIRITO PUPPET.json']) {
  const j = read(n)
  if (j === null) { console.log(n + ': 不存在'); continue }
  console.log('=== ' + n + ' ===')
  console.log(Buffer.from(j).toString('utf8'))
  console.log()
}
// 找 50×50 图层的完整定义
const scene = Buffer.from(read('scene.json')).toString('utf8')
const idx = scene.indexOf('ASUNA PUPPET')
if (idx >= 0) {
  console.log('--- ASUNA PUPPET 图层上下文 ---')
  console.log(scene.slice(idx - 200, idx + 400))
}
