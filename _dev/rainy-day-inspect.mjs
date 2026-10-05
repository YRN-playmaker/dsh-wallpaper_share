import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { parseScenePkg, readSceneJson } from '../src/scene/ScenePkg.ts'
import { buildSceneModel } from '../src/scene/SceneModel.ts'
const bytes = new Uint8Array(readFileSync('D:/SteamLibrary/steamapps/workshop/content/431960/3465215190/scene.pkg'))
const pkg = parseScenePkg(bytes), scene = readSceneJson(pkg)
const model = buildSceneModel(bytes, { particleRateScale: 1, particleSizeScale: 1, effectStrengthScale: 0.6, puppetMeshRender: true })
mkdirSync('_dev/rainy-day-out', { recursive: true })
writeFileSync('_dev/rainy-day-out/scene.json', JSON.stringify(scene, null, 2), 'utf8')
writeFileSync('_dev/rainy-day-out/model.json', JSON.stringify(model, null, 2), 'utf8')
console.log('scene', model.width, model.height, 'layers', model.layers.length)
for (const l of model.layers) {
  console.log(JSON.stringify({ id: l.id, name: l.name, kind: l.kind, visible: l.visible, alpha: l.alpha,
    origin: l.origin, scale: l.scale, size: l.size, effects: l.effects, particle: l.particle }))
}
for (const e of pkg.entries) {
  if (e.name.endsWith('.json') && /rain|drop|particle|effect|material/i.test(e.name)) {
    console.log('\nENTRY ' + e.name + '\n' + new TextDecoder().decode(pkg.read(e.name)))
  }
}
