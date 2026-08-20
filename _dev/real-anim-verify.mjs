// 验证 3759313716 + 3770263871 的真实部件动画：帧序列详情（平滑性/语义）
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
  return { read, entries }
}

for (const [wid, mdlName] of [
  ['3759313716', 'models/skırt_puppet.mdl'],
  ['3759313716', 'models/hairfrontside_puppet.mdl'],
  ['3759313716', 'models/petal_puppet.mdl'],
  ['3770263871', 'models/草_puppet.mdl'],
]) {
  const pkg = parsePkg(readFileSync('D:/SteamLibrary/steamapps/workshop/content/431960/' + wid + '/scene.pkg'))
  const pm = parsePuppetMdl(pkg.read(mdlName))
  if (!pm) { console.log(wid + ' ' + mdlName + ': parse fail'); continue }
  for (const anim of pm.animations) {
    const kf = anim.keyframes
    console.log('\n=== ' + wid + ' ' + mdlName.split('/').pop() + ' anim="' + anim.name + '" id=' + anim.id + ' bones=' + pm.bones.length + ' kf=' + kf.length)
    // 每分量跨度
    const spans = []
    for (let vi = 0; vi < 8; vi++) {
      let mn = Infinity, mx = -Infinity
      for (const k of kf) { const v = k.values[vi]; if (v < mn) mn = v; if (v > mx) mx = v }
      spans.push([mn, mx, mx - mn])
    }
    for (let vi = 0; vi < 8; vi++) {
      if (spans[vi][2] > 0.01) console.log('  v' + vi + ': [' + spans[vi][0].toFixed(3) + ', ' + spans[vi][1].toFixed(3) + '] span=' + spans[vi][2].toFixed(3))
    }
    // 打印变化分量的帧序列（选跨度最大的 2 个分量）
    const order = [0, 1, 2, 3, 4, 5, 6, 7].sort((a, b) => spans[b][2] - spans[a][2])
    const picks = order.slice(0, 2)
    for (const fi of [0, 1, 2, 3, 5, 10, 20, 30, 40, 50, 58, 59, 60]) {
      if (fi >= kf.length) continue
      const k = kf[fi]
      console.log('  f' + fi + ' t=' + k.t + ' v' + picks[0] + '=' + k.values[picks[0]].toFixed(3) + ' v' + picks[1] + '=' + k.values[picks[1]].toFixed(3))
    }
  }
}
