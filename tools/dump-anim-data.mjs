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
console.log('MDLA0001 @', mdla)
// 条目解析
let q = mdla + 17
const id = u32At(b, q); q += 4
console.log('id:', id)
q += 4
let nm = ''
while (b[q] !== 0) { nm += String.fromCharCode(b[q]); q++ }
q++
let lp = ''
while (b[q] !== 0) { lp += String.fromCharCode(b[q]); q++ }
q++
console.log('name:', nm, 'loop:', lp, 'q=', q)
const duration = f32At(b, q); q += 4
const bc = u32At(b, q); q += 4
console.log('duration:', duration, 'bc:', bc, 'q=', q)
// 打印后续 u32
for (let i = 0; i < 5; i++) { console.log('  u32@' + q + ' =', u32At(b, q)); q += 4 }
const dataStart = q
console.log('dataStart:', dataStart, '(文件总长', b.length + ')')
// dump 数据区前 160 字节
console.log()
console.log('=== 数据区前 160B ===')
for (let i = 0; i < 160; i += 16) {
  const bytes = Array.from(b.subarray(dataStart + i, dataStart + i + 16)).map(x => x.toString(16).padStart(2, '0')).join(' ')
  const f32s = []
  for (let k = 0; k < 16; k += 4) {
    const v = f32At(b, dataStart + i + k)
    f32s.push(Number.isFinite(v) ? v.toFixed(2) : '?')
  }
  console.log(String(dataStart + i).padStart(7) + ': ' + bytes + '  f32:' + f32s.join(' '))
}
