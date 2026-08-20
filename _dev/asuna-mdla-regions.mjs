// asuna MDLA 区 @+2256..@+33146 分段概况：找零区/数据块边界
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

const pkg = parsePkg('D:/SteamLibrary/steamapps/workshop/content/431960/3463520581/scene.pkg')
const m = pkg.read('models/asuna body_puppet.mdl')
const mdla = m.indexOf('MDLA0006')
// 分段：每 512B 统计非零比例 + 前 8B hex
for (let off = 2256; off < 33146; off += 512) {
  let nz = 0
  for (let i = off; i < Math.min(off + 512, 33146); i++) if (m[mdla + i] !== 0) nz++
  const pct = Math.round(nz / Math.min(512, 33146 - off) * 100)
  if (pct > 2 || off < 3000) {
    console.log('@+' + off + ' (' + pct + '% nonzero) ' + m.subarray(mdla + off, mdla + off + 12).toString('hex'))
  }
}
// Animation 2 数据 @+33161 起 2196B 后（@+35357）的结构
console.log('\n@+35357: ' + m.subarray(mdla + 35357, mdla + 35357 + 64).toString('hex'))
console.log('@+40000: ' + m.subarray(mdla + 40000, mdla + 40000 + 32).toString('hex'))
console.log('@+60000: ' + m.subarray(mdla + 60000, mdla + 60000 + 32).toString('hex'))
console.log('@+66000: ' + m.subarray(mdla + 66000, mdla + 66000 + 32).toString('hex'))
