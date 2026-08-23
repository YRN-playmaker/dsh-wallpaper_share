// 检查 3463520581：完整图层列表 + ASUNA PUPPET 纹理/网格
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
  return (n) => { const e = entries.find((x) => x.name === n); if (!e) return null; return buf.subarray(dataStart + e.offset, dataStart + e.offset + e.size) }
}

const read = parsePkg(readFileSync('D:/SteamLibrary/steamapps/workshop/content/431960/3463520581/scene.pkg'))
console.log('=== ASUNA PUPPET 材质 ===')
const mat = Buffer.from(read('materials/puppet.json')).toString('utf8')
console.log(mat)
const texM = /"textures"\s*:\s*\[\s*"([^"]+)"/.exec(mat)
if (texM) {
  const t = decodeTex(read('materials/' + texM[1] + '.tex'))
  if (t) console.log('纹理: 画布 ' + t.textureWidth + 'x' + t.textureHeight + ' image ' + t.imageWidth + 'x' + t.imageHeight + ' kind=' + t.mip0.kind)
}
console.log('=== ASUNA PUPPET 网格 ===')
const pm = parsePuppetMdl(read('models/puppet_puppet.mdl'))
console.log('骨骼: ' + pm.bones.length + ' 动画: ' + pm.animations.length + ' 网格: ' + (pm.mesh ? pm.mesh.vertices.length + 'v/' + pm.mesh.indices.length + 'i' : 'null'))
if (pm.mesh) {
  let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity
  for (const v of pm.mesh.vertices) {
    if (v.pos[0] < mnx) mnx = v.pos[0]
    if (v.pos[0] > mxx) mxx = v.pos[0]
    if (v.pos[1] < mny) mny = v.pos[1]
    if (v.pos[1] > mxy) mxy = v.pos[1]
    if (v.uv[0] < minU) minU = v.uv[0]
    if (v.uv[0] > maxU) maxU = v.uv[0]
    if (v.uv[1] < minV) minV = v.uv[1]
    if (v.uv[1] > maxV) maxV = v.uv[1]
  }
  console.log('网格范围: x[' + mnx.toFixed(1) + ',' + mxx.toFixed(1) + '] y[' + mny.toFixed(1) + ',' + mxy.toFixed(1) + '] UV u[' + minU.toFixed(3) + ',' + maxU.toFixed(3) + '] v[' + minV.toFixed(3) + ',' + maxV.toFixed(3) + ']')
}
console.log()
console.log('=== 完整图层列表（name + image + size）===')
const scene = Buffer.from(read('scene.json')).toString('utf8')
const re = /"image"\s*:\s*"([^"]+)"[\s\S]*?"name"\s*:\s*"([^"]*)"[\s\S]*?"origin"\s*:\s*"([^"]+)"[\s\S]*?"size"\s*:\s*"([^"]+)"/g
let m
let n = 0
while ((m = re.exec(scene)) !== null && n < 60) {
  const j = read(m[1])
  const hasPuppet = j !== null && Buffer.from(j).toString('utf8').includes('puppet')
  const jj = read(m[1])
  let texInfo = ''
  if (jj !== null) {
    const mj = Buffer.from(jj).toString('utf8')
    const tm = /"material"\s*:\s*"([^"]+)"/.exec(mj)
    if (tm) {
      const mm = read(tm[1])
      if (mm !== null) {
        const mmj = Buffer.from(mm).toString('utf8')
        const tx = /"textures"\s*:\s*\[\s*"([^"]+)"/.exec(mmj)
        if (tx) texInfo = ' tex=' + tx[1]
      }
    }
  }
  console.log((n++) + ': ' + m[2] + ' | ' + m[1] + (hasPuppet ? ' [PUPPET]' : '') + ' | size=(' + m[4] + ')' + texInfo)
}
