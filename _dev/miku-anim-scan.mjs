// 扫描 3409595232（Miku）所有 puppet mdl：统计每个动画帧间值变化 → 找真实部件动画
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = fileURLToPath(import.meta.url).replace(/\\/g, '/')
const root = here.slice(0, here.lastIndexOf('/_dev/'))
const { parsePuppetMdl } = await import(pathToFileURL(join(root, 'src/scene/ScenePuppet.ts')).href)

function parsePkg(path) {
  const buf = readFileSync(path)
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

const parsed = parsePkg('D:/SteamLibrary/steamapps/workshop/content/431960/3409595232/scene.pkg')
const pkg = parsed
const mdlNames = parsed.entries.filter((e) => e.name.endsWith('_puppet.mdl')).map((e) => e.name)
console.log('mdl files: ' + mdlNames.length)
for (const n of mdlNames) {
  const pm = parsePuppetMdl(pkg.read(n))
  if (!pm || pm.animations.length === 0) continue
  console.log('\n=== ' + n.split('/').pop() + ' bones=' + pm.bones.length + ' mesh=' + (pm.mesh ? pm.mesh.vertices.length + 'v' : 'none'))
  for (const anim of pm.animations) {
    const kf = anim.keyframes
    if (kf.length < 2) { console.log('  anim "' + anim.name + '" id=' + anim.id + ' kf=' + kf.length + ' (no frames)'); continue }
    // 每分量变化幅度
    const spans = []
    for (let vi = 0; vi < 8; vi++) {
      let mn = Infinity, mx = -Infinity
      for (const k of kf) { const v = k.values[vi]; if (!Number.isFinite(v)) { mn = NaN; break } if (v < mn) mn = v; if (v > mx) mx = v }
      spans.push(Number.isFinite(mn) ? (mx - mn) : NaN)
    }
    const t0 = kf[0].t, tLast = kf[kf.length - 1].t
    const changing = spans.map((s, i) => (Number.isFinite(s) && s > 0.0001 ? 'v' + i + '=' + s.toFixed(4) : null)).filter(Boolean)
    console.log('  anim "' + anim.name + '" id=' + anim.id + ' kf=' + kf.length + ' t[' + t0 + ',' + tLast + '] changing: ' + (changing.length ? changing.join(' ') : 'NONE (static)'))
  }
}
