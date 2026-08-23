// 验证 3409595232 Miku MDLS0003 解析（骨骼 bind/parent + 网格）
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
if (!pm) { console.log('parse FAIL'); process.exit(1) }
console.log('bones=' + pm.bones.length)
for (let i = 0; i < Math.min(6, pm.bones.length); i++) {
  const b = pm.bones[i]
  console.log('  bone' + i + ' parent=' + b.parent + ' bind=' + (b.bind ? '(' + b.bind[12].toFixed(1) + ',' + b.bind[13].toFixed(1) + ')' : 'null') + ' pose=' + (b.pose ? 'yes' : 'no'))
}
const mesh = pm.mesh
let nonDeg = 0
if (mesh) {
  for (let t = 0; t + 2 < mesh.indices.length; t += 3) {
    const a = mesh.vertices[mesh.indices[t]], b = mesh.vertices[mesh.indices[t + 1]], c = mesh.vertices[mesh.indices[t + 2]]
    if (!a || !b || !c) continue
    const area = (b.pos[0] - a.pos[0]) * (c.pos[1] - a.pos[1]) - (b.pos[1] - a.pos[1]) * (c.pos[0] - a.pos[0])
    if (Math.abs(area) > 1e-4) nonDeg++
  }
}
console.log('mesh=' + (mesh ? mesh.vertices.length + 'v ' + mesh.indices.length / 3 + 'tri nonDeg=' + nonDeg : 'NONE'))
console.log('anims=' + pm.animations.map((a) => a.name + '(' + a.id + ')d' + a.duration).join(', '))
console.log('attach=' + JSON.stringify(Object.keys(pm.bonePositions)))
