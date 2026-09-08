// 全块搜索 bone41 的序列值出现在哪里 → 揭示真实布局
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
const totalRows = (pm.bones.length * segBytes) / 36
console.log(`segBytes=${segBytes} segRows=${segRows} bones=${pm.bones.length} 全块行数=${totalRows}`)

// 把整个 MDLA 数据块当作连续行流 (每行 9 f32)
// bone41 px 序列 (c1): 行9..66 段41 = 全局行 41*67+9 .. 41*67+66
// 全局行 g = seg*67 + r。找所有 c1∈[98.0,98.3] 且 c2∈[-87.5,-85.5] 的全局行
console.log('\n搜索 c1∈[98.0,98.3] && c2∈[-87.5,-85.5] 的全局行:')
const hits = []
for (let g = 0; g < totalRows; g++) {
  const o = segsStart + g * 36
  if (o + 36 > segsStart + pm.bones.length * segBytes) break
  const c1 = f32(bytes, o + 4)
  const c2 = f32(bytes, o + 8)
  if (c1 >= 98.0 && c1 <= 98.3 && c2 >= -87.5 && c2 <= -85.5) hits.push(g)
}
// 压缩成区间
let s = -1, prev = -2
for (const g of hits) {
  if (g !== prev + 1) { if (s >= 0) console.log(`  全局行 ${s}..${prev} (段${Math.floor(s / 67)} 行${s % 67} 起)`); s = g }
  prev = g
}
if (s >= 0) console.log(`  全局行 ${s}..${prev} (段${Math.floor(s / 67)} 行${s % 67} 起)`)
console.log(`共 ${hits.length} 行`)

// 同样搜 bone6 的序列: c3≈-341.79 (c4 任意) → 全局行分布
console.log('\n搜索 c3∈[-342.5,-341.0] 的全局行 (bone6 px):')
const hits6 = []
for (let g = 0; g < totalRows; g++) {
  const o = segsStart + g * 36
  if (o + 36 > segsStart + pm.bones.length * segBytes) break
  const c3 = f32(bytes, o + 12)
  if (c3 >= -342.5 && c3 <= -341.0) hits6.push(g)
}
s = -1; prev = -2
for (const g of hits6) {
  if (g !== prev + 1) { if (s >= 0) console.log(`  全局行 ${s}..${prev} (段${Math.floor(s / 67)} 行${s % 67} 起)`); s = g }
  prev = g
}
if (s >= 0) console.log(`  全局行 ${s}..${prev} (段${Math.floor(s / 67)} 行${s % 67} 起)`)
console.log(`共 ${hits6.length} 行`)

// bone8: c7≈22.96 && c8≈139.17
console.log('\n搜索 c7∈[22.5,23.5] && c8∈[138,140] 的全局行 (bone8 px/py):')
const hits8 = []
for (let g = 0; g < totalRows; g++) {
  const o = segsStart + g * 36
  if (o + 36 > segsStart + pm.bones.length * segBytes) break
  const c7 = f32(bytes, o + 28)
  const c8 = f32(bytes, o + 32)
  if (c7 >= 22.5 && c7 <= 23.5 && c8 >= 138 && c8 <= 140) hits8.push(g)
}
s = -1; prev = -2
for (const g of hits8) {
  if (g !== prev + 1) { if (s >= 0) console.log(`  全局行 ${s}..${prev} (段${Math.floor(s / 67)} 行${s % 67} 起)`); s = g }
  prev = g
}
if (s >= 0) console.log(`  全局行 ${s}..${prev} (段${Math.floor(s / 67)} 行${s % 67} 起)`)
console.log(`共 ${hits8.length} 行`)
