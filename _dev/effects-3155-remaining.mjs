// 列出 3151551777 剩余 waterwaves 层 + 参数
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = fileURLToPath(import.meta.url).replace(/\\/g, '/')
const root = here.slice(0, here.lastIndexOf('/_dev/'))
const { buildSceneModel } = await import(pathToFileURL(join(root, 'src/scene/SceneModel.ts')).href)
const model = buildSceneModel(new Uint8Array(readFileSync('D:/SteamLibrary/steamapps/workshop/content/431960/3151551777/scene.pkg')))
for (const l of model.layers) {
  for (const e of l.effects) {
    if (e.type === 'waterwaves') console.log('#' + l.id + ' ' + l.name + ' strength=' + e.strength + ' scale=' + e.scale + ' dir=' + e.direction.toFixed(2) + ' mask=' + (e.mask ?? 'null'))
  }
}
