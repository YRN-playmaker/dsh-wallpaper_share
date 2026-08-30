// 把 0013 offset 47 的候选 mesh 渲染成 SVG wireframe，检查是否是真实网格
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
const vc = vertexBytes / 64
// 前 30 顶点的位置（@0-8），看是否有网格特征
console.log('=== 前 30 顶点 @0 位置 ===')
const pts = []
for (let i = 0; i < 30; i++) {
  const vp = vo + i * 64
  const x = f32At(b, vp), y = f32At(b, vp+4)
  pts.push([x, y])
  console.log('v' + i + ': (' + x.toFixed(1) + ',' + y.toFixed(1) + ')')
}
// 索引检查：是不是 4 顶点一个 quad（6 索引）
console.log()
console.log('=== 前 30 索引 ===')
const idx = []
for (let i = 0; i < 30; i++) idx.push(u16At(b, io + i * 2))
console.log(idx.join(', '))
// 计算位置范围
let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
for (let i = 0; i < vc; i++) {
  const vp = vo + i * 64
  const x = f32At(b, vp), y = f32At(b, vp+4)
  if (x < minX) minX = x; if (x > maxX) maxX = x
  if (y < minY) minY = y; if (y > maxY) maxY = y
}
console.log('位置范围 X:[' + minX.toFixed(1) + ',' + maxX.toFixed(1) + '] Y:[' + minY.toFixed(1) + ',' + maxY.toFixed(1) + ']')
// 生成 SVG wireframe（全部三角形）
const W = 600, H = 600
const sx = (x) => (x - minX) / (maxX - minX) * (W - 40) + 20
const sy = (y) => (maxY - y) / (maxY - minY) * (H - 40) + 20
let polys = ''
let count = 0
for (let i = 0; i + 2 < indexBytes / 2; i += 3) {
  const a = u16At(b, io + i * 2)
  const bb = u16At(b, io + i * 2 + 2)
  const c = u16At(b, io + i * 2 + 4)
  if (a >= vc || bb >= vc || c >= vc) continue
  const ax = f32At(b, vo + a * 64), ay = f32At(b, vo + a * 64 + 4)
  const bx = f32At(b, vo + bb * 64), by = f32At(b, vo + bb * 64 + 4)
  const cx = f32At(b, vo + c * 64), cy = f32At(b, vo + c * 64 + 4)
  polys += `<polygon points="${sx(ax)},${sy(ay)} ${sx(bx)},${sy(by)} ${sx(cx)},${sy(cy)}" fill="none" stroke="#333" stroke-width="0.5"/>`
  count++
}
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${polys}</svg>`
fs.writeFileSync('tools/eye-mesh-0013.svg', svg)
console.log('三角形数:', count, '→ tools/eye-mesh-0013.svg')
// 也检查每个顶点是否有 weight（单骨骼绑定？找 u32=2 或 0 模式）
console.log()
console.log('=== 前 10 顶点 @12 的 u32 ===')
for (let i = 0; i < 10; i++) {
  const vp = vo + i * 64
  console.log('v' + i + ' @12=' + u32At(b, vp+12) + ' @28(f32)=' + f32At(b, vp+28).toFixed(2) + ' @44(f32)=' + f32At(b, vp+44).toFixed(3) + ' @48(f32)=' + f32At(b, vp+48).toFixed(3))
}
