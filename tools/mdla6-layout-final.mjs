// 最终布局验证：MDLA0006 8 f32 各分量变化，确定 pos/rot/scale 下标
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
const pkg = readPkg('D:/SteamLibrary/steamapps/workshop/content/431960/3363252053/scene.pkg')
const b = pkg.read('models/身体部件_puppet.mdl')
const mdla = findTag(b, 'MDLA0006')
let q = mdla + 17
q += 4; q += 4
while (b[q] !== 0) q++; q++
while (b[q] !== 0) q++; q++
q += 4; q += 4; q += 4
const boneCount = u32At(b, q); q += 4
q += 4
const dataLen = u32At(b, q); q += 4
q++
const dataStart = q
const frames = Math.floor(dataLen / 36)
console.log('bones=' + boneCount + ' dataLen=' + dataLen + ' frames=' + frames)
// 逐骨骼：从 dataStart + bi*dataLen，无头。打印每骨骼 8 分量中 maxSpan>0.5 的
console.log('\n=== 每骨骼 8 分量 maxSpan（3B t + 8 f32，f32 from +3）===')
for (let bi = 0; bi < Math.min(boneCount, 12); bi++) {
  const off = dataStart + bi * dataLen
  const spans = [0,0,0,0,0,0,0,0]
  for (let vi = 0; vi < 8; vi++) {
    let mn = Infinity, mx = -Infinity
    for (let f = 0; f < frames; f++) {
      const v = f32At(b, off + f*36 + 3 + vi*4)
      if (v < mn) mn = v
      if (v > mx) mx = v
    }
    if (Number.isFinite(mn)) spans[vi] = mx - mn
  }
  const active = spans.map((s, i) => s > 0.5 ? i + ':' + s.toFixed(1) : '').filter(x => x !== '').join(' ')
  const f0 = [0,1,2,3,4,5,6,7].map(k => f32At(b, off + 3 + k*4))
  const f5 = [0,1,2,3,4,5,6,7].map(k => f32At(b, off + 5*36 + 3 + k*4))
  console.log('b' + bi + ' span: [' + spans.map(s=>s.toFixed(1)).join(',') + '] active: ' + (active||'-'))
  if (active) {
    console.log('    f0=(' + f0.map(x=>x.toFixed(2)).join(',') + ')')
    console.log('    f5=(' + f5.map(x=>x.toFixed(2)).join(',') + ')')
  }
}
