// 扫描 asuna MDLA 区找 id=2385 (0x951) 目录项 + 分析周围结构
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
const mdle = m.indexOf('MDLE0002')
console.log('MDLA@' + mdla + '..' + mdle + ' (' + (mdle - mdla) + 'B)')
// 找 51 09 00 00（2385 LE）
const target = [0x51, 0x09, 0x00, 0x00]
const hits = []
for (let i = mdla; i < mdle - 4; i++) {
  if (m[i] === target[0] && m[i + 1] === target[1] && m[i + 2] === target[2] && m[i + 3] === target[3]) hits.push(i)
}
console.log('id=2385 hits: ' + hits.map((h) => h + ' (mdla+' + (h - mdla) + ')').join(', ') || 'NONE')
// 也找 id=264 的第二个出现（264 = 08 01 00 00）
const t2 = [0x08, 0x01, 0x00, 0x00]
const hits2 = []
for (let i = mdla; i < mdle - 4; i++) {
  if (m[i] === t2[0] && m[i + 1] === t2[1] && m[i + 2] === t2[2] && m[i + 3] === t2[3]) hits2.push(i)
}
console.log('id=264 hits: ' + hits2.map((h) => h + ' (mdla+' + (h - mdla) + ')').join(', '))
// dump 每个 2385 命中点前后 80B
for (const h of hits) {
  console.log('\n@' + h + ' (mdla+' + (h - mdla) + ') context:')
  console.log(m.subarray(h - 16, h + 96).toString('hex'))
  // ASCII
  const asc = []
  for (let i = h; i < Math.min(h + 64, m.length); i++) asc.push(m[i] >= 32 && m[i] < 127 ? String.fromCharCode(m[i]) : '.')
  console.log('ascii: ' + asc.join(''))
}
