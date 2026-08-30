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
  const jsonOf = (name) => {
    const raw = read(name); if (!raw) return null
    let s = Buffer.from(raw).toString('utf8').replace(/^\s*\r?\n/, '')
    if (s[0] !== '{') s = '{' + s
    const last = s.lastIndexOf('}')
    if (last > 0) s = s.slice(0, last + 1)
    try { return JSON.parse(s) } catch { return null }
  }
  return { read, jsonOf, entries }
}
const pkg = readPkg('D:/SteamLibrary/steamapps/workshop/content/431960/2804379697/scene.pkg')
console.log('=== pkg 文件列表（部分） ===')
for (const e of pkg.entries) {
  if (/models|animations|puppet|skeleton|eyes|eye/i.test(e.name)) console.log(e.name, e.size)
}
console.log()
const eye = pkg.jsonOf('models/右眼.json')
console.log('=== models/右眼.json keys ===')
if (eye) console.log(Object.keys(eye).join(', '))
const eyeball = pkg.jsonOf('models/左眼球.json')
console.log('=== models/左眼球.json keys ===')
if (eyeball) console.log(Object.keys(eyeball).join(', '))
