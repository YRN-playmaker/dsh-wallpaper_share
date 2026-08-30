/**
 * 模拟 /we-sync/asset/texture 路由：对每个粒子纹理名走完整服务端流程
 * （pkg 优先 → 引擎资产 → decodeTex → texMipToPng → spritesheet 元数据）
 */
import { readFileSync, existsSync } from 'node:fs'
import { parseScenePkg } from '../src/scene/ScenePkg.ts'
import { decodeTex, texMipToPng } from '../src/scene/SceneTex.ts'

const weDir = 'D:/SteamLibrary/steamapps/common/wallpaper_engine'
const wallpapers = [
  'D:/SteamLibrary/steamapps/workshop/content/431960/2820050218/scene.pkg',
  'D:/SteamLibrary/steamapps/workshop/content/431960/2865923273/scene.pkg',
  'D:/SteamLibrary/steamapps/workshop/content/431960/3151551777/scene.pkg',
  'D:/SteamLibrary/steamapps/workshop/content/431960/3463520581/scene.pkg',
  'D:/SteamLibrary/steamapps/workshop/content/431960/2439864877/scene.pkg',
]

// 收集所有粒子材质的纹理名（pkg 优先去重）
const texNames = new Set<string>()
for (const file of wallpapers) {
  const pkg = parseScenePkg(new Uint8Array(readFileSync(file)))
  for (const e of pkg.entries) {
    // 粒子材质 json → textures
    if (/^materials\/.*(particle|preset|halo|fog|beam|star|bird|ember|spark|smoke|torch|magic|light|dust|leaves|snow|rain|wind|drop|fire|nature|debris|chromatic)/i.test(e.name) && e.name.endsWith('.json')) {
      try {
        const raw = new TextDecoder().decode(pkg.read(e.name) ?? new Uint8Array())
        const last = raw.lastIndexOf('}')
        let text = raw.slice(0, last + 1).trim()
        if (!text.startsWith('{')) text = '{' + text
        const mat = JSON.parse(text) as { passes?: Array<{ textures?: unknown }> }
        for (const pass of mat.passes ?? []) {
          for (const t of Array.isArray(pass.textures) ? pass.textures : []) {
            if (typeof t === 'string' && t !== '') texNames.add(t)
          }
        }
      } catch { /* skip */ }
    }
  }
}

console.log('unique particle texture names:', texNames.size)
let ok = 0
let fail = 0
for (const name of texNames) {
  // 模拟路由：pkg → engine asset
  let bytes: Uint8Array | null = null
  let source = ''
  for (const file of wallpapers) {
    const pkg = parseScenePkg(new Uint8Array(readFileSync(file)))
    const entry = pkg.entries.find((x) => x.name === 'materials/' + name + '.tex')
    if (entry !== undefined) {
      const buf = readFileSync(file)
      bytes = new Uint8Array(buf.subarray(pkg.dataStart + entry.offset, pkg.dataStart + entry.offset + entry.size))
      source = 'pkg:' + file.split('/').slice(-2, -1)[0]
      break
    }
  }
  if (bytes === null) {
    const p = weDir + '/assets/materials/' + name + '.tex'
    if (!existsSync(p)) {
      console.log(`MISS  ${name}  (pkg 与引擎资产都没有)`)
      fail++
      continue
    }
    bytes = new Uint8Array(readFileSync(p))
    source = 'engine'
  }
  const tex = decodeTex(bytes)
  if (tex === null) {
    console.log(`DECODE-FAIL  ${name}  [${source}]`)
    fail++
    continue
  }
  const png = texMipToPng(tex)
  if (png === null) {
    console.log(`PNG-FAIL  ${name}  [${source}] format=${tex.format} ${tex.textureWidth}x${tex.textureHeight} mip0=${tex.mip0?.kind}`)
    fail++
    continue
  }
  const metaPath = (source === 'engine' ? weDir + '/assets/materials/' + name + '.tex-json' : null)
  let meta = ''
  if (metaPath !== null && existsSync(metaPath)) meta = ' +texjson'
  console.log(`OK    ${name}  [${source}] ${tex.mip0?.width}x${tex.mip0?.height} fmt=${tex.format} ${tex.mip0?.kind}${meta} png=${png.length}B`)
  ok++
}
console.log(`\nOK=${ok} FAIL=${fail}`)
