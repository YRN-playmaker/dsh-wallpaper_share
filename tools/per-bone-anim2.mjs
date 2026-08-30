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
console.log('dataLen=' + dataLen, 'dataStart=' + q)
// 逐骨骼遍历：每块 = [u32 0][u32 dataLen][data]
const bindExpected = [
  [-8.997, -0.508],
  [-69.456, 44.534],
  [74.359, -40.856],
  [-29.825, -52.705],
  [29.008, 49.028],
]
let pos = q
let boneIdx = 0
while (pos + 8 <= b.length && boneIdx < 8) {
  // 第一块无头（直接用 dataLen），后续块有 [u32 0][u32 dataLen]
  let len
  let dataStart
  if (boneIdx === 0) {
    len = dataLen
    dataStart = pos
  } else {
    const u0 = u32At(b, pos)
    const u1 = u32At(b, pos + 4)
    if (u0 !== 0 || u1 < 36 || u1 > 100000) { console.log('@' + pos + ': 非块头 u0=' + u0 + ' u1=' + u1); break }
    len = u1
    dataStart = pos + 8
  }
  const v = []
  for (let k = 0; k < 9; k++) v.push(f32At(b, dataStart + k * 4))
  const expected = boneIdx < bindExpected.length ? bindExpected[boneIdx] : null
  const match = expected && Math.abs(v[0]-expected[0])<0.01 && Math.abs(v[1]-expected[1])<0.01
  const frames = Math.floor(len / 36)
  // 统计变化帧
  let changed = 0
  let firstChanged = -1
  const span = [0,0,0,0,0,0,0,0,0]
  for (let f = 0; f < frames; f++) {
    const fp = dataStart + f * 36
    for (let k = 0; k < 9; k++) {
      const val = f32At(b, fp + k*4)
      if (val < span[k]) span[k] = val
      if (val > span[k+9-9]) { /* noop */ }
    }
  }
  // 重新计算 span
  for (let k = 0; k < 9; k++) span[k] = 0
  for (let f = 0; f < frames; f++) {
    const fp = dataStart + f * 36
    for (let k = 0; k < 9; k++) {
      const val = f32At(b, fp + k*4)
      if (f === 0) span[k] = Math.abs(val)
      else span[k] = Math.max(span[k], Math.abs(val))
    }
  }
  for (let f = 1; f < frames; f++) {
    const fp = dataStart + f * 36
    let same = true
    for (let k = 0; k < 9; k++) if (Math.abs(f32At(b, fp+k*4) - v[k]) > 1e-3) { same = false; break }
    if (!same) { changed++; if (firstChanged < 0) firstChanged = f }
  }
  console.log(`骨骼${boneIdx}: dataStart=${dataStart} len=${len} frames=${frames} 首帧=(${v[0].toFixed(2)},${v[1].toFixed(2)}) quat=(${v[3].toFixed(2)},${v[4].toFixed(2)},${v[5].toFixed(2)},${v[6].toFixed(2)}) ${match?'bind匹配':'?'} 变化帧=${changed}${firstChanged>=0?'(首个@'+firstChanged+')':''}`)
  if (changed > 0) {
    // 打印变化帧附近
    for (let f = Math.max(0, firstChanged - 1); f < Math.min(frames, firstChanged + 4); f++) {
      const fp = dataStart + f * 36
      const vv = []
      for (let k = 0; k < 9; k++) vv.push(f32At(b, fp + k*4))
      console.log(`   帧${f}: pos=(${vv[0].toFixed(2)},${vv[1].toFixed(2)},${vv[2].toFixed(2)}) quat=(${vv[3].toFixed(3)},${vv[4].toFixed(3)},${vv[5].toFixed(3)},${vv[6].toFixed(3)}) s=(${vv[7].toFixed(3)},${vv[8].toFixed(3)})`)
    }
  }
  pos = dataStart + len
  boneIdx++
}
console.log()
console.log('结束位置:', pos, '剩余字节:', b.length - pos)
// 打印剩余部分
if (b.length - pos > 0) {
  const rem = b.length - pos
  console.log('剩余', rem, '字节前 128B:')
  for (let off = pos; off < Math.min(pos + 128, b.length); off += 16) {
    const bytes = Array.from(b.subarray(off, off + 16)).map(x => x.toString(16).padStart(2, '0')).join(' ')
    console.log('  ' + String(off).padStart(7) + ': ' + bytes)
  }
}
