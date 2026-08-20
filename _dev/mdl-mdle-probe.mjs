// MDLE 矩阵 @+17 起全部平移；MDLS @+29 起逐 64B；puppet MDAT 区完整 hex
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

const f = (m, o, k) => m.readFloatLE(o + k * 4)
function mats(m, base, n, label) {
  console.log('  ' + label + ':')
  for (let i = 0; i < Math.min(n, 24); i++) {
    const mp = base + i * 64
    const t = [f(m, mp, 12), f(m, mp, 13), f(m, mp, 14)]
    const s0 = Math.hypot(f(m, mp, 0), f(m, mp, 1), f(m, mp, 2))
    console.log('    [' + i + '] t=(' + t.map((x) => x.toFixed(2)).join(', ') + ')')
  }
}

function analyze(mdlPath, pkg) {
  const m = pkg.read(mdlPath)
  if (!m) { console.log(mdlPath + ': MISSING'); return }
  console.log('\n=== ' + mdlPath.split('/').pop())
  const mdlsIdx = m.indexOf('MDLS')
  const mdleIdx = m.indexOf('MDLE0002')
  const mdatIdx = m.indexOf('MDAT0001')

  if (mdlsIdx >= 0) {
    const count = m.readUInt32LE(mdlsIdx + 13)
    console.log('  MDLS@' + mdlsIdx + ' count=' + count)
    mats(m, mdlsIdx + 29, count, 'MDLS bind @+29')
    // 检查 @+29+count*64 处
    const after = mdlsIdx + 29 + count * 64
    console.log('  MDLS after region @' + after + ': ' + m.subarray(after, after + 64).toString('hex'))
  }
  if (mdleIdx >= 0) {
    const bytes = m.readUInt32LE(mdleIdx + 13)
    console.log('  MDLE@' + mdleIdx + ' byteCount=' + bytes + ' count=' + bytes / 64)
    mats(m, mdleIdx + 17, bytes / 64, 'MDLE @+17')
  }
  if (mdatIdx >= 0) {
    let end = m.length
    for (const mk of ['MDLA0006', 'MDLE0002']) {
      const j = m.indexOf(mk)
      if (j > mdatIdx && j < end) end = j
    }
    console.log('  MDAT@' + mdatIdx + ' regionLen=' + (end - mdatIdx))
    console.log('  MDAT region hex: ' + m.subarray(mdatIdx, Math.min(end, mdatIdx + 260)).toString('hex'))
  }
}

const pkg = parsePkg('D:/SteamLibrary/steamapps/workshop/content/431960/3463520581/scene.pkg')
for (const n of [
  'models/asuna body_puppet.mdl',
  'models/puppet_puppet.mdl',
]) analyze(n, pkg)
