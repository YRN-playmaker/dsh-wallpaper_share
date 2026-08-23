// 验证 3409595232 导出初音 MDLS 骨骼矩阵（步长 + 合理性）
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
const mdls = m.indexOf('MDLS0004')
const count = m.readUInt32LE(mdls + 13)
console.log('MDLS@' + mdls + ' count=' + count)
console.log('head48: ' + m.subarray(mdls, mdls + 48).toString('hex'))
// 步长探测 60-110
for (let step = 60; step <= 110; step++) {
  let ok = 0
  const tList = []
  for (let i = 0; i < Math.min(count, 8); i++) {
    const base = mdls + 18 + i * step
    if (base + 12 + 64 > m.length) break
    const mp = base + 12
    const m00 = m.readFloatLE(mp)
    const m11 = m.readFloatLE(mp + 20)
    const m22 = m.readFloatLE(mp + 40)
    const tx = m.readFloatLE(mp + 48)
    const ty = m.readFloatLE(mp + 52)
    if (Math.abs(m00 - 1) < 0.05 && Math.abs(m11 - 1) < 0.05 && Math.abs(m22 - 1) < 0.05 && Math.abs(tx) < 3000 && Math.abs(ty) < 3000) {
      ok++
      tList.push(i + ':(' + tx.toFixed(0) + ',' + ty.toFixed(0) + ')')
    }
  }
  if (ok >= 4) console.log('  step=' + step + ' OK=' + ok + ' [' + tList.join(' ') + ']')
}
