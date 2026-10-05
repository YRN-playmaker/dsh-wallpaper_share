// 3258032485 的图层纹理：条目尺寸/格式、解码耗时、PNG 大小（判断浏览器端加载失败的原因）
import { readFileSync } from 'node:fs'
import { parseScenePkg } from '../src/scene/ScenePkg.ts'
import { buildSceneModel } from '../src/scene/SceneModel.ts'
import { decodeTex, texMipToPng } from '../src/scene/SceneTex.ts'

const id = process.argv[2] ?? '3258032485'
const t0 = Date.now()
const pkgBuf = new Uint8Array(readFileSync(`D:/SteamLibrary/steamapps/workshop/content/431960/${id}/scene.pkg`))
console.log('pkg bytes=' + pkgBuf.length + ' read+parse ' + (Date.now() - t0) + 'ms')
const pkg = parseScenePkg(pkgBuf)
const model = buildSceneModel(pkgBuf, { particleRateScale: 1, particleSizeScale: 1, effectStrengthScale: 0.6, puppetMeshRender: true })
for (const layer of model.layers) {
  console.log(`#${layer.id} ${layer.name} textureRefs=${JSON.stringify(layer.textureRefs)} decodable=${layer.decodableTexture}`)
  for (const ref of layer.textureRefs) {
    const t1 = Date.now()
    const bytes = pkg.read(ref)
    if (bytes === null) { console.log('  ' + ref + ': 条目不存在'); continue }
    const tex = decodeTex(bytes)
    const t2 = Date.now()
    if (tex === null) { console.log(`  ${ref}: decodeTex 失败（${bytes.length}B, ${t2 - t1}ms）`); continue }
    console.log(`  ${ref}: 条目=${bytes.length}B fmt=${tex.format} tex=${tex.textureWidth}x${tex.textureHeight} img=${tex.imageWidth}x${tex.imageHeight} mips=${tex.mipCount} kind=${tex.mip0?.kind} padding=${tex.mip0?.data.length} 解码${t2 - t1}ms`)
    if (tex.mip0?.kind === 'raw') {
      const png = texMipToPng(tex)
      const t3 = Date.now()
      console.log(`    → PNG ${png === null ? 'NULL（失败）' : (png.length / 1048576).toFixed(1) + 'MB'} 编码+解码共 ${t3 - t1}ms`)
    } else {
      console.log('    → 内嵌图片，原样伺服 ' + (tex.mip0?.data.length ?? 0) + 'B')
    }
  }
}
