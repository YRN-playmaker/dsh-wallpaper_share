// dump 3465215190 人物 anim 头字段 + 每个校验条件的判定
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
  return { read: (n) => { const e = entries.find((x) => x.name === n); return e ? new Uint8Array(buf.subarray(dataStart + e.offset, dataStart + e.offset + e.size)) : null }, names: () => entries.map((e) => e.name) }
}
function findTag(bytes, tag, from = 0) {
  const t = new TextEncoder().encode(tag)
  outer: for (let i = from; i + t.length <= bytes.length; i++) {
    for (let k = 0; k < t.length; k++) if (bytes[i + k] !== t[k]) continue outer
    return i
  }
  return -1
}
const u32r = (b, q) => b[q] | (b[q + 1] << 8) | (b[q + 2] << 16) | (b[q + 3] << 24)

const pkg = parsePkg('D:/SteamLibrary/steamapps/workshop/content/431960/3465215190/scene.pkg')
const bytes = pkg.read('models/人物_puppet.mdl')
const len = bytes.length
const pm = parsePuppetMdl(bytes)
console.log('解析结果 animsV2=' + pm.animsV2.length)
let p = findTag(bytes, 'MDLA0006')
console.log('MDLA0006 @' + p + ' len=' + len)
p += 9
const totalBytes = u32r(bytes, p); p += 4
const animCount = u32r(bytes, p); p += 4
console.log('总字节=' + totalBytes + ' animCount=' + animCount)
for (let a = 0; a < animCount && p + 12 <= len; a++) {
  const animStart = p
  const id = u32r(bytes, p); p += 4
  p += 4
  let s = p
  while (bytes[s] !== 0) s++
  const nm = bytes.subarray(p, s).toString('utf8')
  p = s + 1
  const loopStart = p
  while (bytes[p] !== 0) p++
  const loop = bytes.subarray(loopStart, p).toString('utf8')
  p++
  const markScanStart = p
  let scan = 0
  while (p + 1 < len && !(bytes[p] === 0xf0 && bytes[p + 1] === 0x41)) { p++; scan++ }
  const found = p + 1 < len || (bytes[p] === 0xf0 && bytes[p + 1] === 0x41)
  console.log(`anim[${a}] id=${id} name="${nm}" loop="${loop}" 标记扫描=${scan}B found=${found}`)
  if (!found) { console.log('  → 会 break (无标记)'); break }
  p += 2
  const frameCount = bytes[p] | (bytes[p + 1] << 8); p += 2
  p += 2; p += 4
  const boneCount = u32r(bytes, p); p += 4
  p += 4
  const segBytes = u32r(bytes, p); p += 4
  const segRows = segBytes / 36
  console.log(`  frameCount=${frameCount} boneCount=${boneCount} segBytes=${segBytes} segRows=${segRows}`)
  const c1 = boneCount >= 1 && boneCount <= 512
  const c2 = frameCount >= 1 && frameCount <= 8192
  const c3 = Number.isInteger(segRows) && segRows >= frameCount && segRows <= frameCount + 8
  console.log(`  校验: bones=${c1} frames=${c2} segRows范围=${c3} → ${c1 && c2 && c3 ? '通过' : 'BREAK!'}`)
  p += segBytes * boneCount
  console.log('  下一个动画 @' + p)
}
