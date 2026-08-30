// 调试 decodeTex 的 TEXS 位置 pos 状态
import { decodeTex } from '../src/scene/SceneTex.ts'
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
// 手动重放解码器头部，打印每一步 pos
let pos = 0
const readNString = () => { let s = ''; while (pos < b.length) { const c = b[pos++]; if (c === 0) break; s += String.fromCharCode(c) } return s }
const readI32 = () => { const v = (b[pos] | (b[pos+1]<<8) | (b[pos+2]<<16) | (b[pos+3]<<24)); pos += 4; return v }
console.log('m1=' + readNString() + ' pos=' + pos)
console.log('m2=' + readNString() + ' pos=' + pos)
console.log('format=' + readI32() + ' flags=' + readI32() + ' texW=' + readI32() + ' texH=' + readI32() + ' imgW=' + readI32() + ' imgH=' + readI32() + ' unk=' + readI32())
console.log('after header pos=' + pos)
console.log('container=' + readNString() + ' pos=' + pos)
const imageCount = readI32()
console.log('imageCount=' + imageCount + ' pos=' + pos)
let imageFormat = readI32()
console.log('imageFormat=' + imageFormat + ' pos=' + pos)
const mipCount = readI32()
console.log('mipCount=' + mipCount + ' pos=' + pos)
const w = readI32(); const h = readI32(); const lz4 = readI32(); const decomp = readI32(); const byteCount = readI32()
console.log('mip0: ' + w + 'x' + h + ' lz4=' + lz4 + ' decomp=' + decomp + ' bytes=' + byteCount + ' pos=' + pos)
pos += byteCount
console.log('after mip0 pos=' + pos)
const magic = String.fromCharCode(...b.slice(pos, pos + 9))
console.log('TEXS magic? = "' + magic + '"')
console.log('bytes @pos: ' + Array.from(b.slice(pos, pos + 32)).map(x => x.toString(16).padStart(2, '0')).join(' '))
