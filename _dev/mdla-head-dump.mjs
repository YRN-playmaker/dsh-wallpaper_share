// asuna body MDLA 完整头 dump（+17 起 200B），人工解析目录结构
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
console.log('mdla=' + mdla + ' len=' + m.length)
// 逐字节打印 +17 起 240B（每 16B 一行，hex + ascii）
for (let off = 17; off < 257; off += 16) {
  const end = Math.min(off + 16, m.length)
  const hex = []
  const asc = []
  for (let i = off; i < end; i++) {
    hex.push(m[mdla + i].toString(16).padStart(2, '0'))
    const c = m[mdla + i]
    asc.push(c >= 32 && c < 127 ? String.fromCharCode(c) : '.')
  }
  console.log('+' + String(off).padStart(4) + ': ' + hex.join(' ') + '  |' + asc.join('') + '|')
}
// MDLA 结束偏移：下一个块或文件尾
console.log('MDLA region end: next block search...')
const mdle = m.indexOf('MDLE0002')
console.log('MDLE@' + mdle + ' mdla region len=' + (mdle - mdla))
