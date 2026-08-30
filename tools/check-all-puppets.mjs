// 检查所有 puppet 文件是否含 mesh（stride 52），及骨骼/动画概况
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
const findTag = (b, tag) => {
  const t = new Uint8Array(tag.length)
  for (let i = 0; i < t.length; i++) t[i] = tag.charCodeAt(i)
  for (let i = 0; i < b.length - t.length; i++) {
    let ok = true
    for (let k = 0; k < t.length; k++) if (b[i+k] !== t[k]) { ok = false; break }
    if (ok) return i
  }
  return -1
}
for (const name of ['models/右眼_puppet.mdl', 'models/右睫毛_puppet.mdl', 'models/左眼球_puppet.mdl', 'models/z左睫毛_puppet.mdl']) {
  const b = pkg.read(name)
  if (!b) { console.log(name + ': 无'); continue }
  const mdls = findTag(b, 'MDLS0001')
  const mdla = findTag(b, 'MDLA0001')
  // 扫描 mesh：stride 52
  let meshInfo = null
  if (mdls > 0) {
    for (let offset = 9; offset + 12 < mdls; offset++) {
      const vb = u32At(b, offset + 4)
      const vo2 = offset + 8
      const ilo2 = vo2 + vb
      if (vb === 0 || vb % 52 !== 0 || ilo2 + 4 > mdls) continue
      const ib = u32At(b, ilo2)
      const io2 = ilo2 + 4
      if (ib === 0 || ib % 6 !== 0 || io2 + ib > mdls) continue
      const vc = vb / 52
      let valid = true
      for (let i = 0; i < ib / 2; i++) {
        const v = b[io2 + i*2] | (b[io2 + i*2 + 1] << 8)
        if (v >= vc) { valid = false; break }
      }
      if (valid) { meshInfo = { vc, idx: ib / 2, offset }; break }
    }
  }
  const bc = mdls >= 0 ? u32At(b, mdls + 13) : 0
  console.log(name + ': len=' + b.length + ' mdls@' + mdls + ' mdla@' + mdla + ' boneCount=' + bc + ' mesh=' + (meshInfo ? ('stride52 vc=' + meshInfo.vc + ' idx=' + meshInfo.idx + ' @' + meshInfo.offset) : '无'))
}
