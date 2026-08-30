// stride=32 与 48 的全布局扫描（pos/uv/weights/boneIndices）
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
const vo = 47
const vertexBytes = u32At(b, 43)
const ilo = vo + vertexBytes
const indexBytes = u32At(b, ilo)
const io = ilo + 4
for (const stride of [32, 48]) {
  const vc = vertexBytes / stride
  console.log(`\n===== stride=${stride} verts=${vc} =====`)
  // pos@0 合理性
  let posOK = 0
  for (let i = 0; i < vc; i++) {
    const vp = vo + i * stride
    const x = f32At(b, vp), y = f32At(b, vp + 4)
    if (Number.isFinite(x) && Number.isFinite(y) && Math.abs(x) < 500 && Math.abs(y) < 500) posOK++
  }
  console.log('pos@0 合理:', posOK + '/' + vc)
  // UV 扫描（两个连续 f32 ∈ [0,1] 比例高）
  for (let uvOff = 0; uvOff <= stride - 8; uvOff += 4) {
    let m = 0
    for (let i = 0; i < vc; i++) {
      const vp = vo + i * stride
      const u = f32At(b, vp + uvOff), v = f32At(b, vp + uvOff + 4)
      if (u >= -0.001 && u <= 1.001 && v >= -0.001 && v <= 1.001) m++
    }
    if (m > vc * 0.8) console.log('  UV@' + uvOff + ': ' + m + '/' + vc)
  }
  // 权重扫描（4 连续 f32 和≈1）
  for (let wOff = 0; wOff <= stride - 16; wOff += 4) {
    let m = 0
    for (let i = 0; i < vc; i++) {
      const vp = vo + i * stride
      const w = [0,1,2,3].map(k => f32At(b, vp + wOff + k*4))
      if (w.every(x => x >= -0.01 && x <= 1.01) && Math.abs(w[0]+w[1]+w[2]+w[3]-1) < 0.05) m++
    }
    if (m > vc * 0.5) console.log('  权重@' + wOff + ': ' + m + '/' + vc + ' 示例:' + [0,1,2,3].map(k=>f32At(b, vo + wOff + k*4).toFixed(2)).join(','))
  }
  // boneIndex 扫描（4 u16 < 6）
  for (let biOff = 0; biOff <= stride - 8; biOff += 2) {
    let m = 0
    for (let i = 0; i < vc; i++) {
      const vp = vo + i * stride
      const idx = [0,1,2,3].map(k => u16At(b, vp + biOff + k*2))
      if (idx.every(x => x < 6)) m++
    }
    if (m > vc * 0.5) console.log('  boneIdx@' + biOff + ': ' + m + '/' + vc)
  }
  // 打印前 3 顶点完整字节
  for (let i = 0; i < 3; i++) {
    const vp = vo + i * stride
    const bytes = Array.from(b.subarray(vp, vp + stride)).map(x => x.toString(16).padStart(2, '0')).join(' ')
    console.log('  v' + i + ': ' + bytes)
  }
}
