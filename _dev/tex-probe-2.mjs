// 实测 3409595232 / 3463520581 纹理：textureW/H vs imageW/H vs mip0 尺寸
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = fileURLToPath(import.meta.url).replace(/\\/g, '/')
const root = here.slice(0, here.lastIndexOf('/_dev/'))
const { decodeTex } = await import(pathToFileURL(join(root, 'src/scene/SceneTex.ts')).href)

const WS = 'D:/SteamLibrary/steamapps/workshop/content/431960'
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
  return { buf, dataStart, entries }
}

const CASES = [
  ['3409595232', 'materials/导出初音.tex'],
  ['3409595232', 'materials/背景.tex'],
  ['3409595232', 'materials/图层 22.tex'],
  ['3409595232', 'materials/workshop/2328851328/particle/雪花.jpg.tex'],
  ['3463520581', 'materials/sky.tex'],
  ['3463520581', 'materials/extra bg.tex'],
]

for (const [pid, texName] of CASES) {
  const pkg = parsePkg(`${WS}/${pid}/scene.pkg`)
  const e = pkg.entries.find((x) => x.name === texName)
  if (!e) { console.log(`== ${pid} ${texName}: NOT FOUND`); continue }
  const bytes = pkg.buf.subarray(pkg.dataStart + e.offset, pkg.dataStart + e.offset + e.size)
  const t = decodeTex(bytes)
  if (!t) { console.log(`== ${pid} ${texName}: decodeTex NULL`); continue }
  const m = t.mip0
  console.log(`== ${pid} ${texName} (${e.size}B)`)
  console.log(`   fmt=${t.format} container=${t.containerMagic} imageFormat=${t.imageFormat} mipCount=${t.mipCount}`)
  console.log(`   texture=${t.textureWidth}x${t.textureHeight} image=${t.imageWidth}x${t.imageHeight} mip0=${m ? m.width + 'x' + m.height : 'null'} kind=${m ? m.kind : '?'}`)
}
