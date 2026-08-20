// 蒙皮渲染验证：stride=80 网格 + MDLE 矩阵 → SVG 线框 + MDLA 头分析
import { readFileSync, writeFileSync } from 'node:fs'

function parsePkg(path) {
  const buf = readFileSync(path)
  let pos = 16
  const entries = []
  while (pos + 8 <= buf.length) {
    const nameLen = buf.readInt32LE(pos); pos += 4
    if (nameLen <= 0 || nameLen > 1024 || pos + nameLen + 8 > buf.length) break
    const name = buf.subarray(pos, pos + nameLen).toString('utf8'); pos += nameLen
    const offset = buf.readInt32LE(pos); pos += 4
    const size = buf.readInt32LE(pos); pos += 4
    if (offset < 0 || size < 0 || offset + size > buf.length) break
    entries.push({ name, offset, size })
  }
  const dataStart = pos
  const read = (n) => {
    const e = entries.find((x) => x.name === n)
    if (!e) return null
    return buf.subarray(dataStart + e.offset, dataStart + e.offset + e.size)
  }
  return { read }
}

const pkg = parsePkg('D:/SteamLibrary/steamapps/workshop/content/431960/3463520581/scene.pkg')
const m = pkg.read('models/asuna body_puppet.mdl')

// MDLS 骨骼 count + MDLE 矩阵
const mdlsIdx = m.indexOf('MDLS')
const mdleIdx = m.indexOf('MDLE0002')
const mdatIdx = m.indexOf('MDAT0001')
const mdlaIdx = m.indexOf('MDLA0006')
console.log('MDLS@' + mdlsIdx + ' MDAT@' + mdatIdx + ' MDLA@' + mdlaIdx + ' MDLE@' + mdleIdx)

// MDLE 矩阵 @+17（byteCount @+13）
const byteCount = m.readUInt32LE(mdleIdx + 13)
const matCount = byteCount / 64
const bones = []
for (let i = 0; i < matCount; i++) {
  const mp = mdleIdx + 17 + i * 64
  const b = []
  for (let r = 0; r < 4; r++) {
    b.push([m.readFloatLE(mp + r * 16), m.readFloatLE(mp + r * 16 + 4), m.readFloatLE(mp + r * 16 + 8), m.readFloatLE(mp + r * 16 + 12)])
  }
  bones.push(b)
}
console.log('bones=' + matCount)

// 网格（stride=80）
const stride = 80
let blk = null
for (let offset = 9; offset + 12 < mdlsIdx; offset++) {
  const cvb = m.readUInt32LE(offset + 4)
  const vo = offset + 8
  const ilo = vo + cvb
  if (cvb === 0 || cvb % stride !== 0 || ilo + 4 > mdlsIdx) continue
  const cib = m.readUInt32LE(ilo)
  if (cib === 0 || cib % 6 !== 0 || ilo + 4 + cib > mdlsIdx) continue
  blk = { vo, vc: cvb / stride, ilo, ib: cib }
  break
}
console.log('mesh vc=' + blk.vc + ' tri=' + blk.ib / 6 + ' at ' + blk.vo)

// 蒙皮：skinPos = boneMatrix × [pos,1]（bone = 权重槽 14-17 的索引，权重 × 矩阵）
const skin = []
for (let i = 0; i < blk.vc; i++) {
  const vo = blk.vo + i * stride
  const px = m.readFloatLE(vo), py = m.readFloatLE(vo + 4), pz = m.readFloatLE(vo + 8)
  // 4 权重槽（隐含骨骼 0..3）
  let sx = 0, sy = 0, sz = 0
  for (let w = 0; w < 4; w++) {
    const wt = m.readFloatLE(vo + 56 + w * 4)
    if (wt === 0 || w >= bones.length) continue
    const bm = bones[w]
    const x = bm[0][0] * px + bm[1][0] * py + bm[2][0] * pz + bm[3][0]
    const y = bm[0][1] * px + bm[1][1] * py + bm[2][1] * pz + bm[3][1]
    const z = bm[0][2] * px + bm[1][2] * py + bm[2][2] * pz + bm[3][2]
    sx += wt * x; sy += wt * y; sz += wt * z
  }
  skin.push([sx, sy, sz])
}

// 范围
let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity
for (const [x, y] of skin) { if (x < mnx) mnx = x; if (x > mxx) mxx = x; if (y < mny) mny = y; if (y > mxy) mxy = y }
console.log('skin bounds x[' + mnx.toFixed(1) + ',' + mxx.toFixed(1) + '] y[' + mny.toFixed(1) + ',' + mxy.toFixed(1) + ']')
console.log('bone0 t=(' + bones[0][3][0].toFixed(2) + ',' + bones[0][3][1].toFixed(2) + ')')

// SVG（y-up 模型空间 → SVG y-down：ys = H - y）
const W = 700, H = 700
const pad = 20
const sx = (W - pad * 2) / Math.max(mxx - mnx, mxy - mny)
const toX = (x) => pad + (x - mnx) * sx
const toY = (y) => H - pad - (y - mny) * sx
const idx = []
const idxOff = blk.ilo + 4
const ic = blk.ib / 2
for (let i = 0; i < ic; i++) idx.push(m.readUInt16LE(idxOff + i * 2))
let tris = ''
let rawTris = ''
for (let t = 0; t + 2 < ic; t += 3) {
  const a = skin[idx[t]], b = skin[idx[t + 1]], c = skin[idx[t + 2]]
  const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
  if (Math.abs(area) < 1e-4) continue
  tris += `<polygon points="${toX(a[0])},${toY(a[1])} ${toX(b[0])},${toY(b[1])} ${toX(c[0])},${toY(c[1])}" fill="rgba(80,160,255,0.15)" stroke="#4488ff" stroke-width="0.6"/>\n`
}
// 未蒙皮 raw（bind 姿势）
const rawSkin = []
for (let i = 0; i < blk.vc; i++) {
  const vo = blk.vo + i * stride
  rawSkin.push([m.readFloatLE(vo), m.readFloatLE(vo + 4), m.readFloatLE(vo + 8)])
}
for (let t = 0; t + 2 < ic; t += 3) {
  const a = rawSkin[idx[t]], b = rawSkin[idx[t + 1]], c = rawSkin[idx[t + 2]]
  const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
  if (Math.abs(area) < 1e-4) continue
  rawTris += `<polygon points="${toX(a[0])},${toY(a[1])} ${toX(b[0])},${toY(b[1])} ${toX(c[0])},${toY(c[1])}" fill="rgba(255,120,120,0.12)" stroke="#ff6644" stroke-width="0.6"/>\n`
}
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
<rect width="${W}" height="${H}" fill="#111"/>
<text x="10" y="16" fill="#888" font-size="12">blue=skinned (MDLE), red=raw bind</text>
${tris}${rawTris}</svg>`
writeFileSync('_dev/out-asuna-skin.svg', svg)
console.log('SVG written')

// MDLA 头分析
if (mdlaIdx > 0) {
  console.log('MDLA head64: ' + m.subarray(mdlaIdx, mdlaIdx + 64).toString('hex'))
  // 解析动画目录（fields 连续读取）
  let p = mdlaIdx + 9
  const u32 = () => { const v = m.readUInt32LE(p); p += 4; return v }
  const u16 = () => { const v = m.readUInt16LE(p); p += 2; return v }
  const f32 = () => { const v = m.readFloatLE(p); p += 4; return v }
  const f2 = () => { const v = m.readFloatLE(p); p += 2; return v } // 2B 精度？
  const u8 = () => m[p++]
  const fileSize = u32()
  const animCount = u32()
  console.log('  fileSize=' + fileSize + ' animCount=' + animCount)
  for (let a = 0; a < animCount && a < 4; a++) {
    const id = u32()
    const f2v = f2()
    let nm = ''
    while (m[p] !== 0 && nm.length < 64) { nm += String.fromCharCode(m[p]); p++ }
    p++ // null
    let loop = ''
    while (m[p] !== 0 && loop.length < 64) { loop += String.fromCharCode(m[p]); p++ }
    p++
    const f5 = f2()
    const dur = f32()
    const f7 = f32()
    const bones2 = u32()
    const f9 = f32()
    const dataLen = u32()
    console.log('  anim[' + a + '] id=' + id + ' name="' + nm + '" loop="' + loop + '" dur=' + dur + ' bones=' + bones2 + ' dataLen=' + dataLen + ' @' + p)
    p += dataLen
  }
}
