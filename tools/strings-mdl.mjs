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
const pkg = readPkg('D:/SteamLibrary/steamapps/workshop/content/431960/2804379697/scene.pkg')
const b = pkg.read('models/右眼_puppet.mdl')
// 找所有可打印字符串（≥4 字符）
const strings = []
let cur = ''
let curStart = 0
for (let i = 0; i < b.length; i++) {
  const c = b[i]
  if (c >= 32 && c < 127) {
    if (cur === '') curStart = i
    cur += String.fromCharCode(c)
  } else {
    if (cur.length >= 4) strings.push({ off: curStart, s: cur })
    cur = ''
  }
}
if (cur.length >= 4) strings.push({ off: curStart, s: cur })
console.log('=== 右眼_puppet.mdl 字符串（前 80 个） ===')
for (const s of strings.slice(0, 80)) {
  console.log(String(s.off).padStart(7), JSON.stringify(s.s))
}
console.log()
console.log('=== 前 64 字节 ===')
console.log(Array.from(b.subarray(0, 64)).map(x => x.toString(16).padStart(2, '0')).join(' '))
