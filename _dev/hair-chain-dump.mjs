// dump 3463520581 头发相关层的完整链：id/name/parent/origin/scale/attachment/animationIds/size
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = fileURLToPath(import.meta.url).replace(/\\/g, '/')
const root = here.slice(0, here.lastIndexOf('/_dev/'))
const { buildSceneModel } = await import(pathToFileURL(join(root, 'src/scene/SceneModel.ts')).href)

const model = buildSceneModel(new Uint8Array(readFileSync('D:/SteamLibrary/steamapps/workshop/content/431960/3463520581/scene.pkg')))
const byId = new Map(model.layers.map((l) => [l.id, l]))
const lines = []
for (const l of model.layers) {
  const par = l.parent !== null ? byId.get(l.parent) : undefined
  lines.push({
    id: l.id,
    name: l.name,
    parent: l.parent !== null ? par ? par.name + '(' + par.id + ')' : String(l.parent) : '-',
    origin: l.origin.map((n) => +n.toFixed(2)),
    scale: l.scale.map((n) => +n.toFixed(3)),
    attach: l.attachment,
    anims: l.animationIds,
    kind: l.kind,
    size: l.size,
  })
}
// 只输出关键层：名称含 hair/asuna/puppet/body/head/kirito 或附件相关
for (const l of lines) {
  const nm = l.name.toLowerCase()
  if (nm.includes('hair') || nm.includes('asuna') || nm.includes('puppet') || nm.includes('head') || nm.includes('kirito') || nm.includes('body') || l.attach) {
    console.log(JSON.stringify(l))
  }
}
console.log('scene ' + model.width + 'x' + model.height)
