// 冒烟测试：直接 import 我们的 TS 解析器，验证新格式解析 + 采样
import { readFileSync } from 'node:fs'
import { parsePuppetMdl, samplePuppetRT } from '../src/scene/ScenePuppet.ts'
import { mat4Mul } from '../src/scene/PuppetSkin.ts'

function parsePkg(path) {
  const buf = readFileSync(path)
  let pos = 16; const entries = []
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
  return { read: (n) => { const e = entries.find((x) => x.name === n); return e ? new Uint8Array(buf.subarray(dataStart + e.offset, dataStart + e.offset + e.size)) : null } }
}

const cases = [
  ['3363252053', 'models/身体部件_puppet.mdl'],
  ['3426865175', 'models/fll_puppet.mdl'],
  ['3759313716', 'models/hairback1_puppet.mdl'],
  ['3759313716', 'models/petal_puppet.mdl'],
  ['3463520581', 'models/asuna body_puppet.mdl'],
]

for (const [id, mn] of cases) {
  const pkg = parsePkg(`D:/SteamLibrary/steamapps/workshop/content/431960/${id}/scene.pkg`)
  const bytes = pkg.read(mn)
  if (bytes === null) { console.log(`${id} ${mn}: NOT FOUND`); continue }
  const pm = parsePuppetMdl(bytes)
  if (pm === null) { console.log(`${id} ${mn}: PARSE FAIL`); continue }
  console.log(`\n=== ${id} ${mn} ===`)
  console.log(`  bones=${pm.bones.length} mesh=${pm.mesh !== null ? pm.mesh.vertices.length + 'v/' + pm.mesh.indices.length + 'i' : 'null'} anims=${pm.animations.length} animsV2=${pm.animsV2.length} anchors=${pm.boneAnchors.length}`)
  // 骨骼索引 u32@40 合法性（用解析出的 mesh.vertices.boneIndices）
  if (pm.mesh !== null && pm.bones.length > 0) {
    let idxOk = 0, n = 0
    for (const v of pm.mesh.vertices) {
      n++
      const ok = (v.boneIndices ?? []).every((bi) => bi >= 0 && bi < pm.bones.length)
      if (ok) idxOk++
    }
    console.log(`  boneIndices u32@40 合法率 = ${(100 * idxOk / n).toFixed(1)}%`)
  }
  // 锚点
  for (const a of pm.boneAnchors) console.log(`  anchor "${a.name}" boneIdx=${a.boneIdx} local=(${a.m[12].toFixed(1)}, ${a.m[13].toFixed(1)})`)
  // 帧0 ≈ bind（链乘）
  if (pm.animsV2.length > 0 && pm.bones.length > 0) {
    const nb = pm.bones.length
    const bindWorld = []
    for (let b = 0; b < nb; b++) {
      const local = pm.bones[b].bind ?? pm.bones[b].pose ?? null
      const par = pm.bones[b].parent
      bindWorld[b] = local === null ? (par >= 0 ? bindWorld[par] ?? null : null) : (par >= 0 && bindWorld[par] ? mat4Mul(bindWorld[par], local) : local)
    }
    const f0 = samplePuppetRT(pm, 0, 0)
    let ok = 0, maxPos = 0
    for (let b = 0; b < nb; b++) {
      const f = f0[b]
      const bw = bindWorld[b]
      if (!f || !bw) continue
      const dPos = Math.hypot(f.tx - bw[12], f.ty - bw[13])
      if (dPos < 2) ok++
      if (dPos > maxPos) maxPos = dPos
    }
    console.log(`  animsV2[0] frameCount=${pm.animsV2[0].frameCount} 帧0≈bind=${Math.round(100 * ok / nb)}% (maxPos=${maxPos.toFixed(1)})`)
    // 帧1 与帧0 差异（判断是否静态）
    if (pm.animsV2[0].frameCount > 1) {
      const f1 = samplePuppetRT(pm, 0, 1)
      let moved = 0
      for (let b = 0; b < nb; b++) if (f0[b] && f1[b] && Math.hypot(f1[b].tx - f0[b].tx, f1[b].ty - f0[b].ty) > 0.01) moved++
      console.log(`  帧1 相对帧0 移动骨骼数 = ${moved}/${nb}`)
    }
  }
}
console.log('\nSMOKE DONE')
