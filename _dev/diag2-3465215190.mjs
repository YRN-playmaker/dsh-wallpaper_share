// 聚焦：人物_puppet bone 8 跳变定位 + 角度连续性 + animlayers
import { readFileSync } from 'node:fs'
import { parsePuppetMdl, samplePuppetRT } from '../src/scene/ScenePuppet.ts'
import { parseJsonLike } from '../src/scene/ScenePkg.ts'

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
  return {
    read: (n) => { const e = entries.find((x) => x.name === n); return e ? new Uint8Array(buf.subarray(dataStart + e.offset, dataStart + e.offset + e.size)) : null },
    names: () => entries.map((e) => e.name),
  }
}
const pkg = parsePkg('D:/SteamLibrary/steamapps/workshop/content/431960/3465215190/scene.pkg')

// scene.json 的 animationlayers
const sceneJson = pkg.read('scene.json')
const scene = parseJsonLike(sceneJson)
function findPuppetLayers(obj, out = [], path = '') {
  if (Array.isArray(obj)) { obj.forEach((o, i) => findPuppetLayers(o, out, path + '[' + i + ']')); return out }
  if (obj === null || typeof obj !== 'object') return out
  if (obj.puppet !== null && obj.puppet !== undefined) out.push({ name: obj.name, path, al: obj.animationlayers ?? null, animation: obj.animation ?? null, object: obj.puppet })
  for (const [k, v] of Object.entries(obj)) if (k !== 'puppet') findPuppetLayers(v, out, path + '.' + k)
  return out
}
for (const L of findPuppetLayers(scene)) {
  console.log(`图层 "${L.name}": object=${JSON.stringify(L.object)} animation=${JSON.stringify(L.animation)}`)
  if (L.al) {
    for (const a of L.al) console.log(`   layer: name=${JSON.stringify(a.name)} animation=${a.animation} blend=${a.blend} rate=${a.rate} additive=${a.additive} visible=${a.visible}`)
  }
}

const bytes = pkg.read('models/人物_puppet.mdl')
const pm = parsePuppetMdl(bytes)
const anim = pm.animsV2[0]
const fc = anim.frameCount
console.log(`\n人物 animsV2[0] "${anim.name}" id=${anim.id} fc=${fc} boneCount=${anim.boneCount} localFrames=${anim.localFrames.length}`)

// 全骨骼相邻帧局部值跳变排查（px/py/rotZ 分开）
const nb = anim.boneCount
let worst = { v: 0 }
for (let b = 0; b < nb; b++) {
  for (let f = 1; f < fc; f++) {
    for (let k = 0; k < 3; k++) {
      const v0 = anim.localFrames[(b * fc + f - 1) * 3 + k]
      const v1 = anim.localFrames[(b * fc + f) * 3 + k]
      const d = Math.abs(v1 - v0)
      if (d > worst.v) worst = { v: d, b, f, k, v0, v1 }
    }
  }
}
console.log('局部值最大相邻帧跳变:', JSON.stringify(worst), '(k: 0=px 1=py 2=rotZ)')

// bone 8 逐帧局部值
const B = worst.b ?? 8
console.log(`\nbone ${B} 局部值 (帧: px, py, rotZ):`)
for (let f = 0; f < fc; f++) {
  const px = anim.localFrames[(B * fc + f) * 3]
  const py = anim.localFrames[(B * fc + f) * 3 + 1]
  const rz = anim.localFrames[(B * fc + f) * 3 + 2]
  const mark = f === worst.f ? ' ←跳变' : ''
  console.log(`  f${String(f).padStart(2)}: ${px.toFixed(1).padStart(8)}, ${py.toFixed(1).padStart(8)}, ${rz.toFixed(4)}${mark}`)
}

// 世界角度连续性 + 帧0≈bind（角度）
const rt0 = samplePuppetRT(pm, 0, 0)
const bindWorld = []
for (let b = 0; b < pm.bones.length; b++) {
  const local = pm.bones[b].bind ?? pm.bones[b].pose ?? null
  const par = pm.bones[b].parent
  bindWorld[b] = local === null ? (par >= 0 ? bindWorld[par] ?? null : null) : (par >= 0 && bindWorld[par] ? mul(bindWorld[par], local) : local)
}
function mul(a, b) {
  const o = new Array(16)
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3]
  }
  return o
}
const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a }
let angOk = 0, posOk = 0
for (let b = 0; b < pm.bones.length; b++) {
  const f = rt0[b], bw = bindWorld[b]
  if (!f || !bw) continue
  const dA = Math.abs(wrap(f.angle - Math.atan2(bw[1], bw[0])))
  const dP = Math.hypot(f.tx - bw[12], f.ty - bw[13])
  if (dA < 0.05) angOk++
  if (dP < 2) posOk++
}
console.log(`\n帧0 vs bind: 位置吻合 ${posOk}/${pm.bones.length}, 角度吻合 ${angOk}/${pm.bones.length}`)

// 相邻帧世界角度最大跳变
let worstA = { v: 0 }
let prev = samplePuppetRT(pm, 0, 0)
for (let f = 1; f < fc; f++) {
  const cur = samplePuppetRT(pm, 0, f)
  for (let b = 0; b < pm.bones.length; b++) {
    if (!prev[b] || !cur[b]) continue
    const d = Math.abs(wrap(cur[b].angle - prev[b].angle))
    if (d > worstA.v) worstA = { v: d, b, f }
  }
  prev = cur
}
console.log('世界角度最大相邻帧跳变:', JSON.stringify(worstA), `(${(worstA.v * 180 / Math.PI).toFixed(1)}°)`)
