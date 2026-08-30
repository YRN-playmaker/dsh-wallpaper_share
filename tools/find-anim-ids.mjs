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
// 搜索动画 id 的 LE u32
for (const id of [479, 313, 218, 549]) {
  const le = [id & 0xff, (id >> 8) & 0xff, (id >> 16) & 0xff, (id >> 24) & 0xff]
  const pos = []
  for (let i = 0; i < b.length - 4; i++) {
    let ok = true
    for (let k = 0; k < 4; k++) if (b[i + k] !== le[k]) { ok = false; break }
    if (ok) pos.push(i)
  }
  console.log('id', id, 'found at:', pos.slice(0, 10).join(', '), pos.length > 10 ? '...' : '')
}
// 找骨骼名可能存在的字符串（eyes/brow/blink 等）
console.log()
console.log('=== 含字母的字符串（≥3 字符） ===')
let cur = ''
let curStart = 0
const list = []
for (let i = 0; i < b.length; i++) {
  const c = b[i]
  if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122)) {
    if (cur === '') curStart = i
    cur += String.fromCharCode(c)
  } else {
    if (cur.length >= 3) list.push({ off: curStart, s: cur })
    cur = ''
  }
}
for (const s of list.slice(0, 60)) console.log(String(s.off).padStart(7), s.s)
console.log('total alpha strings:', list.length)
