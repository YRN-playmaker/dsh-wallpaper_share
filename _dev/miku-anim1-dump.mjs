// Miku anim[1] 目录项 @+5500 附近 dump + 解析
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

const pkg = parsePkg('D:/SteamLibrary/steamapps/workshop/content/431960/3409595232/scene.pkg')
const m = pkg.read('models/导出初音_puppet.mdl')
const mdla = m.indexOf('MDLA0006')
console.log('MDLA@' + mdla + ' len=' + m.length + ' region=' + (m.indexOf('MDLE0002') - mdla))
// anim[0] 数据 @+64 起 5436B → anim[1] 目录 @+64+5436 = @+5500
for (const off of [5496, 5500, 5504]) {
  console.log('\n@+' + off + ' 160B: ' + m.subarray(mdla + off, mdla + off + 160).toString('hex'))
}
// 尝试解析 anim[1] 目录（id u32 + u32 + name + loop + f32 + 4×u32 + dataLen + extra + 数据）
// 逐 4B 打印 @+5500 起
for (let off = 5500; off < 5580; off += 4) {
  console.log('  @+' + off + ': ' + m.subarray(mdla + off, mdla + off + 4).toString('hex') + ' u32=' + m.readUInt32LE(mdla + off) + ' f32=' + m.readFloatLE(mdla + off).toFixed(2))
}
