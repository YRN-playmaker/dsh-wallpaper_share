// 验证假设：cropoffset = 网格 UV 覆盖纹理区域相对图片中心/左上角的偏移？
// 计算各样本：网格 UV 范围 × 纹理尺寸，与 cropoffset 对比
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

const samples = [
  ['3409595232', 'models/导出初音.json', 'materials/导出初音.tex', '(-220, 434.5)'],
  ['3195212886', 'models/左眉.json', null, '(-41.5, 161)'],
  ['3463520581', 'models/hair back big chunk.json', null, '(-20.5, 290)'],
  ['3463520581', 'models/kirito face.json', null, '(863, 717)'],
  ['3463520581', 'models/main hair back c2.json', null, '(398, 378)'],
  ['3463520581', 'models/asuna body bottom.json', null, '(-845, 220.5)'],
  ['3463520581', 'models/asuna body.json', null, '(233, 241)'],
  ['3463520581', 'models/kirito arm.json', null, '(1102.5, 4)'],
  ['3770263871', 'models/草.json', null, '(1007, 357)'],
]

for (const [id, modelName, texName, cropStr] of samples) {
  const buf = readFileSync('D:/SteamLibrary/steamapps/workshop/content/431960/' + id + '/scene.pkg')
  const pkg = parsePkg(buf)
  const j = Buffer.from(pkg.get(modelName)).toString('utf8')
  const mdl = /"puppet"\s*:\s*"([^"]+)"/.exec(j)
  if (!mdl) { console.log(id + ': no mdl'); continue }
  let pm
  try { pm = parsePuppetMdl(pkg.get(mdl[1])) } catch { console.log(id + ': mdl fail'); continue }
  if (!pm.mesh) { console.log(id + ': no mesh'); continue }
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity
  for (const v of pm.mesh.vertices) {
    if (v.uv[0] < minU) minU = v.uv[0]
    if (v.uv[0] > maxU) maxU = v.uv[0]
    if (v.uv[1] < minV) minV = v.uv[1]
    if (v.uv[1] > maxV) maxV = v.uv[1]
  }
  let tw = 0, th = 0, texInfo = ''
  // 纹理：从 material 找
  const mat = /"material"\s*:\s*"([^"]+)"/.exec(j)
  if (mat) {
    const mj = Buffer.from(pkg.get(mat[1])).toString('utf8')
    const tex = /"textures"\s*:\s*\[\s*"([^"]+)"/.exec(mj)
    if (tex) {
      const t = decodeTex(pkg.get('materials/' + tex[1] + '.tex'))
      if (t) { tw = t.imageWidth || t.textureWidth; th = t.imageHeight || t.textureHeight; texInfo = ' tex=' + tw + 'x' + th }
    }
  }
  console.log(id + ' ' + modelName.replace('models/', '') + ': UV u[' + minU.toFixed(3) + ',' + maxU.toFixed(3) + '] v[' + minV.toFixed(3) + ',' + maxV.toFixed(3) + ']' + texInfo)
  if (tw > 0) {
    console.log('  UV×纹理: x[' + (minU * tw).toFixed(0) + ',' + (maxU * tw).toFixed(0) + '] y[' + (minV * th).toFixed(0) + ',' + (maxV * th).toFixed(0) + ']，中心 (' + ((minU + maxU) / 2 * tw).toFixed(0) + ', ' + ((minV + maxV) / 2 * th).toFixed(0) + ')，图片中心 (' + (tw / 2) + ', ' + (th / 2) + ')')
    console.log('  中心差(UV中心-图片中心): (' + (((minU + maxU) / 2 * tw) - tw / 2).toFixed(1) + ', ' + (((minV + maxV) / 2 * th) - th / 2).toFixed(1) + ')')
  }
  console.log('  cropoffset=' + cropStr)
  console.log()
}
