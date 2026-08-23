// 验证 MDLV0021 stride=40 布局：槽位 + UV 方向
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
// stride 40 网格块
const stride = 40
let blk = null
for (let offset = 9; offset + 12 < mdls; offset++) {
  const cvb = m.readUInt32LE(offset + 4)
  const vo = offset + 8
  const ilo = vo + cvb
  if (cvb === 0 || cvb % stride !== 0 || cvb < 20000 || ilo + 4 > mdls) continue
  const cib = m.readUInt32LE(ilo)
  if (cib === 0 || cib % 6 !== 0 || ilo + 4 + cib > mdls) continue
  const vc = cvb / stride
  let maxIdx = 0
  for (let i = 0; i < Math.min(cib / 2, 500); i++) {
    const v = m.readUInt16LE(ilo + 4 + i * 2)
    if (v > maxIdx) maxIdx = v
  }
  blk = { vo, vc, ilo, ib: cib, maxIdx, headerOffset: offset }
  break
}
console.log('stride40 block: @' + blk.headerOffset + ' vc=' + blk.vc + ' maxIdx=' + blk.maxIdx)
// 槽位统计
for (let s = 0; s < 10; s++) {
  let mn = Infinity, mx = -Infinity
  for (let i = 0; i < Math.min(blk.vc, 3000); i++) {
    const v = m.readFloatLE(blk.vo + i * stride + s * 4)
    if (v < mn) mn = v
    if (v > mx) mx = v
  }
  console.log('slot[' + s + '] [' + mn.toFixed(1) + ',' + mx.toFixed(1) + ']')
}
// UV 方向（pos slot0,1 vs 各槽位对）
const idx = []
for (let i = 0; i < blk.ib / 2; i++) idx.push(m.readUInt16LE(blk.ilo + 4 + i * 2))
const f = (v, slot) => m.readFloatLE(blk.vo + v * stride + slot * 4)
const results = []
for (let us = 0; us < 10; us++) {
  for (let vs = 0; vs < 10; vs++) {
    if (us === vs) continue
    let same = 0
    let nonDeg = 0
    for (let t = 0; t + 2 < idx.length; t += 3) {
      const a = idx[t], b = idx[t + 1], c = idx[t + 2]
      const cross = (f(b, 0) - f(a, 0)) * (f(c, 1) - f(a, 1)) - (f(b, 1) - f(a, 1)) * (f(c, 0) - f(a, 0))
      if (Math.abs(cross) < 1e-3) continue
      nonDeg++
      const ucross = (f(b, us) - f(a, us)) * (f(c, vs) - f(a, vs)) - (f(b, vs) - f(a, vs)) * (f(c, us) - f(a, us))
      if (ucross * cross > 0) same++
    }
    if (nonDeg) {
      const pct = Math.round(same / nonDeg * 100)
      if (pct <= 3 || pct >= 97) results.push({ us, vs, pct, nonDeg })
    }
  }
}
console.log('direction results:')
for (const r of results.slice(0, 10)) console.log('  u=' + r.us + ' v=' + r.vs + ' same=' + r.pct + '% nonDeg=' + r.nonDeg)
