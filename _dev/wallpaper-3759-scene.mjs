// 3759313716 scene.json：animationlayers 挂载的图层 + 部件层级
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = fileURLToPath(import.meta.url).replace(/\\/g, '/')
const root = here.slice(0, here.lastIndexOf('/_dev/'))
const { buildSceneModel } = await import(pathToFileURL(join(root, 'src/scene/SceneModel.ts')).href)

const model = buildSceneModel(new Uint8Array(readFileSync('D:/SteamLibrary/steamapps/workshop/content/431960/3759313716/scene.pkg')))
console.log('scene ' + model.width + 'x' + model.height + ' layers=' + model.layerCount)
const byId = new Map(model.layers.map((l) => [l.id, l]))
for (const l of model.layers) {
  if (l.animationIds.length === 0 && l.puppet === null && l.kind !== 'particle') continue
  const par = l.parent !== null ? byId.get(l.parent) : undefined
  console.log(
    '#' + l.id + ' ' + l.name +
    ' kind=' + l.kind +
    ' parent=' + (par ? par.name + '(' + par.id + ')' : '-') +
    ' origin=[' + l.origin.map((n) => n.toFixed(1)) + ']' +
    ' anims=[' + l.animationIds.join(',') + ']' +
    ' puppet=' + (l.puppet ? l.puppet.bones.length + 'bones ' + l.puppet.animations.map((a) => a.name + '(' + a.id + ')').join(',') : '-') +
    ' alpha=' + l.alpha
  )
}
