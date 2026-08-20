// 验证 MDLV 顶点 stride：40B（uv@32） vs 80B（uv@72，linux-wallpaperengine 采用）
// 判据1：三角形 pos 叉积方向 vs UV 叉积方向一致性（正确 UV 应高度一致；错误 UV 随机）
// 判据2：MDAT 具名骨骼平移 vs MDLE 矩阵平移 vs MDLS bind 平移 一致性
import { readFileSync } from 'node:fs'

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

// 扫描 MDLV 网格块（仿 linux-wallpaperengine findPuppetMeshBlock，但 stride 可配）
function findMesh(m, markerSize, mdlsOffset, vertexStride) {
  for (let offset = markerSize; offset + 8 + 4 < mdlsOffset; offset++) {
    const candidateVertexBytes = m.readUInt32LE(offset + 4)
    const verticesOffset = offset + 8
    const indexLengthOffset = verticesOffset + candidateVertexBytes
    if (candidateVertexBytes === 0 || candidateVertexBytes % vertexStride !== 0 || indexLengthOffset + 4 > mdlsOffset) continue
    const candidateIndexBytes = m.readUInt32LE(indexLengthOffset)
    const indicesOffset = indexLengthOffset + 4
    if (candidateIndexBytes === 0 || candidateIndexBytes % 6 !== 0 || indicesOffset + candidateIndexBytes > mdlsOffset) continue
    return { headerOffset: offset, vertexBytes: candidateVertexBytes, indexBytes: candidateIndexBytes }
  }
  return null
}

function analyze(mdlPath, pkg) {
  const m = pkg.read(mdlPath)
  if (!m) { console.log(mdlPath + ': MISSING'); return }
  const markerSize = 9
  // mdlsOffset：扫描 "MDLS" 魔数
  let mdlsOffset = -1
  for (let i = markerSize; i + 4 < m.length; i++) {
    if (m.toString('ascii', i, i + 4) === 'MDLS') { mdlsOffset = i; break }
  }
  const mdleIdx = m.indexOf('MDLE0002')
  const mdatIdx = m.indexOf('MDAT0001')
  const mdlaIdx = m.indexOf('MDLA0006')

  for (const stride of [40, 80]) {
    const blk = findMesh(m, markerSize, mdlsOffset, stride)
    if (!blk) { console.log(mdlPath + ' stride=' + stride + ': no mesh block'); continue }
    const vc = blk.vertexBytes / stride
    const verts = []
    const vertsOff = blk.headerOffset + 8
    for (let i = 0; i < vc; i++) {
      const vo = vertsOff + i * stride
      const px = m.readFloatLE(vo + 0), py = m.readFloatLE(vo + 4), pz = m.readFloatLE(vo + 8)
      verts.push({ px, py, pz })
    }
    const idxOff = vertsOff + blk.vertexBytes + 4
    const ic = blk.indexBytes / 2
    const idx = []
    for (let i = 0; i < ic; i++) idx.push(m.readUInt16LE(idxOff + i * 2))

    // 判据1：三角形方向一致性（非退化三角形）
    let nonDeg = 0, same = 0
    const areas = []
    for (let t = 0; t + 2 < ic; t += 3) {
      const a = verts[idx[t]], b = verts[idx[t + 1]], c = verts[idx[t + 2]]
      const ax = b.px - a.px, ay = b.py - a.py
      const bx = c.px - a.px, by = c.py - a.py
      const cross = ax * by - ay * bx
      if (Math.abs(cross) < 1e-6) continue
      nonDeg++
      areas.push(Math.abs(cross))
      // UV 方向
      const uOff = stride === 40 ? 32 : 72
      const ua = m.readFloatLE(vertsOff + idx[t] * stride + uOff)
      const va = m.readFloatLE(vertsOff + idx[t] * stride + uOff + 4)
      const ub = m.readFloatLE(vertsOff + idx[t + 1] * stride + uOff)
      const vb = m.readFloatLE(vertsOff + idx[t + 1] * stride + uOff + 4)
      const uc = m.readFloatLE(vertsOff + idx[t + 2] * stride + uOff)
      const vc2 = m.readFloatLE(vertsOff + idx[t + 2] * stride + uOff + 4)
      const ucross = (ub - ua) * (vc2 - va) - (vb - va) * (uc - ua)
      if (ucross * cross > 0) same++
    }
    areas.sort((x, y) => x - y)
    const med = areas.length ? areas[Math.floor(areas.length / 2)] : 0
    console.log(mdlPath.split('/').pop() + ' stride=' + stride +
      ': vc=' + vc + ' tri=' + (ic / 3) + ' nonDeg=' + nonDeg +
      ' sameDir=' + same + '/' + nonDeg + ' (' + (nonDeg ? Math.round(same / nonDeg * 100) : 0) + '%)' +
      ' medianArea=' + med.toFixed(2))
  }

  // 判据2：MDAT vs MDLE 平移
  if (mdatIdx > 0 && mdleIdx > 0) {
    const end = mdlaIdx > 0 ? mdlaIdx : m.length
    let p = mdatIdx + 17
    const bones = []
    while (p + 66 <= end) {
      let nm = ''
      let q = p
      while (q < end && m[q] !== 0 && m[q] >= 32 && m[q] < 127) { nm += String.fromCharCode(m[q]); q++ }
      if (nm.length >= 2 && m[q] === 0 && q + 1 + 64 <= end) {
        const mp = q + 1
        const f = (k) => m.readFloatLE(mp + k * 4)
        bones.push({ name: nm, t: [f(12), f(13), f(14)] })
        p = mp + 64
      } else break
    }
    // MDLE: "MDLE0002\0" + offset(4B) + count(4B) + count×64B（列主序）
    const matCount = m.readUInt32LE(mdleIdx + 15)
    const mats = []
    for (let i = 0; i < matCount; i++) {
      const mp = mdleIdx + 19 + i * 64
      mats.push([m.readFloatLE(mp + 48), m.readFloatLE(mp + 52), m.readFloatLE(mp + 56)])
    }
    console.log(mdlPath.split('/').pop() + ' MDAT=' + bones.length + ' MDLE=' + matCount)
    for (let i = 0; i < Math.min(bones.length, matCount); i++) {
      const b = bones[i], mm = mats[i]
      const d = Math.hypot(b.t[0] - mm[0], b.t[1] - mm[1], b.t[2] - mm[2])
      if (d > 0.01 || i < 3) console.log('  bone[' + i + '] ' + b.name + ' MDAT=(' + b.t.map((x) => x.toFixed(2)).join(',') + ') MDLE=(' + mm.map((x) => x.toFixed(2)).join(',') + ') d=' + d.toFixed(2))
    }
  } else if (mdatIdx > 0) {
    console.log(mdlPath.split('/').pop() + ': MDAT only (no MDLE)')
  }
}

const pkg = parsePkg('D:/SteamLibrary/steamapps/workshop/content/431960/3463520581/scene.pkg')
for (const n of [
  'models/asuna body_puppet.mdl',          // #22 15 bones + MDLE
  'models/puppet_puppet.mdl',              // #30 1 bone
  'models/puppet - Copy_puppet.mdl',       // #34 1 bone
  'models/asuna body bottom_puppet.mdl',   // #16
  'models/hair back big chunk_puppet.mdl', // #70
  'models/main hair back c2_puppet.mdl',   // #134
]) analyze(n, pkg)
