// 验证 MDLS bind 矩阵修复：bone1+ 应干净
import { readFileSync } from 'node:fs'
import { parseScenePkg } from '../src/scene/ScenePkg.ts'
import { parsePuppetMdl } from '../src/scene/ScenePuppet.ts'

const id = process.argv[2] ?? '3521337568'
const buf = readFileSync(`D:/SteamLibrary/steamapps/workshop/content/431960/${id}/scene.pkg`)
const pkg = parseScenePkg(new Uint8Array(buf))
const entry = pkg.entries.find(e => e.name.endsWith('_puppet.mdl') || e.name.includes('_puppet'))
const mdl = pkg.read(entry.name)
const model = parsePuppetMdl(new Uint8Array(mdl))
if (!model) { console.log('parse failed'); process.exit(0) }
console.log('bones:', model.bones.length, 'mesh verts:', model.mesh?.vertices.length)
// bind 矩阵前 8 骨骼：检查平移是否合理（非巨大）
for (let i = 0; i < Math.min(8, model.bones.length); i++) {
  const b = model.bones[i]
  const bind = b.bind
  if (!bind) { console.log(`  bone${i} name='${b.name}' parent=${b.parent} bind=null`); continue }
  const T = [bind[12], bind[13], bind[14]]
  const sane = T.every(v => Number.isFinite(v) && Math.abs(v) < 100000)
  console.log(`  bone${i} name='${b.name}' parent=${b.parent} bindT=[${T.map(x => x.toFixed(1))}] ${sane ? 'OK' : 'GARBAGE'}`)
}
// 顶点骨骼索引抽样
const v = model.mesh?.vertices ?? []
console.log('\nvertex boneIndices/weights (first 8):')
for (let i = 0; i < Math.min(8, v.length); i++) {
  console.log(`  v${i}: idx=[${v[i].boneIndices.join(',')}] w=[${v[i].weights.map(x => x.toFixed(2)).join(',')}]`)
}
// 统计骨骼索引范围
let minI = Infinity, maxI = -Infinity
for (const vert of v) for (const idx of vert.boneIndices) { if (idx < minI) minI = idx; if (idx > maxI) maxI = idx }
console.log('bone index range:', minI, '..', maxI, '(模型骨骼数', model.bones.length, ')')
