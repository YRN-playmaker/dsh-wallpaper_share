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
  return jsonOf
}
// smoke2 (2691031899)
const j1 = readPkg('D:/SteamLibrary/steamapps/workshop/content/431960/2691031899/scene.pkg')
const smoke2 = j1('particles/presets/smoke2.json')
console.log('=== smoke2 preset initializer names ===')
if (smoke2?.initializer) console.log(smoke2.initializer.map(i => i.name).join(', '))
// snowperspective (3409595232)
const j2 = readPkg('D:/SteamLibrary/steamapps/workshop/content/431960/3409595232/scene.pkg')
const snow = j2('particles/presets/snowperspective.json')
console.log('=== snowperspective initializer names ===')
if (snow?.initializer) console.log(snow.initializer.map(i => i.name).join(', '))
const snowW = j2('particles/workshop/2328851328/presets/snowperspective.json')
console.log('=== workshop snowperspective initializer names ===')
if (snowW?.initializer) console.log(snowW.initializer.map(i => i.name).join(', '))
const fog2 = j2('particles/presets/fog2.json')
console.log('=== fog2 initializer names ===')
if (fog2?.initializer) console.log(fog2.initializer.map(i => i.name).join(', '))