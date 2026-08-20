// dump asuna body MDLA anim[0] 数据后区域（anim[1] 起点探测）
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
// anim[0] 头从 +17 起：id(4) u32(4) name loop f32 u32 u32 u32 u32 dataLen extra
// 名字 "eyes" @+25，loop "loop" @+30
// 字段：+35 f32=20.0, +39=60, +43=0, +47=15, +51=0, +55=2196, +59=02(extra), 数据 +60
const dataStart = mdla + 60
console.log('anim0 dataStart=' + dataStart + ' (offset from mdla: ' + 60 + ')')
console.log('anim0 head bytes: ' + m.subarray(dataStart, dataStart + 16).toString('hex'))
// anim[1] 应该在 dataStart + 2196
const a1 = dataStart + 2196
console.log('anim1 @' + a1 + ' (+' + (a1 - mdla) + '): ' + m.subarray(a1, a1 + 64).toString('hex'))
// 尝试 ±4 字节偏移找 "name" 模式（ASCII 可打印串）
for (let d = -8; d <= 8; d++) {
  const p2 = a1 + d
  const s = m.subarray(p2, Math.min(p2 + 24, m.length)).toString('latin1')
  const printable = /^[\x20-\x7e]+$/.test(s.slice(0, 12))
  console.log('  +' + (d >= 0 ? '+' : '') + d + ': ' + JSON.stringify(s.slice(0, 20)) + (printable ? ' <PRINTABLE>' : ''))
}
