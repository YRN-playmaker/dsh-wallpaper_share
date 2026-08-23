// 扫描本地壁纸：models/*.json 的 effects 字段（waterwaves/shake 等）+ 纹理序列
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

function parsePkg(buf) {
  let pos = 16
  const entries = []
  while (pos + 8 <= buf.length) {
    const nameLen = buf.readInt32LE(pos); pos += 4
    if (nameLen <= 0 || nameLen > 1024 || pos + nameLen + 8 > buf.length) break
    const name = buf.subarray(pos, pos + nameLen).toString('utf8'); pos += nameLen
    const offset = buf.readInt32LE(pos); pos += 4
    const size = buf.readInt32LE(pos); pos += 4
    if (offset < 0 || size < 0 || offset + size > buf.length) break
    entries.push({ name, offset, size })
  }
  const dataStart = pos
  const read = (n) => {
    const e = entries.find((x) => x.name === n)
    if (!e) return null
    return buf.subarray(dataStart + e.offset, dataStart + e.offset + e.size)
  }
  return { read, entries }
}

function parseJsonLike(buf) {
  const s = buf.toString('utf8')
  const lb = s.indexOf('{')
  const rb = s.lastIndexOf('}')
  try { return JSON.parse(s.slice(lb, rb + 1)) } catch { return null }
}

const workshop = 'D:/SteamLibrary/steamapps/workshop/content/431960'
const dirs = readdirSync(workshop)
let total = 0
for (const d of dirs) {
  const pkgPath = join(workshop, d, 'scene.pkg')
  if (!existsSync(pkgPath)) continue
  let pkg = null
  try { pkg = parsePkg(readFileSync(pkgPath)) } catch { continue }
  const modelNames = pkg.entries.filter((e) => e.name.startsWith('models/') && e.name.endsWith('.json')).map((e) => e.name)
  for (const n of modelNames) {
    const buf = pkg.read(n)
    if (!buf) continue
    const j = parseJsonLike(buf)
    if (!j) continue
    const eff = j.effects
    if (eff !== undefined && eff !== null) {
      const names = Array.isArray(eff) ? eff.map((e) => (e && typeof e === 'object' ? e.name : e)) : [eff]
      total++
      console.log(d + ' ' + n.split('/').pop() + ': effects=' + JSON.stringify(names).slice(0, 200))
    }
  }
}
console.log('\ntotal effects found: ' + total)
