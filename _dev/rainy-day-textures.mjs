import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { parseScenePkg } from '../src/scene/ScenePkg.ts'
import { decodeTex, texMipToPng } from '../src/scene/SceneTex.ts'
const pkg = parseScenePkg(new Uint8Array(readFileSync('D:/SteamLibrary/steamapps/workshop/content/431960/3465215190/scene.pkg')))
for (const name of ['particle/drop', 'particle/drop_normal', 'particle/normal_splash', 'particle/normal_pinch_rotate',
  'workshop/2446129945/particle/particles 256x1280 blank', 'workshop/2446129945/particle/particles 256x1280N',
  'workshop/3462439536/particle/размытая капля дождя 1', 'particle/misc/wave']) {
  const f = 'D:/SteamLibrary/steamapps/common/wallpaper_engine/assets/materials/' + name + '.tex'
  const bytes = pkg.read('materials/' + name + '.tex') ?? (existsSync(f) ? new Uint8Array(readFileSync(f)) : null)
  if (!bytes) { console.log(name, 'missing'); continue }
  const tex = decodeTex(bytes)
  console.log(name, JSON.stringify({ format: tex.format, tex: [tex.textureWidth, tex.textureHeight], image: [tex.imageWidth, tex.imageHeight] }))
  if (name.includes('normal_pinch') || name.includes('256x1280N')) writeFileSync('_dev/rainy-day-out/' + name.split('/').pop() + '.png', texMipToPng(tex))
}
