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
console.log('=== 文件头 0-80 字节 ===')
for (let off = 0; off < 80; off += 16) {
  const bytes = Array.from(b.subarray(off, off + 16)).map(x => x.toString(16).padStart(2, '0')).join(' ')
  const f32s = []
  for (let k = 0; k < 16; k += 4) f32s.push(f32At(b, off + k).toFixed(2))
  console.log(String(off).padStart(4) + ': ' + bytes + '  f32[' + f32s.join(' ') + ']')
}
console.log()
console.log('=== 0-39 逐字节 ===')
for (let off = 0; off < 40; off++) {
  const byte = b[off].toString(16).padStart(2, '0')
  const c = b[off] >= 32 && b[off] < 127 ? String.fromCharCode(b[off]) : '.'
  console.log(String(off).padStart(3) + ': ' + byte + ' (' + c + ')')
}
