// 端到端验证：直接使用 parsePuppetMdl 的 animsV2[0].localFrames（真实代码路径）
// 检查 帧0≈bind + 全帧世界坐标平滑度（含闭环 f=fc-1 → f=0）
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { parsePuppetMdl, samplePuppetRT } from '../src/scene/ScenePuppet.ts'

function parsePkg(path) {
  const buf = readFileSync(path)
  let pos = 16; const entries = []
  while (pos + 8 <= buf.length) {
    const nameLen = buf.readInt32LE(pos); pos += 4
    if (nameLen <= 0 || nameLen > 1024 || pos + nameLen + 8 > buf.length) break
    const name = buf.subarray(pos, pos + nameLen).toString('utf8'); pos += nameLen
    const offset = buf.readInt32LE(pos); pos += 4
    const size = buf.readInt32LE(pos); pos += 4
    entries.push({ name, offset, size })
  }
  const dataStart = pos
  return { read: (n) => { const e = entries.find((x) => x.name === n); return e ? new Uint8Array(buf.subarray(dataStart + e.offset, dataStart + e.offset + e.size)) : null }, names: () => entries.map((e) => e.name) }
}
const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a }
function findTag(bytes, tag, from = 0) {
  const t = new TextEncoder().encode(tag)
  outer: for (let i = from; i + t.length <= bytes.length; i++) {
    for (let k = 0; k < t.length; k++) if (bytes[i + k] !== t[k]) continue outer
    return i
  }
  return -1
}
function mul(a, b) {
  const o = new Array(16)
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3]
  return o
}

const ROOT = 'D:/SteamLibrary/steamapps/workshop/content/431960'
const ids = readdirSync(ROOT).filter((d) => /^\d+$/.test(d))
let checked = 0
for (const id of ids) {
  const pkgPath = join(ROOT, id, 'scene.pkg')
  if (!existsSync(pkgPath)) continue
  let pkg
  try { pkg = parsePkg(pkgPath) } catch { continue }
  for (const mn of pkg.names().filter((n) => /\.mdl$/i.test(n))) {
    const bytes = pkg.read(mn)
    if (!bytes || findTag(bytes, 'MDLA0006') < 0 || findTag(bytes, 'MDLS') < 0) continue
    const pm = parsePuppetMdl(bytes)
    if (pm === null || pm.animsV2.length === 0 || pm.bones.length === 0) continue
    const anim = pm.animsV2[0]
    const fc = anim.frameCount
    const nb = pm.bones.length
    checked++
    const bindWorld = []
    for (let b = 0; b < nb; b++) {
      const local = pm.bones[b].bind ?? pm.bones[b].pose ?? null
      const par = pm.bones[b].parent
      bindWorld[b] = local === null ? (par >= 0 ? bindWorld[par] ?? null : null) : (par >= 0 && bindWorld[par] ? mul(bindWorld[par], local) : local)
    }
    const chain = (frame) => {
      const rt = samplePuppetRT(pm, 0, frame)
      const out = new Array(nb)
      for (let b = 0; b < nb; b++) {
        const v = rt[b]
        const parent = pm.bones[b].parent
        if (!v || !Number.isFinite(v.px) || !Number.isFinite(v.py) || !Number.isFinite(v.rz)) { out[b] = null; continue }
        if (parent >= 0 && parent < nb && out[parent]) {
          const pa = out[parent].angle, pc = Math.cos(pa), ps = Math.sin(pa)
          out[b] = { angle: pa + v.rz, tx: out[parent].tx + v.px * pc - v.py * ps, ty: out[parent].ty + v.px * ps + v.py * pc }
        } else out[b] = { angle: v.rz, tx: v.px, ty: v.py }
      }
      return out
    }
    const f0 = chain(0)
    let okP = 0, okA = 0, tot = 0
    for (let b = 0; b < nb; b++) {
      const fv = f0[b], bw = bindWorld[b]
      if (!fv || !bw) continue
      tot++
      if (Math.hypot(fv.tx - bw[12], fv.ty - bw[13]) < 2) okP++
      if (Math.abs(wrap(fv.angle - Math.atan2(bw[1], bw[0]))) < 0.05) okA++
    }
    let maxJp = 0, maxJa = 0, atP = '', atA = ''
    let prev = f0
    for (let f = 1; f <= fc; f++) {
      const cur = chain(f % fc)
      for (let b = 0; b < nb; b++) {
        if (!prev[b] || !cur[b]) continue
        const dp = Math.hypot(cur[b].tx - prev[b].tx, cur[b].ty - prev[b].ty)
        const da = Math.abs(wrap(cur[b].angle - prev[b].angle))
        if (dp > maxJp) { maxJp = dp; atP = `b${b}@f${f % fc}` }
        if (da > maxJa) { maxJa = da; atA = `b${b}@f${f % fc}` }
      }
      prev = cur
    }
    const bad = maxJp > 30 || maxJa > 0.35
    if (bad) console.log(`⚠️ ${id} ${mn}: fc=${fc} 帧0≈bind pos ${okP}/${tot} ang ${okA}/${tot} | 闭环最大跳变 pos=${maxJp.toFixed(1)}px@${atP} ang=${(maxJa * 180 / Math.PI).toFixed(1)}°@${atA}`)
  }
}
console.log(`检查了 ${checked} 个模型`)
