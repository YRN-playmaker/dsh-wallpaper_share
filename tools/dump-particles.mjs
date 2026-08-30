// 临时诊断工具：dump scene.pkg 中所有粒子层（含完整预设参数）
// 用法：node tools/dump-particles.mjs <scene.pkg> [output.json]
import { readFileSync, writeFileSync } from 'node:fs'
import { buildSceneModel } from '../src/scene/SceneModel.ts'

const pkgPath = process.argv[2]
const outPath = process.argv[3]
const buf = readFileSync(pkgPath)
const model = buildSceneModel(new Uint8Array(buf), {})
if (model === null) {
  console.error('buildSceneModel failed')
  process.exit(1)
}

const particleLayers = model.layers.filter((l) => l.particle !== null)
const report = {
  width: model.width,
  height: model.height,
  particleRateScale: model.particleRateScale,
  particleSizeScale: model.particleSizeScale,
  totalLayers: model.layers.length,
  particleLayers: particleLayers.map((l) => ({
    id: l.id,
    name: l.name,
    origin: l.origin,
    scale: l.scale,
    parent: l.parent,
    particle: l.particle,
  })),
}

const text = JSON.stringify(report, null, 2)
if (outPath !== undefined) {
  writeFileSync(outPath, text)
} else {
  console.log(text)
}
