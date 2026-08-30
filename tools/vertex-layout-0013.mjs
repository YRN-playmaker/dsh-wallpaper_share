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
// offset=39 网格：vertexBytes @43 = 64896, verts=1014, indices @47+64896=64943
const gridOff = 39
const vertexBytes = u32At(b, gridOff + 4)
const vo = gridOff + 8
const ilo = vo + vertexBytes
const indexBytes = u32At(b, ilo)
const io = ilo + 4
console.log('gridOff=' + gridOff, 'vertexBytes=' + vertexBytes, 'verts=' + (vertexBytes/64), 'indexBytes=' + indexBytes, 'indices=' + (indexBytes/2))
console.log()
console.log('=== 前 3 个顶点（stride=64）===')
for (let i = 0; i < 3; i++) {
  const vp = vo + i * 64
  const vals = []
  for (let k = 0; k < 16; k++) vals.push(f32At(b, vp + k * 4))
  console.log('vert' + i + ':', vals.map(v => v.toFixed(3)).join(', '))
}
// 检查权重位置：常见布局 pos@0(12B) + uv@12(8B) + normal@20(12B)? + weights@?
console.log()
console.log('=== 顶点偏移 0-64 逐 f32 ===')
const vp0 = vo
for (let k = 0; k < 16; k++) {
  console.log('  @+' + (k*4).toString().padStart(2), f32At(b, vp0 + k * 4).toFixed(4))
}
// 检查哪些偏移是权重（多个顶点在固定偏移都是 0-1 范围）
console.log()
console.log('=== 各偏移位 10 个顶点的值（找权重模式） ===')
for (let off = 0; off < 64; off += 4) {
  const samples = []
  for (let i = 0; i < 10; i++) samples.push(f32At(b, vo + i * 64 + off))
  const minV = Math.min(...samples)
  const maxV = Math.max(...samples)
  const in01 = samples.every(v => v >= -0.01 && v <= 1.01)
  if (in01 || (maxV - minV < 1.5 && samples.every(v => Number.isFinite(v) && Math.abs(v) < 10))) {
    console.log('  @+' + String(off).padStart(2) + ' 范围[' + minV.toFixed(2) + ',' + maxV.toFixed(2) + '] 样本: ' + samples.map(v=>v.toFixed(2)).join(',') + (in01 ? '  <== 可能权重' : ''))
  }
}
// 骨骼索引（u16）探测
console.log()
console.log('=== u16 骨骼索引探测（0-64） ===')
for (let off = 0; off < 64; off += 2) {
  const samples = []
  for (let i = 0; i < 10; i++) samples.push(u16At(b, vo + i * 64 + off))
  const maxV = Math.max(...samples)
  if (maxV < 64) console.log('  @+' + String(off).padStart(2) + ' 样本: ' + samples.join(',') + '  <== 可能是骨骼索引')
}
