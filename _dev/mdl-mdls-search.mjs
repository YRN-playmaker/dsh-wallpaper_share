// 暴搜 MDLS 骨骼定义起点：模式 [u0 4B][parent -1 4B][f0=2.0 4B][矩阵 64B m00=1.0]
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
for (const mdlName of ['models/asuna body_puppet.mdl', 'models/hair back big chunk_puppet.mdl', 'models/puppet_puppet.mdl']) {
  const m = pkg.read(mdlName)
  const mdlsIdx = m.indexOf('MDLS')
  const count = m.readUInt32LE(mdlsIdx + 13)
  console.log('\n=== ' + mdlName.split('/').pop() + ' count=' + count)
  // 暴搜骨骼 0 起点（mdlsIdx+9 .. mdlsIdx+40）
  for (let off = 9; off <= 40; off++) {
    const start = mdlsIdx + off
    const u0 = m.readUInt32LE(start)
    const parent = m.readInt32LE(start + 4)
    const f0 = m.readFloatLE(start + 8)
    if (parent !== -1) continue
    if (Math.abs(f0 - 2.0) > 0.01 && f0 !== 0) continue
    // 矩阵 @+12：m00 应 1.0，平移合理
    const mp = start + 12
    const m00 = m.readFloatLE(mp)
    const m11 = m.readFloatLE(mp + 16 + 4)
    const m22 = m.readFloatLE(mp + 32 + 8)
    const tx = m.readFloatLE(mp + 48), ty = m.readFloatLE(mp + 52)
    if (Math.abs(m00 - 1.0) < 0.01 && Math.abs(m11 - 1.0) < 0.01 && Math.abs(m22 - 1.0) < 0.01 && Math.abs(tx) < 5000 && Math.abs(ty) < 5000) {
      console.log('  HIT off=' + off + ' start=' + start + ' u0=' + u0 + ' parent=' + parent + ' f0=' + f0 + ' t=(' + tx.toFixed(2) + ',' + ty.toFixed(2) + ')')
    }
  }
  // 直接看 off=18 的矩阵
  for (const off of [18]) {
    const start = mdlsIdx + off
    const mp = start + 12
    const vals = []
    for (let k = 0; k < 16; k++) vals.push(m.readFloatLE(mp + k * 4).toFixed(3))
    console.log('  off=' + off + ' matrix16: ' + vals.join(' '))
    console.log('  off=' + off + ' m00=' + m.readFloatLE(mp) + ' m11=' + m.readFloatLE(mp + 20) + ' m22=' + m.readFloatLE(mp + 40) + ' t=(' + m.readFloatLE(mp + 48) + ',' + m.readFloatLE(mp + 52) + ',' + m.readFloatLE(mp + 56) + ')')
  }
}
