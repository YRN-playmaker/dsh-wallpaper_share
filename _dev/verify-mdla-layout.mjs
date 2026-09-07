// 验证脚本：对全机 workshop 场景的 puppet MDL，用对方 (dsh-wallpaper-engine) 的
// 9 列交错 MDLA 布局 + MDLS 层级链乘，验证不变量：
//   1) 动画帧0 世界姿势 ≈ bind 世界姿势（多数模型成立）
//   2) 蒙皮索引/权重合法（索引 < 骨数、权重 ∈ [0,1] 且和 ≈ 1）
//   3) MDAT 锚点 boneIdx < 骨数
// 输出汇总表，供"是否采用对方布局"定案。
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

// ---------- pkg 读取 ----------
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
  const names = () => entries.map((e) => e.name)
  return { read, names }
}

// ---------- 矩阵 (行主序, 与对方 puppet.js 一致) ----------
function matMulRow(a, b) {
  const o = new Array(16)
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++)
    o[r * 4 + c] = a[r * 4 + 0] * b[0 * 4 + c] + a[r * 4 + 1] * b[1 * 4 + c] + a[r * 4 + 2] * b[2 * 4 + c] + a[r * 4 + 3] * b[3 * 4 + c]
  return o
}

// ---------- 对方 _parseMdl 移植 ----------
function parseMdl(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  let mdlsOffset = buf.length
  for (let off = 9; off + 4 < buf.length; off++)
    if (buf[off] === 0x4d && buf[off + 1] === 0x44 && buf[off + 2] === 0x4c && buf[off + 3] === 0x53) { mdlsOffset = off; break }

  let found = null
  for (let offset = 9; offset + 12 < mdlsOffset; offset++) {
    const vertexBytes = dv.getUint32(offset + 4, true)
    const verticesOffset = offset + 8
    if (vertexBytes === 0 || vertexBytes % 80 !== 0) continue
    const indexLenOffset = verticesOffset + vertexBytes
    if (indexLenOffset + 4 > mdlsOffset) continue
    const indexBytes = dv.getUint32(indexLenOffset, true)
    const indicesOffset = indexLenOffset + 4
    if (indexBytes === 0 || indexBytes % 2 !== 0 || indicesOffset + indexBytes > mdlsOffset) continue
    const vc = vertexBytes / 80
    let sane = true
    for (let i = 0; i < Math.min(vc, 64); i++) {
      const vo = verticesOffset + i * 80
      for (let k = 0; k < 3; k++) {
        const v = dv.getFloat32(vo + k * 4, true)
        if (!isFinite(v) || Math.abs(v) > 1e6) { sane = false; break }
      }
      if (!sane) break
    }
    if (!sane) continue
    const ic = indexBytes / 2
    if (ic > 0) {
      let idxOk = 0
      for (let k = 0; k < Math.min(ic, 400); k++) if (dv.getUint16(indicesOffset + k * 2, true) < vc) idxOk++
      if (idxOk < Math.min(ic, 400) * 0.98) continue
    }
    found = { verticesOffset, vertexBytes, indicesOffset, indexBytes, vc }
    break
  }
  if (!found) return { ok: false, reason: 'no-mesh' }

  const blendIndices = [], blendWeights = []
  for (let i = 0; i < found.vc; i++) {
    const vo = found.verticesOffset + i * 80
    blendIndices.push([dv.getUint32(vo + 40, true), dv.getUint32(vo + 44, true), dv.getUint32(vo + 48, true), dv.getUint32(vo + 52, true)])
    blendWeights.push([dv.getFloat32(vo + 56, true), dv.getFloat32(vo + 60, true), dv.getFloat32(vo + 64, true), dv.getFloat32(vo + 68, true)])
  }

  let bones = [], animations = [], anchors = []
  if (mdlsOffset < buf.length) {
    try {
      let p = mdlsOffset + 9
      p += 4
      const boneCount = dv.getUint32(p, true); p += 4
      for (let b = 0; b < boneCount && p + 12 < buf.length; b++) {
        let headExtra = 0
        let tmp = buf[p]
        let type = dv.getUint32(p + 1, true)
        let parent = dv.getInt32(p + 5, true)
        let len = dv.getUint32(p + 9, true)
        if (len === 0 || len > 4096) {
          tmp = dv.getUint16(p, true)
          type = dv.getUint32(p + 2, true)
          parent = dv.getInt32(p + 6, true)
          len = dv.getUint32(p + 10, true)
          headExtra = 1
          if (len === 0 || len > 4096) break
        }
        p += 9 + headExtra
        p += 4
        const m = new Array(16)
        for (let i = 0; i < 16; i++) m[i] = dv.getFloat32(p + i * 4, true)
        p += len
        let je = p
        while (je < buf.length && buf[je] !== 0) je++
        p = je + 1
        bones.push({ index: b, type, parent: parent === -1 ? -1 : parent, bind: m })
      }
    } catch { bones = [] }

    const mdla = buf.indexOf('MDLA')
    if (mdla >= 0) {
      try {
        let p = mdla + 9
        p += 4
        const animCount = dv.getUint32(p, true); p += 4
        for (let a = 0; a < animCount && p + 12 < buf.length; a++) {
          p += 8
          const nameEnd = buf.indexOf(0, p); if (nameEnd < 0) break
          const animName = buf.toString('utf8', p, nameEnd); p = nameEnd + 1
          const loopEnd = buf.indexOf(0, p); if (loopEnd < 0) break
          p = loopEnd + 1
          while (p + 1 < buf.length && !(buf[p] === 0xf0 && buf[p + 1] === 0x41)) p++
          p += 2
          const frameCount = dv.getUint16(p, true); p += 2
          p += 2
          p += 4
          const boneCount = dv.getUint32(p, true); p += 4
          p += 4
          const segBytes = dv.getUint32(p, true); p += 4
          const segs = []
          for (let b = 0; b < boneCount && p + (b + 1) * segBytes <= buf.length; b++) segs.push(p + b * segBytes)
          animations.push({ name: animName, frameCount, boneCount, segBytes, segs })
          p += segBytes * boneCount
        }
      } catch { animations = [] }
    }

    // MDAT 锚点 (对方 core.js: [u16 boneIdx + name\0 + 64B 矩阵])
    const mdat = buf.indexOf('MDAT')
    if (mdat >= 0) {
      try {
        let p = mdat + 9
        p += 4
        const cnt = dv.getUint16(p, true); p += 2
        const cnt2 = dv.getUint16(p, true); p += 2
        for (let i = 0; i < Math.min(cnt || cnt2, 256) && p + 66 < buf.length; i++) {
          const boneIdx = dv.getUint16(p, true); p += 2
          const ne = buf.indexOf(0, p); if (ne < 0) break
          const name = buf.toString('utf8', p, ne); p = ne + 1
          const m = new Array(16)
          for (let k = 0; k < 16; k++) m[k] = dv.getFloat32(p + k * 4, true)
          p += 64
          anchors.push({ name, boneIdx, tx: m[12], ty: m[13] })
        }
      } catch { anchors = [] }
    }
  }
  return { ok: true, blendIndices, blendWeights, bones, animations, anchors, vc: found.vc }
}

// ---------- 对方 _sampleAnimRT 移植 ----------
function sampleAnimRT(buf, anim, frame, nb, bones) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const out = new Array(nb)
  const totalFrames = Math.max(1, anim.frameCount)
  for (let b = 0; b < nb; b++) {
    const segStart = anim.segs[b]
    if (segStart === undefined) { out[b] = null; continue }
    const b2 = 2 * b
    const posShift = Math.floor(b2 / 9)
    const posCol = b2 % 9
    const frame0 = ((frame + posShift) % totalFrames) * 36
    const o = segStart + frame0 + posCol * 4
    const px = dv.getFloat32(o, true)
    const py = dv.getFloat32(o + 4, true)
    const rotShift = Math.floor((b2 + 5) / 9)
    const rotCol = (b2 + 5) % 9
    const o2 = segStart + ((frame + posShift + rotShift) % totalFrames) * 36 + rotCol * 4
    const rotZ = dv.getFloat32(o2, true)
    const parent = bones[b].parent
    if (isFinite(px) && isFinite(py) && Math.abs(px) < 10000 && Math.abs(py) < 10000 && isFinite(rotZ)) {
      if (parent >= 0 && parent < nb && out[parent]) {
        const pa = out[parent].angle, pc = Math.cos(pa), ps = Math.sin(pa)
        out[b] = { angle: pa + rotZ, tx: out[parent].tx + px * pc - py * ps, ty: out[parent].ty + px * ps + py * pc }
      } else out[b] = { angle: rotZ, tx: px, ty: py }
    } else {
      const bm = bones[b].bind
      if (parent >= 0 && parent < nb && out[parent]) {
        const pa = out[parent].angle, pc = Math.cos(pa), ps = Math.sin(pa)
        out[b] = { angle: pa + Math.atan2(bm[1], bm[0]), tx: out[parent].tx + bm[12] * pc - bm[13] * ps, ty: out[parent].ty + bm[12] * ps + bm[13] * pc }
      } else out[b] = { angle: Math.atan2(bm[1], bm[0]), tx: bm[12], ty: bm[13] }
    }
  }
  return out
}

function wrapAngle(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a }

// ---------- 扫描 + 验证 ----------
const ROOT = 'D:/SteamLibrary/steamapps/workshop/content/431960'
const rows = []
const ids = readdirSync(ROOT).filter((d) => /^\d+$/.test(d))
for (const id of ids) {
  const pkgPath = join(ROOT, id, 'scene.pkg')
  if (!existsSync(pkgPath)) continue
  let pkg
  try { pkg = parsePkg(pkgPath) } catch { continue }
  const mdlNames = pkg.names().filter((n) => /\.mdl$/i.test(n))
  for (const mn of mdlNames) {
    const buf = pkg.read(mn)
    if (!buf || buf.indexOf('MDLA') < 0 || buf.indexOf('MDLS') < 0) continue
    const r = parseMdl(buf)
    if (!r.ok || !r.bones.length || !r.animations.length) continue
    const nb = r.bones.length

    // 不变量1：帧0 世界 ≈ bind 世界
    const bindWorld = new Array(nb)
    for (let b = 0; b < nb; b++) {
      const par = r.bones[b].parent
      bindWorld[b] = par >= 0 && par < nb && bindWorld[par] ? matMulRow(bindWorld[par], r.bones[b].bind) : r.bones[b].bind
    }
    const anim = r.animations[0]
    let frame0 = null
    try { frame0 = sampleAnimRT(buf, anim, 0, nb, r.bones) } catch { }
    let maxPos = 0, maxAng = 0, okCount = 0
    if (frame0) {
      for (let b = 0; b < nb; b++) {
        const f = frame0[b]
        if (!f) continue
        const bw = bindWorld[b]
        const dAng = Math.abs(wrapAngle(f.angle - Math.atan2(bw[1], bw[0])))
        const dPos = Math.hypot(f.tx - bw[12], f.ty - bw[13])
        if (dAng < 0.05 && dPos < 2) okCount++
        if (dPos > maxPos) maxPos = dPos
        if (dAng > maxAng) maxAng = dAng
      }
    }

    // 不变量2：索引/权重合法
    let idxOk = 0, wOk = 0
    for (let v = 0; v < r.vc; v++) {
      const bi = r.blendIndices[v], bw = r.blendWeights[v]
      let ii = 0, wi = 0
      for (let k = 0; k < 4; k++) { if (bi[k] < nb) ii++; if (bw[k] >= -0.001 && bw[k] <= 1.001) wi++ }
      if (ii === 4) idxOk++
      const s = bw[0] + bw[1] + bw[2] + bw[3]
      if (Math.abs(s - 1) < 0.05) wOk++
    }
    // 不变量3：MDAT boneIdx 合法
    const anchOk = r.anchors.length === 0 ? -1 : (r.anchors.every((a) => a.boneIdx >= 0 && a.boneIdx < nb) ? 1 : 0)

    rows.push({
      id, mdl: mn, nb, nAnim: r.animations.length, frame0Ok: frame0 ? Math.round(100 * okCount / nb) : -1,
      maxPos: +maxPos.toFixed(1), maxAng: +maxAng.toFixed(3),
      idxOk: Math.round(100 * idxOk / r.vc), wOk: Math.round(100 * wOk / r.vc),
      anchors: r.anchors.length, anchOk,
      bonesStr: r.bones.map((b) => b.parent).join(','),
    })
  }
}

// 汇总
console.log('总计 puppet MDL (含 MDLA+MDLS):', rows.length)
const fail = rows.filter((r) => r.frame0Ok < 100)
console.log('帧0≈bind 不完全吻合(说明布局/头部偏移可能异常) 的模型数:', fail.length)
console.log('')
console.log('id | mdl | bones | anims | frame0Ok% | maxPos | maxAng | idxOk% | wOk% | anch(anchOk)')
for (const r of rows) {
  console.log([r.id, r.mdl, r.nb, r.nAnim, r.frame0Ok, r.maxPos, r.maxAng, r.idxOk, r.wOk, `${r.anchors}(${r.anchOk})`].join(' | '))
}
console.log('')
console.log('=== frame0 不完全吻合的模型（重点排查） ===')
for (const r of fail) console.log(`${r.id} ${r.mdl} nb=${r.nb} frame0Ok=${r.frame0Ok}% maxPos=${r.maxPos} maxAng=${r.maxAng}`)
