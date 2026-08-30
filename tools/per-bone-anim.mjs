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
// 结构：MDLA0001\0(9) + u32@+9 + animCount@+13 + [条目...]
// 条目: id u32, u32, name\0, loop\0, duration f32, bc u32, u32, boneCount u32, u32, dataLen u32
let q = mdla + 17
q += 4; q += 4
while (b[q] !== 0) q++
q++
while (b[q] !== 0) q++
q++
q += 4; q += 4; q += 4; q += 4; q += 4
const dataLen = u32At(b, q); q += 4
console.log('dataLen=' + dataLen, 'dataStart=' + q, '文件总长=' + b.length)
// dataLen 之后的字节：检查是否 [u32 0][u32 dataLen][数据]
console.log('dataLen 后 8B:', Array.from(b.subarray(q + dataLen, q + dataLen + 8)).map(x=>x.toString(16).padStart(2,'0')).join(' '))
console.log('u32@dataEnd =', u32At(b, q + dataLen), 'u32@dataEnd+4 =', u32At(b, q + dataLen + 4))
// 骨骼数（从条目里）
console.log()
console.log('=== 按 [u32 0][u32 dataLen][data] 结构遍历骨骼数据块 ===')
let pos = q // 80045
let boneIdx = 0
const bindExpected = [
  [-8.997, -0.508],
  [-69.456, 44.534],
  [74.359, -40.856],
  [-29.825, -52.705],
  [29.008, 49.028],
]
while (pos + 8 <= b.length && boneIdx < 8) {
  const u0 = u32At(b, pos)
  const u1 = u32At(b, pos + 4)
  const dataStart = pos + 8
  // 判断：u1 是否像是 dataLen（几百到几万）
  if (u1 >= 36 && u1 < 50000 && dataStart + u1 <= b.length + 1) {
    // 打印此块第一帧 pos
    const v = []
    for (let k = 0; k < 9; k++) v.push(f32At(b, dataStart + k * 4))
    const expected = boneIdx < bindExpected.length ? bindExpected[boneIdx] : null
    const match = expected && Math.abs(v[0]-expected[0])<0.01 && Math.abs(v[1]-expected[1])<0.01
    console.log(`骨骼${boneIdx}: u0=${u0} dataLen=${u1} dataStart=${dataStart} 首帧=(${v[0].toFixed(2)},${v[1].toFixed(2)},${v[2].toFixed(2)}) quat=(${v[3].toFixed(2)},${v[4].toFixed(2)},${v[5].toFixed(2)},${v[6].toFixed(2)}) s=(${v[7].toFixed(2)},${v[8].toFixed(2)}) ${match?'<== bind匹配':'<== ？'}`)
    // 统计此块 201 帧是否全相同
    const frames = Math.floor(u1 / 36)
    let changed = 0
    const first = v
    for (let f = 1; f < frames; f++) {
      const fp = dataStart + f * 36
      let same = true
      for (let k = 0; k < 9; k++) if (Math.abs(f32At(b, fp + k*4) - first[k]) > 1e-4) { same = false; break }
      if (!same) changed++
    }
    console.log(`   frames=${frames} 变化帧数=${changed}`)
    if (changed > 0) {
      // 打印前几帧变化
      for (let f = 0; f < Math.min(frames, 8); f++) {
        const fp = dataStart + f * 36
        const vv = []
        for (let k = 0; k < 9; k++) vv.push(f32At(b, fp + k*4))
        console.log(`     帧${f}: pos=(${vv[0].toFixed(2)},${vv[1].toFixed(2)}) quat=(${vv[3].toFixed(3)},${vv[4].toFixed(3)},${vv[5].toFixed(3)},${vv[6].toFixed(3)}) s=(${vv[7].toFixed(2)},${vv[8].toFixed(2)})`)
      }
    }
    pos = dataStart + u1
    boneIdx++
  } else {
    console.log(`@${pos}: u0=${u0} u1=${u1} 非数据块头，停止`)
    break
  }
}
