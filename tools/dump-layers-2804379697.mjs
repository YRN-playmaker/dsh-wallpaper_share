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
  const jsonOf = (n) => { const d = read(n); return d ? JSON.parse(Buffer.from(d).toString('utf8')) : null }
  return { read, entries, jsonOf }
}
const pkg = readPkg('D:/SteamLibrary/steamapps/workshop/content/431960/2804379697/scene.pkg')
const scene = pkg.jsonOf('scene.json')
console.log('scene keys:', Object.keys(scene).join(', '))
console.log('layers count:', scene.layers ? scene.layers.length : 'N/A')
// 打印所有层名 + 父子关系 + image + animationlayers
const byId = new Map()
if (scene.layers) for (const l of scene.layers) byId.set(l.id, l)
for (const l of scene.layers) {
  const parentName = l.parent !== undefined && byId.has(l.parent) ? byId.get(l.parent).name : '(root)'
  const anims = l.animationlayers ? l.animationlayers.map(a => `${a.animation}@${a.rate ?? 1}`).join(',') : ''
  console.log(`id=${String(l.id).padStart(3)} name="${l.name}" parent="${parentName}" image=${l.image ?? '-'} anims=[${anims}]`)
}