// 参考实现预测：眨眼脉冲在眼睛可见像素上的实际位移量（纹理像素 + 屏幕像素）
// 以及真实渲染中眼睛区域的位移轨迹（相对静止帧的互相关）
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { decodeTex } from '../src/scene/SceneTex.ts'

const PKG = 'D:/SteamLibrary/steamapps/workshop/content/431960/3791428510/scene.pkg'
const OUT = resolve(import.meta.dirname, 'denia-out')
const W = 201, H = 355

function parsePkg(buf) {
  let pos = 0
  const i32 = () => { const v = buf.readInt32LE(pos); pos += 4; return v }
  const magicLen = i32(); pos += magicLen; pos += 4
  const entries = []
  for (;;) {
    if (pos + 8 > buf.length) break
    const nameLen = buf.readInt32LE(pos); pos += 4
    if (nameLen <= 0 || nameLen > 2048 || pos + nameLen + 8 > buf.length) break
    const name = buf.subarray(pos, pos + nameLen).toString('utf8'); pos += nameLen
    const offset = buf.readInt32LE(pos); pos += 4
    const size = buf.readInt32LE(pos); pos += 4
    if (offset < 0 || size < 0 || offset + size > buf.length) break
    entries.push({ name, offset, size })
  }
  const dataStart = pos
  return { read: (n) => { const e = entries.find((x) => x.name === n); return e === undefined ? null : buf.subarray(dataStart + e.offset, dataStart + e.offset + e.size) } }
}

const pkg = parsePkg(readFileSync(PKG))
const eyes = decodeTex(pkg.read('materials/09眼睛.tex')).mip0.rgba
const flow = decodeTex(pkg.read('materials/masks/shake_mask_73999545.tex')).mip0.rgba
const op = decodeTex(pkg.read('materials/masks/shake_mask_5bdd3707.tex')).mip0.rgba

const L = []
// 参数（scene.json）
const strength = 0.4, speed = 1, bounds = [0.992, 0.998], friction = [1, 1]

// 参考 shader：offset(t) 与每个可见像素的位移
function pulse(t) {
  const time = speed * t
  let raw = Math.sin((time / (2 * Math.PI) - Math.floor(time / (2 * Math.PI))) * 2 * Math.PI)
  // frac(time/M_PI_2)*M_PI_2，M_PI_2 = 2π（WE 定义）→ 等价 sin(time)
  raw = raw * 0.498 + 0.5
  const base = Math.cos(time) >= 0 ? 1 : 0
  let off = base === 1 ? Math.pow(raw, friction[1]) : 1 - Math.pow(1 - raw, friction[0])
  off = Math.min(1, Math.max(0, (off - bounds[0]) * (1 / (bounds[1] - bounds[0]))))
  return off
}
L.push('=== 参考脉冲 offset(t)（speed=1, bounds=0.992/0.998）===')
const pulseSamples = []
for (let i = 0; i <= 64; i++) {
  const t = i / 64 * 2 * Math.PI
  pulseSamples.push(pulse(t))
}
L.push(pulseSamples.map((v, i) => `${(i / 64 * 2 * Math.PI).toFixed(2)}s:${v.toFixed(3)}`).join(' '))
// 脉冲宽度：offset > 0.5 的时间
let inPulse = 0
for (let t = 0; t < 2 * Math.PI; t += 0.001) if (pulse(t) > 0.5) inPulse += 0.001
L.push(`脉冲宽度(offset>0.5)=${inPulse.toFixed(3)}s / 周期 2π=${(2 * Math.PI).toFixed(3)}s`)

// 眼睛可见像素上的位移权重：alpha × mask × flow
let sw = 0, sx = 0, sy = 0, n = 0
let rawAlpha = 0
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = y * W + x
  const a = eyes[i * 4 + 3] / 255
  if (a < 0.02) continue
  const m = op[i * 4 + 3] / 255
  const fx = (flow[i * 4] / 255 - 0.498) * 2
  const fy = (flow[i * 4 + 3] / 255 - 0.498) * 2
  const w = a
  sw += w; sx += w * m * fx; sy += w * m * fy; n++
  rawAlpha += a
}
const amp = strength * strength
const dxTex = amp * (sx / sw) * W
const dyTex = amp * (sy / sw) * H
L.push('')
L.push(`可见像素(a>0.02)=${n}`)
L.push(`按 alpha 加权的 mask×flow 均值 = (${(sx / sw).toFixed(3)}, ${(sy / sw).toFixed(3)})`)
L.push(`→ 参考实现满脉冲位移 = (${dxTex.toFixed(1)}, ${dyTex.toFixed(1)}) 纹理px = (${(dxTex * 0.5).toFixed(1)}, ${(dyTex * 0.5).toFixed(1)}) 屏幕px（场景 3840→屏幕 1920）`)

// 真实渲染：眼睛区域相对静止帧的位移轨迹
const RAW = resolve(OUT, 'truth-eye.raw')
const raw = readFileSync(RAW)
const CW = 110, CH = 145, FRAMES = 128, stride = CW * 4
function shiftVs(refF, f, maxShift = 20) {
  const a = refF * stride * CH, b = f * stride * CH
  let best = { dx: 0, dy: 0, err: Infinity }
  for (let dy = -maxShift; dy <= maxShift; dy++) {
    for (let dx = -maxShift; dx <= maxShift; dx++) {
      let err = 0, c = 0
      for (let y = maxShift; y < CH - maxShift; y += 1) {
        for (let x = maxShift; x < CW - maxShift; x += 1) {
          const o = b + (y * CW + x) * 4
          const o2 = a + ((y - dy) * CW + (x - dx)) * 4
          err += Math.abs(raw[o] - raw[o2]) + Math.abs(raw[o + 1] - raw[o2 + 1]) + Math.abs(raw[o + 2] - raw[o2 + 2])
          c++
        }
      }
      err /= c
      if (err < best.err) best = { dx, dy, err }
    }
  }
  return best
}
L.push('')
L.push('=== 真实 WE 渲染：眼睛区域相对 f60 的位移轨迹 ===')
const traj = []
for (let f = 0; f < FRAMES; f++) {
  const s = shiftVs(60, f)
  traj.push(s)
  L.push(`f${f} (t=${(f / 15).toFixed(2)}s): dx=${s.dx} dy=${s.dy} err=${s.err.toFixed(1)}`)
}
const maxdx = Math.max(...traj.map((s) => Math.abs(s.dx)))
const maxdy = Math.max(...traj.map((s) => Math.abs(s.dy)))
L.push(`轨迹最大 |dx|=${maxdx}px |dy|=${maxdy}px（屏幕像素）`)

writeFileSync(resolve(OUT, 'blind-predict.txt'), L.join('\n'), 'utf8')
console.log('blind-predict.txt written')
console.log(`predicted full-pulse displacement = (${dxTex.toFixed(1)}, ${dyTex.toFixed(1)}) tex px = (${(dxTex * 0.5).toFixed(1)}, ${(dyTex * 0.5).toFixed(1)}) screen px`)
console.log(`measured max |dx|=${maxdx} |dy|=${maxdy} screen px; pulse width(>0.5)=${inPulse.toFixed(3)}s`)
