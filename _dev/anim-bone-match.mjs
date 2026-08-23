// 验证 3759313716 hairfrontside/skırt 动画帧位置 vs MDLE 骨骼矩阵 → 确定驱动骨骼
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

for (const [wid, mdlName] of [
  ['3759313716', 'models/hairfrontside_puppet.mdl'],
  ['3759313716', 'models/skırt_puppet.mdl'],
  ['3759313716', 'models/arms_puppet.mdl'],
]) {
  const pkg = parsePkg(readFileSync('D:/SteamLibrary/steamapps/workshop/content/431960/' + wid + '/scene.pkg'))
  const pm = parsePuppetMdl(pkg.read(mdlName))
  if (!pm) { console.log(mdlName + ': parse fail'); continue }
  console.log('\n=== ' + mdlName.split('/').pop() + ' bones=' + pm.bones.length)
  const anim = pm.animations[0]
  const f0 = anim.keyframes[0].values
  console.log('anim "' + anim.name + '" f0 vals: [' + f0.map((x) => x.toFixed(3)).join(', ') + ']')
  // 动画帧位置候选：v0/v1（x,y）或 v2/v3
  const posCands = [[f0[0], f0[1]], [f0[2], f0[3]]]
  for (const pc of posCands) {
    // 对比 MDLE 各骨骼平移
    const best = []
    for (let i = 0; i < pm.bones.length; i++) {
      const m = pm.bones[i].pose ?? pm.bones[i].bind
      if (!m) continue
      const d = Math.hypot(m[12] - pc[0], m[13] - pc[1])
      best.push({ i, d })
    }
    best.sort((a, b) => a.d - b.d)
    console.log('  pos(' + pc[0].toFixed(1) + ',' + pc[1].toFixed(1) + ') nearest bones: ' + best.slice(0, 3).map((b) => '#' + b.i + '(d=' + b.d.toFixed(1) + ')').join(' '))
  }
  // bind[0] 平移（root）
  const b0 = pm.bones[0].bind
  console.log('  bind[0] t=(' + (b0 ? b0[12].toFixed(1) + ',' + b0[13].toFixed(1) : 'null') + ')')
  // 打印前 5 骨骼 bind 平移
  for (let i = 0; i < Math.min(5, pm.bones.length); i++) {
    const m = pm.bones[i].bind
    if (m) console.log('  bone#' + i + ' bind t=(' + m[12].toFixed(1) + ',' + m[13].toFixed(1) + ') parent=' + pm.bones[i].parent)
  }
}
