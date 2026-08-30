// 验证欧拉角假设：检查4个puppet所有骨骼的 qx/qy/qz 范围 + 左眼球骨骼0动画
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
for (const name of ['models/右眼_puppet.mdl', 'models/右睫毛_puppet.mdl', 'models/左眼球_puppet.mdl', 'models/z左睫毛_puppet.mdl']) {
  const b = pkg.read(name)
  const mdla = findTag(b, 'MDLA0001')
  if (mdla < 0) { console.log(name + ': 无 MDLA0001'); continue }
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
  console.log('\n=== ' + name + ' boneCount=' + boneCount + ' frames=' + frames + ' ===')
  let bq = e
  for (let bi = 0; bi < boneCount; bi++) {
    if (bi > 0) bq += 8
    // 各分量范围
    const rng = []
    for (let vi = 0; vi < 9; vi++) {
      let mn = Infinity, mx = -Infinity
      for (let f = 0; f < frames; f++) {
        const v = f32At(b, bq + f * 36 + vi * 4)
        if (v < mn) mn = v
        if (v > mx) mx = v
      }
      rng.push({ mn, mx, span: mx - mn })
    }
    const qMax = Math.max(rng[3].span, rng[4].span, rng[5].span)
    const qAbs = Math.max(Math.abs(rng[3].mn), Math.abs(rng[3].mx), Math.abs(rng[4].mn), Math.abs(rng[4].mx), Math.abs(rng[5].mn), Math.abs(rng[5].mx))
    console.log('  骨骼' + bi + ': posSpan=(' + rng[0].span.toFixed(1) + ',' + rng[1].span.toFixed(1) + ',' + rng[2].span.toFixed(1) + ') qSpan=' + qMax.toFixed(3) + ' qAbsMax=' + qAbs.toFixed(3) + ' (q范围: x[' + rng[3].mn.toFixed(3) + ',' + rng[3].mx.toFixed(3) + '] y[' + rng[4].mn.toFixed(3) + ',' + rng[4].mx.toFixed(3) + '] z[' + rng[5].mn.toFixed(3) + ',' + rng[5].mx.toFixed(3) + ']) sSpan=(' + rng[6].span.toFixed(3) + ',' + rng[7].span.toFixed(3) + ',' + rng[8].span.toFixed(3) + ')')
    bq += frames * 36
  }
}
