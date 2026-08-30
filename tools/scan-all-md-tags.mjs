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
// 扫描所有 MD?? 标记（任意版本号）
const tags = ['MDLV', 'MDLS', 'MDAT', 'MDLA', 'MDLE', 'MDLB', 'MDLM']
const found = []
for (const tag of tags) {
  const t = new Uint8Array(8)
  for (let i = 0; i < 4; i++) t[i] = tag.charCodeAt(i)
  for (let pos = 0; pos < b.length - 8; pos++) {
    let ok = true
    for (let k = 0; k < 4; k++) if (b[pos + k] !== t[k]) { ok = false; break }
    if (ok) {
      // 版本号：后 4 字节应为 '00xx'
      let ver = ''
      for (let k = 4; k < 8; k++) ver += String.fromCharCode(b[pos + k])
      found.push({ tag, ver, off: pos })
      pos += 7
    }
  }
}
for (const f of found) console.log(f.tag + f.ver, 'at', f.off)
console.log()
console.log('=== MDLA0001 附近 (79970-80060) ===')
const dump = (off, n) => {
  const out = []
  for (let i = off; i < Math.min(off + n, b.length); i += 4) {
    const u32 = (b[i] | (b[i+1]<<8) | (b[i+2]<<16) | (b[i+3]<<24)) >>> 0
    const f32 = new Float32Array(new Int32Array([u32]).buffer)[0]
    out.push(String(i).padStart(7) + '  ' + Array.from(b.subarray(i, i+4)).map(x=>x.toString(16).padStart(2,'0')).join(' ') + '  u32=' + u32 + ' f32=' + (Number.isFinite(f32) ? f32.toFixed(2) : '?'))
  }
  return out.join('\n')
}
console.log(dump(79966, 100))
