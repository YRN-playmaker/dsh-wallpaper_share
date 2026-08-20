// MDLE/MDLS 头 dump + slot[14..17] 值分布 + MDLE 平移 vs MDAT 具名骨骼对比
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

function findBlock(m, marker) {
  const j = m.indexOf(marker)
  return j >= 0 ? j : -1
}

function analyze(mdlPath, pkg) {
  const m = pkg.read(mdlPath)
  if (!m) { console.log(mdlPath + ': MISSING'); return }
  console.log('\n=== ' + mdlPath.split('/').pop() + ' len=' + m.length)

  const mdlsIdx = findBlock(m, 'MDLS')
  const mdleIdx = findBlock(m, 'MDLE0002')
  const mdatIdx = findBlock(m, 'MDAT0001')

  if (mdlsIdx >= 0) {
    console.log('  MDLS@' + mdlsIdx + ' head32: ' + m.subarray(mdlsIdx, mdlsIdx + 32).toString('hex'))
    // 尝试多种偏移读 boneCount
    for (const off of [9, 10, 11, 12, 13, 14, 15, 16]) {
      const v = m.readUInt32LE(mdlsIdx + off)
      if (v >= 1 && v <= 200) console.log('    u32@' + off + ' = ' + v)
    }
    // bind 矩阵 @ mdls+30
    const f = (o, k) => m.readFloatLE(o + k * 4)
    console.log('    bind@+30: m00=' + f(mdlsIdx + 30, 0).toFixed(2) + ' m10=' + f(mdlsIdx + 30, 1).toFixed(2) + ' m20=' + f(mdlsIdx + 30, 2).toFixed(2) + ' t=(' + f(mdlsIdx + 30, 12).toFixed(2) + ',' + f(mdlsIdx + 30, 13).toFixed(2) + ',' + f(mdlsIdx + 30, 14).toFixed(2) + ')')
    // 第二个矩阵 @+94
    console.log('    bind@+94: t=(' + f(mdlsIdx + 94, 12).toFixed(2) + ',' + f(mdlsIdx + 94, 13).toFixed(2) + ',' + f(mdlsIdx + 94, 14).toFixed(2) + ')')
  }

  if (mdleIdx >= 0) {
    console.log('  MDLE@' + mdleIdx + ' head32: ' + m.subarray(mdleIdx, mdleIdx + 32).toString('hex'))
    for (const off of [11, 13, 15, 17]) {
      const v = m.readUInt32LE(mdleIdx + off)
      if (v >= 1 && v <= 200) console.log('    u32@' + off + ' = ' + v)
    }
    const count = m.readUInt32LE(mdleIdx + 15)
    if (count >= 1 && count <= 200) {
      const mats = []
      for (let i = 0; i < count; i++) {
        const mp = mdleIdx + 19 + i * 64
        const f = (k) => m.readFloatLE(mp + k * 4)
        mats.push({ t: [f(12), f(13), f(14)], s: [Math.hypot(f(0), f(1), f(2)), Math.hypot(f(4), f(5), f(6))] })
      }
      console.log('    MDLE count=' + count)
      for (let i = 0; i < count; i++) console.log('      mat[' + i + '] t=(' + mats[i].t.map((x) => x.toFixed(2)).join(', ') + ') scale=(' + mats[i].s.map((x) => x.toFixed(3)).join(', ') + ')')
    }
  }

  if (mdatIdx >= 0) {
    // 具名骨骼（end = 下一块）
    let end = m.length
    for (const mk of ['MDLA0006', 'MDLE0002']) {
      const j = findBlock(m, mk)
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
        const f = (k) => m.readFloatLE(mp + k * 4)
        bones.push({ name: nm, t: [f(12), f(13), f(14)] })
        p = mp + 64
      } else break
    }
    console.log('  MDAT bones=' + bones.length + ' -> ' + JSON.stringify(bones))
  }

  // 顶点 slot[14..17] 分布（stride=80）
  const stride = 80
  const mdlsOffset = mdlsIdx
  let blk = null
  for (let offset = 9; offset + 12 < mdlsOffset; offset++) {
    const cvb = m.readUInt32LE(offset + 4)
    const vo = offset + 8
    const ilo = vo + cvb
    if (cvb === 0 || cvb % stride !== 0 || ilo + 4 > mdlsOffset) continue
    const cib = m.readUInt32LE(ilo)
    if (cib === 0 || cib % 6 !== 0 || ilo + 4 + cib > mdlsOffset) continue
    blk = { vo, vc: cvb / stride }
    break
  }
  if (blk) {
    for (const s of [14, 15, 16, 17]) {
      const cnt = new Map()
      for (let i = 0; i < blk.vc; i++) {
        const v = m.readFloatLE(blk.vo + i * stride + s * 4)
        const key = Math.round(v * 1000) / 1000
        cnt.set(key, (cnt.get(key) ?? 0) + 1)
      }
      const top = [...cnt.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
      console.log('  slot[' + s + '] top: ' + top.map(([k, c]) => k + '×' + c).join('  '))
    }
    // 组合分布（14,15 联合）
    const combo = new Map()
    for (let i = 0; i < blk.vc; i++) {
      const a = m.readFloatLE(blk.vo + i * stride + 56)
      const b = m.readFloatLE(blk.vo + i * stride + 60)
      const key = a + ',' + b
      combo.set(key, (combo.get(key) ?? 0) + 1)
    }
    console.log('  slot14,15 combo: ' + [...combo.entries()].sort((x, y) => y[1] - x[1]).slice(0, 6).map(([k, c]) => k + '×' + c).join('  '))
  }
}

const pkg = parsePkg('D:/SteamLibrary/steamapps/workshop/content/431960/3463520581/scene.pkg')
for (const n of [
  'models/asuna body_puppet.mdl',
  'models/asuna body bottom_puppet.mdl',
  'models/puppet_puppet.mdl',
  'models/puppet - Copy_puppet.mdl',
  'models/hair back big chunk_puppet.mdl',
  'models/main hair back c2_puppet.mdl',
]) analyze(n, pkg)
