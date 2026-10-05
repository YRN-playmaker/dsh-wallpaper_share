// 3258032485：8 个 shake 方向场的实际内容与位移量（按我的实现公式算成"场景像素/屏幕像素"）
import { readFileSync } from 'node:fs'
import { parseScenePkg } from '../src/scene/ScenePkg.ts'
import { buildSceneModel } from '../src/scene/SceneModel.ts'
import { decodeTex } from '../src/scene/SceneTex.ts'
import { shakeOffset } from '../src/client/shake-math.ts'

const id = process.argv[2] ?? '3258032485'
const pkgBuf = new Uint8Array(readFileSync(`D:/SteamLibrary/steamapps/workshop/content/431960/${id}/scene.pkg`))
const pkg = parseScenePkg(pkgBuf)
const model = buildSceneModel(pkgBuf, { particleRateScale: 1, particleSizeScale: 1, effectStrengthScale: 0.6, puppetMeshRender: true })

for (const layer of model.layers) {
  const shakes = layer.effects.filter((e) => e.type === 'shake')
  if (shakes.length === 0) continue
  const size = layer.size
  console.log(`\n=== #${layer.id} ${layer.name}  size=${JSON.stringify(size)}  shake pass=${shakes.length} ===`)
  let totalPx = 0
  shakes.forEach((e, i) => {
    if (e.flow === null) { console.log(`  pass${i}: flow=null（无方向场 → 官方语义位移 0）`); return }
    const b = pkg.read(e.flow.startsWith('materials/') ? e.flow : 'materials/' + e.flow + '.tex')
    if (b === null) { console.log(`  pass${i}: flow 条目缺失 ${e.flow}`); return }
    const tex = decodeTex(b)
    const tw = tex.imageWidth, th = tex.imageHeight
    const px = tex.mip0.rgba
    // 统计 flowMask = (rg-0.498)*2（RG88 解码：y 在 A；R8 解码：rgb=255 → 我们按 y=G 处理）
    const isR8 = px[0] >= 254 && px[1] >= 254 && px[2] >= 254
    let sx = 0, sy = 0, mx = 0, my = 0, n = 0
    for (let p = 0; p < tw * th; p++) {
      const r = px[p * 4]
      const ch1 = isR8 ? px[p * 4 + 1] : px[p * 4 + 3]
      const fx = (r / 255 - 0.498) * 2
      const fy = (ch1 / 255 - 0.498) * 2
      sx += Math.abs(fx); sy += Math.abs(fy)
      if (Math.abs(fx) > mx) mx = Math.abs(fx)
      if (Math.abs(fy) > my) my = Math.abs(fy)
      n++
    }
    const amp = e.strength * e.strength
    // 单 pass 在 offset=1 时的位移（场景像素）
    const dxScene = amp * (sx / n) * size[0]
    const dyScene = amp * (sy / n) * size[1]
    totalPx += Math.hypot(dxScene, dyScene)
    const at = (t) => shakeOffset(t, { speed: e.speed, bounds: e.bounds, friction: e.friction, direction: e.direction, audioProcessing: e.audioProcessing })
    console.log(`  pass${i}: fmt=${tex.format} tex=${tw}x${th} ${isR8 ? 'R8(单通道)' : 'RG88(双通道)'} strength=${e.strength} speed=${e.speed} bounds=${JSON.stringify(e.bounds)} dir=${e.direction}`)
    console.log(`           |flowMask|均值=(${(sx / n).toFixed(3)},${(sy / n).toFixed(3)}) 峰值=(${mx.toFixed(3)},${my.toFixed(3)}) → offset=1 时位移≈(${dxScene.toFixed(1)},${dyScene.toFixed(1)}) 场景px`)
    console.log(`           offset: t=0→${at(0).toFixed(3)} t=0.5→${at(0.5).toFixed(3)} t=1→${at(1).toFixed(3)} t=2→${at(2).toFixed(3)} t=5→${at(5).toFixed(3)}`)
  })
  console.log(`  8 pass 位移量级合计≈${totalPx.toFixed(1)} 场景px（画面 3840 宽；屏幕 1250 宽时约 ${(totalPx * 1250 / 3840).toFixed(1)}px）`)
}
