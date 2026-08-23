// 3766677415 #25 图层的 effects（shake 参数 + flow 纹理）+ 全部 shake 效果分布
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

const pkg = parsePkg(readFileSync('D:/SteamLibrary/steamapps/workshop/content/431960/3766677415/scene.pkg'))
const s = pkg.read('scene.json').toString('utf8')
// #25 图层（找 "id" : 25）
const i = s.indexOf('"id" : 25')
console.log('#25 idx=' + i)
if (i >= 0) {
  const seg = s.slice(i, i + 3000)
  console.log(seg.slice(0, 300).replace(/\r/g, ''))
  const ei = seg.indexOf('"effects"')
  if (ei >= 0) console.log('\n#25 effects:\n' + seg.slice(ei, ei + 1600).replace(/\r/g, ''))
}
// 所有 shake 的引用
console.log('\nshake refs: ' + (s.match(/effects\/shake/g) || []).length)
// flow 纹理（noflow 等）
for (const e of pkg.entries) {
  if (e.name.includes('noflow') || e.name.includes('shake')) console.log('  entry: ' + e.name)
}
