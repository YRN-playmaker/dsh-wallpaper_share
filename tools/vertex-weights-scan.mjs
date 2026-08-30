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
const gridOff = 39
const vertexBytes = u32At(b, gridOff + 4)
const vo = gridOff + 8
const ilo = vo + vertexBytes
const indexBytes = u32At(b, ilo)
const io = ilo + 4
const vc = vertexBytes / 64
console.log('verts=' + vc, 'indices=' + (indexBytes/2))
// 对每个 4B 偏移（0-60）统计：多个顶点的该偏移是否符合权重特征（0-1 范围，且同骨骼的4连续和≈1）
console.log()
console.log('=== 权重扫描（4 连续 f32，和≈1，采样前 20 顶点） ===')
for (let off = 0; off <= 56; off += 4) {
  let matchCount = 0
  for (let i = 0; i < 20; i++) {
    const vp = vo + i * 64
    const w = []
    for (let k = 0; k < 4; k++) w.push(f32At(b, vp + off + k * 4))
    if (w.every(x => x >= -0.001 && x <= 1.001) && Math.abs(w[0]+w[1]+w[2]+w[3] - 1) < 0.01) matchCount++
  }
  if (matchCount >= 15) console.log('  @off+' + off + ': ' + matchCount + '/20 顶点权重和≈1')
}
console.log()
console.log('=== 骨骼索引扫描（u16，< 骨骼数，采样前 20 顶点） ===')
// 骨骼数 = 5（MDLS0001）
for (let off = 0; off <= 62; off += 2) {
  let matchCount = 0
  for (let i = 0; i < 20; i++) {
    const vp = vo + i * 64
    const idx = u16At(b, vp + off)
    if (idx < 8) matchCount++
  }
  if (matchCount >= 15) console.log('  @+' + off + ': ' + matchCount + '/20 u16<8')
}
console.log()
console.log('=== 每个顶点的完整 64B 分块（offsets 0-63 每 4B 一 f32/u16/u32） ===')
// 打印 6 个顶点各偏移的值，便于人工识别
for (let i = 0; i < 6; i++) {
  const vp = vo + i * 64
  console.log('vert' + i + ':')
  for (let off = 0; off < 64; off += 4) {
    const f = f32At(b, vp + off)
    const u = u32At(b, vp + off)
    const u16a = u16At(b, vp + off)
    const u16b = u16At(b, vp + off + 2)
    console.log(`  @${String(off).padStart(2)}: f32=${f.toFixed(3).padStart(8)} u32=${String(u).padStart(10)} u16=(${u16a},${u16b})`)
  }
}