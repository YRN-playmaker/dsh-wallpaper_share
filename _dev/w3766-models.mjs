// 3766677415 的模型/骨骼情况：哪些图层是 puppet 网格、哪些是纯图片、附件锚点
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const PKG = 'D:/SteamLibrary/steamapps/workshop/content/431960/3766677415/scene.pkg'
const OUT = resolve(import.meta.dirname, 'w3766-out')
mkdirSync(OUT, { recursive: true })

function parsePkg(buf) {
  let pos = 0
  const i32 = () => { const v = buf.readInt32LE(pos); pos += 4; return v }
  const magicLen = i32(); pos += magicLen; pos += 4
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
  return { entries, read: (n) => { const e = entries.find((x) => x.name === n); return e === undefined ? null : buf.subarray(dataStart + e.offset, dataStart + e.offset + e.size) } }
}
const pkg = parsePkg(readFileSync(PKG))
const L = []
L.push('=== 模型条目 ===')
for (const e of pkg.entries) if (/^models\//.test(e.name)) L.push(String(e.size).padStart(8) + '  ' + e.name)
L.push('')
L.push('=== 各模型 json ===')
for (const e of pkg.entries) {
  if (!/^models\/.*\.json$/.test(e.name)) continue
  L.push('--- ' + e.name + ' ---')
  L.push(pkg.read(e.name).toString('utf8').replace(/\s+/g, ' ').slice(0, 700))
  L.push('')
}
writeFileSync(resolve(OUT, 'models.txt'), L.join('\n'), 'utf8')
console.log('models.txt written; models=' + pkg.entries.filter((e) => /^models\//.test(e.name)).length)
console.log(L.slice(1, 25).join('\n'))
