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
const pkg = readPkg('D:/SteamLibrary/steamapps/workshop/content/431960/2804379697/scene.pkg')
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
const b = pkg.read('models/右眼_puppet.mdl')
const mdla = find(b, 'MDLA0001')
let q = mdla + 17
q += 4; q += 4
while (b[q] !== 0) q++
q++
while (b[q] !== 0) q++
q++
q += 4; q += 4; q += 4; q += 4; q += 4
const dataLen = u32At(b, q); q += 4
console.log('dataStart=' + q, 'dataLen=' + dataLen)
// 扫描整个数据区，按 36B 块，找出 != 块0 的块
const ref = []
for (let k = 0; k < 9; k++) ref.push(f32At(b, q + k * 4))
console.log('块0 (参考):', ref.map(v => v.toFixed(3)).join(', '))
const changed = []
for (let f = 1; f < Math.floor(dataLen / 36); f++) {
  const fp = q + f * 36
  let same = true
  for (let k = 0; k < 9; k++) {
    if (Math.abs(f32At(b, fp + k * 4) - ref[k]) > 1e-4) { same = false; break }
  }
  if (!same) changed.push(f)
}
console.log('变化的块 (共' + Math.floor(dataLen / 36) + '块):', changed.length, '个')
if (changed.length > 0) {
  console.log('前 30 个:', changed.slice(0, 30).join(','))
  // 打印第一个变化块的内容
  const f = changed[0]
  const fp = q + f * 36
  const v = []
  for (let k = 0; k < 9; k++) v.push(f32At(b, fp + k * 4))
  console.log('第一个变化块', f, ':', v.map(x => x.toFixed(3)).join(', '))
}
// 如果全部相同，尝试按 180B（5 骨骼 × 36B）分组看每组的第 1 块
console.log()
console.log('=== 按 180B (5×36) 分组，每组第1块 pos ===')
for (let g = 0; g < Math.floor(dataLen / 180); g++) {
  const fp = q + g * 180
  const v = []
  for (let k = 0; k < 9; k++) v.push(f32At(b, fp + k * 4))
  console.log('组' + g + ' 骨0块: (' + v[0].toFixed(2) + ',' + v[1].toFixed(2) + ',' + v[2].toFixed(2) + ') quat=(' + v[3].toFixed(3) + ',' + v[4].toFixed(3) + ',' + v[5].toFixed(3) + ',' + v[6].toFixed(3) + ')')
}
// 每组的 5 块分别打印（组0）
console.log()
console.log('=== 组0 (前 180B) 的 5 个 36B 块 ===')
for (let k = 0; k < 5; k++) {
  const fp = q + k * 36
  const v = []
  for (let j = 0; j < 9; j++) v.push(f32At(b, fp + j * 4))
  console.log('块' + k + ': pos=(' + v[0].toFixed(2) + ',' + v[1].toFixed(2) + ',' + v[2].toFixed(2) + ') quat=(' + v[3].toFixed(3) + ',' + v[4].toFixed(3) + ',' + v[5].toFixed(3) + ',' + v[6].toFixed(3) + ') scale=(' + v[7].toFixed(2) + ',' + v[8].toFixed(2) + ')')
}
