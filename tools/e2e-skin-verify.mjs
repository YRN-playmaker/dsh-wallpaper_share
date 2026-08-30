// 端到端验证：解析 0013 右眼 puppet，计算骨骼动画矩阵 + 蒙皮，检查瞳孔是否收缩
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

// --- 解析 mesh (stride 52) ---
const vo = 47
const stride = 52
const vertexBytes = u32At(b, 43)
const ilo = vo + vertexBytes
const indexBytes = u32At(b, ilo)
const io = ilo + 4
const vc = vertexBytes / stride
const verts = []
for (let i = 0; i < vc; i++) {
  const vp = vo + i * stride
  verts.push({
    pos: [f32At(b, vp), f32At(b, vp + 4), f32At(b, vp + 8)],
    boneIdx: [0,1,2,3].map(k => u32At(b, vp + 12 + k * 4)),
    weights: [0,1,2,3].map(k => f32At(b, vp + 28 + k * 4)),
    uv: [f32At(b, vp + 44), f32At(b, vp + 48)],
  })
}
// --- 解析骨骼 bind ---
const binds = []
let q = mdls + 17
for (let i = 0; i < 5; i++) {
  const parent = b[q+5] | (b[q+6]<<8) | (b[q+7]<<16) | (b[q+8]<<24)
  const m = []
  for (let k = 0; k < 16; k++) m.push(f32At(b, q + 13 + k * 4))
  binds.push({ parent: parent | 0, m })
  q += 77
}
// --- 解析动画 (逐骨骼) ---
let e = mdla + 17
const id = u32At(b, e); e += 4
e += 4
while (b[e] !== 0) e++; e++
while (b[e] !== 0) e++; e++
const duration = f32At(b, e); e += 4
const bc = u32At(b, e); e += 4
e += 4
const boneCount = u32At(b, e); e += 4
e += 4
const dataLen = u32At(b, e); e += 4
const frames = Math.floor(dataLen / 36)
const boneKf = []
let bq = e
for (let bi = 0; bi < boneCount; bi++) {
  if (bi > 0) {
    const h0 = u32At(b, bq), h1 = u32At(b, bq + 4)
    if (h0 !== 0 || h1 !== dataLen) { console.log('!! 骨骼' + bi + ' 头不匹配'); break }
    bq += 8
  }
  const kfs = []
  for (let f = 0; f < frames; f++) {
    const fp = bq + f * 36
    kfs.push([0,1,2,3,4,5,6,7,8].map(k => f32At(b, fp + k * 4)))
  }
  boneKf.push(kfs)
  bq += frames * 36
}
console.log('骨骼数=' + boneCount + ' 帧数=' + frames + ' duration=' + duration)

// --- 蒙皮数学（等价 renderer） ---
// 矩阵：列主序 16 f32
const mat4Mul = (a, bb) => {
  const o = new Array(16)
  for (let c = 0; c < 4; c++) {
    const b0 = bb[c*4], b1 = bb[c*4+1], b2 = bb[c*4+2], b3 = bb[c*4+3]
    for (let r = 0; r < 4; r++) o[c*4+r] = a[r]*b0 + a[4+r]*b1 + a[8+r]*b2 + a[12+r]*b3
  }
  return o
}
const mat4Invert = (m) => {
  const a0 = m[0]*m[5]-m[4]*m[1], a1 = m[0]*m[6]-m[4]*m[2], a2 = m[0]*m[7]-m[4]*m[3]
  const a3 = m[1]*m[6]-m[5]*m[2], a4 = m[1]*m[7]-m[5]*m[3], a5 = m[2]*m[7]-m[6]*m[3]
  const b0 = m[8]*m[13]-m[12]*m[9], b1 = m[8]*m[14]-m[12]*m[10], b2 = m[8]*m[15]-m[12]*m[11]
  const b3 = m[9]*m[14]-m[13]*m[10], b4 = m[9]*m[15]-m[13]*m[11], b5 = m[10]*m[15]-m[14]*m[11]
  const det = a0*b5-a1*b4+a2*b3+a3*b2-a4*b1+a5*b0
  if (Math.abs(det) < 1e-12) return null
  const id = 1/det
  return [
    (m[5]*b5-m[6]*b4+m[7]*b3)*id, (-m[1]*b5+m[2]*b4-m[3]*b3)*id,
    (m[13]*a5-m[14]*a4+m[15]*a3)*id, (-m[9]*a5+m[10]*a4-m[11]*a3)*id,
    (-m[4]*b5+m[6]*b2-m[7]*b1)*id, (m[0]*b5-m[2]*b2+m[3]*b1)*id,
    (-m[12]*a5+m[14]*a2-m[15]*a1)*id, (m[8]*a5-m[10]*a2+m[11]*a1)*id,
    (m[4]*b4-m[5]*b2+m[7]*b0)*id, (-m[0]*b4+m[1]*b2-m[3]*b0)*id,
    (m[12]*a4-m[13]*a2+m[15]*a0)*id, (-m[8]*a4+m[9]*a2-m[11]*a0)*id,
    (-m[4]*b3+m[5]*b1-m[6]*b0)*id, (m[0]*b3-m[1]*b1+m[2]*b0)*id,
    (-m[12]*a3+m[13]*a1-m[14]*a0)*id, (m[8]*a3-m[9]*a1+m[10]*a0)*id,
  ]
}
const mat4FromQuat = (qx, qy, qz, qw) => {
  const w = qw !== undefined ? qw : Math.sqrt(Math.max(0, 1 - qx*qx - qy*qy - qz*qz))
  const x = qx, y = qy, z = qz
  return [
    1-2*(y*y+z*z), 2*(x*y+z*w), 2*(x*z-y*w), 0,
    2*(x*y-z*w), 1-2*(x*x+z*z), 2*(y*z+x*w), 0,
    2*(x*z+y*w), 2*(y*z-x*w), 1-2*(x*x+y*y), 0,
    0, 0, 0, 1,
  ]
}
const mat4TRSQuat = (tx, ty, tz, qx, qy, qz, qw, sx, sy, sz) => {
  const R = mat4FromQuat(qx, qy, qz, qw)
  return [R[0]*sx, R[1]*sx, R[2]*sx, R[3], R[4]*sy, R[5]*sy, R[6]*sy, R[7], R[8]*sz, R[9]*sz, R[10]*sz, R[11], tx, ty, tz, 1]
}
const transform = (m, x, y, z) => {
  const w = m[3]*x + m[7]*y + m[11]*z + m[15]
  const iw = w !== 0 ? 1/w : 0
  return [(m[0]*x+m[4]*y+m[8]*z+m[12])*iw, (m[1]*x+m[5]*y+m[9]*z+m[13])*iw, (m[2]*x+m[6]*y+m[10]*z+m[14])*iw]
}
// 对某一帧 f，计算所有顶点蒙皮后位置
function skinFrame(f) {
  const skin = []
  for (let i = 0; i < boneCount; i++) {
    const v = boneKf[i][f]
    const animM = mat4TRSQuat(v[0], v[1], v[2], v[3], v[4], v[5], undefined, v[6], v[7], v[8])
    const inv = mat4Invert(binds[i].m)
    skin.push(inv ? mat4Mul(animM, inv) : null)
  }
  const out = verts.map((v) => {
    let x = 0, y = 0, z = 0
    for (let k = 0; k < 4; k++) {
      const w = v.weights[k]
      if (!(w > 0)) continue
      const idx = v.boneIdx[k]
      const m = skin[idx]
      const p = m ? transform(m, v.pos[0], v.pos[1], v.pos[2]) : v.pos
      x += w * p[0]; y += w * p[1]; z += w * p[2]
    }
    return [x, y, z]
  })
  return out
}
// 找出瞳孔附近的顶点（bone1 为主）
console.log('\n=== 骨骼 bind 位置 ===')
binds.forEach((bb, i) => console.log('  bone' + i + ': t=(' + bb.m[12].toFixed(2) + ',' + bb.m[13].toFixed(2) + ') parent=' + bb.parent))
// 各帧 0,1,2,3,4 的骨骼1 动画值
console.log('\n=== 骨骼1 动画值（前5帧） ===')
for (let f = 0; f < 5; f++) {
  const v = boneKf[1][f]
  console.log('  f' + f + ': pos=(' + v[0].toFixed(2) + ',' + v[1].toFixed(2) + ') scale=(' + v[6].toFixed(3) + ',' + v[7].toFixed(3) + ')')
}
// 瞳孔顶点选择：boneIdx[0]==1 或权重包含1
const pupilVerts = verts.map((v, i) => ({ i, v })).filter(o => o.v.boneIdx.includes(1) && o.v.weights[o.v.boneIdx.indexOf(1)] > 0.8)
console.log('\n=== 瞳孔顶点数（bone1 权重>0.8）: ' + pupilVerts.length + ' ===')
if (pupilVerts.length > 0) {
  const some = pupilVerts.slice(0, 5)
  for (const { i, v } of some) {
    console.log('  v' + i + ': pos=(' + v.pos[0].toFixed(1) + ',' + v.pos[1].toFixed(1) + ') boneIdx=[' + v.boneIdx.join(',') + '] w=[' + v.weights.map(x=>x.toFixed(2)).join(',') + ']')
  }
  // 计算这些顶点在帧0 和 帧4 的蒙皮位置，比较
  const f0 = skinFrame(0)
  const f4 = skinFrame(4)
  let moved = 0
  for (const { i } of pupilVerts) {
    const d = Math.hypot(f4[i][0] - f0[i][0], f4[i][1] - f0[i][1])
    if (d > 1) moved++
  }
  console.log('\n帧0 vs 帧4: 瞳孔顶点位移>1px 的数量: ' + moved + '/' + pupilVerts.length)
  // 帧0 到帧4 的质心收缩
  const cen = (pts) => pts.reduce((a, p) => [a[0]+p[0], a[1]+p[1]], [0,0]).map(x => x / pts.length)
  const c0 = cen(pupilVerts.map(o => f0[o.i]))
  const c4 = cen(pupilVerts.map(o => f4[o.i]))
  console.log('瞳孔质心: f0=(' + c0[0].toFixed(2) + ',' + c0[1].toFixed(2) + ') f4=(' + c4[0].toFixed(2) + ',' + c4[1].toFixed(2) + ')')
  // 各顶点到质心距离（帧0 vs 帧4）——收缩应减小距离
  let d0sum = 0, d4sum = 0
  for (const { i } of pupilVerts) {
    d0sum += Math.hypot(f0[i][0]-c0[0], f0[i][1]-c0[1])
    d4sum += Math.hypot(f4[i][0]-c4[0], f4[i][1]-c4[1])
  }
  const avgD0 = d0sum / pupilVerts.length, avgD4 = d4sum / pupilVerts.length
  console.log('瞳孔顶点到质心平均距离: f0=' + avgD0.toFixed(2) + ' f4=' + avgD4.toFixed(2) + ' → ' + (avgD4 < avgD0 ? '收缩 ✓' : '未收缩 ✗'))
}
// 下眼睑（bone3）
console.log('\n=== 骨骼3 动画值（前5帧） ===')
for (let f = 0; f < 5; f++) {
  const v = boneKf[3][f]
  console.log('  f' + f + ': pos=(' + v[0].toFixed(2) + ',' + v[1].toFixed(2) + ') quat.z=' + v[5].toFixed(4) + ' scale=(' + v[6].toFixed(3) + ',' + v[7].toFixed(3) + ')')
}
const lidVerts = verts.map((v, i) => ({ i, v })).filter(o => o.v.boneIdx.includes(3) && o.v.weights[o.v.boneIdx.indexOf(3)] > 0.8)
console.log('\n=== 下眼睑顶点数（bone3 权重>0.8）: ' + lidVerts.length + ' ===')
if (lidVerts.length > 0) {
  const f0 = skinFrame(0)
  const f4 = skinFrame(4)
  let moved = 0
  for (const { i } of lidVerts) {
    const d = Math.hypot(f4[i][0] - f0[i][0], f4[i][1] - f0[i][1])
    if (d > 1) moved++
  }
  console.log('帧0 vs 帧4: 下眼睑顶点位移>1px 数量: ' + moved + '/' + lidVerts.length)
}
// 全部顶点 bounding box 变化
{
  const f0 = skinFrame(0), f4 = skinFrame(4)
  const bb = (pts) => {
    let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity
    for (const p of pts) { if (p[0] < minx) minx = p[0]; if (p[0] > maxx) maxx = p[0]; if (p[1] < miny) miny = p[1]; if (p[1] > maxy) maxy = p[1] }
    return [minx, maxx, miny, maxy]
  }
  console.log('\n=== 全部顶点包围盒 ===')
  console.log('f0: ' + bb(f0).map(x => x.toFixed(1)).join(' '))
  console.log('f4: ' + bb(f4).map(x => x.toFixed(1)).join(' '))
}
