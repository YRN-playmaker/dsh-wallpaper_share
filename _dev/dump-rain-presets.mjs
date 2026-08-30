/**
 * 导出 3770263871 的粒子预设/材质原文 + WE 引擎资产预设
 */
import { readFileSync, existsSync } from 'node:fs'
import { parseScenePkg } from '../src/scene/ScenePkg.ts'

const file = 'D:/SteamLibrary/steamapps/workshop/content/431960/3770263871/scene.pkg'
const weDir = 'D:/SteamLibrary/steamapps/common/wallpaper_engine'
const pkg = parseScenePkg(new Uint8Array(readFileSync(file)))

const names = [
  'particles/presets/rain_screen.json',
  'particles/presets/shootingstar.json',
  'particles/presets/magic_sparkle.json',
  'particles/workshop/2446129945/Rain2.json',
  'particles/presets/rain_screen_static.json',
  'particles/presets/rain_screen_fast.json',
  'particles/presets/rain_screen_fast_child.json',
]
for (const n of names) {
  const buf = pkg.read(n)
  if (buf === null) { console.log(`### ${n} — NOT IN PKG`); continue }
  console.log(`### ${n} ###`)
  console.log(new TextDecoder().decode(buf))
  console.log()
}

// 引擎资产预设（对比）
for (const n of names) {
  const p = weDir + '/assets/' + n
  if (existsSync(p)) {
    console.log(`### ENGINE ${n} ###`)
    console.log(readFileSync(p, 'utf8'))
    console.log()
  }
}
