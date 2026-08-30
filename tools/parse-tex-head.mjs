// 解析 TEXI 纹理头，找 spritesheet 帧信息
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
const pkg = readPkg('D:/SteamLibrary/steamapps/workshop/content/431960/2164591875/scene.pkg')
for (const tn of ['materials/a26caf8007678c9c489207faf8230ac6.tex', 'materials/h8hsv5S.tex']) {
  const buf = pkg.read(tn)
  console.log('=== ' + tn + ' (' + buf.length + 'B) ===')
  // TEXI 头：前 64B 已见。逐字段解析
  const b = buf
  console.log('前 96B hex:')
  for (let off = 0; off < 96; off += 16) {
    const hex = Array.from(b.slice(off, off + 16)).map(x => x.toString(16).padStart(2, '0')).join(' ')
    const ascii = Array.from(b.slice(off, off + 16)).map(x => x >= 32 && x < 127 ? String.fromCharCode(x) : '.').join('')
    console.log('  @' + off + ': ' + hex + '  |' + ascii + '|')
  }
  // TEXI 后常见结构：u32 宽 u32 高 u32 帧? 试读
  // "0005.TEXI0001" = 12 字节（含结尾 00），然后数据
  // 找 TEXB（实际位图块）
  const texb = b.indexOf(Buffer.from('TEXB'))
  console.log('  TEXB@' + texb)
  // 从 TEXI 头部读取宽高
  // 头部 "0005.TEXI0001" + 一些字节后是 u32 尺寸
  // 常见：magic(5) null(1) TEXI(4) version(4+1) 然后 width height
  // 试解析：@13 起 u32
  const readU32 = (o) => (b[o] | (b[o+1]<<8) | (b[o+2]<<16) | (b[o+3]<<24)) >>> 0
  console.log('  u32@13=' + readU32(13) + ' @17=' + readU32(17) + ' @21=' + readU32(21) + ' @25=' + readU32(25) + ' @29=' + readU32(29))
  console.log('  u32@33=' + readU32(33) + ' @37=' + readU32(37) + ' @41=' + readU32(41) + ' @45=' + readU32(45) + ' @49=' + readU32(49))
  console.log()
}
