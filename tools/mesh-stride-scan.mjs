// 系统性扫描 0013 mesh 顶点布局
// 尝试 stride ∈ {32,48,64,96}, 各字段偏移, 用"UV∈[0,1] + 权重和≈1"组合打分
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
console.log('vertexBytes:', vertexBytes)
// 可能 stride
for (const stride of [32, 48, 64, 96, 80, 128]) {
  if (vertexBytes % stride !== 0) continue
  const vc = vertexBytes / stride
  console.log(`\n=== stride=${stride} verts=${vc} ===`)
  // pos @0 检查范围
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  let bad = false
  for (let i = 0; i < vc; i++) {
    const vp = vo + i * stride
    const x = f32At(b, vp), y = f32At(b, vp + 4)
    if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 1e6) { bad = true; break }
    if (x < minX) minX = x; if (x > maxX) maxX = x
    if (y < minY) minY = y; if (y > maxY) maxY = y
  }
  if (bad) { console.log('  pos@0 无效'); continue }
  console.log(`  pos@0 范围 X[${minX.toFixed(0)},${maxX.toFixed(0)}] Y[${minY.toFixed(0)},${maxY.toFixed(0)}]`)
  // 权重扫描：找连续 4 f32 和≈1
  for (let wOff = 0; wOff <= stride - 16; wOff += 4) {
    let match = 0
    for (let i = 0; i < Math.min(vc, 60); i++) {
      const vp = vo + i * stride
      const w = [0,1,2,3].map(k => f32At(b, vp + wOff + k*4))
      if (w.every(x => x >= -0.001 && x <= 1.001) && Math.abs(w[0]+w[1]+w[2]+w[3]-1) < 0.01) match++
    }
    if (match >= 40) console.log(`  权重@${wOff}: ${match}/60`)
  }
  // UV 扫描：找连续 2 f32 ∈[0,1]（比例高）
  for (let uvOff = 0; uvOff <= stride - 8; uvOff += 4) {
    let match = 0
    for (let i = 0; i < Math.min(vc, 60); i++) {
      const vp = vo + i * stride
      const u = f32At(b, vp + uvOff), v = f32At(b, vp + uvOff + 4)
      if (u >= -0.001 && u <= 1.001 && v >= -0.001 && v <= 1.001) match++
    }
    if (match >= 55) console.log(`  UV@${uvOff}: ${match}/60`)
  }
  // 打印前 2 顶点（pos@0）
  for (let i = 0; i < 2; i++) {
    const vp = vo + i * stride
    const bytes = Array.from(b.subarray(vp, vp + stride)).map(x => x.toString(16).padStart(2, '0')).join(' ')
    console.log(`  v${i}: ${bytes}`)
  }
}
