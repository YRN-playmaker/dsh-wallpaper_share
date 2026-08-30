// 检查 0021 (Miku) 和 0013 (2804379697) 的 MDLA 动画结构差异
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
// Miku
const pkg2 = readPkg('D:/SteamLibrary/steamapps/workshop/content/431960/3409595232/scene.pkg')
const b2 = pkg2.read('models/导出初音_puppet.mdl')
console.log('=== Miku (0021) 导出初音_puppet.mdl ===')
console.log('magic:', utf8Slice(b2, 0, 4))
const mdla6 = find(b2, 'MDLA0006')
console.log('MDLA0006 @', mdla6, '总长', b2.length)
if (mdla6 >= 0) {
  const animCount = u32At(b2, mdla6 + 13)
  console.log('animCount:', animCount)
  let q = mdla6 + 17
  for (let a = 0; a < animCount && q + 8 <= b2.length; a++) {
    const id = u32At(b2, q); q += 4
    q += 4
    let nm = ''
    while (b2[q] !== 0 && nm.length < 64) { nm += String.fromCharCode(b2[q]); q++ }
    q++
    let lp = ''
    while (b2[q] !== 0 && lp.length < 64) { lp += String.fromCharCode(b2[q]); q++ }
    q++
    const duration = f32At(b2, q); q += 4
    const bc = u32At(b2, q); q += 4
    console.log(`  anim id=${id} name="${nm}" loop="${lp}" duration=${duration} bc=${bc} q=${q}`)
    q += 4; q += 4; q += 4
    const dataLen = u32At(b2, q); q += 4
    q++ // extra
    console.log(`    dataLen=${dataLen} dataStart=${q} 36B帧数=${(dataLen/36)}`)
    // 打印前 3 个 36B 块的 pos3
    for (let f = 0; f < 3; f++) {
      const fp = q + f * 36
      const v = []
      for (let k = 0; k < 8; k++) v.push(f32At(b2, fp + k * 4))
      console.log(`    帧${f}: t3B=${b2[fp].toString(16).padStart(2,'0')}${b2[fp+1].toString(16).padStart(2,'0')}${b2[fp+2].toString(16).padStart(2,'0')} pos=(${v[0].toFixed(2)},${v[1].toFixed(2)},${v[2].toFixed(2)}) quat=(${v[3].toFixed(2)},${v[4].toFixed(2)},${v[5].toFixed(2)},${v[6].toFixed(2)}) s=${v[7].toFixed(2)}`)
    }
    q += dataLen
  }
}
// MDLS 骨骼数
const mdls3 = find(b2, 'MDLS0003')
const mdls4 = find(b2, 'MDLS0004')
console.log('MDLS0003@', mdls3, 'MDLS0004@', mdls4)
if (mdls3 >= 0) {
  console.log('MDLS0003 boneCount@+13:', u32At(b2, mdls3 + 13))
} else if (mdls4 >= 0) {
  console.log('MDLS0004 boneCount@+13:', u32At(b2, mdls4 + 13))
}
