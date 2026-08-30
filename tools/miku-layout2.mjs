// 分析 MDLA0006 段内第一个动画的数据布局：38 骨骼 × 151帧 × 36B
import fs from 'fs'
function utf8Slice(buf, a, b) { return Buffer.from(buf.subarray(a, b)).toString('utf8') }
const readPkg = (path) => {
  const buf = fs.readFileSync(path)
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  let pos = 0
  const readI32 = () => { const v = view.getInt32(pos, true); pos += 4; return v }
  const magicLen = readI32(); pos += magicLen; const version = readI32()
  const entries = []
  while (pos + 8 <= buf.length) {
    const nameLen = readI32(); if (nameLen <= 0 || nameLen > 2048 || pos + nameLen + 8 > buf.length) break
    const name = utf8Slice(buf, pos, pos + nameLen); pos += nameLen
    const offset = readI32(); const size = readI32()
    if (offset < 0 || size < 0 || offset + size > buf.length) break
    entries.push({ name, offset, size })
  }
  const dataStart = pos
  const read = (n) => { const e = entries.find((x) => x.name === n); return e ? buf.subarray(dataStart + e.offset, dataStart + e.offset + e.size) : null }
  return { read, entries }
}
const f32At = (b, q) => new Float32Array(new Int32Array([(b[q] | (b[q+1]<<8) | (b[q+2]<<16) | (b[q+3]<<24)) | 0]).buffer)[0]
const u32At = (b, q) => (b[q] | (b[q+1]<<8) | (b[q+2]<<16) | (b[q+3]<<24)) >>> 0
const pkg = readPkg('D:/SteamLibrary/steamapps/workshop/content/431960/3409595232/scene.pkg')
const b = pkg.read('models/导出初音_puppet.mdl')
const findTag = (bb, tag) => {
  const t = new Uint8Array(tag.length)
  for (let i = 0; i < t.length; i++) t[i] = tag.charCodeAt(i)
  for (let i = 0; i < bb.length - t.length; i++) {
    let ok = true
    for (let k = 0; k < t.length; k++) if (bb[i+k] !== t[k]) { ok = false; break }
    if (ok) return i
  }
  return -1
}
const mdla = findTag(b, 'MDLA0006')
// 解析第一个动画条目
let q = mdla + 17
const id = u32At(b, q); q += 4
q += 4
let nm = ''
while (b[q] !== 0) { nm += String.fromCharCode(b[q]); q++ }
q++
let lp = ''
while (b[q] !== 0) { lp += String.fromCharCode(b[q]); q++ }
q++
const duration = f32At(b, q); q += 4
const bc = u32At(b, q); q += 4
q += 4
const boneCount = u32At(b, q); q += 4
q += 4
const dataLen = u32At(b, q); q += 4
q++ // extra 1B
const dataStart = q
console.log('动画1: boneCount=' + boneCount + ' dataLen=' + dataLen + ' 每骨骼帧数=' + Math.floor(dataLen/36) + ' 数据起始@' + dataStart)
// 假设：每骨骼 dataLen 连续，无头。检查骨骼 0..37 的块起始
// 帧格式：每帧 36B = 3B t + 8 f32 + 1B? 或 9 f32？
// 先看骨骼0 首帧完整 36B，判断 t 是否递增
console.log('\n=== 骨骼0 前 6 帧 t 值（3B）与首 f32 ===')
for (let f = 0; f < 6; f++) {
  const fp = dataStart + f * 36
  const t = (b[fp] | (b[fp+1]<<8) | (b[fp+2]<<16)) >>> 0
  const v0 = f32At(b, fp + 3)
  console.log('  f' + f + ': t=' + t + ' f32@3=' + v0.toFixed(2))
}
// 看骨骼1 的块：如果无头，@ dataStart + 1*dataLen
console.log('\n=== 无头连续布局：骨骼块起点检查 ===')
for (let bi = 0; bi < Math.min(boneCount, 5); bi++) {
  const off = dataStart + bi * dataLen
  const t0 = (b[off] | (b[off+1]<<8) | (b[off+2]<<16)) >>> 0
  const v0 = f32At(b, off + 3)
  // 该块内所有帧的 maxSpan
  let maxSpan = 0
  for (let vi = 0; vi < 8; vi++) {
    let mn = Infinity, mx = -Infinity
    for (let f = 0; f < Math.floor(dataLen/36); f++) {
      const v = f32At(b, off + f*36 + 3 + vi*4)
      if (v < mn) mn = v
      if (v > mx) mx = v
    }
    if (Number.isFinite(mn) && mx - mn > maxSpan) maxSpan = mx - mn
  }
  console.log('  骨骼' + bi + ' @' + off + ': t0=' + t0 + ' f32@3=' + v0.toFixed(2) + ' maxSpan(8分量)=' + maxSpan.toFixed(2))
}
// 检查骨骼块是否间隔 dataLen（即无头）还是 dataLen+8（有头）
console.log('\n=== 间隔检查 ===')
for (let bi = 0; bi < Math.min(boneCount - 1, 3); bi++) {
  const off = dataStart + bi * dataLen
  const nextOff = off + dataLen
  // 看 nextOff 处是否是下一个骨骼（t 合理 + f32 合理）还是垃圾
  const tNext = (b[nextOff] | (b[nextOff+1]<<8) | (b[nextOff+2]<<16)) >>> 0
  const vNext = f32At(b, nextOff + 3)
  console.log('  骨骼' + bi + '→' + (bi+1) + ': next@' + nextOff + ' t=' + tNext + ' v0=' + vNext.toFixed(2))
  // 也检查 nextOff-8（有 8B 头的情况）
  const tAlt = (b[nextOff + 8] | (b[nextOff+9]<<8) | (b[nextOff+10]<<16)) >>> 0
  const vAlt = f32At(b, nextOff + 11)
  console.log('    若有8B头: next+8@' + (nextOff+8) + ' t=' + tAlt + ' v0=' + vAlt.toFixed(2))
}
