// 分类所有 puppet：有 mesh 还是仅骨骼动画
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
const findTag = (b, tag) => {
  const t = new Uint8Array(tag.length)
  for (let i = 0; i < t.length; i++) t[i] = tag.charCodeAt(i)
  for (let i = 0; i < b.length - t.length; i++) {
    let ok = true
    for (let k = 0; k < t.length; k++) if (b[i+k] !== t[k]) { ok = false; break }
    if (ok) return i
  }
  return -1
}
const workshop = 'D:/SteamLibrary/steamapps/workshop/content/431960'
const dirs = fs.readdirSync(workshop).filter(d => /^\d+$/.test(d))
let meshCount = 0, boneOnlyCount = 0
for (const dir of dirs) {
  const projPath = workshop + '/' + dir + '/project.json'
  if (!fs.existsSync(projPath)) continue
  let proj = null
  try { proj = JSON.parse(fs.readFileSync(projPath, 'utf8')) } catch { continue }
  if (!/scene/i.test(proj.type || '')) continue
  const pkgPath = workshop + '/' + dir + '/scene.pkg'
  if (!fs.existsSync(pkgPath)) continue
  try {
    const pkg = readPkg(pkgPath)
    const modelFiles = pkg.entries.filter(e => e.name.startsWith('models/') && e.name.endsWith('.json'))
    for (const mf of modelFiles) {
      try {
        const text = Buffer.from(pkg.read(mf.name)).toString('utf8')
        const m = text.match(/"puppet"\s*:\s*"([^"]+)"/)
        if (!m) continue
        const b = pkg.read(m[1])
        if (!b) continue
        const magic = String.fromCharCode(...b.slice(0, 4))
        const hasMesh = findTag(b, 'MDLV0001') >= 0
        const hasMdla1 = findTag(b, 'MDLA0001') >= 0
        const hasMdla6 = findTag(b, 'MDLA0006') >= 0
        if (hasMesh) meshCount++; else boneOnlyCount++
        if (hasMesh) console.log(dir + ' ' + magic + ' MESH ' + m[1] + (hasMdla1 ? ' 0001' : '') + (hasMdla6 ? ' 0006' : ''))
      } catch {}
    }
  } catch {}
}
console.log('\n含 mesh（网格蒙皮）puppet: ' + meshCount)
console.log('仅骨骼动画（图层变换）puppet: ' + boneOnlyCount)