// 3766677415：各纹理「画布尺寸 vs 图像尺寸」——检查 shake 层的 rectUv 采样映射是否必要/是否正确
import { readFileSync } from 'node:fs'
import { parseScenePkg } from '../src/scene/ScenePkg.ts'
import { buildSceneModel } from '../src/scene/SceneModel.ts'
import { decodeTex } from '../src/scene/SceneTex.ts'

const pkgBuf = new Uint8Array(readFileSync('D:/SteamLibrary/steamapps/workshop/content/431960/3766677415/scene.pkg'))
const model = buildSceneModel(pkgBuf, { particleRateScale: 1, particleSizeScale: 1, effectStrengthScale: 0.6, puppetMeshRender: true })
const pkg = parseScenePkg(pkgBuf)
for (const layer of model.layers) {
  const eff = layer.effects.map((e) => e.type + (e.type === 'shake' ? '(flow=' + e.flow + ',mask=' + e.mask + ')' : '')).join(',')
  const refs = layer.textureRefs.join(',')
  const lines = []
  for (const r of layer.textureRefs) {
    const b = pkg.read(r)
    if (b === null) { lines.push(r + ': MISSING'); continue }
    const t = decodeTex(b)
    if (t === null) { lines.push(r + ': decode fail'); continue }
    const padded = t.textureWidth !== t.imageWidth || t.textureHeight !== t.imageHeight
    lines.push(`${r}: tex=${t.textureWidth}x${t.textureHeight} img=${t.imageWidth}x${t.imageHeight} fmt=${t.format}${padded ? '  <== 画布有边距' : ''}`)
  }
  console.log(`#${layer.id} ${layer.name}  size=${JSON.stringify(layer.size)}  effects=[${eff}]`)
  for (const l of lines) console.log('    ' + l)
}
