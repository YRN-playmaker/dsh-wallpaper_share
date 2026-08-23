// 验证 buildSceneModel 的 effects 解析 vs scene.json 原始参数
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = fileURLToPath(import.meta.url).replace(/\\/g, '/')
const root = here.slice(0, here.lastIndexOf('/_dev/'))
const { buildSceneModel } = await import(pathToFileURL(join(root, 'src/scene/SceneModel.ts')).href)

for (const wid of ['3463520581', '3770263871']) {
  const model = buildSceneModel(new Uint8Array(readFileSync('D:/SteamLibrary/steamapps/workshop/content/431960/' + wid + '/scene.pkg')))
  console.log('\n=== ' + wid + ' ===')
  let count = 0
  for (const l of model.layers) {
    if (l.effects.length === 0) continue
    count++
    for (const e of l.effects) {
      if (e.type === 'waterwaves') {
        console.log('#' + l.id + ' ' + l.name + ': ww dir=' + e.direction.toFixed(2) + ' speed=' + e.speed + ' scale=' + e.scale + ' strength=' + e.strength + ' exp=' + e.exponent)
      } else if (e.type !== 'unknown') {
        console.log('#' + l.id + ' ' + l.name + ': ' + e.type + ' ' + JSON.stringify(e).slice(0, 100))
      }
    }
  }
  if (count === 0) console.log('  (no effects)')
}
