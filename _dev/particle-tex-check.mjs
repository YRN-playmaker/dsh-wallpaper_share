// 检查 WE assets 粒子纹理的 Image 内容区域（textureWidth vs imageWidth）
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = fileURLToPath(import.meta.url).replace(/\\/g, '/')
const root = here.slice(0, here.lastIndexOf('/_dev/'))
const { decodeTex } = await import(pathToFileURL(join(root, 'src/scene/SceneTex.ts')).href)

const assets = 'D:/SteamLibrary/steamapps/common/wallpaper_engine/assets/materials'
const names = ['particle/fog/fog3', 'particle/fog/fog1', 'particle/fog/fog2', 'particle/wind/wind1', 'particle/smoke/smoke1', 'particle/debris/debris1', 'particle/nature/leaves6', 'particle/snow/snow1']
for (const n of names) {
  try {
    const bytes = new Uint8Array(readFileSync(assets + '/' + n + '.tex'))
    const tex = decodeTex(bytes)
    if (tex === null) { console.log(n + ': decode FAIL'); continue }
    console.log(n + ': tex=' + tex.textureWidth + 'x' + tex.textureHeight + ' image=' + tex.imageWidth + 'x' + tex.imageHeight + ' fmt=' + tex.format + ' kind=' + (tex.mip0 ? tex.mip0.kind : '?'))
  } catch (e) {
    console.log(n + ': MISSING')
  }
}
