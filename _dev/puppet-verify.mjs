// 验证新 ScenePuppet 解析器：3463520581 全部 puppet mdl
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
for (const n of [
  'models/asuna body_puppet.mdl',
  'models/asuna body bottom_puppet.mdl',
  'models/puppet_puppet.mdl',
  'models/puppet - Copy_puppet.mdl',
  'models/hair back big chunk_puppet.mdl',
  'models/main hair back c2_puppet.mdl',
]) {
  const mdl = pkg.read(n)
  const pm = parsePuppetMdl(mdl)
  if (!pm) { console.log(n.split('/').pop() + ': PARSE FAIL'); continue }
  const mesh = pm.mesh
  let nonDeg = 0, tri = 0
  if (mesh) {
    tri = mesh.indices.length / 3
    for (let t = 0; t + 2 < mesh.indices.length; t += 3) {
      const a = mesh.vertices[mesh.indices[t]], b = mesh.vertices[mesh.indices[t + 1]], c = mesh.vertices[mesh.indices[t + 2]]
      if (!a || !b || !c) continue
      const area = (b.pos[0] - a.pos[0]) * (c.pos[1] - a.pos[1]) - (b.pos[1] - a.pos[1]) * (c.pos[0] - a.pos[0])
      if (Math.abs(area) > 1e-4) nonDeg++
    }
  }
  console.log(n.split('/').pop() +
    ': mesh=' + (mesh ? mesh.vertices.length + 'v ' + tri + 'tri nonDeg=' + nonDeg : 'NONE') +
    ' bones=' + pm.bones.length +
    (pm.bones[0] ? ' b0parent=' + pm.bones[0].parent + ' bind=' + (pm.bones[0].bind ? pm.bones[0].bind.slice(12, 15).map((x) => x.toFixed(1)).join(',') : 'null') : '') +
    ' pose=' + (pm.bones[0] && pm.bones[0].pose ? 'yes' : 'no') +
    ' anims=' + pm.animations.map((a) => a.name + ':' + a.keyframes.length + 'kf').join(',') +
    ' attach=' + JSON.stringify(Object.fromEntries(Object.entries(pm.bonePositions).map(([k, v]) => [k, v.map((x) => x.toFixed(1))])))
  )
}
