// 验证 parent/size/alpha 解析 + 世界变换公式（bug ② 修复）
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = fileURLToPath(import.meta.url).replace(/\\/g, '/')
const root = here.slice(0, here.lastIndexOf('/_dev/'))
const { buildSceneModel } = await import(pathToFileURL(join(root, 'src/scene/SceneModel.ts')).href)

let pass = 0
let fail = 0
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`PASS ${name}`) }
  else { fail++; console.log(`FAIL ${name} ${detail}`) }
}

const model = buildSceneModel(new Uint8Array(readFileSync('D:/SteamLibrary/steamapps/workshop/content/431960/3463520581/scene.pkg')))
const byId = new Map(model.layers.map((l) => [l.id, l]))

// parent / size / alpha 解析
const body = byId.get(122)
check('kirito body parent=34', body.parent === 34, `got ${body.parent}`)
check('kirito body size=1298x1737', body.size && body.size[0] === 1298 && body.size[1] === 1737, `got ${body.size}`)
const puppet = byId.get(34)
check('puppet#34 alpha=0', puppet.alpha === 0, `got ${puppet.alpha}`)
const face = byId.get(126)
check('kirito face parent=34', face.parent === 34, `got ${face.parent}`)
const hairBack = byId.get(134)
check('hair back c2 parent=70 (2 级嵌套)', hairBack.parent === 70, `got ${hairBack.parent}`)
const c2p4 = byId.get(54)
check('c2 part 4 parent=134 (3 级嵌套)', c2p4.parent === 134, `got ${c2p4.parent}`)
const sky = byId.get(1142)
check('sky size=1920x1080', sky.size && sky.size[0] === 1920 && sky.size[1] === 1080, `got ${sky.size}`)
check('sky parent=null', sky.parent === null, `got ${sky.parent}`)

// 世界变换公式复算（与 renderer computeWorldTransforms 同公式；顶层 y 镜像）
function world(l) {
  if (l.parent !== null && byId.has(l.parent)) {
    const p = world(byId.get(l.parent))
    return { ox: p.ox + p.sx * l.origin[0], oy: p.oy - p.sy * l.origin[1], sx: p.sx * (l.scale[0] ?? 1), sy: p.sy * (l.scale[1] ?? 1) }
  }
  return { ox: l.origin[0], oy: model.height - l.origin[1], sx: l.scale[0] ?? 1, sy: l.scale[1] ?? 1 }
}
const wBody = world(body)
check('body 世界位置≈(2578,1047)（y 镜像后）', Math.abs(wBody.ox - 2577.98) < 1 && Math.abs(wBody.oy - 1047.09) < 1, `got ${wBody.ox.toFixed(1)},${wBody.oy.toFixed(1)}`)
const wFace = world(face)
check('face 世界 y≈295（镜像后仍在上方）', Math.abs(wFace.oy - 294.5) < 5, `got ${wFace.oy.toFixed(1)}`)
const legs = byId.get(130)
const wLegs = world(legs)
check('legs 世界 y≈1771（下方）', Math.abs(wLegs.oy - 1771.3) < 5, `got ${wLegs.oy.toFixed(1)}`)
const wLegsX = world(legs)
check('legs 世界 x≈2642（右侧）', Math.abs(wLegsX.ox - 2642) < 5, `got ${wLegsX.ox.toFixed(1)}`)
check('body 世界 scale=1.04', Math.abs(wBody.sx - 1.04) < 0.01, `got ${wBody.sx}`)
// 3 级嵌套：c2p4 (134→70→30)
const wC2p4 = world(c2p4)
check('c2p4 世界 scale=1.045(30)*1(70)*1(134)*1', Math.abs(wC2p4.sx - 1.045) < 0.01, `got ${wC2p4.sx}`)
// 顶层 y 镜像（决定性验证：地面在下、天空居中）
const wSky = world(sky)
check('sky 世界 y≈1085（居中不变）', Math.abs(wSky.oy - 1085.18) < 1, `got ${wSky.oy.toFixed(1)}`)
const terrain = byId.get(361)
const wTerrain = world(terrain)
check('Terrain front 世界 y≈1968（地面在底部）', Math.abs(wTerrain.oy - 1967.9) < 1, `got ${wTerrain.oy.toFixed(1)}`)
const extrabg = byId.get(1152)
const wExtra = world(extrabg)
check('extra bg 世界 y≈1636（地面在下部）', Math.abs(wExtra.oy - 1635.98) < 1, `got ${wExtra.oy.toFixed(1)}`)

const m2 = buildSceneModel(new Uint8Array(readFileSync('D:/SteamLibrary/steamapps/workshop/content/431960/3409595232/scene.pkg')))
const bg = m2.layers.find((l) => l.id === 101)
check('雪花场景背景 size=3840x2160', bg.size && bg.size[0] === 3840 && bg.size[1] === 2160, `got ${bg.size}`)
const miku = m2.layers.find((l) => l.id === 16)
check('雪花场景 Miku size=4862x3288', miku.size && miku.size[0] === 4862 && miku.size[1] === 3288, `got ${miku.size}`)

// 粒子 sizeChanges 解析（1771607909：magic_charge 2 个、vapor1 1 个）
const m3 = buildSceneModel(new Uint8Array(readFileSync('D:/SteamLibrary/steamapps/workshop/content/431960/1771607909/scene.pkg')))
const magic = m3.layers.find((l) => l.particle && l.particle.particleRef === 'particles/presets/magic_charge.json')
check('magic_charge 解析到 2 个 sizechange', magic.particle.operators.sizeChanges && magic.particle.operators.sizeChanges.length === 2, `got ${JSON.stringify(magic.particle.operators.sizeChanges)}`)
const sc0 = magic.particle.operators.sizeChanges[0]
check('sizechange#1 startValue=0 endValue=1 endTime=0.5', sc0.startValue === 0 && sc0.endValue === 1 && sc0.endTime === 0.5, `got ${JSON.stringify(sc0)}`)
const sc1 = magic.particle.operators.sizeChanges[1]
check('sizechange#2 startTime=0.5（保持 1）', sc1.startTime === 0.5 && sc1.startValue === 1 && sc1.endValue === 1, `got ${JSON.stringify(sc1)}`)
const vapor = m3.layers.find((l) => l.particle && l.particle.particleRef === 'particles/presets/vapor1.json')
const vsc = vapor.particle.operators.sizeChanges
check('vapor1 sizechange 0.2→0', vsc && vsc.length === 1 && vsc[0].startValue === 0.2 && vsc[0].endValue === 0 && vsc[0].startTime === 0.5, `got ${JSON.stringify(vsc)}`)
// 雪景（无 sizechange）
const m4 = buildSceneModel(new Uint8Array(readFileSync('D:/SteamLibrary/steamapps/workshop/content/431960/3409595232/scene.pkg')))
const snow = m4.layers.find((l) => l.particle && l.particle.particleRef === 'particles/presets/snowperspective.json')
check('雪景无 sizechange', !snow.particle.operators.sizeChanges, `got ${JSON.stringify(snow.particle.operators.sizeChanges)}`)
check('雪景 emitter 为 boxrandom', snow.particle.emitter.type === 'boxrandom', `got ${snow.particle.emitter.type}`)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
