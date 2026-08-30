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
const pkg = readPkg('D:/SteamLibrary/steamapps/workshop/content/431960/2804379697/scene.pkg')
const b = pkg.read('models/右眼_puppet.mdl')
const f32At = (q) => new Float32Array(new Int32Array([(b[q] | (b[q+1]<<8) | (b[q+2]<<16) | (b[q+3]<<24)) | 0]).buffer)[0]
const u32At = (q) => (b[q] | (b[q+1]<<8) | (b[q+2]<<16) | (b[q+3]<<24)) >>> 0
// MDLA0001 @79982
const mdla = 79982
console.log('u32 @+9 (mdla+9=79991):', u32At(mdla + 9))
console.log('u32 @+13 (animCount):', u32At(mdla + 13))
// 0006 布局：animCount@+13，条目 @+17
let q = mdla + 17
console.log('条目起点 q =', q)
console.log('id u32:', u32At(q))
q += 4
console.log('id后 u32:', u32At(q))
q += 4
// name
let nm = ''
let s = q
while (b[s] !== 0 && nm.length < 128) { nm += String.fromCharCode(b[s]); s++ }
console.log('name:', JSON.stringify(nm), '@', q)
q = s + 1
let lp = ''
s = q
while (b[s] !== 0 && lp.length < 128) { lp += String.fromCharCode(b[s]); s++ }
console.log('loop:', JSON.stringify(lp), '@', q)
q = s + 1
console.log('duration f32:', f32At(q))
q += 4
const bc = u32At(q)
console.log('boneCount:', bc)
q += 4
console.log('u32:', u32At(q)); q += 4
console.log('u32:', u32At(q)); q += 4
console.log('u32:', u32At(q)); q += 4
const dataLen = u32At(q)
console.log('dataLen:', dataLen)
q += 4
q++ // extra
console.log('数据起点 q =', q, 'dataLen =', dataLen, '每帧36B → 帧数 =', Math.floor(dataLen / 36))
// 尝试解析关键帧
const frameCount = Math.floor(dataLen / 36)
for (let f = 0; f < Math.min(frameCount, 4); f++) {
  const fp = q + f * 36
  const t = (b[fp] | (b[fp+1]<<8) | (b[fp+2]<<16)) >>> 0
  const vals = []
  for (let k = 0; k < 8; k++) vals.push(f32At(fp + 3 + k * 4))
  console.log('帧', f, 't=', t, 'vals=', vals.map(v => Number.isFinite(v) ? v.toFixed(2) : '?').join(', '))
}
