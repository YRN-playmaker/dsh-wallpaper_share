// 找出新解析器下 animsV2 为空的 MDLA0006 模型 (对比旧版 47 个)
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { parsePuppetMdl } from '../src/scene/ScenePuppet.ts'

function parsePkg(path) {
  const buf = readFileSync(path)
  let pos = 16; const entries = []
  while (pos + 8 <= buf.length) {
    const nameLen = buf.readInt32LE(pos); pos += 4
    if (nameLen <= 0 || nameLen > 1024 || pos + nameLen + 8 > buf.length) break
    const name = buf.subarray(pos, pos + nameLen).toString('utf8'); pos += nameLen
    const offset = buf.readInt32LE(pos); pos += 4
    const size = buf.readInt32LE(pos); pos += 4
    entries.push({ name, offset, size })
  }
  const dataStart = pos
  return { read: (n) => { const e = entries.find((x) => x.name === n); return e ? new Uint8Array(buf.subarray(dataStart + e.offset, dataStart + e.offset + e.size)) : null }, names: () => entries.map((e) => e.name) }
}
function findTag(bytes, tag, from = 0) {
  const t = new TextEncoder().encode(tag)
  outer: for (let i = from; i + t.length <= bytes.length; i++) {
    for (let k = 0; k < t.length; k++) if (bytes[i + k] !== t[k]) continue outer
    return i
  }
  return -1
}
const ROOT = 'D:/SteamLibrary/steamapps/workshop/content/431960'
for (const id of readdirSync(ROOT).filter((d) => /^\d+$/.test(d))) {
  const pkgPath = join(ROOT, id, 'scene.pkg')
  if (!existsSync(pkgPath)) continue
  let pkg; try { pkg = parsePkg(pkgPath) } catch { continue }
  for (const mn of pkg.names().filter((n) => /\.mdl$/i.test(n))) {
    const bytes = pkg.read(mn)
    if (!bytes || findTag(bytes, 'MDLA0006') < 0 || findTag(bytes, 'MDLS') < 0) continue
    const pm = parsePuppetMdl(bytes)
    if (pm === null) console.log('parse=null: ' + id + ' ' + mn)
    else if (pm.animsV2.length === 0) console.log('animsV2=0: ' + id + ' ' + mn + ' bones=' + pm.bones.length)
  }
}
console.log('done')
