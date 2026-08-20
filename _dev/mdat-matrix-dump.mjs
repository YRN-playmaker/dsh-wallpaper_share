// 打印 asuna body MDAT head 矩阵 16 个 f32，确定 t 位置
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
const mdat = m.indexOf('MDAT0001')
console.log('mdat=' + mdat)
console.log('region: ' + m.subarray(mdat, mdat + 96).toString('hex'))
// 名字起点 +17，矩阵从名字+5 起（head\0 = 5B）——尝试矩阵起点 22..26 打印 t
for (let mp0 = 22; mp0 <= 26; mp0++) {
  const vals = []
  for (let k = 0; k < 16; k++) vals.push(m.readFloatLE(mdat + mp0 + k * 4).toFixed(2))
  console.log('mp@' + mp0 + ': ' + vals.join(' '))
}
