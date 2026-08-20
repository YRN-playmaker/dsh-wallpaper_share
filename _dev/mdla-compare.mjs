// 对比 puppet_puppet 与 puppet - Copy 的 MDLA 头/目录项/数据区
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
for (const n of ['models/puppet_puppet.mdl', 'models/puppet - Copy_puppet.mdl']) {
  const m = pkg.read(n)
  const mdla = m.indexOf('MDLA0006')
  const mdle = m.indexOf('MDLE0002')
  console.log('\n=== ' + n.split('/').pop() + ' len=' + m.length + ' MDLA@' + mdla + ' region=' + (mdle - mdla))
  console.log('head64: ' + m.subarray(mdla, mdla + 64).toString('hex'))
  // 解析目录项
  const animCount = m.readUInt32LE(mdla + 13)
  console.log('animCount=' + animCount)
  let q = mdla + 17
  for (let a = 0; a < animCount; a++) {
    const id = m.readUInt32LE(q)
    const u2 = m.readUInt32LE(q + 4)
    let nm = ''
    let s = q + 8
    while (m[s] !== 0 && nm.length < 64) { nm += String.fromCharCode(m[s]); s++ }
    const nmEnd = s
    s++
    let lp = ''
    while (m[s] !== 0 && lp.length < 64) { lp += String.fromCharCode(m[s]); s++ }
    s++
    const f32a = m.readFloatLE(s); s += 4
    const ua = m.readUInt32LE(s); s += 4
    const ub = m.readUInt32LE(s); s += 4
    const uc = m.readUInt32LE(s); s += 4
    const ud = m.readUInt32LE(s); s += 4
    const dataLen = m.readUInt32LE(s); s += 4
    const extra = m[s]
    console.log('  anim[' + a + '] id=' + id + ' u2=' + u2 + ' name="' + nm + '" loop="' + lp + '" f32=' + f32a + ' ua=' + ua + ' ub=' + ub + ' uc=' + uc + ' ud=' + ud + ' dataLen=' + dataLen + ' extra=' + extra + ' data@' + (s + 1) + ' (+' + (s + 1 - mdla) + ')')
    // 数据区前 32B
    console.log('  data: ' + m.subarray(s + 1, s + 1 + 32).toString('hex'))
    s += dataLen
    q = s + 1
  }
}
