// 蒙皮假设验证：Miku 顶点 × 骨骼矩阵后，UV 方向是否一致（slot18/19 = uv？）
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
// 骨骼 0 矩阵（bind 或 pose）
const M = pm.bones[0].bind ?? pm.bones[0].pose
console.log('bone0 matrix: ' + (M ? M.map((x) => x.toFixed(2)).join(',') : 'null'))
const mesh = pm.mesh
// 蒙皮（骨骼 0）：skinPos = M × [pos,1]
const m00 = M[0], m01 = M[4], m02 = M[8], m03 = M[12]
const m10 = M[1], m11 = M[5], m12 = M[9], m13 = M[13]
const skin = mesh.vertices.map((v) => {
  const x = m00 * v.pos[0] + m01 * v.pos[1] + m02 * v.pos[2] + m03
  const y = m10 * v.pos[0] + m11 * v.pos[1] + m12 * v.pos[2] + m13
  return { x, y, u: v.uv[0], vv: v.uv[1] }
})
// 方向一致性（蒙皮后 pos vs uv@72/76）
let nonDeg = 0
let same = 0
for (let t = 0; t + 2 < mesh.indices.length; t += 3) {
  const a = skin[mesh.indices[t]], b = skin[mesh.indices[t + 1]], c = skin[mesh.indices[t + 2]]
  const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
  if (Math.abs(cross) < 1e-3) continue
  nonDeg++
  const ucross = (b.u - a.u) * (c.vv - a.vv) - (b.vv - a.vv) * (c.u - a.u)
  if (ucross * cross > 0) same++
}
console.log('skinned uv@72/76 direction: same=' + same + '/' + nonDeg + ' (' + (nonDeg ? Math.round(same / nonDeg * 100) : 0) + '%)')
// raw 对比
nonDeg = 0
same = 0
for (let t = 0; t + 2 < mesh.indices.length; t += 3) {
  const a = mesh.vertices[mesh.indices[t]], b = mesh.vertices[mesh.indices[t + 1]], c = mesh.vertices[mesh.indices[t + 2]]
  const cross = (b.pos[0] - a.pos[0]) * (c.pos[1] - a.pos[1]) - (b.pos[1] - a.pos[1]) * (c.pos[0] - a.pos[0])
  if (Math.abs(cross) < 1e-3) continue
  nonDeg++
  const ucross = (b.uv[0] - a.uv[0]) * (c.uv[1] - a.uv[1]) - (b.uv[1] - a.uv[1]) * (c.uv[0] - a.uv[0])
  if (ucross * cross > 0) same++
}
console.log('raw uv@72/76 direction: same=' + same + '/' + nonDeg + ' (' + (nonDeg ? Math.round(same / nonDeg * 100) : 0) + '%)')
// 蒙皮后 pos 范围
let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity
for (const s of skin) { if (s.x < mnx) mnx = s.x; if (s.x > mxx) mxx = s.x; if (s.y < mny) mny = s.y; if (s.y > mxy) mxy = s.y }
console.log('skinned pos: x[' + mnx.toFixed(0) + ',' + mxx.toFixed(0) + '] y[' + mny.toFixed(0) + ',' + mxy.toFixed(0) + ']')
