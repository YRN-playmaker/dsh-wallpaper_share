// 解析 3463520581 的 effects：effect.json 参数 + layer passes 参数
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

const pkg = parsePkg(readFileSync('D:/SteamLibrary/steamapps/workshop/content/431960/3463520581/scene.pkg'))
// 1. waterwaves effect.json
for (const n of ['effects/waterwaves/effect.json', 'effects/shake/effect.json', 'effects/opacity/effect.json']) {
  const buf = pkg.read(n)
  if (!buf) { console.log(n + ': MISSING'); continue }
  console.log('\n=== ' + n + ' ===')
  console.log(JSON.stringify(parseJsonLike(buf), null, 1).slice(0, 1500))
}
// 2. scene.json 里第一个 waterwaves 的 passes 参数
{
  const scene = parseJsonLike(pkg.read('scene.json'))
  if (scene && Array.isArray(scene.layers)) {
    for (const l of scene.layers) {
      const effs = l.effects
      if (!Array.isArray(effs)) continue
      for (const e of effs) {
        if (e && typeof e === 'object' && typeof e.file === 'string' && e.file.includes('waterwaves')) {
          console.log('\n=== layer #' + l.id + ' ' + l.name + ' waterwaves ===')
          console.log(JSON.stringify(e, null, 1).slice(0, 1200))
        }
      }
    }
  }
}
