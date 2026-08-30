// 确认 MDLA0006 多骨骼布局：第一个动画数据段后是否还有 37 个骨骼的数据块
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
const mdle = findTag(b, 'MDLE0002')
console.log('MDLA0006@' + mdla + ' MDLE0002@' + mdle + ' 段大小=' + (mdle - mdla))
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
console.log('动画1: boneCount=' + boneCount + ' dataLen=' + dataLen + ' 数据起始@' + q)
// 数据段大小 = MDLE - q
console.log('数据段总大小=' + (mdle - q) + ' = ' + (dataLen) + '×' + ((mdle - q) / dataLen).toFixed(2) + ' 块')
// 在数据段内每隔 dataLen 检查是否有 [u32 0][u32 dataLen] 头
for (let i = 0; i < Math.min(boneCount, 6); i++) {
  const off = q + i * (dataLen + 8)
  const h0 = u32At(b, off)
  const h1 = u32At(b, off + 4)
  const f0 = f32At(b, off + 8)
  const f1 = f32At(b, off + 8 + 3) // 3B t 后的第一个 f32
  console.log('  骨骼' + i + ' @' + off + ': h=(' + h0 + ',' + h1 + ') 首字节=' + b[off].toString(16) + ' f32[0]=' + f0.toFixed(2))
}
// 无头布局：每骨骼 dataLen 直接连续
console.log('\n无头布局检查（每块 dataLen，无 8B 头）：')
for (let i = 0; i < Math.min(boneCount, 6); i++) {
  const off = q + i * dataLen
  const vals = [0,1,2,3,4,5,6,7,8].map(k => f32At(b, off + 3 + k * 4))
  console.log('  骨骼' + i + ' @' + off + ': pos=(' + vals[0].toFixed(1) + ',' + vals[1].toFixed(1) + ') scale=(' + vals[5].toFixed(2) + ',' + vals[6].toFixed(2) + ') 尾字节=' + b[off + dataLen - 1].toString(16))
}
// 检查有多少骨骼块直到 MDLE
const totalLen = mdle - q
console.log('\ntotalLen=' + totalLen + ' dataLen=' + dataLen + ' → 块数=' + (totalLen / dataLen).toFixed(2))
