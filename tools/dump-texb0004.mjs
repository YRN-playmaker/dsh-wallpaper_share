// dump 3577990983 的 TEXB0004 纹理头部，验证 mip 头结构（是否有 json 字符串）
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
const pkg = readPkg('D:/SteamLibrary/steamapps/workshop/content/431960/3577990983/scene.pkg')
const texFiles = pkg.entries.filter(e => e.name.endsWith('.tex'))
console.log('3577990983 tex 文件:')
for (const tf of texFiles) console.log('  ' + tf.name + ' (' + tf.size + 'B)')
// 找一个 TEXB0004 的 dump 头部
const target = texFiles.find(t => t.name.includes('合成')) ?? texFiles[0]
const b = pkg.read(target.name)
let pos = 0
const readNString = () => { let s = ''; while (pos < b.length) { const c = b[pos++]; if (c === 0) break; s += String.fromCharCode(c) } return s }
const readI32 = () => { const v = (b[pos] | (b[pos+1]<<8) | (b[pos+2]<<16) | (b[pos+3]<<24)); pos += 4; return v }
console.log('\n=== ' + target.name + ' ===')
const m1 = readNString(); const m2 = readNString()
console.log('magic: ' + m1 + ' ' + m2 + ' pos=' + pos)
const format = readI32(); const flags = readI32(); const texW = readI32(); const texH = readI32(); const imgW = readI32(); const imgH = readI32(); const unk = readI32()
console.log('format=' + format + ' flags=' + flags + ' tex=' + texW + 'x' + texH + ' img=' + imgW + 'x' + imgH + ' unk=' + unk + ' pos=' + pos)
const cm = readNString()
console.log('container=' + cm + ' pos=' + pos)
const imageCount = readI32()
let imageFormat = readI32()
console.log('imageCount=' + imageCount + ' imageFormat=' + imageFormat)
let extra = null
if (cm === 'TEXB0004') extra = readI32()
console.log('TEXB0004 extra(isVideoMp4)=' + extra + ' pos=' + pos)
const mipCount = readI32()
console.log('mipCount=' + mipCount + ' pos=' + pos)
// 第一个 mip 头
console.log('--- mip0 前 80 字节 (hex) ---')
console.log(Array.from(b.slice(pos, pos + 80)).map(x => x.toString(16).padStart(2, '0')).join(' '))
// 尝试按 TEXB0004 格式解析: [u32][u32][json\0][u32][W][H][compression][uncompressedSize][compressedSize]
const r1 = readI32(); const r2 = readI32()
const jsonStart = pos
let jl = 0
while (pos < b.length && b[pos] !== 0) { pos++; jl++ }
const jsonStr = utf8Slice(b, jsonStart, jsonStart + jl)
pos++ // skip null
const r3 = readI32()
console.log('TEXB0004 mip 头: ignore1=' + r1 + ' ignore2=' + r2 + ' json="' + jsonStr + '" (len=' + jl + ') ignore3=' + r3)
const w = readI32(); const h = readI32(); const comp = readI32(); const uncomp = readI32(); const bc = readI32()
console.log('W=' + w + ' H=' + h + ' compression=' + comp + ' uncompressedSize=' + uncomp + ' compressedSize=' + bc + ' dataPos=' + pos)
