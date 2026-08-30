// 精确分析 MDLA0006 骨骼0 结束、骨骼1 开始的结构
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
let q = mdla + 17
q += 4; q += 4
while (b[q] !== 0) q++; q++
while (b[q] !== 0) q++; q++
q += 4
q += 4; q += 4
const boneCount = u32At(b, q); q += 4
q += 4
const dataLen = u32At(b, q); q += 4
q++
const dataStart = q
console.log('MDLA0006 数据起始@' + dataStart + ' dataLen=' + dataLen + ' boneCount=' + boneCount)
// 骨骼0 数据区：@dataStart .. dataStart+dataLen-1
// dump 骨骼0 起始 3 帧 和 尾部 1 帧
console.log('\n=== 骨骼0 起始 3 帧 ===')
for (let f = 0; f < 3; f++) {
  const fp = dataStart + f * 36
  const hex = Array.from(b.slice(fp, fp + 36)).map(x => x.toString(16).padStart(2, '0')).join(' ')
  console.log('  f' + f + ' @' + fp + ': ' + hex)
}
const end0 = dataStart + dataLen
console.log('\n骨骼0 结束@' + end0 + '，其后 80 字节：')
for (let off = end0; off < end0 + 80; off += 16) {
  const hex = Array.from(b.slice(off, off + 16)).map(x => x.toString(16).padStart(2, '0')).join(' ')
  console.log('  @' + off + ' (' + (off - dataStart) + '): ' + hex)
}
// 假设骨骼1 无头（@end0 直接数据），检查 3 帧
console.log('\n=== 假设骨骼1 无头（@end0 直接数据）===')
for (let f = 0; f < 3; f++) {
  const fp = end0 + f * 36
  const t3 = (b[fp] | (b[fp+1]<<8) | (b[fp+2]<<16)) >>> 0
  const vals = [0,1,2,3,4,5,6,7].map(k => f32At(b, fp + 3 + k * 4))
  console.log('  f' + f + ' t=' + t3 + ' vals=' + vals.map(x=>x.toFixed(2)).join(', '))
}
// 假设骨骼1 有 8B 头（@end0+8 数据）
console.log('\n=== 假设骨骼1 有 8B 头（@end0+8 数据）===')
const h0 = u32At(b, end0), h1 = u32At(b, end0 + 4)
console.log('  头 h=(' + h0 + ',' + h1 + ')')
for (let f = 0; f < 3; f++) {
  const fp = end0 + 8 + f * 36
  const t3 = (b[fp] | (b[fp+1]<<8) | (b[fp+2]<<16)) >>> 0
  const vals = [0,1,2,3,4,5,6,7].map(k => f32At(b, fp + 3 + k * 4))
  console.log('  f' + f + ' t=' + t3 + ' vals=' + vals.map(x=>x.toFixed(2)).join(', '))
}
// 假设骨骼1 有 4B 头（@end0+4 数据）
console.log('\n=== 假设骨骼1 有 4B 头（@end0+4 数据）===')
for (let f = 0; f < 3; f++) {
  const fp = end0 + 4 + f * 36
  const t3 = (b[fp] | (b[fp+1]<<8) | (b[fp+2]<<16)) >>> 0
  const vals = [0,1,2,3,4,5,6,7].map(k => f32At(b, fp + 3 + k * 4))
  console.log('  f' + f + ' t=' + t3 + ' vals=' + vals.map(x=>x.toFixed(2)).join(', '))
}
