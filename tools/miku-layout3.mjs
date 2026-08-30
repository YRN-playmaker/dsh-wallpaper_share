// 用 0013 风格解析 MDLA0006：骨骼0 无头 + 骨骼1+ 带 [u32 0][u32 dataLen] 头
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
const pkg = readPkg('D:/SteamLibrary/steamapps/workshop/content/431960/3409595232/scene.pkg')
const b = pkg.read('models/导出初音_puppet.mdl')
const findTag = (bb, tag) => {
  const t = new Uint8Array(tag.length)
  for (let i = 0; i < t.length; i++) t[i] = tag.charCodeAt(i)
  for (let i = 0; i < bb.length - t.length; i++) {
    let ok = true
    for (let k = 0; k < t.length; k++) if (bb[i+k] !== t[k]) { ok = false; break }
    if (ok) return i
  }
  return -1
}
const mdla = findTag(b, 'MDLA0006')
let q = mdla + 17
const id = u32At(b, q); q += 4
q += 4
let nm = ''
while (b[q] !== 0) { nm += String.fromCharCode(b[q]); q++ }
q++
let lp = ''
while (b[q] !== 0) { lp += String.fromCharCode(b[q]); q++ }
q++
const duration = f32At(b, q); q += 4
const bc = u32At(b, q); q += 4
q += 4
const boneCount = u32At(b, q); q += 4
q += 4
const dataLen = u32At(b, q); q += 4
q++ // extra 1B
const dataStart = q
const frames = Math.floor(dataLen / 36)
console.log('动画1: id=' + id + ' boneCount=' + boneCount + ' dataLen=' + dataLen + ' frames=' + frames + ' 数据起始@' + dataStart)
// 0013 风格骨骼块解析
let bq = dataStart
for (let bi = 0; bi < Math.min(boneCount, 40) && bq + 8 <= b.length; bi++) {
  let blockStart = bq
  if (bi > 0) {
    const h0 = u32At(b, bq)
    const h1 = u32At(b, bq + 4)
    if (h0 !== 0 || h1 !== dataLen) {
      console.log('骨骼' + bi + ' 头不匹配 h=(' + h0 + ',' + h1 + ') @' + bq)
      break
    }
    blockStart = bq + 8
  }
  // 该块每帧 36B；先看帧格式
  const f0 = blockStart
  const raw = Array.from(b.slice(f0, f0 + 16)).map(x => x.toString(16).padStart(2, '0')).join(' ')
  // 计算 maxSpan（按 8 f32 + 3B t 布局，f32 从 off+3 开始）
  let maxSpan = 0
  let maxVi = -1
  for (let vi = 0; vi < 8; vi++) {
    let mn = Infinity, mx = -Infinity
    for (let f = 0; f < frames; f++) {
      const v = f32At(b, f0 + f * 36 + 3 + vi * 4)
      if (v < mn) mn = v
      if (v > mx) mx = v
    }
    if (Number.isFinite(mn) && mx - mn > maxSpan) { maxSpan = mx - mn; maxVi = vi }
  }
  const t0 = (b[f0] | (b[f0+1]<<8) | (b[f0+2]<<16)) >>> 0
  const v0 = [0,1,2,3,4,5,6,7].map(k => f32At(b, f0 + 3 + k * 4))
  console.log('骨骼' + bi + ' @' + f0 + ': 头字节="' + raw + '" t0=' + t0 + ' maxSpan=' + maxSpan.toFixed(2) + '(vi' + maxVi + ') v0=(' + v0.map(x=>x.toFixed(1)).join(',') + ')')
  bq = blockStart + dataLen
}
