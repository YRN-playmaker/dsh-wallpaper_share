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
console.log('MDLA@' + mdla, 'dataStart=' + q, 'dataLen=' + dataLen)
// 打印数据区前 720 字节（20 个 36B 块）每个块的前 3 个值
console.log()
console.log('=== 数据区前 20 个 36B 块（每块 pos3 + quat 摘要） ===')
for (let f = 0; f < 20; f++) {
  const fp = q + f * 36
  const v = []
  for (let k = 0; k < 9; k++) v.push(f32At(b, fp + k * 4))
  console.log('块' + String(f).padStart(2) + ' @' + fp + ' pos=(' + v[0].toFixed(2) + ',' + v[1].toFixed(2) + ',' + v[2].toFixed(2) + ') quat=(' + v[3].toFixed(3) + ',' + v[4].toFixed(3) + ',' + v[5].toFixed(3) + ',' + v[6].toFixed(3) + ') scale=(' + v[7].toFixed(2) + ',' + v[8].toFixed(2) + ')')
}
// 数据区总 7236B。如果每帧=所有骨骼(5×36=180B)，7236/180 = 40.2 帧（不是整数）
// 但如果每帧 = 1 骨骼 × 36B，201 帧。可能结构 = 骨骼数 × 每骨骼 帧数？
// 检查 7236 的分解
console.log()
console.log('dataLen 分解: 7236 =', 7236, ' /5 =', 7236/5, ' /6 =', 7236/6, ' /9 =', 7236/9, ' /36 =', 7236/36)
// 也许每帧含骨骼数×9 f32，但骨骼数可能不是 5？
// 检查中间某个位置是否出现骨骼1 bind (-69.456, 44.534)
console.log()
console.log('=== 搜索骨骼1 bind 平移 (-69.456, 44.534) ===')
for (let off = q; off < q + dataLen - 8; off++) {
  const x = f32At(b, off)
  const y = f32At(b, off + 4)
  if (Math.abs(x - (-69.456)) < 0.01 && Math.abs(y - 44.534) < 0.01) {
    console.log('  found at offset ' + (off - q) + ' (abs ' + off + ')')
    if (off - q > 0) { const prev = (off - q) % 36; console.log('  offset mod 36 =', prev) }
    break
  }
}
// 检查数据区是否包含骨骼2 bind (74.359, -40.856)
console.log('=== 搜索骨骼2 bind 平移 (74.359, -40.856) ===')
for (let off = q; off < q + dataLen - 8; off++) {
  const x = f32At(b, off)
  const y = f32At(b, off + 4)
  if (Math.abs(x - 74.359) < 0.01 && Math.abs(y - (-40.856)) < 0.01) {
    console.log('  found at offset ' + (off - q) + ' (abs ' + off + ')')
    break
  }
}
