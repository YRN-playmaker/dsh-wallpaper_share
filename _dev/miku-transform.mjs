// Miku 图层 transform 详情 + 各图层组合位置自查
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = fileURLToPath(import.meta.url).replace(/\\/g, '/')
const root = here.slice(0, here.lastIndexOf('/_dev/'))
const { buildSceneModel } = await import(pathToFileURL(join(root, 'src/scene/SceneModel.ts')).href)
const m = buildSceneModel(new Uint8Array(readFileSync('D:/SteamLibrary/steamapps/workshop/content/431960/3409595232/scene.pkg')))
for (const l of m.layers) {
  console.log('#' + l.id + ' ' + l.name + ' origin=[' + l.origin.map((n) => n.toFixed(0)) + '] scale=[' + l.scale.map((n) => n.toFixed(2)) + '] size=' + (l.size ? '[' + l.size.join(',') + ']' : 'null') + ' alpha=' + l.alpha)
}
