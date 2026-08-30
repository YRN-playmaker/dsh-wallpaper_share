// 数据驱动确定 MDLA0006 骨骼块布局：枚举头大小，检验各骨骼帧时间戳单调性与 bind 匹配
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
// MDLS 骨骼 bind（用于匹配）
const readBinds = (b, mlsTag) => {
  const mls = findTag(b, mlsTag)
  if (mls < 0) return []
  const bc = u32At(b, mls + 13)
  const binds = []
  let q = mls + 17
  for (let i = 0; i < bc && q + 4 <= b.length; i++) {
    const mp = q + 13
    const m = []
    for (let k = 0; k < 16; k++) m.push(f32At(b, mp + k * 4))
    binds.push({ x: m[12], y: m[13] })
    let j = mp + 64
    while (j < b.length && b[j] !== 0) j++
    q = j + 1
  }
  return binds
}
function analyzeMdl(path, mdlName) {
  const pkg = readPkg(path)
  const b = pkg.read(mdlName)
  const magic = String.fromCharCode(...b.slice(0, 4))
  const mlsTag = findTag(b, 'MDLS0004') >= 0 ? 'MDLS0004' : (findTag(b, 'MDLS0003') >= 0 ? 'MDLS0003' : 'MDLS0001')
  const binds = readBinds(b, mlsTag)
  const mdla = findTag(b, 'MDLA0006')
  const mdle = findTag(b, 'MDLE0002')
  console.log('=== ' + mdlName + ' fmt=' + magic + ' mls=' + mlsTag + ' binds=' + binds.length + ' MDLA0006@' + mdla + ' MDLE@' + mdle)
  // 第一个动画条目
  let q = mdla + 17
  const animCount = u32At(b, mdla + 13)
  q += 4; q += 4
  let nm = ''
  while (b[q] !== 0) { nm += String.fromCharCode(b[q]); q++ }
  q++
  while (b[q] !== 0) q++; q++
  q += 4 // duration
  q += 4; q += 4
  const boneCount = u32At(b, q); q += 4
  q += 4
  const dataLen = u32At(b, q); q += 4
  q++ // extra
  const dataStart = q
  console.log('animCount=' + animCount + ' bones=' + boneCount + ' dataLen=' + dataLen + ' dataStart@' + dataStart + ' 段余量=' + (mdle - dataStart))
  // 枚举头大小：骨骼0 之后每个骨骼块头
  for (const headSize of [0, 4, 8, 12]) {
    let bq = dataStart
    let ok = true
    const rows = []
    for (let bi = 0; bi < Math.min(boneCount, 8) && bq + 8 < mdle; bi++) {
      let blockStart = bq
      if (bi > 0) {
        const h = u32At(b, bq)
        if (headSize === 4 && h !== dataLen) { ok = false; break }
        if (headSize === 8) { const h0 = u32At(b, bq); const h1 = u32At(b, bq + 4); if (h0 !== 0 || h1 !== dataLen) { ok = false; break } }
        blockStart = bq + headSize
      }
      // 该块帧：3B t + 8 f32
      const frames = Math.floor((dataLen) / 36)
      let t0 = -1, t1 = -1
      let firstV = null
      let maxSpan = 0
      for (let f = 0; f < Math.min(frames, 4); f++) {
        const fp = blockStart + f * 36
        const t3 = (b[fp] | (b[fp+1]<<8) | (b[fp+2]<<16)) >>> 0
        const vals = [0,1,2,3,4,5,6,7].map(k => f32At(b, fp + 3 + k * 4))
        if (f === 0) { t0 = t3; firstV = vals }
        if (f === 1) t1 = t3
      }
      // maxSpan
      for (let vi = 0; vi < 8; vi++) {
        let mn = Infinity, mx = -Infinity
        for (let f = 0; f < frames; f++) {
          const v = f32At(b, blockStart + f*36 + 3 + vi*4)
          if (v < mn) mn = v
          if (v > mx) mx = v
        }
        if (Number.isFinite(mn) && mx - mn > maxSpan) maxSpan = mx - mn
      }
      const bind = binds[bi]
      rows.push('  b' + bi + '@' + blockStart + ' t0=' + t0 + ' t1=' + t1 + ' v0=(' + (firstV ? firstV.slice(0,3).map(x=>x.toFixed(1)).join(',') : '?') + ') span=' + maxSpan.toFixed(1) + ' bind=(' + (bind ? bind.x.toFixed(1)+','+bind.y.toFixed(1) : '?') + ')')
      bq = blockStart + dataLen
    }
    if (ok) {
      console.log('  --- 头大小 ' + headSize + '：布局可行 ---')
      for (const r of rows) console.log(r)
    } else {
      console.log('  头大小 ' + headSize + '：不匹配（bq@' + bq + '）')
    }
  }
}
// 0023 身体部件
analyzeMdl('D:/SteamLibrary/steamapps/workshop/content/431960/3363252053/scene.pkg', 'models/身体部件_puppet.mdl')
