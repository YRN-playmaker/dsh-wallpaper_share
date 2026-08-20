// dump 3463520581 图层模型：kind/origin/scale/size/textureRefs + 场景尺寸
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = fileURLToPath(import.meta.url).replace(/\\/g, '/')
const root = here.slice(0, here.lastIndexOf('/_dev/'))
const { buildSceneModel } = await import(pathToFileURL(join(root, 'src/scene/SceneModel.ts')).href)
const { readFileSync } = await import('node:fs')

const model = buildSceneModel(new Uint8Array(readFileSync('D:/SteamLibrary/steamapps/workshop/content/431960/3463520581/scene.pkg')))
console.log(`scene ${model.width}x${model.height} layers=${model.layerCount} clearColor=${model.clearColor}`)
for (const l of model.layers) {
  console.log(`#${l.id} ${l.name} kind=${l.kind} vis=${l.visible} origin=[${l.origin.map((n) => n.toFixed(1))}] scale=[${l.scale.map((n) => n.toFixed(3))}] size?=${'size' in l} image=${l.image ?? '-'} texRefs=[${l.textureRefs.join(', ')}] decodable=${l.decodableTexture ?? '-'} particle=${l.particle ? l.particle.particleRef : '-'}`)
}
