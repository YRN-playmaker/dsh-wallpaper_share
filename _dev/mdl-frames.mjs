// face 数据区全部块（36B）：9 个 f32，找变化
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
const face = pkg.read('models/kirito face_puppet.mdl')

// 73.06 位置 pos[0]=0xc883。检查块 @0xc883 - k*36 哪种对齐给出有意义值
// 方案：块起点 = 0xc883（73.06 在块首）？或 0xc880（73.06 在 @+3）？
// 打印两种对齐的块值
for (const start of [0xc880, 0xc883]) {
  console.log(`\n== 块起点 0x${start.toString(16)}（f32 序列）==`)
  let prev = null
  for (let f = 0; f < 61; f++) {
    const p = start + f * 36
    const vals = []
    for (let off = 0; off < 36; off += 4) vals.push(face.readFloatLE(p + off).toFixed(3))
    const sig = vals.join(' ')
    const mark = sig === prev ? '' : '  <<<'
    if (mark) console.log(`f${f}: ${sig}${mark}`)
    prev = sig
  }
}
