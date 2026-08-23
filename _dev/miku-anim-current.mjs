// Miku 463 动画实际帧值（当前解析器）：maxSpan + 播放判定
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
  const read = (n) => {
    const e = entries.find((x) => x.name === n)
    if (!e) return null
    return buf.subarray(dataStart + e.offset, dataStart + e.offset + e.size)
  }
  return { read }
}

const pkg = parsePkg(readFileSync('D:/SteamLibrary/steamapps/workshop/content/431960/3409595232/scene.pkg'))
const pm = parsePuppetMdl(pkg.read('models/导出初音_puppet.mdl'))
for (const anim of pm.animations) {
  const kf = anim.keyframes
  if (kf.length < 2) { console.log('anim id=' + anim.id + ' "' + anim.name + '" kf=' + kf.length + ' dur=' + anim.duration); continue }
  let maxSpan = 0
  const spans = []
  for (let vi = 0; vi < 8; vi++) {
    let mn = Infinity, mx = -Infinity
    for (const k of kf) {
      const v = k.values[vi]
      if (!Number.isFinite(v)) continue
      if (v < mn) mn = v
      if (v > mx) mx = v
    }
    const sp = Number.isFinite(mn) ? mx - mn : 0
    spans.push(sp)
    if (sp > maxSpan) maxSpan = sp
  }
  console.log('anim id=' + anim.id + ' "' + anim.name + '" kf=' + kf.length + ' dur=' + anim.duration + ' maxSpan=' + maxSpan.toFixed(3) + ' spans=[' + spans.map((s) => s.toFixed(2)).join(',') + ']')
  if (anim.id === 463 || anim.id === 1006632960) {
    for (const fi of [0, 1, 5, 30, kf.length - 1]) {
      console.log('  f' + fi + ' [' + kf[fi].values.map((x) => x.toFixed(2)).join(', ') + ']')
    }
  }
}
