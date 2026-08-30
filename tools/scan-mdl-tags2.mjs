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
const scan = (b) => {
  const tags = ['MDLS0004', 'MDLS0003', 'MDAT0001', 'MDLA0006', 'MDLE0002']
  const res = {}
  for (const tag of tags) {
    const t = new Uint8Array(tag.length)
    for (let i = 0; i < tag.length; i++) t[i] = tag.charCodeAt(i)
    let found = -1
    for (let pos = 0; pos < b.length - t.length; pos++) {
      let ok = true
      for (let k = 0; k < t.length; k++) if (b[pos + k] !== t[k]) { ok = false; break }
      if (ok) { found = pos; break }
    }
    res[tag] = found
  }
  return res
}
// 3409595232 (0021, 正常)
const pkgA = readPkg('D:/SteamLibrary/steamapps/workshop/content/431960/3409595232/scene.pkg')
const a = pkgA.read('models/导出初音_puppet.mdl')
console.log('=== 3409595232 导出初音 (0021, 正常) ===')
console.log(scan(a))
// 2804379697 (0013)
const pkgB = readPkg('D:/SteamLibrary/steamapps/workshop/content/431960/2804379697/scene.pkg')
for (const eye of ['右眼', '左眼球']) {
  const b = pkgB.read(`models/${eye}_puppet.mdl`)
  console.log(`=== 2804379697 ${eye} (0013) ===`)
  console.log(scan(b))
}
