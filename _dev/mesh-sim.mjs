// 验证 arm 顶点 boneIdx（索引6,7）分布 + MDLE 骨骼矩阵
import { readFileSync } from 'node:fs'

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
  const read = (n) => { const e = entries.find((x) => x.name === n); if (!e) return null; return buf.subarray(dataStart + e.offset, dataStart + e.offset + e.size) }
  return { read }
}

const pkg = parsePkg('D:/SteamLibrary/steamapps/workshop/content/431960/3463520581/scene.pkg')
const { parsePuppetMdl } = await import('../src/scene/ScenePuppet.ts')
const arm = parsePuppetMdl(pkg.read('models/kirito arm_puppet.mdl'))
// boneIdx 分布（索引 6,7）
const dist = {}
let multi = 0
for (const v of arm.mesh.vertices) {
  const key = v.boneIdx.join(',')
  dist[key] = (dist[key] ?? 0) + 1
  if (v.boneIdx[0] !== v.boneIdx[1]) multi++
}
console.log('boneIdx 分布:', JSON.stringify(dist), ' 双骨骼顶点:', multi)
// 骨骼矩阵（MDLE）
console.log('骨骼矩阵:')
for (let i = 0; i < Math.min(4, arm.bones.length); i++) {
  const m = arm.bones[i].matrix
  if (m) console.log('  骨骼' + i + ': 平移=' + m[12].toFixed(1) + ',' + m[13].toFixed(1) + ',' + m[14].toFixed(1))
  else console.log('  骨骼' + i + ': 无矩阵')
}
// 蒙皮模拟：tri1 的 3 顶点蒙皮后位置
const verts = arm.mesh.vertices
const idx = arm.mesh.indices
const skin = (v) => {
  const m = arm.bones[v.boneIdx[0]]?.matrix
  if (!m) return [v.pos[0], v.pos[1]]
  // 列主序 4x4：x' = m0*x + m4*y + m8*z + m12
  const x = m[0] * v.pos[0] + m[4] * v.pos[1] + m[8] * v.pos[2] + m[12]
  const y = m[1] * v.pos[0] + m[5] * v.pos[1] + m[9] * v.pos[2] + m[13]
  return [x, y]
}
for (let i = 0; i < 6; i += 3) {
  const a = verts[idx[i]], b = verts[idx[i + 1]], c = verts[idx[i + 2]]
  console.log('tri' + i / 3 + ' 蒙皮后: A=' + skin(a).map((x) => x.toFixed(0)) + ' B=' + skin(b).map((x) => x.toFixed(0)) + ' C=' + skin(c).map((x) => x.toFixed(0)))
}
