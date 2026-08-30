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
const raw = Buffer.from(read('scene.json')).toString('utf8').replace(/^\s*\r?\n/, '')
const json = JSON.parse('{' + raw.slice(0, raw.lastIndexOf('}') + 1))
// 打印含 instanceoverride 或 particles 字段的层完整内容
const walk = (obj) => {
  if (obj === null || typeof obj !== 'object') return
  if (Array.isArray(obj)) { obj.forEach(walk); return }
  if (obj.instanceoverride !== undefined || obj.particles !== undefined) {
    console.log('=== LAYER', JSON.stringify(obj.name))
    for (const k of Object.keys(obj)) {
      if (k === 'instances') continue
      const v = obj[k]
      console.log(`  ${k} = ${typeof v === 'object' ? JSON.stringify(v).slice(0, 600) : JSON.stringify(v)}`)
    }
    console.log('--- children:')
    if (Array.isArray(obj.instances)) obj.instances.forEach((c) => {
      console.log('   child', JSON.stringify(c.name ?? ''), 'keys=', Object.keys(c).join(','))
    })
  }
  for (const k of Object.keys(obj)) {
    const v = obj[k]
    if (v !== null && typeof v === 'object' && k !== 'visible' && k !== 'angles' && k !== 'scale' && k !== 'origin') walk(v)
  }
}
walk(json)
