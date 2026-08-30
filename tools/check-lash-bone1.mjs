// 检查睫毛骨骼1动画 + 场景图层层级/attachment
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
// 场景 JSON
const sceneBuf = pkg.read('scene.json')
const sceneText = Buffer.from(sceneBuf).toString('utf8')
// 打印 objects 中带 id/name/parent/image/attachment/animationlayers 的行
console.log('=== 场景图层（右眼相关 + 父层级）===')
const lines = sceneText.split(/[{}]/).map(s => s.trim()).filter(Boolean)
for (const l of lines) {
  if (/"(name|image|attachment|parent|animationlayers)"\s*:/.test(l) && /(眼|球|睫|head|Head|Layer|layer)/.test(l)) {
    console.log('  ' + l.slice(0, 180))
  }
}
// 睫毛骨骼1动画
const b = pkg.read('models/右睫毛_puppet.mdl')
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
const mdls = findTag(b, 'MDLS0001')
const mdla = findTag(b, 'MDLA0001')
let q = mdls + 17
console.log('\n=== 右睫毛 骨骼 bind ===')
for (let i = 0; i < 2 && q + 77 <= b.length; i++) {
  const parent = (b[q+5] | (b[q+6]<<8) | (b[q+7]<<16) | (b[q+8]<<24)) | 0
  const mp = q + 13
  const m = []
  for (let k = 0; k < 16; k++) m.push(f32At(b, mp + k * 4))
  console.log('  bone' + i + ': t=(' + m[12].toFixed(2) + ',' + m[13].toFixed(2) + ') parent=' + parent)
  let j = mp + 64
  while (j < b.length && b[j] !== 0 && j < q + 4096) j++
  q = j + 1
}
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
console.log('动画: duration=' + duration + ' boneCount=' + boneCount + ' frames=' + frames)
let bq = e
for (let bi = 0; bi < boneCount; bi++) {
  if (bi > 0) bq += 8
  let maxSpan = 0
  for (let vi = 0; vi < 9; vi++) {
    let mn = Infinity, mx = -Infinity
    for (let f = 0; f < frames; f++) {
      const v = f32At(b, bq + f * 36 + vi * 4)
      if (v < mn) mn = v
      if (v > mx) mx = v
    }
    if (mx - mn > maxSpan) maxSpan = mx - mn
  }
  const v0 = [0,1,2,3,4,5,6,7,8].map(k => f32At(b, bq + k * 4))
  const v10 = [0,1,2,3,4,5,6,7,8].map(k => f32At(b, bq + 10 * 36 + k * 4))
  console.log('骨骼' + bi + ': maxSpan=' + maxSpan.toFixed(2) + ' f0=(' + v0[0].toFixed(1) + ',' + v0[1].toFixed(1) + ') s=(' + v0[6].toFixed(2) + ',' + v0[7].toFixed(2) + ') | f10=(' + v10[0].toFixed(1) + ',' + v10[1].toFixed(1) + ') qz=' + v10[5].toFixed(3))
  bq += frames * 36
}
