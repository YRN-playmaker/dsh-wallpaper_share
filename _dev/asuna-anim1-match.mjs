// asuna anim[1]（2385）骨骼状态流破解：
// 假设 [时间点 × 15 骨骼]，状态 36B = [t 3B][8 f32]；
// 用 MDLE 15 矩阵平移做模板，扫描起点 + 状态内位置布局。
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
  const read = (n) => {
    const e = entries.find((x) => x.name === n)
    if (!e) return null
    return buf.subarray(dataStart + e.offset, dataStart + e.offset + e.size)
  }
  return { read }
}

const pkg = parsePkg('D:/SteamLibrary/steamapps/workshop/content/431960/3463520581/scene.pkg')
const m = pkg.read('models/asuna body_puppet.mdl')
const mdla = m.indexOf('MDLA0006')
const mdle = m.indexOf('MDLE0002')
// MDLE 15 矩阵平移
const mats = []
const matCount = m.readUInt32LE(mdle + 13) / 64
for (let i = 0; i < matCount; i++) {
  const mp = mdle + 17 + i * 64
  mats.push([m.readFloatLE(mp + 48), m.readFloatLE(mp + 52), m.readFloatLE(mp + 56)])
}
console.log('MDLE ' + matCount + ' mats')
console.log('MDLA@' + mdla + ' anim[1] 数据区 @' + (mdla + 2256) + ' 起 16236B')
// 数据区起点候选（anim[0] 数据尾附近）
// 先看 @+2256 起 6 个连续状态（36B 步）的 8 floats
for (let s = 0; s < 6; s++) {
  const fp = mdla + 2256 + s * 36
  const vals = []
  for (let k = 0; k < 8; k++) vals.push(m.readFloatLE(fp + k * 4).toFixed(2))
  console.log('  state' + s + ' raw8: ' + vals.join(' '))
}
// 模板匹配：候选起点 off（相对 mdla @+2240..@+2280），结构 [30 时间点 × 15 骨骼]
// 状态内位置布局候选：8 floats 中连续 3 值作为 [x,y,z]（枚举所有 6 组合）
const best = []
for (let off = 2240; off <= 2280; off++) {
  for (let posStart = 0; posStart <= 5; posStart++) {
    let score = 0
    let ok = true
    for (let bone = 0; bone < 15 && ok; bone++) {
      const fp = mdla + off + bone * 36
      const x = m.readFloatLE(fp + posStart * 4)
      const y = m.readFloatLE(fp + posStart * 4 + 4)
      if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 2000 || Math.abs(y) > 2000) { ok = false; break }
      const d = Math.hypot(x - mats[bone][0], y - mats[bone][1])
      score += d
    }
    if (ok && score < 2000) best.push({ off, posStart, score })
  }
}
best.sort((a, b) => a.score - b.score)
console.log('best candidates (score<2000): ' + best.length)
for (const b of best.slice(0, 5)) {
  console.log('  off=' + b.off + ' posStart=' + b.posStart + ' score=' + b.score.toFixed(1))
}
