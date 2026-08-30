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
const mdls = (() => {
  const t = new Uint8Array('MDLS0001'.length)
  for (let i = 0; i < t.length; i++) t[i] = 'MDLS0001'.charCodeAt(i)
  for (let i = 0; i < b.length - t.length; i++) {
    let ok = true
    for (let k = 0; k < t.length; k++) if (b[i+k] !== t[k]) { ok = false; break }
    if (ok) return i
  }
  return -1
})()
console.log('MDLS @', mdls)
const gridOff = 39
const vertexBytes = u32At(b, gridOff + 4)
const vo = gridOff + 8
const ilo = vo + vertexBytes
const indexBytes = u32At(b, ilo)
const io = ilo + 4
console.log('gridOff=39 vertexBytes=' + vertexBytes + ' vo=' + vo + ' ilo=' + ilo + ' indexBytes=' + indexBytes + ' io=' + io)
console.log('ilo+4+ib =', io + indexBytes, '== mdls?', io + indexBytes === mdls)
console.log('idx count:', indexBytes / 2, 'verts:', vertexBytes / 64)
// 打印前 3 顶点 64B 全字节
for (let i = 0; i < 3; i++) {
  const vp = vo + i * 64
  const bytes = Array.from(b.subarray(vp, vp + 64)).map(x => x.toString(16).padStart(2, '0')).join(' ')
  console.log('vert' + i + ' @' + vp + ': ' + bytes)
}
// 权重：检查哪些 4 连续 f32 位置（所有顶点）符合权重（0-1 且 4 和=1）
console.log()
console.log('=== 权重候选：跨 50 顶点统计 ===')
for (let off = 0; off <= 56; off += 4) {
  let cnt = 0
  for (let i = 0; i < 50; i++) {
    const vp = vo + i * 64
    const w = [0,1,2,3].map(k => f32At(b, vp + off + k * 4))
    if (w.every(x => x >= -0.001 && x <= 1.001) && Math.abs(w[0]+w[1]+w[2]+w[3]-1) < 0.01) cnt++
  }
  console.log('  @' + off + ': ' + cnt + '/50')
}
console.log()
console.log('=== 骨骼索引候选：跨 50 顶点统计 u16<6 ===')
for (let off = 0; off <= 60; off += 2) {
  let cnt = 0
  for (let i = 0; i < 50; i++) {
    const vp = vo + i * 64
    if (u16At(b, vp + off) < 6) cnt++
  }
  console.log('  @' + off + ': ' + cnt + '/50')
}
console.log()
// UV 候选：0-1 范围的 2 f32
console.log('=== UV 候选：跨 50 顶点统计 0<=v<=1 ===')
for (let off = 0; off <= 56; off += 4) {
  let cnt = 0
  for (let i = 0; i < 50; i++) {
    const vp = vo + i * 64
    const a = f32At(b, vp + off)
    const bb = f32At(b, vp + off + 4)
    if (a >= -0.01 && a <= 1.01 && bb >= -0.01 && bb <= 1.01) cnt++
  }
  console.log('  @' + off + ': ' + cnt + '/50')
}
