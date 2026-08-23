// 检查 asuna/kirito 的动画 period（网页端是否跳过/播放）
import { readFileSync } from 'node:fs'
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
  return (n) => { const e = entries.find((x) => x.name === n); if (!e) return null; return buf.subarray(dataStart + e.offset, dataStart + e.offset + e.size) }
}

const read = parsePkg(readFileSync('D:/SteamLibrary/steamapps/workshop/content/431960/3463520581/scene.pkg'))
// asuna 部件模型
for (const n of ['models/asuna body.json', 'models/asuna body bottom.json', 'models/kirito face.json', 'models/kirito arm.json', 'models/hair back big chunk.json', 'models/main hair back c2.json']) {
  const pm = parsePuppetMdl(read(n))
  if (pm === null) { console.log('=== ' + n + ' === parse null'); continue }
  console.log('=== ' + n + ' ===')
  console.log('骨骼: ' + pm.bones.length + ' 动画: ' + pm.animations.length)
  for (const a of pm.animations) {
    if (a.keyframes.length === 0) continue
    let peak = 0
    for (let i = 1; i < a.keyframes.length; i++) if (a.keyframes[i].t > a.keyframes[peak].t) peak = i
    const period = a.keyframes[peak].t - a.keyframes[0].t
    let maxSpan = 0
    for (let vi = 0; vi < 8; vi++) {
      let mn = Infinity, mx = -Infinity
      for (const k of a.keyframes) {
        const v = k.values[vi]
        if (Number.isFinite(v)) { if (v < mn) mn = v; if (v > mx) mx = v }
      }
      if (Number.isFinite(mn) && mx - mn > maxSpan) maxSpan = mx - mn
    }
    console.log('  动画 id=' + a.id + ' 帧=' + a.keyframes.length + ' period=' + period + ' (>5M跳过: ' + (period > 5000000) + ') maxSpan=' + maxSpan.toFixed(2) + ' (静态: ' + (maxSpan < 0.01) + ') duration=' + a.duration)
  }
}
