// dump 3463520581 粒子层 + particles json（重点 fog）
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = fileURLToPath(import.meta.url).replace(/\\/g, '/')
const root = here.slice(0, here.lastIndexOf('/_dev/'))
const { buildSceneModel } = await import(pathToFileURL(join(root, 'src/scene/SceneModel.ts')).href)

const model = buildSceneModel(new Uint8Array(readFileSync('D:/SteamLibrary/steamapps/workshop/content/431960/3463520581/scene.pkg')))
for (const l of model.layers) {
  if (l.particle === null && l.kind !== 'particle') continue
  console.log('#' + l.id + ' ' + l.name + ' kind=' + l.kind + ' particle=' + JSON.stringify(l.particle))
}

// 读所有 particles/*.json
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
  return { read, entries }
}

const { read, entries } = parsePkg('D:/SteamLibrary/steamapps/workshop/content/431960/3463520581/scene.pkg')
for (const e of entries) {
  if (e.name.includes('particle')) {
    const buf = read(e.name)
    if (!buf) continue
    let s = buf.toString('utf8')
    // 截断垃圾
    const lb = s.lastIndexOf('{')
    const cut = s.lastIndexOf('}', s.lastIndexOf('}') - 1)
    try {
      const j = JSON.parse(s.slice(0, cut + 1))
      console.log('\n=== ' + e.name + ' ===')
      console.log(JSON.stringify(j, null, 1).slice(0, 3000))
    } catch (err) {
      console.log(e.name + ': parse fail')
    }
  }
}
