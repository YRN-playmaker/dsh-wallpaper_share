// 检查 0013 的 mesh（顶点网格）解析 —— 独立复制 mesh 扫描逻辑
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
  const mdls4 = find(b, 'MDLS0004')
  const mdls3 = find(b, 'MDLS0003')
  const mdls1 = find(b, 'MDLS0001')
  const mdls = mdls4 >= 0 ? mdls4 : mdls3 >= 0 ? mdls3 : mdls1
  const mdlsOffset = mdls >= 0 ? mdls : b.length
  const stride = 80
  let best = null
  for (let offset = 9; offset + 12 < mdlsOffset; offset++) {
    const candidateVertexBytes = u32At(b, offset + 4)
    const verticesOffset = offset + 8
    const indexLengthOffset = verticesOffset + candidateVertexBytes
    if (candidateVertexBytes === 0 || candidateVertexBytes % stride !== 0 || indexLengthOffset + 4 > mdlsOffset) continue
    const candidateIndexBytes = u32At(b, indexLengthOffset)
    const indicesOffset = indexLengthOffset + 4
    if (candidateIndexBytes === 0 || candidateIndexBytes % 6 !== 0 || indicesOffset + candidateIndexBytes > mdlsOffset) continue
    const vc = candidateVertexBytes / stride
    const idxCount = candidateIndexBytes / 2
    let valid = true
    let minX = Infinity
    for (let i = 0; i < vc; i++) {
      const vp = verticesOffset + i * stride
      const x = f32At(b, vp)
      if (!Number.isFinite(x)) { valid = false; break }
      if (x < minX) minX = x
    }
    if (!valid || !Number.isFinite(minX)) continue
    const maxIdx = vc - 1
    for (let i = 0; i < idxCount && valid; i++) {
      const v = u16At(b, indicesOffset + i * 2)
      if (v > maxIdx) valid = false
    }
    if (!valid) continue
    best = { offset, vc, idxCount, candidateVertexBytes, candidateIndexBytes }
    break
  }
  console.log(`=== ${eye} ===`)
  console.log('mdls@', mdls, 'mdlsIs3=', mdls >= 0 && mdls4 < 0)
  if (best) console.log('mesh FOUND: offset=' + best.offset, 'verts=' + best.vc, 'idx=' + best.idxCount)
  else console.log('mesh NOT FOUND')
  // 检查 mesh 顶点是否有权重
  if (best) {
    const verticesOffset = best.offset + 8
    let hasWeights = false
    for (let i = 0; i < Math.min(best.vc, 5); i++) {
      const vp = verticesOffset + i * stride
      const ws = [f32At(b, vp+56), f32At(b, vp+60), f32At(b, vp+64), f32At(b, vp+68)]
      if (ws.some(w => Math.abs(w) > 0.001)) { hasWeights = true; break }
    }
    console.log('  有骨骼权重:', hasWeights)
  }
}
