// 打印问题骨骼的完整段数据（67 行 × 9 列）
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
const animCount = u32r(p); p += 4
p += 8
while (bytes[p] !== 0) p++; p++
while (!(bytes[p] === 0xf0 && bytes[p + 1] === 0x41)) p++
p += 2 + 2 + 2 + 4
p += 4 + 4
const segBytes = u32r(p); p += 4
const segsStart = p
console.log(`segBytes=${segBytes} segRows=${segBytes / 36} boneCount=${pm.bones.length}`)

for (const B of [41, 22, 8]) {
  const seg = segsStart + B * segBytes
  console.log(`\n=== bone ${B} (b2=${2 * B}, posShift=${Math.floor(2 * B / 9)}, posCol=${(2 * B) % 9}, rotCol=${(2 * B + 5) % 9}) ===`)
  console.log('row | c0      c1      c2      c3      c4      c5      c6      c7      c8')
  for (let r = 0; r < segBytes / 36; r++) {
    const vals = []
    for (let c = 0; c < 9; c++) vals.push(f32(bytes, seg + r * 36 + c * 4))
    console.log(`r${String(r).padStart(2)} | ` + vals.map((v) => (Math.abs(v) >= 1000 ? v.toFixed(0).padStart(7) : v.toFixed(2).padStart(7))).join(' '))
  }
}
