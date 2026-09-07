// 审计 MDLA 段边界：segBytes vs fc*36，尾帧读取是否越界
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

function findTag(bytes, tag, from = 0) {
  const t = new TextEncoder().encode(tag)
  outer: for (let i = from; i + t.length <= bytes.length; i++) {
    for (let k = 0; k < t.length; k++) if (bytes[i + k] !== t[k]) continue outer
    return i
  }
  return -1
}
const u32 = (b, p) => b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24)
const u16 = (b, p) => b[p] | (b[p + 1] << 8)
const f32 = (b, p) => new DataView(b.buffer, b.byteOffset, b.byteLength).getFloat32(p, true)

const pkg = parsePkg('D:/SteamLibrary/steamapps/workshop/content/431960/3465215190/scene.pkg')
const bytes = pkg.read('models/人物_puppet.mdl')

// 手动重走 MDLA 扫描（与 ScenePuppet 相同），打印每个动画的头部细节
const len = bytes.length
let p = findTag(bytes, 'MDLA0006')
if (p < 0) { console.log('no MDLA0006'); process.exit(0) }
console.log('MDLA0006 @', p)
p += 9
p += 4 // u32 0 (assume)
const animCount = u32(bytes, p); p += 4
console.log('animCount =', animCount)
for (let a = 0; a < animCount; a++) {
  const id = u32(bytes, p); p += 4
  p += 4
  let s = p
  while (s < len && bytes[s] !== 0 && s - p < 128) s++
  const nm = new TextDecoder().decode(bytes.subarray(p, s))
  p = s + 1
  console.log(`anim[${a}] id=${id} name="${nm}" p=${p}`)
  // 找 0xF0 0x41 标记
  while (p + 1 < len && !(bytes[p] === 0xf0 && bytes[p + 1] === 0x41)) p++
  console.log(`  marker 0xF0 0x41 @ ${p}`)
  p += 2
  const fc = u16(bytes, p); p += 2
  p += 2
  p += 4
  const boneCount = u32(bytes, p); p += 4
  p += 4
  const segBytes = u32(bytes, p); p += 4
  const expect = fc * 36
  console.log(`  fc=${fc} boneCount=${boneCount} segBytes=${segBytes}  期望 fc*36=${expect}  ${segBytes === expect ? 'OK' : '⚠️ 不一致!'}`)
  const segsStart = p
  // 每骨骼段起点合理性 + 尾帧读取越界检查
  for (let b = 0; b < boneCount; b++) {
    const segStart = segsStart + b * segBytes
    if (b === 6) {
      const b2 = 12, posShift = 1, posCol = 3, rotShift = 1, rotCol = 8
      for (const f of [0, 1, 63, 64, 65]) {
        const o = segStart + ((f + posShift) % fc) * 36 + posCol * 4
        const o2 = segStart + ((f + posShift + rotShift) % fc) * 36 + rotCol * 4
        console.log(`    bone6 f${f}: posOff=${o - segStart} (帧${(f + posShift) % fc}) px=${f32(bytes, o).toFixed(2)} py=${f32(bytes, o + 4).toFixed(2)}  rotOff=${o2 - segStart} (帧${(f + posShift + rotShift) % fc}) rot=${f32(bytes, o2).toFixed(4)}`)
      }
      // 打印 f65/66 行的原始 f32（整个 9 列）
      const row65 = segStart + 65 * 36
      const vals = []
      for (let c = 0; c < 9; c++) vals.push(f32(bytes, row65 + c * 4).toFixed(3))
      console.log('    seg 行65 全列:', vals.join(', '))
      const row0 = segStart + 0 * 36
      const vals0 = []
      for (let c = 0; c < 9; c++) vals0.push(f32(bytes, row0 + c * 4).toFixed(3))
      console.log('    seg 行0  全列:', vals0.join(', '))
    }
  }
  p = segsStart + segBytes * boneCount
  console.log(`  段区结束 @ ${p}，文件长 ${len}`)
}
