// Miku MDLV0021 顶点槽位分析：确认 uv/pos 槽位（对照 3463520581 的 80B 布局）
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
// 网格块（stride 80，边界 = mdls）
const stride = 80
let blk = null
for (let offset = 9; offset + 12 < mdls; offset++) {
  const cvb = m.readUInt32LE(offset + 4)
  const vo = offset + 8
  const ilo = vo + cvb
  if (cvb === 0 || cvb % stride !== 0 || ilo + 4 > mdls) continue
  const cib = m.readUInt32LE(ilo)
  if (cib === 0 || cib % 6 !== 0 || ilo + 4 + cib > mdls) continue
  blk = { vo, vc: cvb / stride, ilo, ib: cib, headerOffset: offset }
  break
}
console.log('mesh block header@' + blk.headerOffset + ' vc=' + blk.vc + ' tri=' + blk.ib / 6)
// 顶点槽位统计（20 floats）
for (let s = 0; s < 20; s++) {
  const vals = []
  for (let i = 0; i < Math.min(blk.vc, 2000); i++) vals.push(m.readFloatLE(blk.vo + i * stride + s * 4))
  let mn = Infinity, mx = -Infinity
  for (const v of vals) { if (v < mn) mn = v; if (v > mx) mx = v }
  console.log('slot[' + s + '] range=[' + mn.toFixed(2) + ',' + mx.toFixed(2) + ']')
}
// UV 方向一致性（stride 80 uv@72 vs 试探其他槽位）：三角形 pos 叉积 vs UV 叉积
const idx = []
for (let i = 0; i < blk.ib / 2; i++) idx.push(m.readUInt16LE(blk.ilo + 4 + i * 2))
for (const [uvA, uvB] of [[72, 76], [68, 72], [64, 68], [76, 80], [56, 60], [60, 64]]) {
  let nonDeg = 0
  let same = 0
  for (let t = 0; t + 2 < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2]
    const pax = m.readFloatLE(blk.vo + a * stride), pay = m.readFloatLE(blk.vo + a * stride + 4)
    const pbx = m.readFloatLE(blk.vo + b * stride), pby = m.readFloatLE(blk.vo + b * stride + 4)
    const pcx = m.readFloatLE(blk.vo + c * stride), pcy = m.readFloatLE(blk.vo + c * stride + 4)
    const cross = (pbx - pax) * (pcy - pay) - (pby - pay) * (pcx - pax)
    if (Math.abs(cross) < 1e-4) continue
    nonDeg++
    const ua = m.readFloatLE(blk.vo + a * stride + uvA), va = m.readFloatLE(blk.vo + a * stride + uvB)
    const ub = m.readFloatLE(blk.vo + b * stride + uvA), vb = m.readFloatLE(blk.vo + b * stride + uvB)
    const uc = m.readFloatLE(blk.vo + c * stride + uvA), vc2 = m.readFloatLE(blk.vo + c * stride + uvB)
    const ucross = (ub - ua) * (vc2 - va) - (vb - va) * (uc - ua)
    if (ucross * cross > 0) same++
  }
  console.log('uv@' + uvA + ',' + uvB + ': sameDir=' + same + '/' + nonDeg + ' (' + (nonDeg ? Math.round(same / nonDeg * 100) : 0) + '%)')
}
