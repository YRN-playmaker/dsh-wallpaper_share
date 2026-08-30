// 验证 0023 格式的 MDLA 段、帧格式、骨骼布局
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
const findTag = (b, tag) => {
  const t = new Uint8Array(tag.length)
  for (let i = 0; i < t.length; i++) t[i] = tag.charCodeAt(i)
  for (let i = 0; i < b.length - t.length; i++) {
    let ok = true
    for (let k = 0; k < t.length; k++) if (b[i+k] !== t[k]) { ok = false; break }
    if (ok) return i
  }
  return -1
}
const pkg = readPkg('D:/SteamLibrary/steamapps/workshop/content/431960/3363252053/scene.pkg')
const b = pkg.read('models/身体部件_puppet.mdl')
const magic = String.fromCharCode(...b.slice(0, 8))
console.log('magic: ' + magic)
for (const tag of ['MDLV0001','MDLS0001','MDLS0003','MDLS0004','MDLA0001','MDLA0006','MDAT0001','MDLE0002']) {
  const at = findTag(b, tag)
  if (at >= 0) console.log('  ' + tag + '@' + at)
}
// 检查 MDLA
const mdle = findTag(b, 'MDLE0002')
const mdat = findTag(b, 'MDAT0001')
// 尝试找 0001 和 0006
for (const tag of ['MDLA0001', 'MDLA0006']) {
  const at = findTag(b, tag)
  if (at < 0) continue
  console.log('\n=== ' + tag + ' @' + at + ' ===')
  const animCount = u32At(b, at + 13)
  console.log('animCount=' + animCount)
  let q = at + 17
  for (let a = 0; a < Math.min(animCount, 2) && q + 8 <= b.length; a++) {
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
    let extra = 0
    if (tag === 'MDLA0006') { extra = 1; q++ }
    console.log('  anim id=' + id + ' name="' + nm + '" loop="' + lp + '" dur=' + duration + ' bc=' + bc + ' bones=' + boneCount + ' dataLen=' + dataLen)
    // 帧格式：尝试 9 f32 和 3B t + 8 f32
    if (dataLen > 0 && dataLen < 100000) {
      const frames = Math.floor(dataLen / 36)
      console.log('    frames=' + frames + ' (36B/frame)')
      // 尝试 9 f32 格式（无 t）
      let all9 = true
      for (let f = 0; f < Math.min(3, frames); f++) {
        const fp = q + f * 36
        const v9 = [0,1,2,3,4,5,6,7,8].map(k => f32At(b, fp + k * 4))
        if (v9.some(x => !Number.isFinite(x) || Math.abs(x) > 1e8)) all9 = false
      }
      console.log('    9f32 格式: ' + (all9 ? '合理' : '不合理'))
      // 尝试 3B t + 8 f32
      let all8 = true
      for (let f = 0; f < Math.min(3, frames); f++) {
        const fp = q + f * 36
        const t3 = (b[fp] | (b[fp+1]<<8) | (b[fp+2]<<16)) >>> 0
        const v8 = [0,1,2,3,4,5,6,7].map(k => f32At(b, fp + 3 + k * 4))
        if (v8.some(x => !Number.isFinite(x) || Math.abs(x) > 1e8)) all8 = false
      }
      console.log('    3B t + 8 f32: ' + (all8 ? '合理' : '不合理'))
      // 打印首帧
      if (frames > 0) {
        const fp = q
        const hex = Array.from(b.slice(fp, fp + 36)).map(x => x.toString(16).padStart(2, '0')).join(' ')
        console.log('    首帧 hex: ' + hex)
        console.log('    9f32: ' + [0,1,2,3,4,5,6,7,8].map(k => f32At(b, fp + k * 4).toFixed(3)).join(', '))
        console.log('    3B t + 8f32: t=' + (b[fp] | (b[fp+1]<<8) | (b[fp+2]<<16)) + ' vals=' + [0,1,2,3,4,5,6,7].map(k => f32At(b, fp + 3 + k * 4).toFixed(3)).join(', '))
      }
    }
    q += dataLen
  }
}