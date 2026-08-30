// 通过索引最大值得出真实顶点数，从而约束 stride
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
let maxIdx = 0
for (let i = 0; i < indexBytes / 2; i++) {
  const v = u16At(b, io + i * 2)
  if (v > maxIdx) maxIdx = v
}
console.log('vertexBytes=' + vertexBytes + ' indexBytes=' + indexBytes)
console.log('maxIdx=' + maxIdx + ' → 顶点数必须 ≥ ' + (maxIdx + 1))
// 可能的 stride
for (const s of [32, 40, 48, 56, 64, 72, 80, 96, 128, 160]) {
  if (vertexBytes % s === 0) {
    console.log('  stride=' + s + ' → ' + (vertexBytes / s) + ' 顶点' + ((vertexBytes / s) >= maxIdx + 1 ? ' ✓' : ' ✗'))
  }
}
// 统计唯一索引数量
const used = new Set()
for (let i = 0; i < indexBytes / 2; i++) used.add(u16At(b, io + i * 2))
console.log('唯一索引数:', used.size)
// 索引是否连续（grid 特征）
const sorted = [...used].sort((a, b) => a - b)
let gaps = 0
for (let i = 1; i < sorted.length; i++) if (sorted[i] - sorted[i-1] > 1) gaps++
console.log('唯一索引中非连续跳变数:', gaps)
// 打印跳变位置
console.log('前 20 个跳变:')
let shown = 0
for (let i = 1; i < sorted.length && shown < 20; i++) {
  if (sorted[i] - sorted[i-1] > 1) { console.log('  ...' + sorted[i-1] + ' → ' + sorted[i]); shown++ }
}
