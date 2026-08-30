// 用真实 scene.pkg 调 buildSceneModel，确认 dayNight 字段是否出现在 2164591875 的图层上
import { buildSceneModel } from '../src/scene/SceneModel.ts'
import fs from 'fs'
const dir = 'D:/SteamLibrary/steamapps/workshop/content/431960/2164591875'
const buf = new Uint8Array(fs.readFileSync(dir + '/scene.pkg'))
const model = buildSceneModel(buf)
if (model === null) { console.log('buildSceneModel FAILED'); process.exit(1) }
console.log('图层数: ' + model.layers.length)
for (const l of model.layers) {
  console.log('id=' + l.id + ' name="' + l.name + '" alpha=' + l.alpha.toString().slice(0, 6) +
    (l.dayNight !== undefined ? ' dayNight=' + JSON.stringify(l.dayNight) : ' (无昼夜)') +
    ' copybg=' + (l.copybackground ?? false) + ' visible=' + l.visible + ' img=' + (l.image ?? '-'))
}
