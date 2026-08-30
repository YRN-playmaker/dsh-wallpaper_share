// 扫描右睫毛_puppet.mdl 的 mesh 真实偏移（stride 52 布局验证）
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
const u32At = (b, q) => (b[q] | (b[q+1]<<8) | (b[q+2]<<16) | (b[q+3]<<24)) >>> 0
const f32At = (b, q) => new Float32Array(new Int32Array([(b[q] | (b[q+1]<<8) | (b[q+2]<<16) | (b[q+3]<<24)) | 0]).buffer)[0]
const pkg = readPkg('D:/SteamLibrary/steamapps/workshop/content/431960/2804379697/scene.pkg')
const b = pkg.read('models/右睫毛_puppet.mdl')
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
const mdls = findTag(b, 'MDLS0001')
const mdla = findTag(b, 'MDLA0001')
console.log('len=' + b.length + ' mdls@' + mdls + ' mdla@' + mdla)
// 打印前 100 字节 hex
console.log('前96字节:')
for (let i = 0; i < 96; i += 16) {
  const hex = Array.from(b.slice(i, i+16)).map(x => x.toString(16).padStart(2, '0')).join(' ')
  const ascii = Array.from(b.slice(i, i+16)).map(x => (x >= 32 && x < 127) ? String.fromCharCode(x) : '.').join('')
  console.log('  ' + i.toString().padStart(4) + ': ' + hex + '  ' + ascii)
}
// 从 offset 9 开始扫描 stride 52 的合法 mesh
console.log('\n=== stride 52 扫描 ===')
for (let offset = 9; offset < Math.min(mdls, 200); offset++) {
  const vb = u32At(b, offset + 4)
  if (vb === 0 || vb % 52 !== 0) continue
  const vo = offset + 8
  const ilo = vo + vb
  if (ilo + 4 > mdls) continue
  const ib = u32At(b, ilo)
  if (ib === 0 || ib % 6 !== 0 || ib > 300000) continue
  const io = ilo + 4
  if (io + ib > mdls) continue
  // 顶点合理性：首顶点 pos 在合理范围
  const vp = vo
  const px = f32At(b, vp), py = f32At(b, vp + 4)
  console.log('  offset=' + offset + ' vb=' + vb + ' vc=' + vb/52 + ' ib=' + ib + ' idx=' + (io - offset) + ' firstPos=(' + px.toFixed(1) + ',' + py.toFixed(1) + ')')
}
