// 检查 3409595232 的 puppet 动画：MDLA0006 数据、帧值、mesh 是否存在
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
const mdls = findTag(b, 'MDLS0003')
const mdla = findTag(b, 'MDLA0006')
const mdle = findTag(b, 'MDLE0002')
console.log('len=' + b.length + ' MDLS0003@' + mdls + ' MDLA0006@' + mdla + ' MDLE0002@' + mdle)
// MDLS0003 骨骼
if (mdls >= 0) {
  const bc = u32At(b, mdls + 13)
  console.log('boneCount=' + bc)
  let q = mdls + 17
  for (let i = 0; i < Math.min(bc, 5) && q + 4 <= b.length; i++) {
    const parent = (b[q+5] | (b[q+6]<<8) | (b[q+7]<<16) | (b[q+8]<<24)) | 0
    const mp = q + 13
    const m = []
    for (let k = 0; k < 16; k++) m.push(f32At(b, mp + k * 4))
    let j = mp + 64
    let nm = ''
    while (j < b.length && b[j] !== 0 && nm.length < 30) { nm += String.fromCharCode(b[j]); j++ }
    console.log('  bone' + i + ': t=(' + m[12].toFixed(2) + ',' + m[13].toFixed(2) + ') parent=' + parent + ' name="' + nm + '"')
    q = j + 1
  }
}
// MDLA0006 动画
if (mdla >= 0) {
  const ac = u32At(b, mdla + 13)
  console.log('\nanimCount=' + ac)
  let q = mdla + 17
  for (let a = 0; a < ac && q + 8 <= b.length; a++) {
    const id = u32At(b, q); q += 4
    q += 4
    let nm = ''
    while (b[q] !== 0 && nm.length < 40) { nm += String.fromCharCode(b[q]); q++ }
    q++
    let lp = ''
    while (b[q] !== 0 && lp.length < 40) { lp += String.fromCharCode(b[q]); q++ }
    q++
    if (nm === '' || q + 20 > b.length) break
    const duration = f32At(b, q); q += 4
    const bc = u32At(b, q); q += 4
    q += 4
    const boneCount = u32At(b, q); q += 4
    q += 4
    const dataLen = u32At(b, q); q += 4
    if (dataLen <= 0 || dataLen > b.length - q) break
    q++ // extra 1B
    console.log('  anim id=' + id + ' name="' + nm + '" loop="' + lp + '" dur=' + duration + ' boneCount=' + boneCount + ' dataLen=' + dataLen)
    const frameCount = Math.floor(dataLen / 36)
    console.log('    frameCount=' + frameCount)
    // 用 parseKeyframes 逻辑评估偏移 0..4
    for (let off = 0; off <= 4 && q + off + 36 <= b.length; off++) {
      const t0 = (b[q+off] | (b[q+off+1]<<8) | (b[q+off+2]<<16)) >>> 0
      const v0 = [0,1,2,3,4,5,6,7].map(k => f32At(b, q + off + 3 + k * 4))
      const t1 = (b[q+off+36] | (b[q+off+36+1]<<8) | (b[q+off+36+2]<<16)) >>> 0
      const v1 = [0,1,2,3,4,5,6,7].map(k => f32At(b, q + off + 39 + k * 4))
      console.log('    off=' + off + ': t0=' + t0 + ' v0=(' + v0.map(x=>x.toFixed(2)).join(',') + ') | t1=' + t1 + ' v1=(' + v1.map(x=>x.toFixed(2)).join(',') + ')')
    }
    // 检查整个数据段是否有变化
    let maxSpan = 0
    for (let vi = 0; vi < 8; vi++) {
      let mn = Infinity, mx = -Infinity
      for (let f = 0; f < frameCount; f++) {
        const fp = q + f * 36
        if (fp + 36 > b.length) break
        const v = f32At(b, fp + 3 + vi * 4)
        if (v < mn) mn = v
        if (v > mx) mx = v
      }
      if (Number.isFinite(mn) && mx - mn > maxSpan) maxSpan = mx - mn
    }
    console.log('    maxSpan(off=0, 8分量)=' + maxSpan.toFixed(2))
    q += dataLen
  }
}
// mesh 是否存在：在 MDLS 之前找 stride 80/64
if (mdls > 0) {
  for (const stride of [80, 64]) {
    let found = 0
    for (let offset = 9; offset < Math.min(mdls, 300); offset++) {
      const vb = u32At(b, offset + 4)
      if (vb === 0 || vb % stride !== 0) continue
      const vo = offset + 8
      const ilo = vo + vb
      if (ilo + 4 > mdls) continue
      const ib = u32At(b, ilo)
      if (ib === 0 || ib % 6 !== 0 || ib > 500000) continue
      const io = ilo + 4
      if (io + ib > mdls) continue
      found++
    }
    console.log('\nstride=' + stride + ' 候选 mesh 数=' + found)
  }
}
