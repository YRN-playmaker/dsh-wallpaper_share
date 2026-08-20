// 精确 dump puppet 两文件的 MDLA 目录项尾部（dataLen 后到数据区）
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
  console.log('\n=== ' + n.split('/').pop() + ' MDLA@' + mdla)
  // 目录项：@+17 起 id(4) u32(4) name loop f32 u32 u32 u32 u32 dataLen
  // dataLen @ ? —— 逐字段打印 @+17 起每 4B 的 u32/f32 解读
  for (let off = 17; off <= 75; off += 4) {
    const u = m.readUInt32LE(mdla + off)
    const f = m.readFloatLE(mdla + off)
    console.log('  @+' + off + ' u32=' + u + ' f32=' + f.toFixed(3) + ' hex=' + m.subarray(mdla + off, mdla + off + 4).toString('hex'))
  }
  console.log('  raw @+52..+88: ' + m.subarray(mdla + 52, mdla + 88).toString('hex'))
}
