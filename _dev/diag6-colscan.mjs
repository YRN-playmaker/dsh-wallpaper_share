// 紧凑摘要：每个骨骼段, 哪些列在变化, 变化序列从哪行开始
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
p += 4 // animCount
p += 8
while (bytes[p] !== 0) p++; p++
while (!(bytes[p] === 0xf0 && bytes[p + 1] === 0x41)) p++
p += 2 + 2 + 2 + 4
p += 4 + 4
const segBytes = u32r(p); p += 4
const segsStart = p
const segRows = segBytes / 36

// 对每个骨骼段: 逐列统计变化行数与首个变化行（r1..r66 的循环数据内比较，跳过 r0 表头行）
console.log('bone | 每列: 变化行数/首变化行 (仅列出变化列)')
for (let b = 0; b < pm.bones.length; b++) {
  const seg = segsStart + b * segBytes
  const cols = []
  for (let c = 0; c < 9; c++) {
    let changes = 0, firstChange = -1
    const v0 = f32(bytes, seg + 36 + c * 4)
    for (let r = 2; r < segRows; r++) {
      const v = f32(bytes, seg + r * 36 + c * 4)
      if (Math.abs(v - v0) > 1e-4) { changes++; if (firstChange < 0) firstChange = r }
    }
    if (changes > 0) cols.push(`c${c}: ${changes}/${segRows - 2} 首变@r${firstChange}`)
  }
  const b2 = 2 * b
  console.log(`b${String(b).padStart(2)} (shift=${Math.floor(b2 / 9)}, pcol=${b2 % 9}, rcol=${(b2 + 5) % 9}) | ${cols.length > 0 ? cols.join('  ') : '全常量'}`)
}
