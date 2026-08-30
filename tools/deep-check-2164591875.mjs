// 完整 dump 2164591875 scene.json + model json，搜索所有动画相关字段
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
const text = Buffer.from(pkg.read('scene.json')).toString('utf8')
console.log('=== scene.json 完整搜索 sequence/fps/animation ===')
for (const kw of ['sequence', 'fps', 'frame', 'animation', 'imagetype', 'sprites']) {
  let idx = 0, cnt = 0
  while ((idx = text.toLowerCase().indexOf(kw.toLowerCase(), idx)) >= 0) {
    cnt++
    console.log('  ' + kw + '@' + idx + ': ' + text.slice(Math.max(0, idx - 40), idx + 60).replace(/\s+/g, ' '))
    idx += kw.length
    if (cnt > 5) break
  }
  if (cnt === 0) console.log('  ' + kw + ': 无')
}
console.log('\n=== model json 完整 ===')
for (const mn of ['models/a26caf8007678c9c489207faf8230ac6.json', 'models/h8hsv5S.json']) {
  const b = pkg.read(mn)
  console.log(mn + ' (' + b.length + 'B): ' + JSON.stringify(Buffer.from(b).toString('utf8')))
}
