// 动画段逐 DWORD 分析 + face 字符串
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
const mdl = pkg.read('models/puppet - Copy_puppet.mdl')

console.log('== MDLA 段 @0x3b60 起 逐 DWORD ==')
for (let p = 0x3b60; p < mdl.length - 3; p += 4) {
  const u = mdl.readUInt32LE(p)
  const f = mdl.readFloatLE(p)
  let tag = ''
  if (u === 0x3f800000) tag = '<1.0>'
  else if (u === 0xbf800000) tag = '<-1.0>'
  else if (u === 0) tag = '<0>'
  console.log(`0x${p.toString(16)}: u32=${u.toString().padStart(10)} f32=${f.toFixed(5).padStart(11)} ${tag}`)
}

// face 字符串
const face = pkg.read('models/kirito face_puppet.mdl')
console.log(`\n== kirito face 全部可读字符串 ==`)
let i = 0
const isAscii = (b, p) => b[p] >= 32 && b[p] < 127
while (i < face.length - 4) {
  if (isAscii(face, i)) {
    let e = i
    while (e < face.length && isAscii(face, e)) e++
    const s = face.subarray(i, e).toString('utf8')
    if (s.length >= 3 && !/^[\d.]+$/.test(s)) console.log(`@0x${i.toString(16)}: ${JSON.stringify(s)}`)
    i = e
  } else i++
}
