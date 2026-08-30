// 查看 2164591875 的 model json（sequence/spritegrid 动画）与 scene.json 尾部
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
console.log('=== pkg 条目 ===')
for (const e of pkg.entries) console.log('  ' + e.name + ' (' + e.size + 'B)')
// scene.json 尾部
const text = Buffer.from(pkg.read('scene.json')).toString('utf8')
console.log('\n=== scene.json 尾部（184 行后）===')
console.log(text.slice(4968 - 100, 4968 + 500))
// model json
for (const mn of ['models/a26caf8007678c9c489207faf8230ac6.json', 'models/h8hsv5S.json']) {
  const buf = pkg.read(mn)
  if (!buf) { console.log('\n' + mn + ': 不存在'); continue }
  const t = Buffer.from(buf).toString('utf8')
  console.log('\n=== ' + mn + ' (' + t.length + 'B) ===')
  console.log(t.slice(0, 2000))
}
