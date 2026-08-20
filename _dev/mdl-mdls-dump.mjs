// dump MDLS 骨骼定义区：parent 链 + 每个骨骼矩阵（@+29 起逐 76B？试探多种步长）
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
const mdlsIdx = m.indexOf('MDLS')
const count = m.readUInt32LE(mdlsIdx + 13)
console.log('MDLS@' + mdlsIdx + ' count=' + count + ' head48: ' + m.subarray(mdlsIdx, mdlsIdx + 48).toString('hex'))

// 试探骨骼定义步长：76B（12B 头 + 64B 矩阵）或 64B
for (const step of [76, 64, 68]) {
  console.log('--- step=' + step + ' ---')
  for (let i = 0; i < Math.min(count, 6); i++) {
    const base = mdlsIdx + 17 + i * step
    const u0 = m.readUInt32LE(base)
    const parent = m.readInt32LE(base + 4)
    const f0 = m.readFloatLE(base + 8)
    const matBase = base + 12
    const tx = m.readFloatLE(matBase + 48), ty = m.readFloatLE(matBase + 52)
    const m00 = m.readFloatLE(matBase)
    console.log('  b' + i + ' @' + base + ' u0=' + u0 + ' parent=' + parent + ' f0=' + f0.toFixed(3) + ' m00=' + m00.toFixed(2) + ' t=(' + tx.toFixed(2) + ',' + ty.toFixed(2) + ')')
  }
}

// dump 骨骼区原始字节（@+17 起 400B）
console.log('raw: ' + m.subarray(mdlsIdx + 17, mdlsIdx + 17 + 400).toString('hex'))
