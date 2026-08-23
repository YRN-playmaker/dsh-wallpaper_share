// 解析 3463520581 waterwaves 的 passes 完整结构（textures/mask 引用）
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
  return { read, entries }
}

const pkg = parsePkg(readFileSync('D:/SteamLibrary/steamapps/workshop/content/431960/3463520581/scene.pkg'))
const s = pkg.read('scene.json').toString('utf8')
// 找第一个 waterwaves 的完整 effect 对象（含 passes/textures）
const i = s.indexOf('effects/waterwaves')
if (i >= 0) {
  // 从 effect 对象起点（{ "file"）到结尾（"visible" : true }）
  const start = s.lastIndexOf('{', i)
  const end = s.indexOf('"visible"', i)
  console.log('waterwaves effect object:')
  console.log(s.slice(start, end + 60))
}
// 找 masks 纹理条目
console.log('\nmasks entries:')
for (const e of pkg.entries) {
  if (e.name.includes('mask')) console.log('  ' + e.name + ' (' + e.size + 'B)')
}
// 也看 3770263871 的草 waterwaves（对比）
const s2 = parsePkg(readFileSync('D:/SteamLibrary/steamapps/workshop/content/431960/3770263871/scene.pkg'))
const j2 = s2.read('scene.json').toString('utf8')
const i2 = j2.indexOf('effects/waterwaves')
if (i2 >= 0) {
  const start2 = j2.lastIndexOf('{', i2)
  const end2 = j2.indexOf('"visible"', i2)
  console.log('\n3770263871 waterwaves object:')
  console.log(j2.slice(start2, end2 + 60))
}
