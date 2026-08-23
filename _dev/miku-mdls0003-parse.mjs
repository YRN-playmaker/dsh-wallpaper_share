// MDLS0003 逐骨骼解析验证：头(9B) + 矩阵(64B) + json\0 变长
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
const mdls = 593739
const count = m.readUInt32LE(mdls + 13)
console.log('count=' + count)
// 骨骼 0 @+17：头 9B（u0 5B + parent 4B）？——从 @+17 起：
// 尝试：u0 = @+17-20（4B），@+21 = pad，parent @+22-25，f0 @+26-29，矩阵 @+30
let p = mdls + 17
for (let i = 0; i < Math.min(count, 6); i++) {
  const u0 = m.readUInt32LE(p)
  const pad = m[p + 4]
  const parent = m.readInt32LE(p + 5)
  const f0 = m.readFloatLE(p + 9)
  const mp = p + 13
  const m00 = m.readFloatLE(mp)
  const tx = m.readFloatLE(mp + 48)
  const ty = m.readFloatLE(mp + 52)
  // json 从 mp+64 起（到 \0）
  let j = mp + 64
  let js = ''
  while (j < m.length && m[j] !== 0 && js.length < 200) { js += String.fromCharCode(m[j]); j++ }
  console.log('bone' + i + ' @' + p + ' u0=' + u0 + ' pad=' + pad + ' parent=' + parent + ' f0=' + f0.toFixed(1) + ' m00=' + m00.toFixed(2) + ' t=(' + tx.toFixed(1) + ',' + ty.toFixed(1) + ')')
  console.log('  json: ' + js.slice(0, 120))
  p = j + 1
}
