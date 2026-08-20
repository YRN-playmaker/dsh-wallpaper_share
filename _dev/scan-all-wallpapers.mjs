// 批量扫描本地工作坊壁纸：找"部件级真实逐帧动画"（非装配根、帧值变化）
// 遍历 workshop/content/431960/*/scene.pkg → 所有 _puppet.mdl → 动画帧值变化统计
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = fileURLToPath(import.meta.url).replace(/\\/g, '/')
const root = here.slice(0, here.lastIndexOf('/_dev/'))
const { parsePuppetMdl } = await import(pathToFileURL(join(root, 'src/scene/ScenePuppet.ts')).href)

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

const workshop = 'D:/SteamLibrary/steamapps/workshop/content/431960'
const dirs = readdirSync(workshop)
console.log('workshop dirs: ' + dirs.length)
const report = []
for (const d of dirs) {
  const pkgPath = join(workshop, d, 'scene.pkg')
  if (!existsSync(pkgPath)) continue
  let pkg = null
  try { pkg = parsePkg(readFileSync(pkgPath)) } catch { continue }
  if (!pkg.entries.length) continue
  const mdlNames = pkg.entries.filter((e) => e.name.endsWith('_puppet.mdl')).map((e) => e.name)
  if (mdlNames.length === 0) continue
  for (const n of mdlNames) {
    let pm = null
    try { pm = parsePuppetMdl(pkg.read(n)) } catch { continue }
    if (!pm || pm.animations.length === 0) continue
    for (const anim of pm.animations) {
      const kf = anim.keyframes
      if (kf.length < 2) continue
      // 帧值变化幅度
      const spans = []
      let anyChange = false
      for (let vi = 0; vi < 8; vi++) {
        let mn = Infinity, mx = -Infinity, ok = true
        for (const k of kf) {
          const v = k.values[vi]
          if (!Number.isFinite(v)) { ok = false; break }
          if (v < mn) mn = v
          if (v > mx) mx = v
        }
        if (!ok) { spans.push(NaN); continue }
        spans.push(mx - mn)
        if (mx - mn > 0.02) anyChange = true
      }
      if (!anyChange) continue
      // t 变化（真实时间轴）？
      let tMin = Infinity, tMax = -Infinity
      for (const k of kf) { if (k.t < tMin) tMin = k.t; if (k.t > tMax) tMax = k.t }
      report.push({
        wallpaper: d,
        mdl: n.split('/').pop(),
        bones: pm.bones.length,
        anim: anim.name,
        id: anim.id,
        kf: kf.length,
        tSpan: tMax - tMin,
        spans: spans.map((x) => (Number.isFinite(x) ? +x.toFixed(2) : 'NaN')),
      })
    }
  }
}
console.log('\n=== 真实帧值变化动画（部件级候选）===')
for (const r of report) {
  console.log(
    'wallpaper=' + r.wallpaper +
    ' mdl=' + r.mdl +
    ' bones=' + r.bones +
    ' anim="' + r.anim + '" id=' + r.id +
    ' kf=' + r.kf + ' tSpan=' + r.tSpan +
    ' spans=[' + r.spans.join(',') + ']'
  )
}
console.log('total: ' + report.length)
