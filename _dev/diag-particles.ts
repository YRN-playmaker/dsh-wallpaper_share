/**
 * 诊断脚本：用插件自身逻辑解析 scene.pkg，检查粒子加载链路
 * node --experimental-strip-types _dev/diag-particles.ts <scene.pkg>
 */
import { readFileSync, existsSync } from 'node:fs'
import { parseScenePkg, readSceneJson, parseJsonLike } from '../src/scene/ScenePkg.ts'
import { buildSceneModel } from '../src/scene/SceneModel.ts'

const file = process.argv[2] ?? 'D:/SteamLibrary/steamapps/workshop/content/431960/2820050218/scene.pkg'
const weDir = 'D:/SteamLibrary/steamapps/common/wallpaper_engine'

const buf = new Uint8Array(readFileSync(file))
const pkg = parseScenePkg(buf)
console.log('pkg entries:', pkg.entries.length, 'version:', pkg.version)

const scene = readSceneJson(pkg)
const objects = Array.isArray((scene as { objects?: unknown }).objects) ? (scene as { objects?: unknown }).objects as Record<string, unknown>[] : []
console.log('scene objects:', objects.length)

// 找出带 particle 字段的对象
const particleObjs = objects.filter((o) => typeof o.particle === 'string')
console.log('\n=== 带 particle 字段的对象:', particleObjs.length, '===')
for (const o of particleObjs) {
  const ref = o.particle as string
  const inPkg = pkg.has(ref)
  console.log(`\nlayer id=${o.id} name=${o.name} particle="${ref}" pkgHas=${inPkg}`)
  if (!inPkg) {
    // 引擎资产里找
    const enginePath = weDir + '/assets/' + ref
    console.log(`  NOT IN PKG! engine asset exists: ${existsSync(enginePath)} (${enginePath})`)
    // pkg 里相近条目
    const base = ref.split('/').pop()
    const similar = pkg.entries.filter((e) => e.name.includes(base ?? '???')).map((e) => e.name)
    console.log('  pkg similar entries:', JSON.stringify(similar.slice(0, 10)))
    continue
  }
  // 解析预设，看 material
  const preset = parseJsonLike(pkg.read(ref) as Uint8Array) as Record<string, unknown>
  const matRef = typeof preset.material === 'string' ? preset.material : ''
  const matInPkg = matRef !== '' && pkg.has(matRef)
  console.log(`  preset material="${matRef}" pkgHas=${matInPkg} maxcount=${preset.maxcount} starttime=${preset.starttime}`)
  if (!matInPkg && matRef !== '') {
    const engineMat = weDir + '/assets/' + matRef
    console.log(`  MATERIAL NOT IN PKG! engine exists: ${existsSync(engineMat)}`)
  }
  // 纹理
  const children = Array.isArray(preset.children) ? preset.children : []
  const walk = (pref: Record<string, unknown>, depth: number): void => {
    const m = typeof pref.material === 'string' ? pref.material : ''
    if (m !== '' && pkg.has(m)) {
      const mat = parseJsonLike(pkg.read(m) as Uint8Array) as { passes?: Array<{ textures?: unknown; blending?: string }> }
      for (const pass of mat.passes ?? []) {
        const texs = Array.isArray(pass.textures) ? pass.textures : []
        for (const t of texs) {
          if (typeof t !== 'string') continue
          const pkgTex = pkg.has('materials/' + t + '.tex')
          const engineTex = existsSync(weDir + '/assets/materials/' + t + '.tex')
          console.log(`${'  '.repeat(depth + 1)}tex "${t}" pkg=${pkgTex} engine=${engineTex}${!pkgTex && !engineTex ? '  ← MISSING!' : ''}`)
        }
      }
    }
    for (const c of (Array.isArray(pref.children) ? pref.children : []) as Array<Record<string, unknown>>) {
      const cn = c.name as string
      if (typeof cn !== 'string') continue
      const ok = pkg.has(cn)
      if (!ok) {
        console.log(`${'  '.repeat(depth + 1)}child "${cn}" NOT IN PKG! engine: ${existsSync(weDir + '/assets/' + cn)}`)
        continue
      }
      walk(parseJsonLike(pkg.read(cn) as Uint8Array) as Record<string, unknown>, depth + 1)
    }
  }
  walk(preset, 0)
}

// 完整 buildSceneModel 验证
const model = buildSceneModel(buf)
console.log('\n=== buildSceneModel ===')
console.log('layers:', model?.layerCount)
const particleLayers = model?.layers.filter((l) => l.particle !== null) ?? []
console.log('layers with particle desc:', particleLayers.length)
for (const l of particleLayers) {
  const collect: string[] = []
  const walkDesc = (d: NonNullable<typeof l.particle>): void => {
    collect.push(`${d.particleRef}(tex:${d.textureNames.length},rate:${d.emitter.rate},max:${d.maxCount},blend:${d.blending})`)
    for (const c of d.children) walkDesc(c)
  }
  if (l.particle !== null) walkDesc(l.particle)
  console.log(`layer #${l.id} "${l.name}" visible=${l.visible}: ${collect.join(' + ')}`)
}
