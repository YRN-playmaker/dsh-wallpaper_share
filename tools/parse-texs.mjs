// 解析 TEXS0003 动画帧表：frameNumber/frametime/x/y/width/height
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
const pkg = readPkg('D:/SteamLibrary/steamapps/workshop/content/431960/2164591875/scene.pkg')
for (const tn of ['materials/a26caf8007678c9c489207faf8230ac6.tex', 'materials/h8hsv5S.tex']) {
  const b = pkg.read(tn)
  const s = b.toString('latin1')
  const idx = s.indexOf('TEXS')
  console.log('=== ' + tn + ' TEXS@' + idx + ' ===')
  if (idx < 0) continue
  let q = idx + 9
  const frameCount = u32At(b, q); q += 4
  const gifW = u32At(b, q); q += 4
  const gifH = u32At(b, q); q += 4
  console.log('版本=' + s.slice(idx, idx + 9) + ' 帧数=' + frameCount + ' gifW=' + gifW + ' gifH=' + gifH)
  // 每帧：parseFrame = frameNumber u32 + frametime f32 + x f32 + y f32 + width1 f32 + width2 f32 + height2 f32 + height1 f32
  for (let f = 0; f < Math.min(frameCount, 16) && q + 32 <= b.length; f++) {
    const fn = u32At(b, q)
    const ft = f32At(b, q + 4)
    const x = f32At(b, q + 8)
    const y = f32At(b, q + 12)
    const w1 = f32At(b, q + 16)
    const w2 = f32At(b, q + 20)
    const h2 = f32At(b, q + 24)
    const h1 = f32At(b, q + 28)
    console.log('  f' + f + ': #' + fn + ' time=' + ft + ' x=' + x + ' y=' + y + ' w1=' + w1 + ' w2=' + w2 + ' h2=' + h2 + ' h1=' + h1)
    q += 32
  }
  console.log()
}
