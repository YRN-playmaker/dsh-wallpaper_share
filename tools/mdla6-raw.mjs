// 精确检查 MDLA0006 骨骼0 与骨骼1 的帧字节
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
const pkg = readPkg('D:/SteamLibrary/steamapps/workshop/content/431960/3363252053/scene.pkg')
const b = pkg.read('models/身体部件_puppet.mdl')
const mdla = findTag(b, 'MDLA0006')
let q = mdla + 17
q += 4; q += 4
while (b[q] !== 0) q++; q++
while (b[q] !== 0) q++; q++
q += 4; q += 4; q += 4
const boneCount = u32At(b, q); q += 4
q += 4
const dataLen = u32At(b, q); q += 4
q++
const dataStart = q
console.log('dataStart@' + dataStart + ' dataLen=' + dataLen + ' bones=' + boneCount + ' frames=' + (dataLen/36))
// 骨骼0 首帧原始 40B
const show = (label, off) => {
  const hex = Array.from(b.slice(off, off + 40)).map(x => x.toString(16).padStart(2, '0')).join(' ')
  console.log(label + ' @' + off + ': ' + hex)
  // 各种解读
  console.log('  f32@0: ' + [0,1,2,3,4,5,6,7,8,9].map(k => f32At(b, off + k*4).toFixed(3)).join(', '))
  // 3B t + 8 f32
  const t3 = (b[off] | (b[off+1]<<8) | (b[off+2]<<16)) >>> 0
  console.log('  3B t=' + t3 + ' + 8f32: ' + [0,1,2,3,4,5,6,7].map(k => f32At(b, off + 3 + k*4).toFixed(3)).join(', '))
}
show('骨骼0 f0', dataStart)
show('骨骼0 f1', dataStart + 36)
show('骨骼1 f0 (无头)', dataStart + dataLen)
show('骨骼1 f1 (无头)', dataStart + dataLen + 36)
