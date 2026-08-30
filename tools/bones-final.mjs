// 确认 MDLS0001 骨骼格式：层级 + bind matrix + 动画 quat 语义
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
// 找到 MDLS0001
const findTag = (tag) => {
  const t = new Uint8Array(tag.length)
  for (let i = 0; i < t.length; i++) t[i] = tag.charCodeAt(i)
  for (let i = 0; i < b.length - t.length; i++) {
    let ok = true
    for (let k = 0; k < t.length; k++) if (b[i+k] !== t[k]) { ok = false; break }
    if (ok) return i
  }
  return -1
}
const mdls = findTag('MDLS0001')
const mdla = findTag('MDLA0001')
console.log('mdls@' + mdls + ' mdla@' + mdla)
// MDLS 头部
const bc = u32At(b, mdls + 13)
console.log('boneCount=' + bc)
// 0003 layout: 每骨骼 [16B?][parent u32 @+5][64B matrix @+13][name\0]
let q = mdls + 17
const bones = []
for (let i = 0; i < bc; i++) {
  // 探测布局：先看 q..q+80 的字节
  const header = Array.from(b.subarray(q, q + 20)).map(x => x.toString(16).padStart(2, '0')).join(' ')
  // parent 在 @+5? matrix @+13? 打印
  const parent = u32At(b, q + 5)
  const m = []
  for (let k = 0; k < 16; k++) m.push(f32At(b, q + 13 + k * 4))
  // name
  let qn = q + 13 + 64
  let nm = ''
  while (b[qn] !== 0 && nm.length < 64) { nm += String.fromCharCode(b[qn]); qn++ }
  bones.push({ parent, m, nm })
  console.log('bone' + i + ': parent=' + parent + ' name=' + nm)
  console.log('  head: ' + header)
  console.log('  m[0..15]: ' + m.map(x=>x.toFixed(2)).join(', '))
  q = qn + 1
}
// 保存骨骼供后续
console.log()
console.log('=== 各骨骼 bind 平移（从 m 提取） ===')
for (let i = 0; i < bc; i++) {
  const m = bones[i].m
  // 尝试 4x4 列主序: 平移在 m[12],m[13],m[14]
  console.log('bone' + i + ' name=' + bones[i].nm + ' parent=' + bones[i].parent + ' t=(' + m[12].toFixed(2) + ',' + m[13].toFixed(2) + ',' + m[14].toFixed(2) + ')')
}
// 动画 quat 语义验证：骨骼3 的 q 分量平方和
// 用之前确认的 9f32 布局 [pos3][quat3][scale3]
console.log()
console.log('=== 骨骼3 quat 分量平方和（验证四元数 vs 欧拉） ===')
// 找到 MDLA 骨骼3 数据: entry 后 bone0 直接, bone1+ [u32][u32][data]
let e = mdla + 17
const id = u32At(b, e); e += 4
e += 4
let nm = ''; while (b[e] !== 0) { nm += String.fromCharCode(b[e]); e++ }; e++
let lp = ''; while (b[e] !== 0) { lp += String.fromCharCode(b[e]); e++ }; e++
const duration = f32At(b, e); e += 4
const bc2 = u32At(b, e); e += 4
e += 4 // u32
const boneCount2 = u32At(b, e); e += 4
e += 4 // u32
const dataLen = u32At(b, e); e += 4
console.log('anim: id=' + id + ' name=' + nm + ' loop=' + lp + ' duration=' + duration + ' bc=' + bc2 + ' boneCount=' + boneCount2 + ' dataLen=' + dataLen)
// bone0 数据
const framesPerBone = Math.floor(dataLen / 36)
console.log('framesPerBone=' + framesPerBone)
// 骨骼3 数据起点
let boneData = e
for (let bi = 0; bi < Math.min(boneCount2, 5); bi++) {
  if (bi > 0) {
    const u0 = u32At(b, boneData)
    const dl = u32At(b, boneData + 4)
    if (u0 !== 0 || dl !== dataLen) { console.log('  !! 骨骼' + bi + ' 头不匹配 u32=' + u0 + ' dl=' + dl); break }
    boneData += 8
  }
  // 打印 4 帧的 9 f32
  const frames = []
  for (let f = 0; f < Math.min(4, framesPerBone); f++) {
    const fp = boneData + f * 36
    const v = []
    for (let k = 0; k < 9; k++) v.push(f32At(b, fp + k * 4))
    frames.push(v)
  }
  if (bi === 3) {
    console.log('骨骼3 帧 quat 平方和:')
    for (let f = 0; f < frames.length; f++) {
      const v = frames[f]
      const qq = v[3]*v[3] + v[4]*v[4] + v[5]*v[5]
      console.log('  帧' + f + ': pos=(' + v[0].toFixed(2) + ',' + v[1].toFixed(2) + ',' + v[2].toFixed(2) + ') quat=(' + v[3].toFixed(4) + ',' + v[4].toFixed(4) + ',' + v[5].toFixed(4) + ') |q|²=' + qq.toFixed(4) + ' scale=(' + v[6].toFixed(3) + ',' + v[7].toFixed(3) + ',' + v[8].toFixed(3) + ')')
    }
  }
  if (bi === 1) {
    console.log('骨骼1 (pupil) 帧:')
    for (let f = 0; f < frames.length; f++) {
      const v = frames[f]
      console.log('  帧' + f + ': pos=(' + v[0].toFixed(2) + ',' + v[1].toFixed(2) + ',' + v[2].toFixed(2) + ') quat=(' + v[3].toFixed(4) + ',' + v[4].toFixed(4) + ',' + v[5].toFixed(4) + ') scale=(' + v[6].toFixed(3) + ',' + v[7].toFixed(3) + ',' + v[8].toFixed(3) + ')')
    }
  }
  boneData += dataLen
}
