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
const pkg = readPkg('D:/SteamLibrary/steamapps/workshop/content/431960/2804379697/scene.pkg')
const b = pkg.read('models/右眼_puppet.mdl')
const f32At = (q) => new Float32Array(new Int32Array([(b[q] | (b[q+1]<<8) | (b[q+2]<<16) | (b[q+3]<<24)) | 0]).buffer)[0]
const u32At = (q) => (b[q] | (b[q+1]<<8) | (b[q+2]<<16) | (b[q+3]<<24)) >>> 0
const i32At = (q) => (b[q] | (b[q+1]<<8) | (b[q+2]<<16) | (b[q+3]<<24)) | 0
const dumpBytes = (off, n) => {
  const lines = []
  for (let i = 0; i < n; i += 16) {
    const bytes = []
    for (let j = 0; j < 16 && off + i + j < b.length; j++) bytes.push(b[off + i + j].toString(16).padStart(2, '0'))
    const ascii = bytes.map(x => { const v = parseInt(x, 16); return v >= 32 && v < 127 ? String.fromCharCode(v) : '.' }).join('')
    lines.push(String(off + i).padStart(7) + ': ' + bytes.join(' ').padEnd(47) + ' |' + ascii + '|')
  }
  return lines.join('\n')
}
console.log('=== MDLS0001 @79575 (前 128B) ===')
console.log(dumpBytes(79575, 128))
console.log()
console.log('=== MDLS0001 后到 MDLA0001 (79575→79982) 之间 ===')
console.log(dumpBytes(79575, 79982 - 79575))
