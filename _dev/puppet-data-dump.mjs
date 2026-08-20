// puppet_puppet 数据区逐帧 dump：比较 off=0(@+67) vs off=4(@+71) 的 t 序列与值
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
const m = pkg.read('models/puppet_puppet.mdl')
const mdla = m.indexOf('MDLA0006')
console.log('data region @+67 (2196B): first 400B')
console.log(m.subarray(mdla + 67, mdla + 67 + 400).toString('hex'))
for (const off of [0, 4]) {
  const base = mdla + 67 + off
  console.log('\n--- off=' + off + ' (@+' + (67 + off) + ') ---')
  const ts = []
  for (let f = 0; f < 61; f++) {
    const fp = base + f * 36
    const t = (m[fp] | (m[fp + 1] << 8) | (m[fp + 2] << 16)) >>> 0
    ts.push(t)
    if (f < 6 || f === 30 || f > 56) {
      const vals = []
      for (let k = 0; k < 8; k++) vals.push(m.readFloatLE(fp + 3 + k * 4).toFixed(3))
      console.log('  f' + f + ' t=' + t + ' [' + vals.join(', ') + ']')
    }
  }
  let peak = 0
  for (let i = 1; i < ts.length; i++) if (ts[i] > ts[peak]) peak = i
  const period = ts[peak] - ts[0]
  let mono = 0
  for (let i = 1; i <= peak; i++) if (ts[i] >= ts[i - 1]) mono++
  for (let i = peak + 1; i < ts.length; i++) if (ts[i] <= ts[i - 1]) mono++
  console.log('  t: peak=' + peak + ' period=' + period + ' monotonic=' + mono + '/' + (ts.length - 1))
}
