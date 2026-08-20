// Animation 2（2385）段 @+33161 起 61 状态：值变化分析
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
// 段起点候选：@+33161（Animation 2 目录 dataLen 后）± 8
for (const off of [33153, 33157, 33161, 33165]) {
  const base = mdla + off
  // 61 状态（36B 步）t + 8 floats 统计
  const ts = []
  const spans = [0, 0, 0, 0, 0, 0, 0, 0]
  let bad = 0
  for (let f = 0; f < 61; f++) {
    const fp = base + f * 36
    const t = (m[fp] | (m[fp + 1] << 8) | (m[fp + 2] << 16)) >>> 0
    ts.push(t)
    for (let k = 0; k < 8; k++) {
      const v = m.readFloatLE(fp + 3 + k * 4)
      if (!Number.isFinite(v) || Math.abs(v) > 1e7) { bad++; continue }
      const mn = Math.abs(spans[k * 2]) > 1e9 ? v : Math.min(spans[k * 2] || v, v)
      const mx = Math.abs(spans[k * 2 + 1]) > 1e9 ? v : Math.max(spans[k * 2 + 1] || v, v)
      spans[k * 2] = mn
      spans[k * 2 + 1] = mx
    }
  }
  let tMin = Infinity, tMax = -Infinity
  for (const t of ts) { if (t < tMin) tMin = t; if (t > tMax) tMax = t }
  console.log('off+' + off + ': t[' + tMin + ',' + tMax + '] bad=' + bad)
  console.log('  spans: ' + spans.map((s, i) => (i % 2 === 0 ? 'v' + i / 2 + '[' + s.toFixed(2) + ',' : s.toFixed(2) + '] ')).join(''))
  // 打印帧 0,1,2,30,59,60
  for (const fi of [0, 1, 2, 30, 58, 59, 60]) {
    const fp = base + fi * 36
    const t = (m[fp] | (m[fp + 1] << 8) | (m[fp + 2] << 16)) >>> 0
    const vals = []
    for (let k = 0; k < 8; k++) vals.push(m.readFloatLE(fp + 3 + k * 4).toFixed(3))
    console.log('    f' + fi + ' t=' + t + ' [' + vals.join(', ') + ']')
  }
}
