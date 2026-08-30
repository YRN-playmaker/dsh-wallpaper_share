// 深入调试 TEXS 帧解析
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
const tex = decodeTex(b)
console.log('decodeTex 返回: ' + (tex === null ? 'null' : 'frames=' + (tex.frames === null ? 'null' : tex.frames.length)))
// 手动重放 TEXS 解析
let pos = 2923054
const magic3 = String.fromCharCode(b[pos], b[pos+1], b[pos+2], b[pos+3], b[pos+4], b[pos+5], b[pos+6], b[pos+7], b[pos+8])
console.log('magic3 raw = ' + JSON.stringify(magic3) + ' len=' + magic3.length)
console.log('等于 TEXS0003\\0? ' + (magic3 === 'TEXS0003\u0000'))
console.log('charCodeAt(8) = ' + magic3.charCodeAt(8))
const frameCount = (b[pos+9] | (b[pos+10]<<8) | (b[pos+11]<<16) | (b[pos+12]<<24)) >>> 0
console.log('frameCount = ' + frameCount)
