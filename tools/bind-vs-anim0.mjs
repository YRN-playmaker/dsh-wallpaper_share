// 对比 0013 动画帧0 值 vs MDLS0001 骨骼0 bind 矩阵平移/旋转
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
const i32At = (b, q) => (b[q] | (b[q+1]<<8) | (b[q+2]<<16) | (b[q+3]<<24)) | 0
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
for (const eye of ['右眼', '右睫毛', '左眼球', 'z左睫毛']) {
  const b = pkg.read(`models/${eye}_puppet.mdl`)
  console.log(`=== ${eye} ===`)
  // 动画帧0 (9 f32)
  const mdla = find(b, 'MDLA0001')
  let q = mdla + 17
  q += 4; q += 4
  while (b[q] !== 0) q++
  q++
  while (b[q] !== 0) q++
  q++
  q += 4; q += 4; q += 4; q += 4; q += 4
  const dataLen = u32At(b, q); q += 4
  // 无 extra，数据从 q 开始
  const frame0 = []
  for (let k = 0; k < 9; k++) frame0.push(f32At(b, q + k * 4))
  console.log('动画帧0 (9f32):', frame0.map(v => v.toFixed(3)).join(', '))
  // 骨骼 bind 矩阵（MDLS0001, 0003 布局）
  const mdls = find(b, 'MDLS0001')
  const boneCount = u32At(b, mdls + 13)
  console.log('boneCount:', boneCount)
  let qm = mdls + 17
  for (let i = 0; i < boneCount; i++) {
    const parent = i32At(b, qm + 5)
    const mp = qm + 13
    const m = []
    for (let k = 0; k < 16; k++) m.push(f32At(b, mp + k * 4))
    // 平移 = 矩阵第4列 (m[12],m[13],m[14])
    // 旋转部分 m[0..8]
    console.log('  骨' + i + ' parent=' + parent + ' 平移=(' + m[12].toFixed(3) + ',' + m[13].toFixed(3) + ',' + m[14].toFixed(3) + ') rot=[' + m.slice(0,9).map(v=>v.toFixed(3)).join(',') + ']')
    // 跳过 json 块
    let j = mp + 64
    while (j < b.length && b[j] !== 0) j++
    qm = j + 1
  }
  console.log()
}