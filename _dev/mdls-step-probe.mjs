// 探测 3759313716 hairfrontside 的 MDLS 骨骼定义步长（asuna 用 76B，此文件可能不同）
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

const pkg = parsePkg(readFileSync('D:/SteamLibrary/steamapps/workshop/content/431960/3759313716/scene.pkg'))
for (const mdlName of ['models/hairfrontside_puppet.mdl', 'models/skırt_puppet.mdl']) {
  const m = pkg.read(mdlName)
  const mdls = m.indexOf('MDLS0004')
  const count = m.readUInt32LE(mdls + 13)
  console.log('\n=== ' + mdlName.split('/').pop() + ' MDLS@' + mdls + ' count=' + count)
  console.log('head48: ' + m.subarray(mdls, mdls + 48).toString('hex'))
  // 暴力步长 60..100：检查骨骼 0..3 矩阵合理性（m00≈1, m11≈1, 平移合理）
  for (let step = 60; step <= 100; step++) {
    let ok = 0
    const tList = []
    for (let i = 0; i < Math.min(count, 6); i++) {
      const base = mdls + 18 + i * step
      if (base + 12 + 64 > m.length) break
      const mp = base + 12
      const m00 = m.readFloatLE(mp)
      const m11 = m.readFloatLE(mp + 20)
      const m22 = m.readFloatLE(mp + 40)
      const tx = m.readFloatLE(mp + 48)
      const ty = m.readFloatLE(mp + 52)
      if (Math.abs(m00 - 1) < 0.05 && Math.abs(m11 - 1) < 0.05 && Math.abs(m22 - 1) < 0.05 && Math.abs(tx) < 5000 && Math.abs(ty) < 5000) {
        ok++
        tList.push(i + ':(' + tx.toFixed(1) + ',' + ty.toFixed(1) + ')')
      }
    }
    if (ok >= 3) console.log('  step=' + step + ' OK=' + ok + ' t=[' + tList.join(' ') + ']')
  }
}
