// 扫描本地壁纸：找 animationmode=sequence（纹理序列动画）和 effects 图层
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
let seqCount = 0
let effectCount = 0
for (const d of dirs) {
  const pkgPath = join(workshop, d, 'scene.pkg')
  if (!existsSync(pkgPath)) continue
  let pkg = null
  try { pkg = parsePkg(readFileSync(pkgPath)) } catch { continue }
  const sceneBuf = pkg.read('scene.json')
  if (!sceneBuf) continue
  const scene = parseJsonLike(sceneBuf)
  if (!scene || !Array.isArray(scene.layers)) continue
  const found = []
  for (const l of scene.layers) {
    const id = l.id
    const name = l.name
    const am = l.animationmode
    const eff = l.effects
    if (am !== undefined && am !== 'none' && am !== '') found.push('animmode=' + am)
    if (eff !== undefined) found.push('effects=' + (Array.isArray(eff) ? eff.length : typeof eff))
  }
  if (found.length > 0) {
    seqCount++
    console.log(d + ': ' + found.join(' '))
  }
}
console.log('\nwallpapers with sequence/effects: ' + seqCount)
