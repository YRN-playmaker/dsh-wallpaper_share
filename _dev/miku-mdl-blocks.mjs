// 3409595232 mdl 块结构 dump
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
  return { read }
}

const pkg = parsePkg(readFileSync('D:/SteamLibrary/steamapps/workshop/content/431960/3409595232/scene.pkg'))
const m = pkg.read('models/导出初音_puppet.mdl')
console.log('mdl len=' + m.length)
console.log('head64: ' + m.subarray(0, 64).toString('hex'))
// 扫描 4 字符魔数
const markers = ['MDLV', 'MDLS', 'MDAT', 'MDLA', 'MDLE', 'MDLC', 'MDLB', 'TEXV', 'SKEL', 'BONE', 'MESH']
for (const mk of markers) {
  let i = 0
  const hits = []
  while ((i = m.indexOf(mk, i)) !== -1 && hits.length < 6) { hits.push(i); i += 4 }
  if (hits.length) console.log(mk + ': ' + hits.join(', '))
}
// 找所有可打印 4 字符序列的分布（前 200 个唯一）
const uniq = new Map()
for (let i = 0; i < m.length - 4; i++) {
  const c0 = m[i], c1 = m[i + 1], c2 = m[i + 2], c3 = m[i + 3]
  if (c0 >= 65 && c0 <= 90 && c1 >= 65 && c1 <= 90 && c2 >= 65 && c2 <= 90 && c3 >= 48 && c3 <= 57) {
    const s = String.fromCharCode(c0, c1, c2, c3)
    if (!uniq.has(s)) uniq.set(s, i)
  }
}
console.log('markers: ' + [...uniq.entries()].map(([k, v]) => k + '@' + v).join(' '))
