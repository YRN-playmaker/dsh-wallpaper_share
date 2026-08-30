// 检查 2164591875 的 materials json + .tex 纹理结构
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
// materials json
for (const mn of ['materials/a26caf8007678c9c489207faf8230ac6.json', 'materials/h8hsv5S.json']) {
  const buf = pkg.read(mn)
  const t = Buffer.from(buf).toString('utf8')
  console.log('=== ' + mn + ' (' + buf.length + 'B) ===')
  console.log(t)
  console.log()
}
// .tex 头部 hex
for (const tn of ['materials/a26caf8007678c9c489207faf8230ac6.tex', 'materials/h8hsv5S.tex']) {
  const buf = pkg.read(tn)
  console.log('=== ' + tn + ' (' + buf.length + 'B) 头部 64B ===')
  console.log(Array.from(buf.slice(0, 64)).map(x => x.toString(16).padStart(2, '0')).join(' '))
  const ascii = Array.from(buf.slice(0, 64)).map(x => x >= 32 && x < 127 ? String.fromCharCode(x) : '.').join('')
  console.log(ascii)
  console.log()
}
