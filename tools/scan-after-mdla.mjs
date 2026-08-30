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
const b = pkg.read('models/右眼_puppet.mdl')
console.log('文件总长:', b.length)
// 找所有 tag
for (const tag of ['MDLS0001','MDLA0001','MDLE0002','MDAT0001','MDAT0002','MDAT0003','MDLA0006','MDLS0003','MDLV0001','MDLV0002','MDLV0003','MDLV0004']) {
  const p = find(b, tag)
  if (p >= 0) console.log(tag, '@', p)
}
// MDLA0001 @ 79982, dataStart=80045, dataLen=7236 → 结束 87281
// 打印 87281 之后 400B
console.log()
console.log('=== 87281 (dataLen 后) 之后 400B ===')
for (let off = 87281; off < 87281 + 400 && off < b.length; off += 16) {
  const bytes = Array.from(b.subarray(off, off + 16)).map(x => x.toString(16).padStart(2, '0')).join(' ')
  const f32s = []
  for (let k = 0; k < 16; k += 4) f32s.push(f32At(b, off + k).toFixed(2))
  console.log(String(off).padStart(7) + ': ' + bytes + '  f32[' + f32s.join(' ') + ']')
}
// 检查 87281 附近是否是另一个动画数据（可能有变化的值）
console.log()
console.log('=== 搜索 87281 后是否有变化的值（非 bind） ===')
const bind = [-8.997, -0.508, 0, 0, 0, 0, 1, 1, 1]
let found = 0
for (let off = 87281; off < b.length - 36 && found < 10; off++) {
  let same = true
  for (let k = 0; k < 9; k++) {
    if (Math.abs(f32At(b, off + k * 4) - bind[k]) > 1e-3) { same = false; break }
  }
  if (!same) {
    const v = []
    for (let k = 0; k < 9; k++) v.push(f32At(b, off + k * 4))
    if (v.every(x => Number.isFinite(x) && Math.abs(x) < 10000)) {
      console.log('  @' + off + ' (off+' + (off-87281) + '): ' + v.map(x=>x.toFixed(2)).join(', '))
      found++
    }
  }
}
