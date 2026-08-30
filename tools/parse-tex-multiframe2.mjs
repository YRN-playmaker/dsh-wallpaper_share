// 确认 2164591875 的 .tex 是否为 GIF/多帧动画
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
const u32At = (b, q) => (b[q] | (b[q+1]<<8) | (b[q+2]<<16) | (b[q+3]<<24)) >>> 0
const i32At = (b, q) => (b[q] | (b[q+1]<<8) | (b[q+2]<<16) | (b[q+3]<<24)) | 0
try {
  const pkg = readPkg('D:/SteamLibrary/steamapps/workshop/content/431960/2164591875/scene.pkg')
  for (const tn of ['materials/a26caf8007678c9c489207faf8230ac6.tex', 'materials/h8hsv5S.tex']) {
    const b = pkg.read(tn)
    console.log('=== ' + tn + ' (' + b.length + 'B) ===')
    let pos = 0
    const readNString = () => { let s = ''; while (pos < b.length) { const c = b[pos++]; if (c === 0) break; s += String.fromCharCode(c) } return s }
    const readI32 = () => { const v = (b[pos] | (b[pos+1]<<8) | (b[pos+2]<<16) | (b[pos+3]<<24)); pos += 4; return v }
    const m1 = readNString()
    const m2 = readNString()
    console.log('  magic: ' + m1 + ' ' + m2)
    const format = readI32()
    const flags = readI32()
    const texW = readI32()
    const texH = readI32()
    const imgW = readI32()
    const imgH = readI32()
    readI32()
    console.log('  format=' + format + ' flags=' + flags + ' texW=' + texW + ' texH=' + texH + ' imgW=' + imgW + ' imgH=' + imgH)
    console.log('  flags 含义: NoInterp=' + ((flags & 1) ? 'Y' : 'n') + ' ClampUV=' + ((flags & 2) ? 'Y' : 'n') + ' IsGif=' + ((flags & 4) ? 'Y' : 'n') + ' ClampBorder=' + ((flags & 8) ? 'Y' : 'n'))
    const cm = readNString()
    console.log('  container=' + cm)
    const imageCount = readI32()
    console.log('  imageCount=' + imageCount)
    let imageFormat = -1
    if (cm === 'TEXB0003') imageFormat = readI32()
    else if (cm === 'TEXB0004') { imageFormat = readI32(); readI32() }
    console.log('  imageFormat=' + imageFormat + ' (13=PNG 2=JPEG -1=raw)')
    if (imageCount > 1 || (cm.startsWith('TEXB') && imageCount >= 1)) {
      for (let i = 0; i < Math.min(imageCount, 10); i++) {
        if (pos + 4 > b.length) break
        const mipCount = readI32()
        console.log('  image' + i + ': mipCount=' + mipCount)
        for (let mm = 0; mm < Math.min(mipCount, 4) && pos + 24 <= b.length; mm++) {
          const w = readI32(); const h = readI32(); const lz4 = readI32(); const decomp = readI32(); const bytes = readI32()
          if (w <= 0 || w > 16384 || bytes < 0 || pos + bytes > b.length) { console.log('    mip' + mm + ': BAD w=' + w + ' bytes=' + bytes + ' (stop)'); pos = b.length; break }
          console.log('    mip' + mm + ': ' + w + 'x' + h + ' lz4=' + lz4 + ' decomp=' + decomp + ' bytes=' + bytes)
          pos += bytes
        }
        // 可能有多级 mip，跳过剩余
      }
    }
    // 找 TEXS 动画段
    const s = b.toString('latin1')
    for (const tag of ['TEXS0001', 'TEXS0002', 'TEXS0003']) {
      const idx = s.indexOf(tag)
      if (idx >= 0) {
        console.log('  动画段 ' + tag + '@' + idx)
        const fc = u32At(b, idx + 9)
        console.log('  帧数=' + fc)
      }
    }
    console.log()
  }
} catch (e) {
  console.log('ERROR: ' + e.message)
  console.log(e.stack)
}
