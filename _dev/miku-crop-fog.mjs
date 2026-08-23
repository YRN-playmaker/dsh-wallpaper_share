// 3409595232：模型 cropoffset（图集裁剪）+ 雾粒子定义 + 纹理
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

function parseJsonLike(buf) {
  const s = buf.toString('utf8')
  const lb = s.indexOf('{')
  const rb = s.lastIndexOf('}')
  try { return JSON.parse(s.slice(lb, rb + 1)) } catch { return null }
}

const pkg = parsePkg(readFileSync('D:/SteamLibrary/steamapps/workshop/content/431960/3409595232/scene.pkg'))
// 1. 所有模型 json 的 cropoffset
console.log('=== cropoffset ===')
for (const e of pkg.entries) {
  if (!e.name.startsWith('models/') || !e.name.endsWith('.json')) continue
  const j = parseJsonLike(pkg.read(e.name))
  if (!j) continue
  if (j.cropoffset !== undefined) {
    console.log(e.name + ': cropoffset=' + JSON.stringify(j.cropoffset) + ' width=' + j.width + ' height=' + j.height)
  }
}
// 2. 粒子系统
console.log('\n=== particles ===')
for (const e of pkg.entries) {
  if (!e.name.startsWith('particles/') || !e.name.endsWith('.json')) continue
  const j = parseJsonLike(pkg.read(e.name))
  if (!j) continue
  console.log(e.name + ': maxcount=' + j.maxcount + ' material=' + (j.material ?? '') + ' emitter=' + JSON.stringify(j.emitter).slice(0, 200))
}
// 3. 雾相关纹理
console.log('\n=== fog/particle textures ===')
for (const e of pkg.entries) {
  if (e.name.includes('fog') || e.name.startsWith('particle/')) console.log('  ' + e.name + ' (' + e.size + 'B)')
}
