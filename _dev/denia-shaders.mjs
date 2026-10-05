// 导出 pkg 内文本条目（达妮娅）：effects/*.json、shaders/effects/*、models/09眼睛.json、materials/09眼睛.json 等
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const PKG = 'D:/SteamLibrary/steamapps/workshop/content/431960/3791428510/scene.pkg'
const OUT = resolve(import.meta.dirname, 'denia-out')

function parsePkg(buf) {
  let pos = 0
  const i32 = () => { const v = buf.readInt32LE(pos); pos += 4; return v }
  const magicLen = i32()
  const magic = buf.subarray(pos, pos + magicLen).toString('utf8'); pos += magicLen
  const version = i32()
  const entries = []
  for (;;) {
    if (pos + 8 > buf.length) break
    const nameLen = buf.readInt32LE(pos); pos += 4
    if (nameLen <= 0 || nameLen > 2048 || pos + nameLen + 8 > buf.length) break
    const name = buf.subarray(pos, pos + nameLen).toString('utf8'); pos += nameLen
    const offset = buf.readInt32LE(pos); pos += 4
    const size = buf.readInt32LE(pos); pos += 4
    if (offset < 0 || size < 0 || offset + size > buf.length) break
    entries.push({ name, offset, size })
  }
  const dataStart = pos
  return { magic, version, entries, read: (n) => { const e = entries.find((x) => x.name === n); return e === undefined ? null : buf.subarray(dataStart + e.offset, dataStart + e.offset + e.size) } }
}

const pkg = parsePkg(readFileSync(PKG))
mkdirSync(resolve(OUT, 'pkg'), { recursive: true })
const want = [
  'effects/shake/effect.json',
  'shaders/effects/shake.vert',
  'shaders/effects/shake.frag',
  'effects/waterwaves/effect.json',
  'shaders/effects/waterwaves.vert',
  'shaders/effects/waterwaves.frag',
  'effects/foliagesway/effect.json',
  'shaders/effects/foliagesway.vert',
  'shaders/effects/foliagesway.frag',
  'models/09眼睛.json',
  'materials/09眼睛.json',
  'models/03身-改.json',
  'materials/03身-改.json',
]
const listed = []
for (const n of want) {
  const b = pkg.read(n)
  if (b === null) { listed.push(`MISSING ${n}`); continue }
  const safe = n.replace(/[\\/]/g, '__')
  writeFileSync(resolve(OUT, 'pkg', safe), b, undefined)
  listed.push(`${String(b.length).padStart(7)}  ${n}`)
}
console.log(listed.join('\n'))
