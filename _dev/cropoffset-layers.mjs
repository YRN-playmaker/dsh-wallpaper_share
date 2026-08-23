// 分析 3759313716 + 3463520581：图层 size/origin ↔ cropoffset ↔ 网格范围 ↔ 纹理尺寸
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = fileURLToPath(import.meta.url).replace(/\\/g, '/')
const root = here.slice(0, here.lastIndexOf('/_dev/'))
const { parsePuppetMdl } = await import(pathToFileURL(join(root, 'src/scene/ScenePuppet.ts')).href)
const { decodeTex } = await import(pathToFileURL(join(root, 'src/scene/SceneTex.ts')).href)

function parsePkg(buf) {
  let pos = 16
  const entries = []
  while (pos + 8 <= buf.length) {
    const nameLen = buf.readInt32LE(pos); pos += 4
    if (nameLen <= 0 || nameLen > 1024 || pos + nameLen + 8 > buf.length) break
    const name = buf.subarray(pos, pos + nameLen).toString('utf8'); pos += nameLen
    const offset = buf.readInt32LE(pos); pos += 4
    const size = buf.readInt32LE(pos); pos += 4
    if (offset < 0 || size < 0 || offset + size > buf.length) break
    entries.push({ name, offset, size })
  }
  const dataStart = pos
  return { entries, get: (n) => { const e = entries.find((x) => x.name === n); if (!e) return null; return buf.subarray(dataStart + e.offset, dataStart + e.offset + e.size) } }
}

function analyze(id) {
  const pkgPath = 'D:/SteamLibrary/steamapps/workshop/content/431960/' + id + '/scene.pkg'
  const buf = readFileSync(pkgPath)
  const pkg = parsePkg(buf)
  const scene = Buffer.from(pkg.get('scene.json')).toString('utf8')
  console.log('========== ' + id + ' ==========')
  // 图层 image 引用 + size/origin
  const imgRe = /"image"\s*:\s*"([^"]+)"/g
  let m
  while ((m = imgRe.exec(scene)) !== null) {
    const imgName = m[1]
    const after = scene.slice(m.index)
    const sizeM = /"size"\s*:\s*"([^"]+)"/.exec(after)
    const originM = /"origin"\s*:\s*"([^"]+)"/.exec(after)
    const nameM = /"name"\s*:\s*"([^"]+)"/.exec(after)
    console.log('图层: image=' + imgName + ' name=' + (nameM ? nameM[1] : '?') + ' size=' + (sizeM ? sizeM[1] : '?') + ' origin=' + (originM ? originM[1] : '?'))
    // 模型 JSON
    const j = Buffer.from(pkg.get(imgName)).toString('utf8')
    const crop = /"cropoffset"\s*:\s*"([^"]+)"/.exec(j)
    const mdlM = /"puppet"\s*:\s*"([^"]+)"/.exec(j)
    const matM = /"material"\s*:\s*"([^"]+)"/.exec(j)
    if (mdlM) {
      try {
        const pm = parsePuppetMdl(pkg.get(mdlM[1]))
        if (pm.mesh) {
          let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity
          for (const v of pm.mesh.vertices) {
            if (v.pos[0] < mnx) mnx = v.pos[0]
            if (v.pos[1] < mny) mny = v.pos[1]
            if (v.pos[0] > mxx) mxx = v.pos[0]
            if (v.pos[1] > mxy) mxy = v.pos[1]
          }
          const cx = (mnx + mxx) / 2, cy = (mny + mxy) / 2
          console.log('  网格: x[' + mnx.toFixed(0) + ',' + mxx.toFixed(0) + '] 中心 ' + cx.toFixed(1) + '，y[' + mny.toFixed(0) + ',' + mxy.toFixed(0) + '] 中心 ' + cy.toFixed(1) + '，宽 ' + (mxx - mnx).toFixed(0) + ' 高 ' + (mxy - mny).toFixed(0))
          console.log('  cropoffset=' + (crop ? crop[1] : '无'))
        }
      } catch (e) { console.log('  mdl parse fail') }
    }
    if (matM) {
      const mat = Buffer.from(pkg.get(matM[1])).toString('utf8')
      const texM = /"textures"\s*:\s*\[\s*"([^"]+)"/.exec(mat)
      if (texM) {
        const tex = decodeTex(pkg.get('materials/' + texM[1] + '.tex'))
        if (tex) console.log('  纹理: 画布 ' + tex.textureWidth + 'x' + tex.textureHeight + ' image ' + tex.imageWidth + 'x' + tex.imageHeight)
      }
    }
  }
}
analyze('3759313716')
analyze('3463520581')
