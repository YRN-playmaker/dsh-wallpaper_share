// 分析 puppet_puppet "Animation 1" 61 帧的 8 floats：确定位置/旋转/scale 分量布局
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
  return { read }
}

const pkg = parsePkg('D:/SteamLibrary/steamapps/workshop/content/431960/3463520581/scene.pkg')
for (const mdlName of ['models/puppet_puppet.mdl', 'models/puppet - Copy_puppet.mdl']) {
  const pm = parsePuppetMdl(pkg.read(mdlName))
  const anim = pm.animations[0]
  console.log('\n=== ' + mdlName.split('/').pop() + ' anim "' + anim.name + '" kf=' + anim.keyframes.length)
  const kf = anim.keyframes
  // 每分量统计 min/max/变化
  for (let vi = 0; vi < 8; vi++) {
    let mn = Infinity, mx = -Infinity
    for (const k of kf) { const v = k.values[vi]; if (v < mn) mn = v; if (v > mx) mx = v }
    console.log('  v' + vi + ': [' + mn.toFixed(4) + ', ' + mx.toFixed(4) + '] span=' + (mx - mn).toFixed(4))
  }
  // 打印前 8 帧 + 中间 3 帧 + 最后 2 帧
  const pick = [0, 1, 2, 3, 7, 15, 30, 45, 58, 59, 60]
  for (const i of pick) {
    if (i >= kf.length) continue
    console.log('  f' + i + ' t=' + kf[i].t + ' vals=[' + kf[i].values.map((x) => x.toFixed(3)).join(', ') + ']')
  }
}
