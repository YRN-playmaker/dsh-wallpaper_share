// 验证 flipV 自适应：pos y 与 uv.v 的相关性（asuna vs Miku）
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

for (const [wid, mdlName, label] of [
  ['3463520581', 'models/asuna body_puppet.mdl', 'asuna（原翻）'],
  ['3409595232', 'models/导出初音_puppet.mdl', 'miku（原不翻）'],
  ['3759313716', 'models/hairfrontside_puppet.mdl', 'hairfrontside'],
  ['3770263871', 'models/草_puppet.mdl', '草'],
]) {
  const pkg = parsePkg(readFileSync('D:/SteamLibrary/steamapps/workshop/content/431960/' + wid + '/scene.pkg'))
  const pm = parsePuppetMdl(pkg.read(mdlName))
  if (!pm || !pm.mesh) { console.log(label + ': no mesh'); continue }
  const verts = pm.mesh.vertices
  let sy = 0, sv = 0, syv = 0, sy2 = 0, sv2 = 0
  const n = verts.length
  for (const v of verts) {
    const y = v.pos[1], vv = v.uv[1]
    sy += y; sv += vv; syv += y * vv; sy2 += y * y; sv2 += vv * vv
  }
  const denom = Math.sqrt(Math.max(1e-9, (n * sy2 - sy * sy) * (n * sv2 - sv * sv)))
  const r = (n * syv - sy * sv) / denom
  console.log(label + ': r=' + r.toFixed(3) + ' → ' + (r > 0 ? 'flipV=TRUE（翻）' : 'flipV=false（不翻）'))
}
