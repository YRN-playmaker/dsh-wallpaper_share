// 验证修正后的全局连续采样公式: px_flat = (9*segRows+2)*b + 9f, py=+1, rot=+2b+5 (mod N)
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { parsePuppetMdl } from '../src/scene/ScenePuppet.ts'

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
const f32 = (b, p) => new DataView(b.buffer, b.byteOffset, b.byteLength).getFloat32(p, true)
const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a }
function findTag(bytes, tag, from = 0) {
  const t = new TextEncoder().encode(tag)
  outer: for (let i = from; i + t.length <= bytes.length; i++) {
    for (let k = 0; k < t.length; k++) if (bytes[i + k] !== t[k]) continue outer
    return i
  }
  return -1
}
const u32r = (b, q) => b[q] | (b[q + 1] << 8) | (b[q + 2] << 16) | (b[q + 3] << 24)

// 定位每个动画的段区起点 (可能有多个动画, 只处理第一个有效的)
function locate(bytes) {
  let p = findTag(bytes, 'MDLA0006')
  if (p < 0) return null
  p += 9 + 4
  const animCount = u32r(bytes, p); p += 4
  for (let a = 0; a < animCount; a++) {
    const animStart = p
    p += 8
    while (bytes[p] !== 0) p++; p++
    while (!(bytes[p] === 0xf0 && bytes[p + 1] === 0x41)) p++
    p += 2 + 2 + 2 + 4
    p += 4 + 4
    const segBytes = u32r(bytes, p); p += 4
    if (segBytes === 0 || segBytes > 0x100000 || segBytes % 36 !== 0) { p = animStart; continue } // 无效动画, 试下一个? 简化: 跳过
    const segsStart = p
    return { segsStart, segBytes, segRows: segBytes / 36 }
  }
  return null
}

// 修正采样: 返回 bone b 帧 f 的 [px, py, rotZ]
function sampleNew(bytes, loc, boneCount, b, f, fc) {
  const { segsStart, segRows } = loc
  const N = boneCount * segRows * 9
  const R0 = segRows * b + Math.floor(2 * b / 9)
  const R = R0 + f
  let pxFlat = 9 * R + (2 * b) % 9
  let pyFlat = pxFlat + 1
  let rotFlat = 9 * R + 2 * b + 5
  pxFlat = ((pxFlat % N) + N) % N
  pyFlat = ((pyFlat % N) + N) % N
  rotFlat = ((rotFlat % N) + N) % N
  const base = segsStart
  return [f32(bytes, base + pxFlat * 4), f32(bytes, base + pyFlat * 4), f32(bytes, base + rotFlat * 4)]
}

function mul(a, b) {
  const o = new Array(16)
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3]
  return o
}

const ROOT = 'D:/SteamLibrary/steamapps/workshop/content/431960'
const ids = readdirSync(ROOT).filter((d) => /^\d+$/.test(d))
let checked = 0
const problems = []
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
    const loc = locate(bytes)
    if (loc === null) continue
    const fc = pm.animsV2[0].frameCount
    const nb = Math.min(pm.bones.length, pm.animsV2[0].boneCount)
    checked++
    // 1) 帧0≈bind
    const bindWorld = []
    for (let b = 0; b < pm.bones.length; b++) {
      const local = pm.bones[b].bind ?? pm.bones[b].pose ?? null
      const par = pm.bones[b].parent
      bindWorld[b] = local === null ? (par >= 0 ? bindWorld[par] ?? null : null) : (par >= 0 && bindWorld[par] ? mul(bindWorld[par], local) : local)
    }
    let okP = 0, okA = 0, tot = 0
    // 世界链
    const world = new Array(nb)
    for (let b = 0; b < nb; b++) {
      const v = sampleNew(bytes, loc, pm.animsV2[0].boneCount, b, 0, fc)
      const parent = pm.bones[b].parent
      const okv = Number.isFinite(v[0]) && Number.isFinite(v[1]) && Math.abs(v[0]) < 10000 && Math.abs(v[1]) < 10000 && Number.isFinite(v[2])
      if (!okv) { world[b] = null; continue }
      if (parent >= 0 && parent < nb && world[parent]) {
        const pa = world[parent].angle, pc = Math.cos(pa), ps = Math.sin(pa)
        world[b] = { angle: pa + v[2], tx: world[parent].tx + v[0] * pc - v[1] * ps, ty: world[parent].ty + v[0] * ps + v[1] * pc }
      } else world[b] = { angle: v[2], tx: v[0], ty: v[1] }
    }
    for (let b = 0; b < nb; b++) {
      const fv = world[b], bw = bindWorld[b]
      if (!fv || !bw) continue
      tot++
      if (Math.hypot(fv.tx - bw[12], fv.ty - bw[13]) < 2) okP++
      if (Math.abs(wrap(fv.angle - Math.atan2(bw[1], bw[0]))) < 0.05) okA++
    }
    // 2) 全帧平滑度 (世界坐标, 闭环)
    let maxJp = 0, maxJa = 0, atP = '', atA = ''
    let prev = world
    for (let f = 1; f <= fc; f++) {
      const cur = new Array(nb)
      const ff = f % fc
      for (let b = 0; b < nb; b++) {
        const v = sampleNew(bytes, loc, pm.animsV2[0].boneCount, b, ff, fc)
        const parent = pm.bones[b].parent
        const okv = Number.isFinite(v[0]) && Number.isFinite(v[1]) && Math.abs(v[0]) < 10000 && Math.abs(v[1]) < 10000 && Number.isFinite(v[2])
        if (!okv) { cur[b] = null; continue }
        if (parent >= 0 && parent < nb && prev[parent]) {
          const pa = prev[parent].angle, pc = Math.cos(pa), ps = Math.sin(pa)
          cur[b] = { angle: pa + v[2], tx: prev[parent].tx + v[0] * pc - v[1] * ps, ty: prev[parent].ty + v[0] * ps + v[1] * pc }
        } else cur[b] = { angle: v[2], tx: v[0], ty: v[1] }
      }
      for (let b = 0; b < nb; b++) {
        if (!prev[b] || !cur[b]) continue
        const dp = Math.hypot(cur[b].tx - prev[b].tx, cur[b].ty - prev[b].ty)
        const da = Math.abs(wrap(cur[b].angle - prev[b].angle))
        if (dp > maxJp) { maxJp = dp; atP = `b${b}@f${ff}` }
        if (da > maxJa) { maxJa = da; atA = `b${b}@f${ff}` }
      }
      prev = cur
    }
    const line = `${id} ${mn}: fc=${fc} segRows=${loc.segRows} 帧0≈bind pos ${okP}/${tot} ang ${okA}/${tot} | 闭环最大跳变 pos=${maxJp.toFixed(1)}px@${atP} ang=${(maxJa * 180 / Math.PI).toFixed(1)}°@${atA}`
    if (maxJp > 30 || maxJa > 0.3) problems.push(line)
    if (maxJp > 30 || maxJa > 0.3) console.log('⚠️ ' + line)
  }
}
console.log(`\n检查了 ${checked} 个模型, 异常 ${problems.length} 个`)
