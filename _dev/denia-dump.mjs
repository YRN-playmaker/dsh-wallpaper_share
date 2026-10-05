// 达妮娅 Denia（workshop 3791428510）scene.pkg 结构转储：
//   - 条目表（models/materials/shaders/纹理）
//   - scene.json（补 { + 截断到最后一个未引用 }）
// 输出：_dev/denia-out/entries.txt、_dev/denia-out/scene.json
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

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
  return {
    magic, version, entries, dataStart,
    read: (n) => { const e = entries.find((x) => x.name === n); return e === undefined ? null : buf.subarray(dataStart + e.offset, dataStart + e.offset + e.size) },
  }
}

function parseJsonLike(buf) {
  const raw = buf.toString('utf8')
  let inStr = false, esc = false, last = -1
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i]
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false }
    else if (c === '"') inStr = true
    else if (c === '}') last = i
  }
  if (last < 0) throw new Error('no closing brace')
  let text = raw.slice(0, last + 1).trim()
  if (!text.startsWith('{')) text = '{' + text
  return JSON.parse(text)
}

mkdirSync(OUT, { recursive: true })
const pkg = parsePkg(readFileSync(PKG))
const lines = [`magic=${pkg.magic} version=${pkg.version} entries=${pkg.entries.length} dataStart=${pkg.dataStart}`]
for (const e of pkg.entries) lines.push(`${String(e.size).padStart(9)}  ${e.name}`)
writeFileSync(resolve(OUT, 'entries.txt'), lines.join('\n'), 'utf8')

const sceneRaw = pkg.read('scene.json')
writeFileSync(resolve(OUT, 'scene.json.txt'), sceneRaw.toString('utf8'), 'utf8')
const scene = parseJsonLike(sceneRaw)
writeFileSync(resolve(OUT, 'scene.json'), JSON.stringify(scene, null, 1), 'utf8')
console.log('entries=' + pkg.entries.length)
console.log('layers=' + (scene.objects ?? []).length)
console.log('out=' + OUT)
