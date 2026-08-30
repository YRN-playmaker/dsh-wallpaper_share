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
const dump = (off, n) => {
  const out = []
  for (let i = off; i < Math.min(off + n, b.length); i += 4) {
    const bytes = Array.from(b.subarray(i, Math.min(i + 4, b.length))).map(x => x.toString(16).padStart(2, '0')).join(' ')
    const u32 = (b[i] | (b[i+1]<<8) | (b[i+2]<<16) | (b[i+3]<<24)) >>> 0
    const f32 = new Float32Array(new Int32Array([u32]).buffer)[0]
    out.push(String(i).padStart(7) + '  ' + bytes.padEnd(12) + ' u32=' + String(u32).padStart(10) + ' f32=' + (Number.isFinite(f32) ? f32.toFixed(3) : '?'))
  }
  return out.join('\n')
}
// id 479 位置在 79999，dump 前后
console.log('=== 79920-80060 ===')
console.log(dump(79920, 140))
// 文件开头结构：magic 0013 + 材质 + 之后的头部
console.log()
console.log('=== 0-160 ===')
console.log(dump(0, 160))
