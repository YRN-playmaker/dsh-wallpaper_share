// 精确重现 decodeTex 的 TEXS 解析（复制逻辑）定位 null 原因
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
const b = pkg.read('materials/a26caf8007678c9c489207faf8230ac6.tex')
const bytes = b
// 手动重放到 pos（同 decodeTex）
let pos = 0
const readNString = () => { let s = ''; while (pos < bytes.length) { const c = bytes[pos++]; if (c === 0) break; s += String.fromCharCode(c) } return s }
const readI32 = () => { const v = (bytes[pos] | (bytes[pos + 1] << 8) | (bytes[pos + 2] << 16) | (bytes[pos + 3] << 24)); pos += 4; return v }
readNString(); readNString()
for (let i = 0; i < 7; i++) readI32()
readNString()
const imageCount = readI32()
let imageFormat = readI32()
if (imageCount <= 0 || imageCount > 100) { console.log('bad imageCount'); process.exit(1) }
const mipCount = readI32()
readI32(); readI32(); readI32(); readI32(); readI32() // w h lz4 decompressed byteCount
// 跳过 mip 数据
readI32() // byteCount (已经读了5个，需要再读?)
console.log('manual pos after header = ' + pos)
// 实际上上面逻辑和 decodeTex 一致，直接跳到 mip 数据结束
// 重来一次精确对齐
pos = 0
readNString(); readNString()
for (let i = 0; i < 7; i++) readI32()
const cm = readNString()
let ic = readI32()
let ifmt = readI32()
const mipC = readI32()
const w = readI32(); const h = readI32(); const lz4 = readI32(); const decomp = readI32(); const bc = readI32()
pos += bc
console.log('pos after mip0 = ' + pos + ' (TEXS?)')
const magic3 = String.fromCharCode(bytes[pos], bytes[pos+1], bytes[pos+2], bytes[pos+3], bytes[pos+4], bytes[pos+5], bytes[pos+6], bytes[pos+7], bytes[pos+8])
console.log('magic3 = ' + JSON.stringify(magic3))
if (magic3 === 'TEXS0001\u0000' || magic3 === 'TEXS0002\u0000' || magic3 === 'TEXS0003\u0000') {
  let fp = pos + 9
  const readU32 = () => { const v = (bytes[fp] | (bytes[fp+1]<<8) | (bytes[fp+2]<<16) | (bytes[fp+3]<<24)) >>> 0; fp += 4; return v }
  const readF32 = () => {
    const v = (bytes[fp] | (bytes[fp + 1] << 8) | (bytes[fp + 2] << 16) | (bytes[fp + 3] << 24))
    fp += 4
    return new Float32Array([v])[0]
  }
  const frameCount = readU32()
  console.log('frameCount=' + frameCount)
  if (magic3 === 'TEXS0003\u0000') { console.log('gifW=' + readU32() + ' gifH=' + readU32()) }
  for (let f = 0; f < Math.min(frameCount, 4) && fp + 32 <= bytes.length; f++) {
    const fn = readU32(); const t = readF32(); const fx = readF32(); const fy = readF32(); const w1 = readF32(); const w2 = readF32(); const h2 = readF32(); const h1 = readF32()
    console.log('  f' + f + ': fn=' + fn + ' t=' + t + ' fx=' + fx + ' fy=' + fy + ' w1=' + w1 + ' w2=' + w2 + ' h2=' + h2 + ' h1=' + h1)
  }
} else {
  console.log('magic not matched')
}
