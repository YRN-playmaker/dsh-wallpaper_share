// 调查 3151551777：aigis 控件的 effects（含 visible 字段 + mask + 参数）
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

const pkg = parsePkg(readFileSync('D:/SteamLibrary/steamapps/workshop/content/431960/3151551777/scene.pkg'))
const s = pkg.read('scene.json').toString('utf8')
// 统计 waterwaves 出现次数
let count = 0
let i = 0
while ((i = s.indexOf('effects/waterwaves', i)) !== -1) { count++; i += 10 }
console.log('waterwaves refs: ' + count)
// 找含 waterwaves 的 layer：提取每个 effect 对象的完整结构（含 visible）
const effRe = /\{\s*"file"\s*:\s*"effects\/waterwaves[^"]*"[\s\S]*?"visible"\s*:\s*\{[\s\S]*?\}\s*\}/g
let m
let shown = 0
while ((m = effRe.exec(s)) !== null && shown < 8) {
  const body = m[0]
  const vis = body.match(/"visible"\s*:\s*\{[\s\S]*?\}/)
  const csv = body.match(/"constantshadervalues"\s*:\s*\{([\s\S]*?)\}/)
  const tex = body.match(/"textures"\s*:\s*\[([\s\S]*?)\]/)
  console.log('\n--- waterwaves effect #' + (++shown) + ' ---')
  console.log('  visible: ' + (vis ? vis[0].replace(/\s+/g, ' ') : 'NONE'))
  console.log('  params: ' + (csv ? csv[1].replace(/\s+/g, ' ').slice(0, 150) : 'NONE'))
  console.log('  textures: ' + (tex ? tex[1].replace(/\s+/g, ' ').slice(0, 120) : 'NONE'))
}
// 统计所有效果类型的 file 分布
const files = new Map()
const allRe = /"file"\s*:\s*"([^"]*effect[^"]*)"/g
while ((m = allRe.exec(s)) !== null) {
  const f = m[1]
  files.set(f, (files.get(f) ?? 0) + 1)
}
console.log('\neffect files:')
for (const [f, c] of files) console.log('  ' + f + ' × ' + c)
