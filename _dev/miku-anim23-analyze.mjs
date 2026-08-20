// Miku anim[1](1054) @811496 起 9756B + anim[2](377) 数据段：值变化分析
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
for (const [label, base, dataLen] of [
  ['anim1(1054)', 811496, 9756],
  ['anim2(377)', 1182534 + 67, 13004],
]) {
  const n = Math.floor(dataLen / 36)
  console.log('\n=== ' + label + ' @' + base + ' frames=' + n)
  // 探测偏移 0..8
  let best = null
  for (let off = 0; off <= 8; off++) {
    const ts = []
    let bad = 0
    for (let f = 0; f < n; f++) {
      const fp = base + off + f * 36
      const t = (m[fp] | (m[fp + 1] << 8) | (m[fp + 2] << 16)) >>> 0
      ts.push(t)
      for (let k = 0; k < 8; k++) {
        const v = m.readFloatLE(fp + 3 + k * 4)
        if (!Number.isFinite(v) || Math.abs(v) > 1e7) bad++
      }
    }
    let tMin = Infinity, tMax = -Infinity
    for (const t of ts) { if (t < tMin) tMin = t; if (t > tMax) tMax = t }
    let peak = 0
    for (let i = 1; i < ts.length; i++) if (ts[i] > ts[peak]) peak = i
    let mono = 0
    for (let i = 1; i <= peak; i++) if (ts[i] >= ts[i - 1]) mono++
    for (let i = peak + 1; i < ts.length; i++) if (ts[i] <= ts[i - 1]) mono++
    const score = mono - bad * 0.5
    if (best === null || score > best.score) best = { off, score, tMin, tMax, mono, bad, peak }
  }
  console.log('  best off=' + best.off + ' t[' + best.tMin + ',' + best.tMax + '] peak=' + best.peak + ' mono=' + best.mono + '/' + (n - 1) + ' bad=' + best.bad)
  // 打印每分量跨度（best off）
  const spans = []
  for (let vi = 0; vi < 8; vi++) {
    let mn = Infinity, mx = -Infinity
    for (let f = 0; f < n; f++) {
      const fp = base + best.off + f * 36
      const v = m.readFloatLE(fp + 3 + vi * 4)
      if (!Number.isFinite(v)) continue
      if (v < mn) mn = v
      if (v > mx) mx = v
    }
    spans.push(mn + '..' + mx)
  }
  console.log('  spans: v0=' + spans[0] + ' v1=' + spans[1] + ' v2=' + spans[2] + ' v3=' + spans[3])
  console.log('         v4=' + spans[4] + ' v5=' + spans[5] + ' v6=' + spans[6] + ' v7=' + spans[7])
  for (const fi of [0, 1, 2, 5, Math.floor(n / 2), n - 3, n - 2, n - 1]) {
    if (fi >= n) continue
    const fp = base + best.off + fi * 36
    const t = (m[fp] | (m[fp + 1] << 8) | (m[fp + 2] << 16)) >>> 0
    const vals = []
    for (let k = 0; k < 8; k++) vals.push(m.readFloatLE(fp + 3 + k * 4).toFixed(3))
    console.log('  f' + fi + ' t=' + t + ' [' + vals.join(', ') + ']')
  }
}
