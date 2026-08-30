// dump MDLA0006 动画数据段原始字节，确认帧格式
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
// 第一个动画条目
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
console.log('动画1 id=' + id + ' name="' + nm + '" boneCount=' + boneCount + ' dataLen=' + dataLen + ' 数据起始@' + q)
// 数据段前 12 帧的原始字节（每行 36B）
console.log('\n=== 数据段前 12 帧原始字节（36B/帧）===')
for (let f = 0; f < 12 && q + f * 36 + 36 <= b.length; f++) {
  const off = q + f * 36
  const hex = Array.from(b.slice(off, off + 36)).map(x => x.toString(16).padStart(2, '0')).join(' ')
  console.log('  f' + f + ': ' + hex)
}
// 尝试不同帧格式解读
console.log('\n=== 帧格式尝试 ===')
const F = 151
// A: [3B t][8 f32] (35B + 1B pad?)
console.log('A) 3B-t+8f32:')
for (let f = 0; f < 4; f++) {
  const fp = q + f * 36
  const t = (b[fp] | (b[fp+1]<<8) | (b[fp+2]<<16)) >>> 0
  const vals = [0,1,2,3,4,5,6,7].map(k => f32At(b, fp + 3 + k * 4))
  console.log('  f' + f + ' t=' + t + ' vals=' + vals.map(x=>x.toFixed(2)).join(', '))
}
// B: [4B t f32][8 f32]
console.log('\nB) f32-t + 8f32:')
for (let f = 0; f < 4; f++) {
  const fp = q + f * 36
  const t = f32At(b, fp)
  const vals = [0,1,2,3,4,5,6,7].map(k => f32At(b, fp + 4 + k * 4))
  console.log('  f' + f + ' t=' + t + ' vals=' + vals.map(x=>x.toFixed(2)).join(', '))
}
// C: [9 f32] 无时间戳
console.log('\nC) 9f32 无t:')
for (let f = 0; f < 4; f++) {
  const fp = q + f * 36
  const vals = [0,1,2,3,4,5,6,7,8].map(k => f32At(b, fp + k * 4))
  console.log('  f' + f + ' vals=' + vals.map(x=>x.toFixed(2)).join(', '))
}
// 骨骼0 数据检查：9f32 格式下所有帧是否一致（静止）
if (false) {}
