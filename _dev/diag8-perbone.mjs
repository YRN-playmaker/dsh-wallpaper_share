// 逐骨骼自洽搜索：对每根骨骼, 在候选 (周期, 相位, py规则, rot相位) 下
// 找使其 (px,py,rot) 局部序列 最平滑的组合
import { readFileSync } from 'node:fs'
import { parsePuppetMdl } from '../src/scene/ScenePuppet.ts'

function parsePkg(path) {
  const buf = readFileSync(path)
  let pos = 16; const entries = []
  while (pos + 8 <= buf.length) {
    const nameLen = buf.readInt32LE(pos); pos += 4
    if (nameLen <= 0 || nameLen > 1024 || pos + nameLen + 8 > buf.length) break
    const name = buf.subarray(pos, pos + nameLen).toString('utf8'); pos += nameLen
    const offset = buf.readInt32LE(pos); pos += 4
    const size = buf.readInt32LE(pos); pos += 4
    entries.push({ name, offset, size })
  }
  const dataStart = pos
  return { read: (n) => { const e = entries.find((x) => x.name === n); return e ? new Uint8Array(buf.subarray(dataStart + e.offset, dataStart + e.offset + e.size)) : null } }
}
const f32 = (b, p) => new DataView(b.buffer, b.byteOffset, b.byteLength).getFloat32(p, true)
function findTag(bytes, tag, from = 0) {
  const t = new TextEncoder().encode(tag)
  outer: for (let i = from; i + t.length <= bytes.length; i++) {
    for (let k = 0; k < t.length; k++) if (bytes[i + k] !== t[k]) continue outer
    return i
  }
  return -1
}
const u32r = (q) => bytes[q] | (bytes[q + 1] << 8) | (bytes[q + 2] << 16) | (bytes[q + 3] << 24)

const pkg = parsePkg('D:/SteamLibrary/steamapps/workshop/content/431960/3465215190/scene.pkg')
const bytes = pkg.read('models/人物_puppet.mdl')
const pm = parsePuppetMdl(bytes)
let p = findTag(bytes, 'MDLA0006') + 9 + 4
p += 4; p += 8
while (bytes[p] !== 0) p++; p++
while (!(bytes[p] === 0xf0 && bytes[p + 1] === 0x41)) p++
p += 2 + 2 + 2 + 4
p += 4 + 4
const segBytes = u32r(p); p += 4
const segsStart = p
const segRows = segBytes / 36
const fc = 66
const nb = pm.bones.length

// 对骨骼 b: px 列 = pcol, rot 列 = rcol, py 取法 ∈ {同行下一列(物理跨行), 同行col0, 下一行col0}
// 行映射: row(f) = (base + f*sdir) % period, base ∈ [0, period), period ∈ {66, 67}
// 平滑度: max |Δ| over f 的 px/py/rz 各自; 也要求闭合 (f65→f0)
// 先给每根骨骼列出: 在其自身段内, 哪个 (pcol相关) 列组合最平滑
function seq(seg, col, rowFn, pyMode, b) {
  const pxs = [], pys = [], rzs = []
  for (let f = 0; f < fc; f++) {
    const r = rowFn(f)
    const o = seg + r * 36 + col * 4
    pxs.push(f32(bytes, o))
    if (pyMode === 0) pys.push(f32(bytes, o + 4))                       // 物理下一 float (跨行)
    else if (pyMode === 1) pys.push(f32(bytes, seg + r * 36))            // 同行 col0
    else pys.push(f32(bytes, seg + ((r + 1) % segRows) * 36))            // 下一行 col0
    rzs.push(f32(bytes, seg + r * 36 + ((2 * b + 5) % 9) * 4))
  }
  return { pxs, pys, rzs }
}
function smooth(v) {
  let mx = 0
  for (let i = 0; i < v.length; i++) {
    const d = Math.abs(v[(i + 1) % v.length] - v[i])
    if (d > mx) mx = d
  }
  return mx
}

console.log('bone | 最佳组合 (period/base/pyMode) → maxΔpx, maxΔpy, maxΔrz | 上游公式的值')
for (let b = 0; b < nb; b++) {
  const seg = segsStart + b * segBytes
  const b2 = 2 * b
  const col = b2 % 9
  let best = null
  for (const period of [66, 67]) {
    for (let base = 0; base < period; base++) {
      for (const pyMode of [0, 1, 2]) {
        const rowFn = (f) => (base + f) % period
        const s = seq(seg, col, rowFn, pyMode, b)
        const m = Math.max(smooth(s.pxs), smooth(s.pys), smooth(s.rzs) * 30) // rz 弧度加权
        if (best === null || m < best.m) best = { m, period, base, pyMode, s }
      }
    }
  }
  // 上游公式 (period=66, base=shift, py=0)
  const up = seq(seg, col, (f) => (f + Math.floor(b2 / 9)) % 66, 0, b)
  const fmt = (v) => v.map((x) => (Math.abs(x) >= 100 ? x.toFixed(0) : x.toFixed(1))).join(',')
  console.log(`b${String(b).padStart(2)} pcol=${col} | best P${best.period} base${best.base} py${best.pyMode} → Δ(${smooth(best.s.pxs).toFixed(1)}, ${smooth(best.s.pys).toFixed(1)}, ${(smooth(best.s.rzs) * 57.3).toFixed(1)}°) | 上游 Δ(${smooth(up.pxs).toFixed(1)}, ${smooth(up.pys).toFixed(1)}, ${(smooth(up.rzs) * 57.3).toFixed(1)}°)`)
  if (b < 3 || b === 6 || b === 22 || b === 41) {
    console.log(`      best px: ${fmt(best.s.pxs.slice(0, 8))}...`)
    console.log(`      best py: ${fmt(best.s.pys.slice(0, 8))}...`)
    console.log(`      best rz: ${fmt(best.s.rzs.slice(0, 8))}...`)
  }
}
