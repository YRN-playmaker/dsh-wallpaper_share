// 验证：3463520581 部件纹理尺寸 vs 图层 size；雪花场景 parent 结构
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = fileURLToPath(import.meta.url).replace(/\\/g, '/')
const root = here.slice(0, here.lastIndexOf('/_dev/'))
const { decodeTex } = await import(pathToFileURL(join(root, 'src/scene/SceneTex.ts')).href)
const { buildSceneModel } = await import(pathToFileURL(join(root, 'src/scene/SceneModel.ts')).href)

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

console.log('=== 3463520581 部件纹理 ===')
{
  const pkg = parsePkg('D:/SteamLibrary/steamapps/workshop/content/431960/3463520581/scene.pkg')
  for (const n of ['materials/kirito body.tex', 'materials/kirito face.tex', 'materials/hair kirito back.tex', 'materials/kirito arm.tex', 'materials/puppet - Copy.tex', 'materials/Terrain front.tex']) {
    const e = pkg.entries.find((x) => x.name === n)
    if (!e) { console.log(`${n}: NOT FOUND`); continue }
    const bytes = pkg.buf.subarray(pkg.dataStart + e.offset, pkg.dataStart + e.offset + e.size)
    const t = decodeTex(bytes)
    if (!t) { console.log(`${n}: decode NULL`); continue }
    const m = t.mip0
    console.log(`${n}: fmt=${t.format} imgFmt=${t.imageFormat} texture=${t.textureWidth}x${t.textureHeight} image=${t.imageWidth}x${t.imageHeight} mip0=${m ? m.width + 'x' + m.height : 'null'} kind=${m ? m.kind : '?'}`)
  }
}
console.log('=== 3463520581 图层 parent 分布 ===')
{
  const pkg = parsePkg('D:/SteamLibrary/steamapps/workshop/content/431960/3463520581/scene.pkg')
  // 用 buildSceneModel 前的原始 scene.json 需要 parseScenePkg；这里直接读 scene.json 文本
  const e = pkg.entries.find((x) => x.name === 'scene.json')
  const raw = pkg.buf.subarray(pkg.dataStart + e.offset, pkg.dataStart + e.offset + e.size).toString('utf8')
  const lb = raw.lastIndexOf('}')
  const scene = JSON.parse((raw.startsWith('{') ? '' : '{') + raw.slice(0, lb + 1))
  const withParent = scene.objects.filter((o) => o.parent !== undefined && o.parent !== null)
  console.log(`对象数=${scene.objects.length} 有parent=${withParent.length}`)
  const byParent = {}
  for (const o of withParent) (byParent[o.parent] = byParent[o.parent] ?? []).push(o.id)
  for (const [p, ids] of Object.entries(byParent)) console.log(`  parent=${p}: ids=${ids.join(',')}`)
}
console.log('=== 3409595232 parent 结构 ===')
{
  const pkg = parsePkg('D:/SteamLibrary/steamapps/workshop/content/431960/3409595232/scene.pkg')
  const e = pkg.entries.find((x) => x.name === 'scene.json')
  const raw = pkg.buf.subarray(pkg.dataStart + e.offset, pkg.dataStart + e.offset + e.size).toString('utf8')
  const lb = raw.lastIndexOf('}')
  const scene = JSON.parse((raw.startsWith('{') ? '' : '{') + raw.slice(0, lb + 1))
  const withParent = scene.objects.filter((o) => o.parent !== undefined && o.parent !== null)
  console.log(`对象数=${scene.objects.length} 有parent=${withParent.length}`)
  const byParent = {}
  for (const o of withParent) (byParent[o.parent] = byParent[o.parent] ?? []).push(o.id)
  for (const [p, ids] of Object.entries(byParent)) console.log(`  parent=${p}: ids=${ids.join(',')}`)
}
