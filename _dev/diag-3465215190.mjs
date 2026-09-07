// 诊断 3465215190：puppet 模型在新路径下的骨骼/动画健全性
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
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
  return {
    read: (n) => { const e = entries.find((x) => x.name === n); return e ? new Uint8Array(buf.subarray(dataStart + e.offset, dataStart + e.offset + e.size)) : null },
    names: () => entries.map((e) => e.name),
  }
}

const ID = '3465215190'
const pkg = parsePkg(`D:/SteamLibrary/steamapps/workshop/content/431960/${ID}/scene.pkg`)
const mdlNames = pkg.names().filter((n) => /\.mdl$/i.test(n))
console.log('MDL 条目:', mdlNames.join(', '))

function findTag(bytes, tag, from = 0) {
  const t = new TextEncoder().encode(tag)
  outer: for (let i = from; i + t.length <= bytes.length; i++) {
    for (let k = 0; k < t.length; k++) if (bytes[i + k] !== t[k]) continue outer
    return i
  }
  return -1
}

for (const mn of mdlNames) {
  const bytes = pkg.read(mn)
  if (bytes === null) continue
  if (findTag(bytes, 'MDLS') < 0) continue
  const pm = parsePuppetMdl(bytes)
  if (pm === null) { console.log(`\n${mn}: PARSE FAIL`); continue }
  // 原始 MDLS boneCount 字段
  const mdls = findTag(bytes, 'MDLS')
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const rawBoneCount = dv.getUint32(mdls + 13, true)
  console.log(`\n=== ${mn} ===`)
  console.log(`  MDLS boneCount 字段=${rawBoneCount}  实际解析 bones=${pm.bones.length}  mesh=${pm.mesh !== null ? pm.mesh.vertices.length + 'v' : 'null'} animsV2=${pm.animsV2.length} anchors=${pm.boneAnchors.length}`)
  if (pm.bones.length !== rawBoneCount) console.log(`  ⚠️ 骨骼解析不完整! 缺 ${rawBoneCount - pm.bones.length} 个`)
  // 父链健全性
  let badParent = 0
  for (let b = 0; b < pm.bones.length; b++) {
    const p = pm.bones[b].parent
    if (p >= pm.bones.length || p >= b) badParent++  // parent 必须在前（parent-first 序）
  }
  if (badParent > 0) console.log(`  ⚠️ 父链异常（parent ≥ 自身或越界）: ${badParent} 个`)
  // blendIndices 范围
  if (pm.mesh !== null && pm.bones.length > 0) {
    let idxOk = 0
    for (const v of pm.mesh.vertices) if ((v.boneIndices ?? []).every((bi) => bi >= 0 && bi < pm.bones.length)) idxOk++
    const pct = (100 * idxOk / pm.mesh.vertices.length).toFixed(1)
    if (pct !== '100.0') console.log(`  ⚠️ boneIndices 合法率 ${pct}%`)
  }
  // 动画逐帧连续性（抽动 = 相邻帧位姿跳变）
  for (let a = 0; a < Math.min(pm.animsV2.length, 3); a++) {
    const anim = pm.animsV2[a]
    const fc = anim.frameCount
    const nb = Math.max(pm.bones.length, anim.boneCount)
    let maxJump = 0, maxJumpBone = -1, maxJumpFrame = -1
    let prev = samplePuppetRT(pm, a, 0)
    for (let f = 1; f < Math.min(fc, 120); f++) {
      const cur = samplePuppetRT(pm, a, f)
      for (let b = 0; b < nb; b++) {
        const p0 = prev[b], p1 = cur[b]
        if (!p0 || !p1) continue
        const d = Math.hypot(p1.tx - p0.tx, p1.ty - p0.ty)
        if (d > maxJump) { maxJump = d; maxJumpBone = b; maxJumpFrame = f }
      }
      prev = cur
    }
    console.log(`  animsV2[${a}] "${anim.name}" id=${anim.id} fc=${fc} boneCount=${anim.boneCount} segLocal=${anim.localFrames.length} 相邻帧最大跳变=${maxJump.toFixed(1)}px (bone ${maxJumpBone} @frame ${maxJumpFrame})`)
    // 帧0 vs bind
    if (pm.bones.length > 0 && anim.boneCount <= pm.bones.length) {
      const bindWorld = []
      for (let b = 0; b < pm.bones.length; b++) {
        const local = pm.bones[b].bind ?? pm.bones[b].pose ?? null
        const par = pm.bones[b].parent
        bindWorld[b] = local === null ? (par >= 0 ? bindWorld[par] ?? null : null) : (par >= 0 && bindWorld[par] ? mat4Mul(bindWorld[par], local) : local)
      }
      const f0 = samplePuppetRT(pm, a, 0)
      let ok = 0
      for (let b = 0; b < pm.bones.length; b++) {
        const f = f0[b], bw = bindWorld[b]
        if (!f || !bw) continue
        if (Math.hypot(f.tx - bw[12], f.ty - bw[13]) < 2) ok++
      }
      console.log(`    帧0≈bind ${Math.round(100 * ok / pm.bones.length)}%`)
    }
  }
}
console.log('\nDIAG DONE')
