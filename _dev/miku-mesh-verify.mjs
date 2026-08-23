// Miku 全面验证：纹理格式 + 网格 pos/UV 范围 + 骨骼位置对比
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
  const read = (n) => {
    const e = entries.find((x) => x.name === n)
    if (!e) return null
    return buf.subarray(dataStart + e.offset, dataStart + e.offset + e.size)
  }
  return { read, entries }
}

const pkg = parsePkg(readFileSync('D:/SteamLibrary/steamapps/workshop/content/431960/3409595232/scene.pkg'))
// 纹理
const texEntry = pkg.entries.find((e) => e.name === 'materials/导出初音.tex')
console.log('texture entry: ' + (texEntry ? texEntry.name + ' ' + texEntry.size + 'B' : 'MISSING'))
if (texEntry) {
  const tex = decodeTex(pkg.read('materials/导出初音.tex'))
  console.log('tex: ' + (tex ? tex.textureWidth + 'x' + tex.textureHeight + ' image=' + tex.imageWidth + 'x' + tex.imageHeight + ' fmt=' + tex.format + ' kind=' + (tex.mip0 ? tex.mip0.kind : '?') : 'FAIL'))
}
// 网格
const pm = parsePuppetMdl(pkg.read('models/导出初音_puppet.mdl'))
const mesh = pm.mesh
let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity
let umin = Infinity, umax = -Infinity, vmin = Infinity, vmax = -Infinity
for (const v of mesh.vertices) {
  if (v.pos[0] < mnx) mnx = v.pos[0]
  if (v.pos[1] < mny) mny = v.pos[1]
  if (v.pos[0] > mxx) mxx = v.pos[0]
  if (v.pos[1] > mxy) mxy = v.pos[1]
  if (v.uv[0] < umin) umin = v.uv[0]
  if (v.uv[0] > umax) umax = v.uv[0]
  if (v.uv[1] < vmin) vmin = v.uv[1]
  if (v.uv[1] > vmax) vmax = v.uv[1]
}
console.log('mesh pos: x[' + mnx.toFixed(0) + ',' + mxx.toFixed(0) + '] y[' + mny.toFixed(0) + ',' + mxy.toFixed(0) + ']')
console.log('mesh uv: u[' + umin.toFixed(3) + ',' + umax.toFixed(3) + '] v[' + vmin.toFixed(3) + ',' + vmax.toFixed(3) + ']')
console.log('bones: root=(' + (pm.bones[0].bind ? pm.bones[0].bind[12].toFixed(0) + ',' + pm.bones[0].bind[13].toFixed(0) : 'null') + ')')
// 权重槽分布（骨骼 0-3 使用率）
const wUse = [0, 0, 0, 0]
for (const v of mesh.vertices) {
  for (let i = 0; i < 4; i++) if ((v.weights[i] ?? 0) > 0.01) wUse[i]++
}
console.log('weights usage: ' + wUse.join(',') + ' / ' + mesh.vertices.length)
