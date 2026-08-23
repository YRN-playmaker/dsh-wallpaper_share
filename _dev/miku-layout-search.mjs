// Miku MDLV0021 全槽位搜索：pos(x,y) 候选（三角形非退化率）+ UV 方向一致性
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
  blk = { vo, vc: cvb / stride, ilo, ib: cib }
  break
}
const idx = []
for (let i = 0; i < blk.ib / 2; i++) idx.push(m.readUInt16LE(blk.ilo + 4 + i * 2))
const f = (v, slot) => m.readFloatLE(blk.vo + v * stride + slot * 4)
// 1. pos 候选：所有 (x,y) 槽位组合的三角形非退化率
const posCands = []
for (let xs = 0; xs < 20; xs++) {
  for (let ys = 0; ys < 20; ys++) {
    if (xs === ys) continue
    let nonDeg = 0
    for (let t = 0; t + 2 < idx.length; t += 3) {
      const a = idx[t], b = idx[t + 1], c = idx[t + 2]
      const cross = (f(b, xs) - f(a, xs)) * (f(c, ys) - f(a, ys)) - (f(b, ys) - f(a, ys)) * (f(c, xs) - f(a, xs))
      if (Math.abs(cross) > 1e-3) nonDeg++
    }
    const pct = Math.round(nonDeg / (idx.length / 3) * 100)
    if (pct > 50) posCands.push({ xs, ys, pct })
  }
}
posCands.sort((a, b) => b.pct - a.pct)
console.log('pos candidates (nonDeg>50%): ' + posCands.length)
for (const p of posCands.slice(0, 10)) {
  // 该 pos 下的 UV 搜索（找 0%/100% 方向一致的 uv 槽位）
  console.log('  pos x=' + p.xs + ' y=' + p.ys + ' nonDeg=' + p.pct + '%')
  const good = []
  for (let us = 0; us < 20; us++) {
    for (let vs = 0; vs < 20; vs++) {
      if (us === vs) continue
      let same = 0
      let nonDeg = 0
      for (let t = 0; t + 2 < idx.length; t += 3) {
        const a = idx[t], b = idx[t + 1], c = idx[t + 2]
        const cross = (f(b, p.xs) - f(a, p.xs)) * (f(c, p.ys) - f(a, p.ys)) - (f(b, p.ys) - f(a, p.ys)) * (f(c, p.xs) - f(a, p.xs))
        if (Math.abs(cross) < 1e-3) continue
        nonDeg++
        const ucross = (f(b, us) - f(a, us)) * (f(c, vs) - f(a, vs)) - (f(b, vs) - f(a, vs)) * (f(c, us) - f(a, us))
        if (ucross * cross > 0) same++
      }
      const pct = nonDeg ? Math.round(same / nonDeg * 100) : -1
      if (pct <= 2 || pct >= 98) good.push({ us, vs, pct })
    }
  }
  for (const g of good.slice(0, 4)) {
    let mn = Infinity, mx = -Infinity
    for (let i = 0; i < blk.vc; i++) { const v = f(i, g.us); if (v < mn) mn = v; if (v > mx) mx = v }
    let mn2 = Infinity, mx2 = -Infinity
    for (let i = 0; i < blk.vc; i++) { const v = f(i, g.vs); if (v < mn2) mn2 = v; if (v > mx2) mx2 = v }
    console.log('    uv u=' + g.us + ' v=' + g.vs + ' same=' + g.pct + '% u[' + mn.toFixed(2) + ',' + mx.toFixed(2) + '] v[' + mn2.toFixed(2) + ',' + mx2.toFixed(2) + ']')
  }
}
