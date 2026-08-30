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
const u16At = (b, q) => b[q] | (b[q+1]<<8)
const pkg = readPkg('D:/SteamLibrary/steamapps/workshop/content/431960/2804379697/scene.pkg')
const b = pkg.read('models/右眼_puppet.mdl')
const find = (bytes, tag, from = 0) => {
  const len = bytes.length
  const t = new Uint8Array(tag.length)
  for (let i = 0; i < tag.length; i++) t[i] = tag.charCodeAt(i)
  let i = from
  while (i < len - tag.length) {
    let ok = true
    for (let k = 0; k < tag.length; k++) if (bytes[i+k] !== t[k]) { ok = false; break }
    if (ok) return i
    i++
  }
  return -1
}
const mdla = find(b, 'MDLA0001')
// 用与 ScenePuppet.ts 完全一致的解析
const animCount = Math.max(0, Math.min(64, u32At(b, mdla + 13)))
let q = mdla + 17
const id = u32At(b, q); q += 4
q += 4
let nm = ''
while (b[q] !== 0 && nm.length < 128) { nm += String.fromCharCode(b[q]); q++ }
q++
let lp = ''
while (b[q] !== 0 && lp.length < 128) { lp += String.fromCharCode(b[q]); q++ }
q++
const duration = f32At(b, q); q += 4
const bc = u32At(b, q); q += 4
q += 4; q += 4; q += 4
const dataLen = u32At(b, q); q += 4
q++ // extra
console.log('animCount=' + animCount, 'id=' + id, 'name=' + nm, 'loop=' + lp, 'duration=' + duration, 'bc=' + bc, 'dataLen=' + dataLen, 'dataStart=' + q)
console.log('每帧36B帧数=' + (dataLen/36))
// dump 数据区前 4 个 16B 块（原始字节 + 尝试 t 在 0,4,8 偏移）
console.log()
console.log('=== 数据区 @' + q + ' 原始 ===')
for (let i = 0; i < 64; i += 16) {
  const bytes = Array.from(b.subarray(q + i, q + i + 16)).map(x => x.toString(16).padStart(2, '0')).join(' ')
  console.log(String(q + i).padStart(7) + ': ' + bytes)
}
// 尝试帧结构：[8f32 @0][t 4B @32]? 数据 36B
console.log()
console.log('=== 试 [8f32][4B] 前2帧 ===')
for (let f = 0; f < 2; f++) {
  const fp = q + f * 36
  const vals = []
  for (let k = 0; k < 8; k++) vals.push(f32At(b, fp + k * 4))
  const t4 = u32At(b, fp + 32)
  console.log('帧' + f, 't4=' + t4, vals.map(v => v.toFixed(3)).join(', '))
}
// 试 [f32 t @0][8f32 @4] → 36B? 不对 4+32=36 ✓
console.log()
console.log('=== 试 [f32 t][8f32] 前2帧 ===')
for (let f = 0; f < 2; f++) {
  const fp = q + f * 36
  const t = f32At(b, fp)
  const vals = []
  for (let k = 0; k < 8; k++) vals.push(f32At(b, fp + 4 + k * 4))
  console.log('帧' + f, 't=' + t.toFixed(3), vals.map(v => v.toFixed(3)).join(', '))
}
// 试帧大小 40B? 或者骨骼数×?
console.log()
console.log('=== 尝试其他帧大小整除 ===')
for (const fs of [20, 24, 28, 32, 36, 40, 44, 48, 64, 72, 80]) {
  if (dataLen % fs === 0) console.log('  frameSize=' + fs, 'frames=' + (dataLen/fs))
}
