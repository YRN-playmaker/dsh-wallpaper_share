// 验证 isSpritesheetTex 门控：仅对声明 spritesheet 材质的纹理返回 true
// 模拟 index.ts 的 isSpritesheetTex 逻辑
import { parseScenePkg } from '../src/scene/ScenePkg.ts'
import fs from 'fs'
import type { ParsedPkg } from '../src/scene/ScenePkg.ts'function isSpritesheetTex(pkg: ParsedPkg, texEntryName: string): boolean {
  let base = texEntryName.replace(/^materials\//, '').replace(/\.(tex|png|jpe?g)$/i, '')
  if (base === texEntryName) base = texEntryName
  for (const e of pkg.entries) {
    if (!e.name.startsWith('materials/') || !e.name.endsWith('.json')) continue
    try {
      const buf = pkg.read(e.name)
      if (buf === null) continue
      const text = Buffer.from(buf).toString('utf8')
      if (!/"spritesheet"\s*:\s*[1-9]/.test(text)) continue
      const texBase = new Set<string>()
      for (const m of text.matchAll(/"textures"\s*:\s*\[\s*([^\]]*)\]/g)) {
        for (const tm of m[1].matchAll(/"([^"]+)"/g)) {
          texBase.add(tm[1].replace(/\.(tex|png|jpe?g)$/i, ''))
        }
      }
      if (texBase.has(base)) return true
    } catch {}
  }
  return false
}
const workshop = 'D:/SteamLibrary/steamapps/workshop/content/431960'
// 测试壁纸
const cases = [
  { dir: '2164591875', tex: 'materials/a26caf8007678c9c489207faf8230ac6.tex', expect: true },
  { dir: '2164591875', tex: 'materials/h8hsv5S.tex', expect: true },
  { dir: '2587542891', tex: 'materials/1.tex', expect: false },
  { dir: '2735475644', tex: 'materials/river _ 1041uuu on Patreon.tex', expect: false },
  { dir: '3363252053', tex: 'materials/合成 1_00000.tex', expect: false },
  { dir: '3577990983', tex: 'materials/合成 1_00004.tex', expect: false },
  { dir: '2022733184', tex: 'materials/star1_strip32.tex', expect: true },
  { dir: '2325500626', tex: 'materials/Pixel Bonfire.tex', expect: true },
  { dir: '3774904326', tex: 'materials/workshop/3732231168/dayNightToggleSprite.tex', expect: true },
  { dir: '1438064333', tex: 'materials/a1041uuu_02.tex', expect: true },
]
let pass = 0
for (const c of cases) {
  const pkgPath = workshop + '/' + c.dir + '/scene.pkg'
  if (!fs.existsSync(pkgPath)) { console.log('SKIP ' + c.dir + ' (no pkg)'); continue }
  const pkg = parseScenePkg(new Uint8Array(fs.readFileSync(pkgPath)))
  const got = isSpritesheetTex(pkg, c.tex)
  const ok = got === c.expect
  if (ok) pass++
  console.log((ok ? 'PASS' : 'FAIL') + ' ' + c.dir + ' ' + c.tex + ' expect=' + c.expect + ' got=' + got)
}
console.log('\n通过: ' + pass + '/' + cases.length)
