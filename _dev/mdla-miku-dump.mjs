// 精确 dump Miku + asuna body 的 MDLA 目录区：找 anim[1] 真实结构
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

for (const [label, pkgPath, mdlName] of [
  ['MIKU', 'D:/SteamLibrary/steamapps/workshop/content/431960/3409595232/scene.pkg', 'models/导出初音_puppet.mdl'],
  ['ASUNA', 'D:/SteamLibrary/steamapps/workshop/content/431960/3463520581/scene.pkg', 'models/asuna body_puppet.mdl'],
]) {
  const pkg = parsePkg(pkgPath)
  const m = pkg.read(mdlName)
  const mdla = m.indexOf('MDLA0006')
  const mdle = m.indexOf('MDLE0002')
  const animCount = m.readUInt32LE(mdla + 13)
  console.log('\n=== ' + label + ' MDLA@' + mdla + ' region=' + (mdle - mdla) + ' animCount=' + animCount)
  console.log('head96: ' + m.subarray(mdla, mdla + 96).toString('hex'))
  // 逐 4B 打印 @+17 起 96B（目录区）
  for (let off = 17; off < 113; off += 4) {
    console.log('  @+' + off + ': ' + m.subarray(mdla + off, mdla + off + 4).toString('hex') + ' u32=' + m.readUInt32LE(mdla + off) + ' f32=' + m.readFloatLE(mdla + off).toFixed(3))
  }
}
