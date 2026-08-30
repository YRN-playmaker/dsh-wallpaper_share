// 深入验证 0013 mesh：offset=39 处 stride=64 数据是否是真实网格
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
// 材质路径在 offset 17, 结束 @38（"materials/右眼.json\0" 22 字节）
// offset=39 开始：u32@39=0, u32@43=64896(vertexBytes), 顶点@47
const gridOff = 39
const vertexBytes = u32At(b, gridOff + 4)
const vo = gridOff + 8
const ilo = vo + vertexBytes
const indexBytes = u32At(b, ilo)
const io = ilo + 4
console.log('gridOff=' + gridOff, 'vertexBytes=' + vertexBytes, 'verts=' + (vertexBytes/64), 'indexBytes=' + indexBytes, 'indices=' + (indexBytes/2))
// 打印前 5 顶点完整 64B
console.log()
console.log('=== 前 5 顶点完整 64B ===')
for (let i = 0; i < 5; i++) {
  const vp = vo + i * 64
  const vals = []
  for (let k = 0; k < 16; k++) vals.push(f32At(b, vp + k * 4))
  console.log('vert' + i + ':', vals.map(v => v.toFixed(3)).join(', '))
}
// 检查索引范围
console.log()
console.log('=== 索引检查 ===')
let maxIdx = 0
let minIdx = 65535
let validIdx = true
for (let i = 0; i < Math.min(indexBytes / 2, 200); i++) {
  const v = u16At(b, io + i * 2)
  if (v > maxIdx) maxIdx = v
  if (v < minIdx) minIdx = v
  if (v >= vertexBytes / 64) validIdx = false
}
console.log('索引 min=' + minIdx + ' max=' + maxIdx + ' 顶点数=' + (vertexBytes/64) + ' 全部有效=' + validIdx)
// 顶点位置范围（全量）
console.log()
let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
let uvCount = 0
const vc = vertexBytes / 64
for (let i = 0; i < vc; i++) {
  const vp = vo + i * 64
  const x = f32At(b, vp), y = f32At(b, vp + 4)
  if (x < minX) minX = x
  if (x > maxX) maxX = x
  if (y < minY) minY = y
  if (y > maxY) maxY = y
  // 检查 UV 可能位置（0-1 范围）
  for (let k = 12; k <= 60; k += 4) {
    const val = f32At(b, vp + k)
    if (val >= -0.01 && val <= 1.01) uvCount++
  }
}
console.log('顶点位置范围 X: [' + minX.toFixed(1) + ', ' + maxX.toFixed(1) + '] Y: [' + minY.toFixed(1) + ', ' + maxY.toFixed(1) + ']')
console.log('UV 候选值总数:', uvCount)
// 检查 offset 39 与 MDLS0001 (79575) 之间的距离，整个区间应该就是 mesh
console.log('mesh 区域: ' + gridOff + '..' + (ilo + 4 + indexBytes) + ', MDLS0001 @79575')
// 检查顶点中是否有 weights（0-1 且和为 1）
console.log()
console.log('=== 权重探测：4 个连续 f32 和为 1 ===')
let weightFound = 0
for (let i = 0; i < vc && weightFound < 3; i++) {
  const vp = vo + i * 64
  for (let off = 12; off <= 56; off += 4) {
    const w = [f32At(b, vp+off), f32At(b, vp+off+4), f32At(b, vp+off+8), f32At(b, vp+off+12)]
    if (w.every(x => x >= -0.01 && x <= 1.01) && Math.abs(w[0]+w[1]+w[2]+w[3] - 1) < 0.02) {
      console.log('vert' + i + ' @off+' + off + ': weights=[' + w.map(x=>x.toFixed(2)).join(',') + '] 和=' + (w.reduce((a,b)=>a+b,0).toFixed(3)))
      weightFound++
      break
    }
  }
}
if (weightFound === 0) console.log('未找到标准权重组')
