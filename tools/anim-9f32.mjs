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
  const mdla = find(b, 'MDLA0001')
  if (mdla < 0) { console.log(eye, ': no MDLA0001'); continue }
  // 正确解析：MDLA0001 无 extra 字节，数据从 q 直接开始（dataLen 后）
  let q = mdla + 17
  q += 4 // id
  q += 4 // u32
  while (b[q] !== 0) q++
  q++
  while (b[q] !== 0) q++
  q++
  q += 4 // duration
  q += 4 // bc
  q += 4; q += 4; q += 4
  const dataLen = u32At(b, q); q += 4
  // 无 extra！数据直接从 q 开始
  console.log(`=== ${eye} ===`)
  const frameSize = 36 // 9 f32 = 36B
  const frames = Math.floor(dataLen / frameSize)
  console.log(`frames=${frames} dataLen=${dataLen} frameSize=${frameSize}`)
  // 用 [9f32] 格式解析前 5 帧
  for (let f = 0; f < Math.min(frames, 5); f++) {
    const fp = q + f * frameSize
    const vals = []
    for (let k = 0; k < 9; k++) vals.push(f32At(b, fp + k * 4))
    console.log(' 帧' + f + ': ' + vals.map(v => v.toFixed(3)).join(', '))
  }
  if (frames > 2) {
    const mid = Math.floor(frames / 2)
    const fp_mid = q + mid * frameSize
    const vals_mid = []
    for (let k = 0; k < 9; k++) vals_mid.push(f32At(b, fp_mid + k * 4))
    console.log(' 帧' + mid + ': ' + vals_mid.map(v => v.toFixed(3)).join(', '))
    const fp_last = q + (frames - 1) * frameSize
    const vals_last = []
    for (let k = 0; k < 9; k++) vals_last.push(f32At(b, fp_last + k * 4))
    console.log(' 帧' + (frames-1) + ': ' + vals_last.map(v => v.toFixed(3)).join(', '))
  }
}