// 3258032485 的 8 张 shake 方向场：逐通道统计 + 放大导出可视化（判断通道语义与量级）
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseScenePkg } from '../src/scene/ScenePkg.ts'
import { buildSceneModel } from '../src/scene/SceneModel.ts'
import { decodeTex } from '../src/scene/SceneTex.ts'
import { encodePng } from './png-encode.mjs'

const id = process.argv[2] ?? '3258032485'
const OUT = resolve(import.meta.dirname, `w${id}-out`)
const pkgBuf = new Uint8Array(readFileSync(`D:/SteamLibrary/steamapps/workshop/content/431960/${id}/scene.pkg`))
const pkg = parseScenePkg(pkgBuf)
const model = buildSceneModel(pkgBuf, { particleRateScale: 1, particleSizeScale: 1, effectStrengthScale: 0.6, puppetMeshRender: true })
const flows = []
for (const layer of model.layers) for (const e of layer.effects) if (e.type === 'shake' && e.flow !== null && !flows.includes(e.flow)) flows.push(e.flow)

const lines = []
flows.forEach((name, idx) => {
  const b = pkg.read(name.startsWith('materials/') ? name : 'materials/' + name + '.tex')
  if (b === null) { lines.push(name + ': 缺失'); return }
  const tex = decodeTex(b)
  const { imageWidth: w, imageHeight: h } = tex
  const px = tex.mip0.rgba
  const stat = [0, 1, 2, 3].map((c) => {
    let mn = 255, mx = 0, sum = 0
    for (let p = 0; p < w * h; p++) { const v = px[p * 4 + c]; if (v < mn) mn = v; if (v > mx) mx = v; sum += v }
    return `ch${c}: min=${mn} max=${mx} mean=${(sum / (w * h)).toFixed(1)}`
  })
  lines.push(`${name}  fmt=${tex.format} ${w}x${h}`)
  lines.push('   ' + stat.join('  '))
  // 可视化：把「与 127 的偏差」放大 6 倍（R→红、G→绿、A→蓝），中性处为黑
  const vis = new Uint8ClampedArray(w * h * 4)
  for (let p = 0; p < w * h; p++) {
    const r = (px[p * 4] - 127) * 6
    const g = (px[p * 4 + 1] - 127) * 6
    const a = (px[p * 4 + 3] - 127) * 6
    vis[p * 4] = Math.max(0, r); vis[p * 4 + 1] = Math.max(0, g); vis[p * 4 + 2] = Math.max(0, a); vis[p * 4 + 3] = 255
    if (r < 0) vis[p * 4 + 1] = Math.max(0, g)
  }
  writeFileSync(resolve(OUT, `flow-vis-${idx}.png`), encodePng(vis, w, h))
})
lines.push('')
lines.push('可视化文件：flow-vis-N.png（与 127 的偏差 ×6：红=R通道 绿=G通道 蓝=A通道）')
writeFileSync(resolve(OUT, 'flows.txt'), lines.join('\n'), 'utf8')
console.log(lines.join('\n'))
