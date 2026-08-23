// Miku 3409595232 图层完整 dump：origin/size/纹理尺寸 → 找绑定异常
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = fileURLToPath(import.meta.url).replace(/\\/g, '/')
const root = here.slice(0, here.lastIndexOf('/_dev/'))
const { buildSceneModel } = await import(pathToFileURL(join(root, 'src/scene/SceneModel.ts')).href)

const model = buildSceneModel(new Uint8Array(readFileSync('D:/SteamLibrary/steamapps/workshop/content/431960/3409595232/scene.pkg')))
console.log('scene ' + model.width + 'x' + model.height + ' layers=' + model.layerCount)
const byId = new Map(model.layers.map((l) => [l.id, l]))
for (const l of model.layers) {
  const par = l.parent !== null ? byId.get(l.parent) : undefined
  console.log(
    '#' + l.id + ' ' + l.name +
    ' kind=' + l.kind +
    ' parent=' + (par ? par.name + '(' + par.id + ')' : '-') +
    ' origin=[' + l.origin.map((n) => n.toFixed(0)) + ']' +
    ' size=' + (l.size ? '[' + l.size.join(',') + ']' : 'null') +
    ' tex=' + (l.textureRefs.length ? l.textureRefs[0].split('/').pop() : '-') +
    ' anims=[' + l.animationIds.join(',') + ']' +
    (l.puppet ? ' puppet=' + l.puppet.bones.length + 'b' : '')
  )
}
