import fs from 'fs'
function utf8Slice(buf, a, b) { return Buffer.from(buf.subarray(a, b)).toString('utf8') }
const buf = fs.readFileSync('D:/SteamLibrary/steamapps/workshop/content/431960/3409595232/scene.pkg')
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
function jsonOf(name) {
  const raw = read(name); if (!raw) return null
  let s = Buffer.from(raw).toString('utf8').replace(/^\s*\r?\n/, '')
  if (s[0] !== '{') s = '{' + s
  const last = s.lastIndexOf('}')
  if (last > 0) s = s.slice(0, last + 1)
  try { return JSON.parse(s) } catch { return null }
}
const scene = jsonOf('scene.json')
// 找含 particle 的图层
const walk = (o, depth) => {
  if (!o || typeof o !== 'object') return
  if (Array.isArray(o)) { o.forEach((x) => walk(x, depth)); return }
  if (o.name && (o.visible !== undefined || o.instanceoverride !== undefined || o.scale !== undefined)) {
    const ov = o.instanceoverride
    if (ov || (o.particles !== undefined) || (o.angle)) {
      console.log(`[${o.name}] instanceoverride=${JSON.stringify(ov)} angles=${o.angle ?? ''} scale=${o.scale ?? ''}`)
    }
  }
  Object.values(o).forEach((v) => { if (typeof v === 'object') walk(v, depth + 1) })
}
walk(scene, 0)
