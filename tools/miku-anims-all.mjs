// Miku 正确解析所有动画条目 + scene.json 图层动画引用
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
const pkg = readPkg('D:/SteamLibrary/steamapps/workshop/content/431960/3409595232/scene.pkg')
// 1. scene.json 中 puppet 引用 + animationlayers
const sceneText = Buffer.from(pkg.read('scene.json')).toString('utf8')
const puppets = [...sceneText.matchAll(/"puppet"\s*:\s*"([^"]+)"/g)].map(m => m[1])
console.log('scene 引用的 puppet: ' + [...new Set(puppets)].join(', '))
const anims = [...sceneText.matchAll(/"animationlayers"\s*:\s*\[\s*\{([^}]+)\}/g)].map(m => m[1])
console.log('animationlayers 条目:')
for (const a of anims.slice(0, 5)) console.log('  ' + a.replace(/\s+/g, ' ').slice(0, 120))
// 2. MDLA0006 所有动画条目（修正 q 前进：每骨骼块 dataLen，无头）
const b = pkg.read('models/导出初音_puppet.mdl')
const mdla = findTag(b, 'MDLA0006')
const mdle = findTag(b, 'MDLE0002')
console.log('\nMDLA0006@' + mdla + ' MDLE@' + mdle)
const animCount = u32At(b, mdla + 13)
console.log('animCount=' + animCount)
let q = mdla + 17
for (let a = 0; a < animCount && q + 8 <= b.length; a++) {
  const entryStart = q
  const id = u32At(b, q); q += 4
  q += 4
  let nm = ''
  while (b[q] !== 0) { nm += String.fromCharCode(b[q]); q++ }
  q++
  let lp = ''
  while (b[q] !== 0) { lp += String.fromCharCode(b[q]); q++ }
  q++
  const duration = f32At(b, q); q += 4
  const bc = u32At(b, q); q += 4
  q += 4
  const boneCount = u32At(b, q); q += 4
  q += 4
  const dataLen = u32At(b, q); q += 4
  q++ // extra 1B
  const dataStart = q
  const frames = Math.floor(dataLen / 36)
  console.log('anim' + a + ' id=' + id + ' name="' + nm + '" dur=' + duration + ' bones=' + boneCount + ' dataLen=' + dataLen + ' frames=' + frames)
  // 骨骼0 的 maxSpan（8 分量）
  if (frames > 0 && dataStart + frames * 36 <= b.length) {
    let maxSpan = 0, maxVi = -1
    for (let vi = 0; vi < 8; vi++) {
      let mn = Infinity, mx = -Infinity
      for (let f = 0; f < frames; f++) {
        const v = f32At(b, dataStart + f*36 + 3 + vi*4)
        if (v < mn) mn = v
        if (v > mx) mx = v
      }
      if (Number.isFinite(mn) && mx - mn > maxSpan) { maxSpan = mx - mn; maxVi = vi }
    }
    const f0 = [0,1,2,3,4,5,6,7].map(k => f32At(b, dataStart + 3 + k*4))
    const fN = [0,1,2,3,4,5,6,7].map(k => f32At(b, dataStart + (frames-1)*36 + 3 + k*4))
    console.log('  骨骼0: maxSpan=' + maxSpan.toFixed(2) + '(vi' + maxVi + ') f0=(' + f0.map(x=>x.toFixed(2)).join(',') + ') fN=(' + fN.map(x=>x.toFixed(2)).join(',') + ')')
  }
  // 前进到下一动画：本动画数据 = boneCount 块 × dataLen
  const totalData = Math.min(boneCount, 64) * dataLen
  q = dataStart + totalData
  console.log('  数据区总长=' + totalData + ' 下一动画@' + q)
}
