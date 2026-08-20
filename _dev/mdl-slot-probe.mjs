// MDAT 正确解析（end = 下一块魔数）+ 80B 顶点 boneIdx 槽位探测
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

const BLOCKS = ['MDLV', 'MDLS', 'MDAT', 'MDLA', 'MDLE', 'MDLC', 'MDLB']

function blockOffsets(m) {
  const out = {}
  for (const b of BLOCKS) {
    let i = 0
    while (true) {
      const j = m.indexOf(b, i)
      if (j < 0) break
      out[b + '@' + j] = j
      i = j + 1
    }
  }
  return out
}

function analyze(mdlPath, pkg) {
  const m = pkg.read(mdlPath)
  if (!m) { console.log(mdlPath + ': MISSING'); return }
  console.log('\n=== ' + mdlPath.split('/').pop() + ' len=' + m.length)
  const offs = blockOffsets(m)
  for (const k of Object.keys(offs)) console.log('  ' + k)

  const mdatIdx = offs['MDAT@' + Object.keys(offs).find((k) => k.startsWith('MDAT'))?.split('@')[1] ?? -1]
  const mdatKey = Object.keys(offs).find((k) => k.startsWith('MDAT'))
  const mdlaKey = Object.keys(offs).find((k) => k.startsWith('MDLA'))
  const mdleKey = Object.keys(offs).find((k) => k.startsWith('MDLE'))
  if (mdatKey) {
    const mi = Number(mdatKey.split('@')[1])
    // end = 下一个 > mi 的块
    let end = m.length
    for (const k of Object.keys(offs)) {
      const o = Number(k.split('@')[1])
      if (o > mi && o < end) end = o
    }
    // 打印 MDAT 头 32 字节 hex
    console.log('  MDAT@' + mi + ' head: ' + m.subarray(mi, mi + 32).toString('hex'))
    let p = mi + 17
    const bones = []
    let guard = 0
    while (p + 66 <= end && guard++ < 200) {
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
    console.log('  MDAT bones=' + bones.length)
    for (const b of bones) console.log('    ' + b.name + ' @ (' + b.t.map((x) => x.toFixed(2)).join(', ') + ')')
    if (bones.length === 0) {
      console.log('  MDAT raw 128B: ' + m.subarray(mi, mi + 128).toString('hex'))
    }
  }

  // 80B 顶点槽位探测（mdls 前的 MDLV 网格）
  const mdlsKey = Object.keys(offs).find((k) => k.startsWith('MDLS'))
  if (mdlsKey && mdatKey) {
    const mdlsOffset = Number(mdlsKey.split('@')[1])
    const markerSize = 9
    const stride = 80
    let blk = null
    for (let offset = markerSize; offset + 12 < mdlsOffset; offset++) {
      const cvb = m.readUInt32LE(offset + 4)
      const vo = offset + 8
      const ilo = vo + cvb
      if (cvb === 0 || cvb % stride !== 0 || ilo + 4 > mdlsOffset) continue
      const cib = m.readUInt32LE(ilo)
      if (cib === 0 || cib % 6 !== 0 || ilo + 4 + cib > mdlsOffset) continue
      blk = { vo, vc: cvb / stride, ilo, ib: cib }
      break
    }
    if (!blk) { console.log('  no mesh'); return }
    console.log('  mesh: vc=' + blk.vc + ' tri=' + blk.ib / 6)
    // 每个 float 槽（0..19）统计
    const slots = []
    for (let s = 0; s < 20; s++) {
      const vals = []
      for (let i = 0; i < blk.vc; i++) {
        vals.push(m.readFloatLE(blk.vo + i * stride + s * 4))
      }
      let min = Infinity, max = -Infinity, ints = 0, in01 = 0, in13 = 0
      const uniq = new Set()
      for (const v of vals) {
        if (v < min) min = v
        if (v > max) max = v
        if (Math.abs(v - Math.round(v)) < 1e-3) { ints++; uniq.add(Math.round(v)) }
        if (v >= 0 && v <= 1) in01++
        if (v >= -1 && v <= 1) in13++
      }
      slots.push({ s, min, max, ints: ints + '/' + vals.length, uniq: uniq.size, in01: in01 + '/' + vals.length, in13: in13 + '/' + vals.length })
    }
    for (const sl of slots) {
      console.log('  slot[' + sl.s + '] range=[' + sl.min.toFixed(2) + ',' + sl.max.toFixed(2) + '] int=' + sl.ints + ' uniq=' + sl.uniq + ' in[0,1]=' + sl.in01 + ' in[-1,1]=' + sl.in13)
    }
  }
}

const pkg = parsePkg('D:/SteamLibrary/steamapps/workshop/content/431960/3463520581/scene.pkg')
for (const n of [
  'models/asuna body_puppet.mdl',
  'models/asuna body bottom_puppet.mdl',
  'models/puppet_puppet.mdl',
  'models/hair back big chunk_puppet.mdl',
]) analyze(n, pkg)
