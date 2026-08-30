// 睫毛蒙皮：帧0 vs 帧10 顶点位置对比 + 骨骼动画值
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
const b = pkg.read('models/右睫毛_puppet.mdl')
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
// mesh: 睫毛 mesh@42, stride 52, vertexBytes@46, 顶点从 @50 开始
const vo = 50, stride = 52
const vertexBytes = u32At(b, 46)
const ilo = vo + vertexBytes, indexBytes = u32At(b, ilo), io = ilo + 4
const vc = vertexBytes / stride
console.log('睫毛 mesh: vc=' + vc + ' idxBytes=' + indexBytes)
const verts = []
for (let i = 0; i < vc; i++) {
  const vp = vo + i * stride
  verts.push({ pos: [f32At(b,vp), f32At(b,vp+4), f32At(b,vp+8)], boneIdx: [0,1,2,3].map(k=>u32At(b,vp+12+k*4)), weights: [0,1,2,3].map(k=>f32At(b,vp+28+k*4)) })
}
// 骨骼
const binds = []
let q = mdls + 17
for (let i = 0; i < 2 && q + 77 <= b.length; i++) {
  const parent = (b[q+5] | (b[q+6]<<8) | (b[q+7]<<16) | (b[q+8]<<24)) | 0
  const mp = q + 13
  const m = []
  for (let k = 0; k < 16; k++) m.push(f32At(b, mp + k * 4))
  binds.push({ parent, m })
  let j = mp + 64
  while (j < b.length && b[j] !== 0 && j < q + 4096) j++
  q = j + 1
}
// 动画
let e = mdla + 17
e += 4; e += 4
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
  if (bi > 0) bq += 8
  const kfs = []
  for (let f = 0; f < frames; f++) {
    const fp = bq + f * 36
    kfs.push([0,1,2,3,4,5,6,7,8].map(k => f32At(b, fp + k * 4)))
  }
  boneKf.push(kfs)
  bq += frames * 36
}
// 矩阵
const mat4Mul = (a, bb) => {
  const o = new Array(16)
  for (let c = 0; c < 4; c++) { const b0=bb[c*4],b1=bb[c*4+1],b2=bb[c*4+2],b3=bb[c*4+3]; for (let r=0;r<4;r++) o[c*4+r]=a[r]*b0+a[4+r]*b1+a[8+r]*b2+a[12+r]*b3 }
  return o
}
const mat4Invert = (m) => {
  const a0=m[0]*m[5]-m[4]*m[1],a1=m[0]*m[6]-m[4]*m[2],a2=m[0]*m[7]-m[4]*m[3],a3=m[1]*m[6]-m[5]*m[2],a4=m[1]*m[7]-m[5]*m[3],a5=m[2]*m[7]-m[6]*m[3]
  const b0=m[8]*m[13]-m[12]*m[9],b1=m[8]*m[14]-m[12]*m[10],b2=m[8]*m[15]-m[12]*m[11],b3=m[9]*m[14]-m[13]*m[10],b4=m[9]*m[15]-m[13]*m[11],b5=m[10]*m[15]-m[14]*m[11]
  const det=a0*b5-a1*b4+a2*b3+a3*b2-a4*b1+a5*b0
  if (Math.abs(det)<1e-12) return null
  const id=1/det
  return [(m[5]*b5-m[6]*b4+m[7]*b3)*id,(-m[1]*b5+m[2]*b4-m[3]*b3)*id,(m[13]*a5-m[14]*a4+m[15]*a3)*id,(-m[9]*a5+m[10]*a4-m[11]*a3)*id,(-m[4]*b5+m[6]*b2-m[7]*b1)*id,(m[0]*b5-m[2]*b2+m[3]*b1)*id,(-m[12]*a5+m[14]*a2-m[15]*a1)*id,(m[8]*a5-m[10]*a2+m[11]*a1)*id,(m[4]*b4-m[5]*b2+m[7]*b0)*id,(-m[0]*b4+m[1]*b2-m[3]*b0)*id,(m[12]*a4-m[13]*a2+m[15]*a0)*id,(-m[8]*a4+m[9]*a2-m[11]*a0)*id,(-m[4]*b3+m[5]*b1-m[6]*b0)*id,(m[0]*b3-m[1]*b1+m[2]*b0)*id,(-m[12]*a3+m[13]*a1-m[14]*a0)*id,(m[8]*a3-m[9]*a1+m[10]*a0)*id]
}
const mat4FromQuat = (qx,qy,qz,qw) => {
  const w = qw !== undefined ? qw : Math.sqrt(Math.max(0,1-qx*qx-qy*qy-qz*qz))
  return [1-2*(qy*qy+qz*qz),2*(qx*qy+qz*w),2*(qx*qz-qy*w),0,2*(qx*qy-qz*w),1-2*(qx*qx+qz*qz),2*(qy*qz+qx*w),0,2*(qx*qz+qy*w),2*(qy*qz-qx*w),1-2*(qx*qx+qy*qy),0,0,0,0,1]
}
const mat4TRSQuat = (tx,ty,tz,qx,qy,qz,qw,sx,sy,sz) => {
  // 欧拉角版本（0013 实际为欧拉角弧度）
  const c1 = Math.cos(qx), s1 = Math.sin(qx)
  const c2 = Math.cos(qy), s2 = Math.sin(qy)
  const c3 = Math.cos(qz), s3 = Math.sin(qz)
  const R = [c2*c3, c2*s3, -s2, 0, s1*s2*c3-c1*s3, s1*s2*s3+c1*c3, s1*c2, 0, c1*s2*c3+s1*s3, c1*s2*s3-s1*c3, c1*c2, 0, 0,0,0,1]
  return [R[0]*sx,R[1]*sx,R[2]*sx,R[3],R[4]*sy,R[5]*sy,R[6]*sy,R[7],R[8]*sz,R[9]*sz,R[10]*sz,R[11],tx,ty,tz,1]
}
const transform = (m,x,y,z) => {
  const w = m[3]*x+m[7]*y+m[11]*z+m[15]
  const iw = w !== 0 ? 1/w : 0
  return [(m[0]*x+m[4]*y+m[8]*z+m[12])*iw,(m[1]*x+m[5]*y+m[9]*z+m[13])*iw,(m[2]*x+m[6]*y+m[10]*z+m[14])*iw]
}
function skinFrame(f) {
  const skin = []
  for (let i = 0; i < boneCount; i++) {
    const v = boneKf[i][f]
    const animM = mat4TRSQuat(v[0],v[1],v[2],v[3],v[4],v[5],undefined,v[6],v[7],v[8])
    const inv = mat4Invert(binds[i].m)
    skin.push(inv ? mat4Mul(animM, inv) : null)
  }
  return verts.map((v) => {
    let x = 0, y = 0, z = 0
    for (let k = 0; k < 4; k++) {
      const w = v.weights[k]
      if (!(w > 0)) continue
      const idx = v.boneIdx[k]
      const m = skin[idx]
      const p = m ? transform(m, v.pos[0], v.pos[1], v.pos[2]) : v.pos
      x += w*p[0]; y += w*p[1]; z += w*p[2]
    }
    return [x,y,z]
  })
}
// 骨骼动画值表
console.log('=== 睫毛骨骼动画值（关键帧）===')
for (const bi of [0, 1]) {
  console.log('骨骼' + bi + ':')
  for (const f of [0, 1, 3, 5, 8, 10, 12, 15, 20, 30]) {
    const v = boneKf[bi][f]
    console.log('  f' + String(f).padStart(2) + ': pos=(' + v[0].toFixed(1) + ',' + v[1].toFixed(1) + ') qz=' + v[5].toFixed(4) + ' s=(' + v[6].toFixed(3) + ',' + v[7].toFixed(3) + ')')
  }
}
const f0 = skinFrame(0)
const f10 = skinFrame(10)
// 位移统计
let maxD = 0, maxI = -1, moved = 0
for (let i = 0; i < verts.length; i++) {
  const d = Math.hypot(f10[i][0]-f0[i][0], f10[i][1]-f0[i][1])
  if (d > maxD) { maxD = d; maxI = i }
  if (d > 1) moved++
}
console.log('\n帧0→10 位移>1px: ' + moved + '/' + verts.length + ' max=' + maxD.toFixed(1) + 'px @v' + maxI)
console.log('v' + maxI + ': pos=(' + verts[maxI].pos[0].toFixed(1) + ',' + verts[maxI].pos[1].toFixed(1) + ') boneIdx=[' + verts[maxI].boneIdx.join(',') + '] w=[' + verts[maxI].weights.map(x=>x.toFixed(2)).join(',') + '] → f10=(' + f10[maxI][0].toFixed(1) + ',' + f10[maxI][1].toFixed(1) + ')')
const bb = (pts) => { let a=[Infinity,-Infinity,Infinity,-Infinity]; for(const p of pts){ if(p[0]<a[0])a[0]=p[0]; if(p[0]>a[1])a[1]=p[0]; if(p[1]<a[2])a[2]=p[1]; if(p[1]>a[3])a[3]=p[1] } return a }
console.log('包围盒 f0: ' + bb(f0).map(x=>x.toFixed(1)).join(' '))
console.log('包围盒 f10: ' + bb(f10).map(x=>x.toFixed(1)).join(' '))
// 生成 SVG 对比（白=原，红=帧10）
let svg = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="-120 -120 240 240">\n'
svg += '<rect x="-120" y="-120" width="240" height="240" fill="#222"/>\n'
for (let i = 0; i < verts.length; i++) {
  const p0 = f0[i], p10 = f10[i]
  svg += `<circle cx="${p0[0]}" cy="${-p0[1]}" r="1" fill="#fff" opacity="0.5"/>\n`
  svg += `<circle cx="${p10[0]}" cy="${-p10[1]}" r="1" fill="#f55"/>\n`
}
// 骨骼位置
for (let i = 0; i < boneCount; i++) {
  const v = boneKf[i][10]
  svg += `<circle cx="${v[0]}" cy="${-v[1]}" r="4" fill="none" stroke="#0f0"/>\n`
  svg += `<text x="${v[0]+3}" y="${-v[1]+3}" fill="#0f0" font-size="8">bone${i}</text>\n`
}
svg += '</svg>\n'
fs.writeFileSync('tools/lash-frame010.svg', svg)
console.log('SVG 已写入 tools/lash-frame010.svg')
