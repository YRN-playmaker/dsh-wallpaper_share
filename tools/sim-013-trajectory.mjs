// 模拟 old13 动画：右睫毛/z左睫毛 位移轨迹（修复后 dx=v0, dy=v1）
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
function parseAnim(eye) {
  const b = pkg.read(`models/${eye}_puppet.mdl`)
  const mdla = find(b, 'MDLA0001')
  let q = mdla + 17
  q += 4; q += 4
  while (b[q] !== 0) q++
  q++
  while (b[q] !== 0) q++
  q++
  q += 4; q += 4; q += 4; q += 4; q += 4
  const dataLen = u32At(b, q); q += 4
  const kfs = []
  const frames = Math.floor(dataLen / 36)
  for (let f = 0; f < frames; f++) {
    const fp = q + f * 36
    const vals = []
    for (let k = 0; k < 9; k++) vals.push(f32At(b, fp + k * 4))
    kfs.push(vals)
  }
  return kfs
}
for (const eye of ['右睫毛', 'z左睫毛']) {
  const kfs = parseAnim(eye)
  const base = kfs[0]
  console.log(`=== ${eye} 帧数=${kfs.length} base=(${base[0].toFixed(1)},${base[1].toFixed(1)}) quat(${base[3].toFixed(2)},${base[4].toFixed(2)},${base[5].toFixed(2)},${base[6].toFixed(2)}) ===`)
  // 位移幅度与旋转随时间
  let prevDy = 0
  for (const f of [0, 5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 120, 150, 200]) {
    if (f >= kfs.length) continue
    const v = kfs[f]
    const dx = v[0] - base[0]
    const dy = v[1] - base[1]
    const qz = v[5]
    const qw = v[6]
    const rot = Math.abs(qw*qw+qz*qz-1) < 0.05 ? 2 * Math.atan2(qz, qw) : 0
    // 屏幕 dy（模型 y-up → 渲染 y-down 翻转）
    console.log(` 帧${String(f).padStart(3)} dx=${dx.toFixed(1).padStart(6)} dy=${dy.toFixed(1).padStart(6)} 屏幕dy=${(-dy).toFixed(1).padStart(6)} rot=${(rot*180/Math.PI).toFixed(1)}°`)
  }
  console.log()
}