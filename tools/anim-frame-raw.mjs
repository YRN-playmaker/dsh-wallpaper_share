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
console.log('dataStart =', q, 'dataLen =', dataLen)
console.log()
// dump 80046 起 4 帧（36B×4 = 144B）
const dumpRow = (off) => {
  const bytes = Array.from(b.subarray(off, off + 16)).map(x => x.toString(16).padStart(2, '0')).join(' ')
  const f32s = []
  for (let k = 0; k < 16; k += 4) f32s.push(f32At(b, off + k).toFixed(2))
  const u16s = [u16At(b, off), u16At(b, off+2), u16At(b, off+4), u16At(b, off+6), u16At(b, off+8), u16At(b, off+10), u16At(b, off+12), u16At(b, off+14)]
  console.log(String(off).padStart(7) + ': ' + bytes + '  f32[' + f32s.join(' ') + '] u16[' + u16s.join(' ') + ']')
}
for (let f = 0; f < 4; f++) {
  console.log('--- 帧' + f + ' @' + (q + f * 36) + ' ---')
  for (let i = 0; i < 36; i += 16) dumpRow(q + f * 36 + i)
}
