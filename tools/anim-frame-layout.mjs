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
let q = mdla + 17
q += 4 // id
q += 4 // u32
while (b[q] !== 0) q++
q++
while (b[q] !== 0) q++
q++
q += 4 // duration
q += 4 // bc
q += 4; q += 4; q += 4
const dataLen = u32At(b, q); q += 4
q++ // extra
console.log('dataStart =', q, 'dataLen =', dataLen, '每36B帧数 =', dataLen / 36)
// 尝试多种帧布局
// 布局A: [3B t][8×f32][1B pad] = 36
// 布局B: [8×f32][4B] = 36
// 布局C: [f32 t][8×f32] = 36
console.log()
console.log('=== 布局A: [3B t][8f32][1B] 前 5 帧 ===')
for (let f = 0; f < 5; f++) {
  const fp = q + f * 36
  const t = (b[fp] | (b[fp+1]<<8) | (b[fp+2]<<16)) >>> 0
  const vals = []
  for (let k = 0; k < 8; k++) vals.push(f32At(b, fp + 3 + k * 4))
  console.log('帧' + f, 't=' + t, vals.map(v => v.toFixed(2)).join(', '))
}
console.log()
console.log('=== 布局B: [8f32][4B u32] 前 5 帧 ===')
for (let f = 0; f < 5; f++) {
  const fp = q + f * 36
  const vals = []
  for (let k = 0; k < 8; k++) vals.push(f32At(b, fp + k * 4))
  const tail = u32At(b, fp + 32)
  console.log('帧' + f, 'u32@32=' + tail, vals.map(v => v.toFixed(2)).join(', '))
}
console.log()
console.log('=== 布局C: [f32 t][8f32] 前 5 帧 ===')
for (let f = 0; f < 5; f++) {
  const fp = q + f * 36
  const t = f32At(b, fp)
  const vals = []
  for (let k = 0; k < 8; k++) vals.push(f32At(b, fp + 4 + k * 4))
  console.log('帧' + f, 't=' + t.toFixed(3), vals.map(v => v.toFixed(2)).join(', '))
}
