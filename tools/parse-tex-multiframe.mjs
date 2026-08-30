// 精确解析 2164591875 的 .tex：TEXI 头 + TEXB imageCount + mipmap 数量
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
const pkg = readPkg('D:/SteamLibrary/steamapps/workshop/content/431960/2164591875/scene.pkg')
for (const tn of ['materials/a26caf8007678c9c489207faf8230ac6.tex', 'materials/h8hsv5S.tex']) {
  const b = pkg.read(tn)
  console.log('=== ' + tn + ' (' + b.length + 'B) ===')
  // TEXV0005 TEXI0001 (9+9B) 可能前缀，也可能没有。先检查
  const head = utf8Slice(b, 0, Math.min(18, b.length))
  console.log('  头: ' + JSON.stringify(head))
  let q = 0
  // 如果以 TEXV/TEXI 开头跳过 magic
  if (head.startsWith('TEXV')) { q = 9 }
  const magic2 = utf8Slice(b, q, q + 9)
  if (magic2 === 'TEXI0001') q += 9
  else { console.log('  非 TEXI 格式, 从头解析'); q = 0 }
  console.log('  @' + q + ': format=' + u32At(b, q) + ' flags=' + u32At(b, q+4) + ' texW=' + u32At(b, q+8) + ' texH=' + u32At(b, q+12) + ' width=' + u32At(b, q+16) + ' height=' + u32At(b, q+20))
  q += 24
  // TEXB
  const texbMagic = utf8Slice(b, q, q + 9)
  console.log('  @' + q + ': TEXB magic=' + JSON.stringify(texbMagic))
  if (texbMagic.startsWith('TEXB')) {
    q += 9
    const imageCount = u32At(b, q); q += 4
    console.log('  imageCount=' + imageCount)
    // 每个 image：mipmapCount u32
    for (let img = 0; img < imageCount && q + 4 <= b.length; img++) {
      const mipmapCount = u32At(b, q); q += 4
      console.log('  image' + img + ': mipmapCount=' + mipmapCount)
      for (let mm = 0; mm < mipmapCount && q + 16 <= b.length; mm++) {
        const w = u32At(b, q); const h = u32At(b, q+4)
        const comp = u32At(b, q+8); const uncomp = i32At(b, q+12)
        let info = '  mip' + mm + ': ' + w + 'x' + h + ' comp=' + comp + ' uncompSize=' + uncomp
        q += 16
        // TEXB0003+: 还有 compressedSize i32
        info += ' compSize=' + i32At(b, q); q += 4
        // TEXB0004: json 字符串 + extra
        if (texbMagic === 'TEXB0004') {
          // 读取 json null-terminated
          let s = q
          let jsonStr = ''
          while (s < b.length && b[s] !== 0) { jsonStr += String.fromCharCode(b[s]); s++; if (s - q > 4000) break }
          q = s + 1
          if (jsonStr.trim() !== '') info += ' json="' + jsonStr.slice(0, 200) + '"'
          q += 4 // extra u32
        }
        console.log(info)
      }
    }
    // 之后：animated? TEXS
    const tailMagic = utf8Slice(b, q, q + 9)
    console.log('  @' + q + ': next=' + JSON.stringify(tailMagic.slice(0, 9)))
    if (tailMagic.startsWith('TEXS')) {
      console.log('  动画纹理！TEXS 版本=' + JSON.stringify(tailMagic))
      const fcount = u32At(b, q + 9)
      console.log('  帧数=' + fcount)
    }
  }
  console.log()
}
