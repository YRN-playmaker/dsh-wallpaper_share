// 判决实验：4 种采样映射 × (帧0≈bind, 全帧平滑度)
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

const pkg = parsePkg('D:/SteamLibrary/steamapps/workshop/content/431960/3465215190/scene.pkg')
const bytes = pkg.read('models/人物_puppet.mdl')
const pm = parsePuppetMdl(bytes)
const anim = pm.animsV2[0]
const fc = anim.frameCount // 66
const nb = pm.bones.length // 47
// 段区起点：从 mdla 扫描拿 segBytes=2412 → segsStart 需重新定位
// 直接用 localFrames 不行（已按 %66 解码），这里手动重扫 MDLA 段区
function findTag(bytes, tag, from = 0) {
  const t = new TextEncoder().encode(tag)
  outer: for (let i = from; i + t.length <= bytes.length; i++) {
    for (let k = 0; k < t.length; k++) if (bytes[i + k] !== t[k]) continue outer
    return i
  }
  return -1
}
let p = findTag(bytes, 'MDLA0006') + 9 + 4
const u32r = (q) => bytes[q] | (bytes[q + 1] << 8) | (bytes[q + 2] << 16) | (bytes[q + 3] << 24)
const animCount = u32r(p); p += 4
p += 8   // id + u32 0
while (bytes[p] !== 0) p++; p++   // name
while (bytes[p] !== 0) p++; p++   // loop 名
while (!(bytes[p] === 0xf0 && bytes[p + 1] === 0x41)) p++
p += 2        // marker
p += 2 + 2 + 4 // fc(u16) + u16 + u32
p += 4 + 4    // boneCount + u32
const segBytes = u32r(p); p += 4
const segRows = segBytes / 36
console.log(`fc=${fc} segBytes=${segBytes} → segRows=${segRows} (fc+1=${fc + 1})`)
const segsStart = p

// 4 种映射：rowOf(b, f) 返回行号；col 读取与上游一致（px=col, py=col+1 跨行）
// M1: %fc, sumShift   M2: %(fc+1), sumShift   M3: %(fc+1), virtualCol   M4: ((f+s)%fc)+1, sumShift
function makeSampler(mode) {
  return (b, f) => {
    const segStart = segsStart + b * segBytes
    const b2 = 2 * b
    const posShift = Math.floor(b2 / 9)
    const posCol = b2 % 9
    const rotShiftV = Math.floor((b2 + 5) / 9)
    const rotCol = (b2 + 5) % 9
    let T, rotRowBase
    if (mode === 'M1') { T = fc; rotRowBase = posShift + rotShiftV }
    else if (mode === 'M2') { T = fc + 1; rotRowBase = posShift + rotShiftV }
    else if (mode === 'M3') { T = fc + 1; rotRowBase = rotShiftV }
    else { T = fc; rotRowBase = posShift + rotShiftV }
    let posRow, rotRow
    if (mode === 'M4') { posRow = ((f + posShift) % fc) + 1; rotRow = ((f + rotRowBase) % fc) + 1 }
    else { posRow = (f + posShift) % T; rotRow = (f + rotRowBase) % T }
    const o = segStart + posRow * 36 + posCol * 4
    const o2 = segStart + rotRow * 36 + rotCol * 4
    return { px: f32(bytes, o), py: f32(bytes, o + 4), rz: f32(bytes, o2) }
  }
}

// 世界链（2D, 与实现一致）
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

// bind 世界（列主序 mat4Mul 已在 parser 侧验证过位置；角度用 atan2(m1,m0)）
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

for (const mode of ['M1', 'M2', 'M3', 'M4']) {
  const sample = makeSampler(mode)
  const f0 = chainRT(sample, 0)
  let okP = 0, okA = 0
  for (let b = 0; b < nb; b++) {
    const fv = f0[b], bw = bindWorld[b]
    if (!fv || !bw) continue
    if (Math.hypot(fv.tx - bw[12], fv.ty - bw[13]) < 2) okP++
    if (Math.abs(wrap(fv.angle - Math.atan2(bw[1], bw[0]))) < 0.05) okA++
  }
  // 全帧平滑度
  let maxJp = 0, maxJa = 0, jumpAt = ''
  let prev = chainRT(sample, 0)
  for (let f = 1; f < fc; f++) {
    const cur = chainRT(sample, f)
    for (let b = 0; b < nb; b++) {
      if (!prev[b] || !cur[b]) continue
      const dp = Math.hypot(cur[b].tx - prev[b].tx, cur[b].ty - prev[b].ty)
      const da = Math.abs(wrap(cur[b].angle - prev[b].angle))
      if (dp > maxJp) { maxJp = dp; jumpAt = `bone${b}@f${f}` }
      if (da > maxJa) { maxJa = da }
    }
    prev = cur
  }
  console.log(`${mode}: 帧0≈bind pos ${okP}/${nb} ang ${okA}/${nb} | 全帧最大跳变 pos=${maxJp.toFixed(2)}px (${jumpAt}) ang=${(maxJa * 180 / Math.PI).toFixed(1)}°`)
}

// 附：bone6 与 bone0 的原始行数据（rows 0..66, 关键列）
const seg6 = segsStart + 6 * segBytes
const seg0 = segsStart + 0 * segBytes
console.log('\nbone6 行: c3,c4 (pos) | c8 (rot6@shift1) | c0,c1 (bone0 pos 借用)')
for (let r = 0; r <= segRows; r++) {
  if (r >= segRows) break
  const v = (c) => f32(bytes, seg6 + r * 36 + c * 4).toFixed(2)
  const v0 = (c) => f32(bytes, seg0 + r * 36 + c * 4).toFixed(2)
  console.log(`  r${String(r).padStart(2)}: b6pos=(${v(3)}, ${v(4)})  b6rot(c8)=${v(8)}   | seg0 b0pos=(${v0(0)}, ${v0(1)}) b0rot(c5)=${v0(5)}`)
}
