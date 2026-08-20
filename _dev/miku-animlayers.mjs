// 检查 Miku scene.json 的 animationlayers 引用
import { readFileSync } from 'node:fs'

function parsePkg(path) {
  const buf = readFileSync(path)
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
  return { read }
}

const pkg = parsePkg('D:/SteamLibrary/steamapps/workshop/content/431960/3409595232/scene.pkg')
const s = pkg.read('scene.json').toString('utf8')
let i = 0
let c = 0
while ((i = s.indexOf('"animation"', i)) !== -1) {
  c++
  const seg = s.slice(Math.max(0, i - 80), i + 120).replace(/\s+/g, ' ')
  console.log('#' + c + ' @' + i + ': ...' + seg + '...')
  i += 12
}
console.log('total animation refs: ' + c)
