// Miku 网格块头区 dump + 所有候选块（80 倍数）检查
import { readFileSync } from 'node:fs'

function parsePkg(buf) {
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

const pkg = parsePkg(readFileSync('D:/SteamLibrary/steamapps/workshop/content/431960/3409595232/scene.pkg'))
const m = pkg.read('models/导出初音_puppet.mdl')
const mdls = 593739
console.log('head 0-96: ' + m.subarray(0, 96).toString('hex'))
// 所有候选块（80 倍数 + 索引合理）
const cands = []
for (let offset = 9; offset + 12 < mdls; offset++) {
  const cvb = m.readUInt32LE(offset + 4)
  const vo = offset + 8
  const ilo = vo + cvb
  if (cvb === 0 || cvb % 80 !== 0 || cvb < 40000 || ilo + 4 > mdls) continue
  const cib = m.readUInt32LE(ilo)
  if (cib === 0 || cib % 6 !== 0 || ilo + 4 + cib > mdls) continue
  const vc = cvb / 80
  // 索引范围检查
  const idxCount = cib / 2
  let maxIdx = 0
  let ok = true
  for (let i = 0; i < Math.min(idxCount, 200); i++) {
    const v = m.readUInt16LE(ilo + 4 + i * 2)
    if (v > maxIdx) maxIdx = v
    if (v >= vc) { ok = false; break }
  }
  cands.push({ offset, cvb, cib, vc, maxIdx, ok })
}
console.log('candidates: ' + cands.length)
for (const c of cands.slice(0, 12)) {
  console.log('  @' + c.offset + ' vc=' + c.vc + ' idx=' + c.cib / 6 + ' maxIdx=' + c.maxIdx + ' ok=' + c.ok)
  if (c.offset < 200) console.log('    head: ' + m.subarray(c.offset, c.offset + 24).toString('hex'))
}
