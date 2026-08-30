// 用与 ScenePuppet.ts 相同的 parseKeyframes 逻辑解析 0013 的 MDLA0001 动画数据
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
function parseKeyframes(bytes, dataStart, dataLen) {
  const len = bytes.length
  const frameCount = Math.floor(dataLen / 36)
  if (frameCount <= 0) return { keyframes: [], offset: 0 }
  let best = []
  let bestOff = 0
  let bestScore = -Infinity
  for (let off = 0; off <= 8 && dataStart + off + 36 <= len; off++) {
    const kf = []
    let bad = false
    let penalty = 0
    for (let f = 0; f < frameCount; f++) {
      const fp = dataStart + off + f * 36
      if (fp + 36 > len) { bad = true; break }
      const t = (bytes[fp] | (bytes[fp + 1] << 8) | (bytes[fp + 2] << 16)) >>> 0
      const values = []
      for (let k = 0; k < 8; k++) {
        const v = f32At(bytes, fp + 3 + k * 4)
        values.push(v)
        if (!Number.isFinite(v) || Math.abs(v) > 1e7) penalty += 10
        else if (Math.abs(v) > 1e5) penalty += 1
      }
      kf.push({ t, values })
    }
    if (bad) continue
    let peak = 0
    for (let i = 1; i < kf.length; i++) if (kf[i].t > kf[peak].t) peak = i
    let score = 0
    for (let i = 1; i <= peak; i++) if (kf[i].t >= kf[i - 1].t) score++
    for (let i = peak + 1; i < kf.length; i++) if (kf[i].t <= kf[i - 1].t) score++
    let tMin = Infinity
    let tMax = -Infinity
    for (const k of kf) { if (k.t < tMin) tMin = k.t; if (k.t > tMax) tMax = k.t }
    if (tMin === tMax) score -= frameCount * 0.5
    if (score - penalty > bestScore) { bestScore = score - penalty; best = kf; bestOff = off }
  }
  return { keyframes: best, offset: bestOff }
}
for (const eye of ['右眼', '右睫毛', '左眼球', 'z左睫毛']) {
  const b = pkg.read(`models/${eye}_puppet.mdl`)
  const mdla = find(b, 'MDLA0001')
  if (mdla < 0) { console.log(eye, ': no MDLA0001'); continue }
  const animCount = Math.max(0, Math.min(64, u32At(b, mdla + 13)))
  let q = mdla + 17
  for (let a = 0; a < animCount && q + 8 <= b.length; a++) {
    const id = u32At(b, q); q += 4
    q += 4
    let nm = ''
    while (q < b.length && b[q] !== 0 && nm.length < 128) { nm += String.fromCharCode(b[q]); q++ }
    q++
    let lp = ''
    while (q < b.length && b[q] !== 0 && lp.length < 128) { lp += String.fromCharCode(b[q]); q++ }
    q++
    if (nm === '' || q + 20 > b.length) break
    const duration = f32At(b, q); q += 4
    const bc = u32At(b, q); q += 4
    q += 4; q += 4; q += 4
    const dataLen = u32At(b, q); q += 4
    if (dataLen <= 0 || dataLen > b.length - q) break
    q++
    const { keyframes, offset } = parseKeyframes(b, q, dataLen)
    // 统计
    let peak = 0
    for (let i = 1; i < keyframes.length; i++) if (keyframes[i].t > keyframes[peak].t) peak = i
    const period = keyframes.length > 0 ? keyframes[peak].t - keyframes[0].t : 0
    // 前 3 帧 + 中间 + 后 3 帧的 values 摘要
    const summarize = (kf) => kf ? kf.values.map(v => Number.isFinite(v) ? v.toFixed(2) : '?').join(',') : 'none'
    console.log(`=== ${eye} anim id=${id} kf=${keyframes.length} period=${period} duration=${duration.toFixed(1)} ===`)
    if (keyframes.length > 0) {
      console.log('  kf0  t=' + keyframes[0].t + '  [' + summarize(keyframes[0]) + ']')
      if (keyframes.length > 1) console.log('  kf1  t=' + keyframes[1].t + '  [' + summarize(keyframes[1]) + ']')
      const mid = Math.floor(keyframes.length / 2)
      console.log('  kf' + mid + ' t=' + keyframes[mid].t + '  [' + summarize(keyframes[mid]) + ']')
      const last = keyframes[keyframes.length - 1]
      console.log('  kf' + (keyframes.length-1) + ' t=' + last.t + '  [' + summarize(last) + ']')
    }
    q += dataLen
  }
}
