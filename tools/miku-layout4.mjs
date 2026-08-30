// dump 骨骼0 尾部 + 骨骼1 头部区域字节，确定骨骼块间结构
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
console.log('骨骼0 数据 @' + dataStart + ' dataLen=' + dataLen)
// dump 骨骼0 尾部（最后 40B）+ 骨骼1 区域（前 80B）
const end0 = dataStart + dataLen
console.log('\n=== 骨骼0 尾部（@' + (end0 - 40) + '..' + (end0 + 80) + '）===')
for (let off = end0 - 40; off < end0 + 80; off += 16) {
  const hex = Array.from(b.slice(off, off + 16)).map(x => x.toString(16).padStart(2, '0')).join(' ')
  const rel = (off - dataStart) >= 0 ? '+' + (off - dataStart) : (off - dataStart)
  console.log('  @' + off + ' (' + rel + '): ' + hex)
}
// 尝试各种帧格式确定骨骼1 的起点
console.log('\n=== 骨骼1 区域 f32 解读 ===')
for (let off = end0; off < end0 + 60; off += 4) {
  const f = f32At(b, off)
  const u = u32At(b, off)
  if (Number.isFinite(f) && Math.abs(f) < 10000) console.log('  @' + off + ' (' + (off - dataStart) + '): f32=' + f.toFixed(3) + ' u32=' + u)
}
