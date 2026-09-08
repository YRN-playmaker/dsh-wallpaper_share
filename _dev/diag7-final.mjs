// 终审：多映射对比 (帧0≈bind + 局部平滑 + 世界平滑)
import { readFileSync } from 'node:fs'
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
  return { read: (n) => { const e = entries.find((x) => x.name === n); return e ? new Uint8Array(buf.subarray(dataStart + e.offset, dataStart + e.offset + e.size)) : null } }
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
const u32r = (q) => bytes[q] | (bytes[q + 1] << 8) | (bytes[q + 2] << 16) | (bytes[q + 3] << 24)

const pkg = parsePkg('D:/SteamLibrary/steamapps/workshop/content/431960/3465215190/scene.pkg')
const bytes = pkg.read('models/人物_puppet.mdl')
const pm = parsePuppetMdl(bytes)
let p = findTag(bytes, 'MDLA0006') + 9 + 4
p += 4; p += 8
while (bytes[p] !== 0) p++; p++
while (!(bytes[p] === 0xf0 && bytes[p + 1] === 0x41)) p++
p += 2 + 2 + 2 + 4
p += 4 + 4
const segBytes = u32r(p); p += 4
const segsStart = p
const segRows = segBytes / 36
const fc = 66
const nb = pm.bones.length

// 采样: mode 决定 (T, 行偏移公式, py 换行规则)
// pyWrap: 'byte' = o+4 物理连续 (行尾跨到下一物理行/段); 'cyc' = (row+1)%T 行的 col0
function makeSampler(mode) {
  let T, rotMode, pyWrap, rowFn
  if (mode === 'A') { T = fc; rotMode = 'sum'; pyWrap = 'byte'; rowFn = (f, s) => (f + s) % T }
  else if (mode === 'B') { T = segRows; rotMode = 'sum'; pyWrap = 'byte'; rowFn = (f, s) => (f + s) % T }
  else if (mode === 'C') { T = segRows; rotMode = 'sum'; pyWrap = 'cyc'; rowFn = (f, s) => (f + s) % T }
  else if (mode === 'D') { T = segRows; rotMode = 'virt'; pyWrap = 'byte'; rowFn = (f, s) => (f + s) % T }
  else if (mode === 'E') { T = fc; rotMode = 'sum'; pyWrap = 'byte'; rowFn = (f, s) => ((f + s - 1) % T + T) % T + 1 } // 行1..fc 循环
  return (b, f) => {
    const seg = segsStart + b * segBytes
    const b2 = 2 * b
    const s = Math.floor(b2 / 9)
    const pc = b2 % 9
    const rs = rotMode === 'sum' ? Math.floor((b2 + 5) / 9) : 0
    const rc = (b2 + 5) % 9
    const posRow = rowFn(f, s)
    const rotRow = rotMode === 'sum' ? rowFn(f, s + rs) : rowFn(f, Math.floor((b2 + 5) / 9))
    const o = seg + posRow * 36 + pc * 4
    let oPy
    if (pyWrap === 'byte') oPy = o + 4
    else oPy = seg + ((posRow + 1) % T) * 36 + ((pc + 1) % 9) * 4
    const o2 = seg + rotRow * 36 + rc * 4
    return { px: f32(bytes, o), py: f32(bytes, oPy), rz: f32(bytes, o2) }
  }
}

function chainRT(sample, frame) {
  const out = new Array(nb)
  for (let b = 0; b < nb; b++) {
    const v = sample(b, frame)
    const parent = pm.bones[b].parent
    const okv = Number.isFinite(v.px) && Number.isFinite(v.py) && Math.abs(v.px) < 10000 && Math.abs(v.py) < 10000 && Number.isFinite(v.rz)
    if (!okv) { out[b] = null; continue }
    if (parent >= 0 && parent < nb && out[parent]) {
      const pa = out[parent].angle, pc = Math.cos(pa), ps = Math.sin(pa)
      out[b] = { angle: pa + v.rz, tx: out[parent].tx + v.px * pc - v.py * ps, ty: out[parent].ty + v.px * ps + v.py * pc }
    } else out[b] = { angle: v.rz, tx: v.px, ty: v.py }
  }
  return out
}

const bindWorld = []
for (let b = 0; b < nb; b++) {
  const local = pm.bones[b].bind ?? pm.bones[b].pose ?? null
  const par = pm.bones[b].parent
  bindWorld[b] = local === null ? (par >= 0 ? bindWorld[par] ?? null : null) : (par >= 0 && bindWorld[par] ? mul(bindWorld[par], local) : local)
}
function mul(a, b) {
  const o = new Array(16)
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3]
  return o
}

for (const mode of ['A', 'B', 'C', 'D', 'E']) {
  const sample = makeSampler(mode)
  const f0 = chainRT(sample, 0)
  let okP = 0, okA = 0
  for (let b = 0; b < nb; b++) {
    const fv = f0[b], bw = bindWorld[b]
    if (!fv || !bw) continue
    if (Math.hypot(fv.tx - bw[12], fv.ty - bw[13]) < 2) okP++
    if (Math.abs(wrap(fv.angle - Math.atan2(bw[1], bw[0]))) < 0.05) okA++
  }
  let maxJp = 0, maxJa = 0, atP = '', atA = ''
  let prev = chainRT(sample, 0)
  for (let f = 1; f < fc; f++) {
    const cur = chainRT(sample, f)
    for (let b = 0; b < nb; b++) {
      if (!prev[b] || !cur[b]) continue
      const dp = Math.hypot(cur[b].tx - prev[b].tx, cur[b].ty - prev[b].ty)
      const da = Math.abs(wrap(cur[b].angle - prev[b].angle))
      if (dp > maxJp) { maxJp = dp; atP = `b${b}@f${f}` }
      if (da > maxJa) { maxJa = da; atA = `b${b}@f${f}` }
    }
    prev = cur
  }
  console.log(`${mode}: 帧0 pos ${okP}/${nb} ang ${okA}/${nb} | 世界跳变 pos=${maxJp.toFixed(1)}px@${atP} ang=${(maxJa * 180 / Math.PI).toFixed(1)}°@${atA}`)
}
