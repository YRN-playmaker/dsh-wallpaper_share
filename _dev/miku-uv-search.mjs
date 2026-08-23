// Miku 全槽位 UV 组合探测：找 sameDir ≈ 0% 或 100% 的 (uSlot, vSlot)
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
const stride = 80
let blk = null
for (let offset = 9; offset + 12 < mdls; offset++) {
  const cvb = m.readUInt32LE(offset + 4)
  const vo = offset + 8
  const ilo = vo + cvb
  if (cvb === 0 || cvb % stride !== 0 || ilo + 4 > mdls) continue
  const cib = m.readUInt32LE(ilo)
  if (cib === 0 || cib % 6 !== 0 || ilo + 4 + cib > mdls) continue
  blk = { vo, vc: cvb / stride, ilo }
  break
}
const idx = []
for (let i = 0; i < blk.ib / 2; i++) idx.push(m.readUInt16LE(blk.ilo + 4 + i * 2))
const f = (v, slot) => m.readFloatLE(blk.vo + v * stride + slot * 4)
// 每个三角形：pos 叉积 + (uSlot,vSlot) 叉积
const tris = []
for (let t = 0; t + 2 < idx.length; t += 3) {
  const a = idx[t], b = idx[t + 1], c = idx[t + 2]
  const cross = (f(b, 0) - f(a, 0)) * (f(c, 1) - f(a, 1)) - (f(b, 1) - f(a, 1)) * (f(c, 0) - f(a, 0))
  if (Math.abs(cross) < 1e-3) continue
  tris.push([a, b, c, cross > 0 ? 1 : -1])
}
console.log('tris=' + tris.length)
const results = []
for (let us = 0; us < 20; us++) {
  for (let vs = 0; vs < 20; vs++) {
    if (us === vs) continue
    let same = 0
    for (const [a, b, c, sign] of tris) {
      const ucross = (f(b, us) - f(a, us)) * (f(c, vs) - f(a, vs)) - (f(b, vs) - f(a, vs)) * (f(c, us) - f(a, us))
      if (ucross * sign > 0) same++
    }
    const pct = Math.round(same / tris.length * 100)
    if (pct <= 3 || pct >= 97) results.push({ us, vs, pct })
  }
}
results.sort((a, b) => Math.abs(b.pct - 50) - Math.abs(a.pct - 50))
for (const r of results.slice(0, 20)) {
  // 该槽位的值范围
  let mn = Infinity, mx = -Infinity
  for (let i = 0; i < blk.vc; i++) { const v = f(i, r.us); if (v < mn) mn = v; if (v > mx) mx = v }
  let mn2 = Infinity, mx2 = -Infinity
  for (let i = 0; i < blk.vc; i++) { const v = f(i, r.vs); if (v < mn2) mn2 = v; if (v > mx2) mx2 = v }
  console.log('u=' + r.us + ' v=' + r.vs + ' same=' + r.pct + '%  u[' + mn.toFixed(2) + ',' + mx.toFixed(2) + '] v[' + mn2.toFixed(2) + ',' + mx2.toFixed(2) + ']')
}
