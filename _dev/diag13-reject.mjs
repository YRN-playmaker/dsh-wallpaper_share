// dump animsV2=0 模型的动画头字段, 判定死在哪个校验
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
const u32r = (b, q) => b[q] | (b[q + 1] << 8) | (b[q + 2] << 16) | (b[q + 3] << 24)

const TARGETS = new Set([
  '3409595232 models/导出初音_puppet.mdl',
  '3463520581 models/puppet_puppet.mdl',
  '3463520581 models/kirito face_puppet.mdl',
  '3463520581 models/asuna body_puppet.mdl',
  '3463520581 models/kirito arm_puppet.mdl',
  '3465215190 models/cat2_puppet.mdl',
  '3521337568 models/Lucy_puppet.mdl',
  '3759507080 models/SonicTrackLite/SonicTrackLite.mdl',
  '3759507080 models/BoostModel/BoostModel.mdl',
  '3759507080 models/TrackMesh/TrackMesh.mdl',
])
const ROOT = 'D:/SteamLibrary/steamapps/workshop/content/431960'
for (const id of readdirSync(ROOT).filter((d) => /^\d+$/.test(d))) {
  const pkgPath = join(ROOT, id, 'scene.pkg')
  if (!existsSync(pkgPath)) continue
  let pkg; try { pkg = parsePkg(pkgPath) } catch { continue }
  for (const mn of pkg.names().filter((n) => /\.mdl$/i.test(n))) {
    if (!TARGETS.has(id + ' ' + mn)) continue
    const bytes = pkg.read(mn)
    const len = bytes.length
    let p = findTag(bytes, 'MDLA0006')
    if (p < 0) { console.log(`${id} ${mn}: 无 MDLA0006`); continue }
    p += 9
    p += 4
    const animCount = u32r(bytes, p); p += 4
    const parts = []
    for (let a = 0; a < animCount && p + 12 <= len; a++) {
      p += 8
      let q = p
      while (q < len && bytes[q] !== 0) q++; p = q + 1
      q = p
      while (q < len && bytes[q] !== 0) q++; p = q + 1
      if (p >= len) { parts.push('越界'); break }
      while (p + 1 < len && !(bytes[p] === 0xf0 && bytes[p + 1] === 0x41)) p++
      const foundMark = bytes[p] === 0xf0 && bytes[p + 1] === 0x41
      if (!foundMark) { parts.push(`anim[${a}]: 无标记→break`); break }
      p += 2
      const frameCount = bytes[p] | (bytes[p + 1] << 8); p += 2
      p += 2; p += 4
      const boneCount = u32r(bytes, p); p += 4
      p += 4
      const segBytes = u32r(bytes, p); p += 4
      const segRows = segBytes / 36
      const c1 = boneCount >= 1 && boneCount <= 512
      const c2 = frameCount >= 1 && frameCount <= 8192
      const c3 = Number.isInteger(segRows) && segRows >= frameCount && segRows <= frameCount + 8
      parts.push(`anim[${a}]: fc=${frameCount} bc=${boneCount} segBytes=${segBytes} rows=${segRows} → ${c1 && c2 && c3 ? 'pass' : 'BREAK(' + (c1 ? '' : 'bc ') + (c2 ? '' : 'fc ') + (c3 ? '' : 'rows') + ')'}`)
      p += segBytes * boneCount
    }
    const pm = parsePuppetMdl(bytes)
    console.log(`${id} ${mn}: animCount=${animCount} 解析animsV2=${pm === null ? 'null' : pm.animsV2.length} | ${parts.join(' ; ') || '(无遍历)'}`)
  }
}
