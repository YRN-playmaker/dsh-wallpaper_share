// 分析 Miku anim[1] 数据块（@+5500 起）：t 单调性 + 值分布 → 真实动画 or 假象
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

const pkg = parsePkg('D:/SteamLibrary/steamapps/workshop/content/431960/3409595232/scene.pkg')
const m = pkg.read('models/导出初音_puppet.mdl')
const mdla = m.indexOf('MDLA0006')

// 在 @+5450..@+5520 内探测 451 帧（16236B）数据块起点：t 单调性 + 值合理性
for (let off = 5450; off <= 5520; off++) {
  const base = mdla + off
  if (base + 16236 > m.length) continue
  let tMin = Infinity, tMax = -Infinity, badVals = 0
  const ts = []
  let ok = true
  for (let f = 0; f < 451; f++) {
    const fp = base + f * 36
    const t = (m[fp] | (m[fp + 1] << 8) | (m[fp + 2] << 16)) >>> 0
    ts.push(t)
    if (t < tMin) tMin = t
    if (t > tMax) tMax = t
    for (let k = 0; k < 8; k++) {
      const v = m.readFloatLE(fp + 3 + k * 4)
      if (!Number.isFinite(v) || Math.abs(v) > 1e7) badVals++
    }
  }
  if (badVals > 451 * 4) continue // 大量垃圾
  // t 单调性
  let peak = 0
  for (let i = 1; i < ts.length; i++) if (ts[i] > ts[peak]) peak = i
  let mono = 0
  for (let i = 1; i <= peak; i++) if (ts[i] >= ts[i - 1]) mono++
  for (let i = peak + 1; i < ts.length; i++) if (ts[i] <= ts[i - 1]) mono++
  if (mono > 400 && badVals === 0) {
    console.log('CANDIDATE off=' + off + ' t[' + tMin + ',' + tMax + '] peak=' + peak + ' mono=' + mono + '/450 badVals=' + badVals)
    // 打印前 4 帧 + 中 2 帧
    for (const fi of [0, 1, 2, 3, 225, 226, 448, 449, 450]) {
      if (fi >= 451) continue
      const fp = base + fi * 36
      const t = (m[fp] | (m[fp + 1] << 8) | (m[fp + 2] << 16)) >>> 0
      const vals = []
      for (let k = 0; k < 8; k++) vals.push(m.readFloatLE(fp + 3 + k * 4).toFixed(3))
      console.log('    f' + fi + ' t=' + t + ' [' + vals.join(', ') + ']')
    }
    break
  }
}
