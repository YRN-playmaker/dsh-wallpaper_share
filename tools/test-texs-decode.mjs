// 用 tsx 测试 SceneTex.decodeTex 的 TEXS 帧解析
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
for (const tn of ['materials/a26caf8007678c9c489207faf8230ac6.tex', 'materials/h8hsv5S.tex']) {
  const b = pkg.read(tn)
  const tex = decodeTex(b)
  if (tex === null) { console.log(tn + ': decodeTex FAILED'); continue }
  console.log('=== ' + tn + ' ===')
  console.log('  format=' + tex.format + ' flags=' + tex.flags + ' tex=' + tex.textureWidth + 'x' + tex.textureHeight)
  console.log('  image=' + tex.imageWidth + 'x' + tex.imageHeight + ' mip0=' + tex.mip0?.width + 'x' + tex.mip0?.height)
  if (tex.frames !== null) {
    console.log('  frames=' + tex.frames.length)
    for (let i = 0; i < Math.min(tex.frames.length, 16); i++) {
      const f = tex.frames[i]
      console.log('    f' + i + ': x=' + f.x + ' y=' + f.y + ' w=' + f.w + ' h=' + f.h + ' t=' + f.t)
    }
  } else {
    console.log('  frames=null (static)')
  }
}