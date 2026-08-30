// stride=52 的完整字节布局分析
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
const stride = 52
const vc = 1248
console.log('=== 前 6 顶点 stride=52 全字节 + 分块解读 ===')
for (let i = 0; i < 6; i++) {
  const vp = vo + i * stride
  console.log('v' + i + ' @' + vp + ':')
  // 每 4B 一个窗口：f32 和 u32 和 u16
  for (let off = 0; off < stride; off += 4) {
    const f = f32At(b, vp + off)
    const u = u32At(b, vp + off)
    const u16a = u16At(b, vp + off)
    const u16b = u16At(b, vp + off + 2)
    console.log(`  @${String(off).padStart(2)}: f32=${f.toFixed(3).padStart(9)} u32=${String(u).padStart(10)} u16=(${u16a},${u16b})`)
  }
}
// 所有顶点 @12 的 u32（疑似 boneIndex）分布
console.log()
console.log('=== @12 u32 分布（疑似 boneIndex） ===')
const idxDist = new Map()
for (let i = 0; i < vc; i++) {
  const v = u32At(b, vo + i * stride + 12)
  idxDist.set(v, (idxDist.get(v) ?? 0) + 1)
}
for (const [k, v] of [...idxDist.entries()].sort((a, b) => a[1] - b[1])) console.log('  u32=' + k + ': ' + v + ' 顶点')
// @28 f32 分布（疑似权重）
console.log()
console.log('=== @28 f32 分布（疑似权重） ===')
const wDist = new Map()
for (let i = 0; i < vc; i++) {
  const v = f32At(b, vo + i * stride + 28)
  const key = Math.round(v * 100) / 100
  wDist.set(key, (wDist.get(key) ?? 0) + 1)
}
for (const [k, v] of [...wDist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log('  w=' + k + ': ' + v + ' 顶点')
// @44-48 UV 范围
console.log()
console.log('=== @44-48 UV 范围 ===')
let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity
for (let i = 0; i < vc; i++) {
  const u = f32At(b, vo + i * stride + 44)
  const v = f32At(b, vo + i * stride + 48)
  if (u < minU) minU = u; if (u > maxU) maxU = u
  if (v < minV) minV = v; if (v > maxV) maxV = v
}
console.log('UV X:[' + minU.toFixed(3) + ',' + maxU.toFixed(3) + '] Y:[' + minV.toFixed(3) + ',' + maxV.toFixed(3) + ']')
