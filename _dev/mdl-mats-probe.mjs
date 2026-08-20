// 打印 MDLS 全部 bind 矩阵 + MDLE 全部矩阵平移，对比 MDAT 具名骨骼
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
  console.log('  ' + label + ' (' + n + ' matrices @' + base + '):')
  for (let i = 0; i < Math.min(n, 20); i++) {
    const mp = base + i * 64
    const t = [f(m, mp, 12), f(m, mp, 13), f(m, mp, 14)]
    const s0 = Math.hypot(f(m, mp, 0), f(m, mp, 1), f(m, mp, 2))
    const s1 = Math.hypot(f(m, mp, 4), f(m, mp, 5), f(m, mp, 6))
    console.log('    [' + i + '] t=(' + t.map((x) => x.toFixed(2)).join(', ') + ') col0len=' + s0.toFixed(3) + ' col1len=' + s1.toFixed(3))
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
    console.log('  MDLS@' + mdlsIdx + ' count=' + count + ' head40: ' + m.subarray(mdlsIdx, mdlsIdx + 40).toString('hex'))
    mats(m, mdlsIdx + 30, count, 'MDLS bind')
  }
  if (mdleIdx >= 0) {
    const bytes = m.readUInt32LE(mdleIdx + 14)
    const count = bytes / 64
    console.log('  MDLE@' + mdleIdx + ' byteCount=' + bytes + ' count=' + count)
    mats(m, mdleIdx + 19, count, 'MDLE')
  }
  if (mdatIdx >= 0) {
    let end = m.length
    for (const mk of ['MDLA0006', 'MDLE0002']) {
      const j = m.indexOf(mk)
      if (j > mdatIdx && j < end) end = j
    }
    let p = mdatIdx + 17
    const bones = []
    while (p + 66 <= end) {
      let nm = ''
      let q = p
      while (q < end && m[q] !== 0 && m[q] >= 32 && m[q] < 127) { nm += String.fromCharCode(m[q]); q++ }
      if (nm.length >= 1 && m[q] === 0 && q + 1 + 64 <= end) {
        const mp = q + 1
        bones.push({ name: nm, t: [f(m, mp, 12), f(m, mp, 13), f(m, mp, 14)] })
        p = mp + 64
      } else break
    }
    console.log('  MDAT: ' + JSON.stringify(bones))
  }
}

const pkg = parsePkg('D:/SteamLibrary/steamapps/workshop/content/431960/3463520581/scene.pkg')
for (const n of [
  'models/asuna body_puppet.mdl',
  'models/asuna body bottom_puppet.mdl',
  'models/puppet_puppet.mdl',
  'models/hair back big chunk_puppet.mdl',
  'models/main hair back c2_puppet.mdl',
]) analyze(n, pkg)
