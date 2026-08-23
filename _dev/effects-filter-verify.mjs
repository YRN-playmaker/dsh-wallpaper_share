// 验证 visible 过滤：3463520581（保留）+ 3151551777（script 控制的应全部过滤）
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = fileURLToPath(import.meta.url).replace(/\\/g, '/')
const root = here.slice(0, here.lastIndexOf('/_dev/'))
const { buildSceneModel } = await import(pathToFileURL(join(root, 'src/scene/SceneModel.ts')).href)

for (const wid of ['3463520581', '3151551777']) {
  const model = buildSceneModel(new Uint8Array(readFileSync('D:/SteamLibrary/steamapps/workshop/content/431960/' + wid + '/scene.pkg')))
  let ww = 0
  let sh = 0
  let other = 0
  for (const l of model.layers) {
    for (const e of l.effects) {
      if (e.type === 'waterwaves') ww++
      else if (e.type === 'shake') sh++
      else other++
    }
  }
  console.log(wid + ': waterwaves=' + ww + ' shake=' + sh + ' other=' + other)
}
