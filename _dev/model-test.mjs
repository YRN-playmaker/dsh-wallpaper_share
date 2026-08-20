// 验证 buildSceneModel 对真实 scene.pkg 的输出
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { join } from 'node:path'

const here = fileURLToPath(import.meta.url).replace(/\\/g, '/')
const root = here.slice(0, here.lastIndexOf('/_dev/'))
const { buildSceneModel } = await import(pathToFileURL(join(root, 'src/scene/SceneModel.ts')).href)

const WS = 'D:/SteamLibrary/steamapps/workshop/content/431960'
const SCENES = ['904233689', '2865923273', '1516043085', '2627185285', '2125735009', '3151551777', '2804379697', '3463520581']

let ok = 0
for (const id of SCENES) {
  try {
    const buf = readFileSync(join(WS, id, 'scene.pkg'))
    const m = buildSceneModel(new Uint8Array(buf))
    if (m === null) { console.log(id, '-> NULL'); continue }
    ok++
    console.log('===== ' + id + ' =====')
    console.log('  size:', m.width + 'x' + m.height, 'camera:', JSON.stringify(m.camera.center), 'clear:', m.clearColor ? m.clearColor.join(',') : null)
    console.log('  layers:', m.layerCount, '| textures:', m.textures.length, '| decodable textures:', m.decodableTextureCount)
    const imageLayers = m.layers.filter((l) => l.kind === 'image')
    const withTex = imageLayers.filter((l) => l.textureRefs.length > 0)
    console.log('  image layers:', imageLayers.length, '| with resolved texture refs:', withTex.length, '| decodable:', imageLayers.filter((l) => l.decodableTexture).length)
    for (const l of imageLayers.slice(0, 4)) {
      console.log('    layer:', JSON.stringify({ name: l.name, origin: l.origin, angles: l.angles, scale: l.scale, visible: l.visible, image: l.image, tex: l.textureRefs.slice(0, 2), dec: l.decodableTexture }))
    }
  } catch (e) {
    console.log(id, '-> ERROR', e.message)
  }
}
console.log('\nbuildSceneModel OK:', ok + '/' + SCENES.length)
process.exit(ok === SCENES.length ? 0 : 1)
