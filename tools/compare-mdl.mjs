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
// 找出 3409595232 的 puppet 文件
const pkg2 = readPkg('D:/SteamLibrary/steamapps/workshop/content/431960/3409595232/scene.pkg')
if (!pkg2) { console.log('3409595232 not found at default location') } else {
  const puppets = pkg2.entries.filter(e => /_puppet\.mdl/.test(e.name))
  console.log('3409595232 puppet files:', puppets.map(p=>p.name).join(', '))
  for (const p of puppets.slice(0, 2)) {
    const b = pkg2.read(p.name)
    let magic = ''
    let i = 0
    while (i < 64 && b[i] !== 0) { magic += String.fromCharCode(b[i]); i++ }
    console.log(p.name, 'magic:', JSON.stringify(magic))
    const hex = Array.from(b.subarray(0, 40)).map(x => x.toString(16).padStart(2, '0')).join(' ')
    console.log('head hex:', hex)
  }
}
