// 3409595232 MDLS/MDAT/MDLA/MDLE 块头 dump
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
for (const [name, off] of [['MDLS', 593739], ['MDAT', 604375], ['MDLA', 604467], ['MDLE', 1676759]]) {
  console.log(name + '@' + off + ': ' + m.subarray(off, off + 40).toString('hex'))
  console.log('  ascii: ' + m.subarray(off, off + 24).toString('latin1'))
}
