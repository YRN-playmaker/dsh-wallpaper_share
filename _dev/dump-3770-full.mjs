/**
 * 3770263871 完整粒子相关导出：材质 json、scene.json 图层 origin、tex-json 帧元数据
 */
import { readFileSync, existsSync } from 'node:fs'
import { parseScenePkg, readSceneJson } from '../src/scene/ScenePkg.ts'

const file = 'D:/SteamLibrary/steamapps/workshop/content/431960/3770263871/scene.pkg'
const weDir = 'D:/SteamLibrary/steamapps/common/wallpaper_engine'
const pkg = parseScenePkg(new Uint8Array(readFileSync(file)))

// 1) scene.json 粒子图层 origin/scale/angles
const scene = readSceneJson(pkg)
const objects = Array.isArray((scene as { objects?: unknown }).objects) ? (scene as { objects?: unknown }).objects as Record<string, unknown>[] : []
console.log('=== scene.json 粒子图层 ===')
for (const o of objects) {
  if (typeof o.particle !== 'string') continue
  console.log(`id=${o.id} name=${o.name} origin=${JSON.stringify(o.origin)} scale=${JSON.stringify(o.scale)} angles=${JSON.stringify(o.angles)} parent=${o.parent} visible=${JSON.stringify(o.visible)}`)
}

// 2) 材质原文
console.log('\n=== 材质 ===')
const mats = [
  'materials/presets/rain_screen.json',
  'materials/presets/rain_screen_static.json',
  'materials/presets/rain_screen_fast.json',
  'materials/presets/rain_screen_fast_child.json',
  'materials/presets/magic_sparkle.json',
  'materials/presets/shootingstar.json',
  'materials/presets/shootingstarglow.json',
  'materials/workshop/2446129945/particle/halo_50_1.json',
]
for (const m of mats) {
  const buf = pkg.read(m)
  if (buf === null) { console.log(`# ${m} NOT IN PKG`); continue }
  console.log(`# ${m}`)
  console.log(new TextDecoder().decode(buf))
  console.log()
}

// 3) tex-json 帧元数据（引擎资产）
console.log('=== tex-json ===')
for (const n of ['particle/water/rain_drops_sheet', 'particle/water/rain_drops_sheet_normal', 'particle/sharp_halo', 'particle/sharp_halo_normal', 'particle/drop', 'particle/light/flare_1', 'particle/light/light_shafts_0']) {
  const p = weDir + '/assets/materials/' + n + '.tex-json'
  console.log(`# ${n}: ${existsSync(p) ? readFileSync(p, 'utf8').slice(0, 600) : 'NO TEX-JSON'}`)
  console.log()
}

// 4) 纹理尺寸
console.log('=== 纹理尺寸 ===')
import { decodeTex } from '../src/scene/SceneTex.ts'
for (const n of ['particle/water/rain_drops_sheet', 'particle/drop', 'particle/light/flare_1']) {
  const p = weDir + '/assets/materials/' + n + '.tex'
  if (!existsSync(p)) { console.log(`# ${n} MISSING`); continue }
  const tex = decodeTex(new Uint8Array(readFileSync(p)))
  console.log(`# ${n}: tex=${tex?.textureWidth}x${tex?.textureHeight} img=${tex?.imageWidth}x${tex?.imageHeight} mip0=${tex?.mip0?.width}x${tex?.mip0?.height} fmt=${tex?.format}`)
}
