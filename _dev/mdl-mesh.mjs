// 验证 MDAT [name + 矩阵64B] 交替解析：所有具名骨骼位置
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
const MDLS = [
  'models/puppet_puppet.mdl',              // #30
  'models/puppet - Copy_puppet.mdl',       // #34
  'models/asuna body bottom_puppet.mdl',   // #16
  'models/asuna body_puppet.mdl',          // #22
  'models/hair back big chunk_puppet.mdl', // #70
  'models/main hair back c2_puppet.mdl',   // #134
]
for (const n of MDLS) {
  const m = pkg.read(n)
  const mdat = m.indexOf('MDAT0001')
  const mdla = m.indexOf('MDLA0006')
  const end = mdla > 0 ? mdla : m.length
  let p = mdat + 17 // offset(4B) + count(4B)
  const bones = {}
  while (p + 66 <= end) {
    // 读名字（ASCII 可打印）
    let nm = ''
    let q = p
    while (q < end && m[q] !== 0 && m[q] >= 32 && m[q] < 127) { nm += String.fromCharCode(m[q]); q++ }
    if (nm.length >= 2 && m[q] === 0 && q + 1 + 64 <= end) {
      const mp = q + 1
      const f = (k) => m.readFloatLE(mp + k * 4)
      bones[nm] = [f(12), f(13), f(14)]
      p = mp + 64
    } else {
      break
    }
  }
  console.log(n.split('/').pop() + ': ' + JSON.stringify(bones))
}
