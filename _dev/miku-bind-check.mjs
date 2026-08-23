// 完整 dump Miku 模型 JSON 原始字节 + MDLS 骨骼 bind 验证
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = fileURLToPath(import.meta.url).replace(/\\/g, '/')
const root = here.slice(0, here.lastIndexOf('/_dev/'))
const { parsePuppetMdl } = await import(pathToFileURL(join(root, 'src/scene/ScenePuppet.ts')).href)

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

const read = parsePkg(readFileSync('D:/SteamLibrary/steamapps/workshop/content/431960/3409595232/scene.pkg'))
const j = read('models/导出初音.json')
console.log('=== models/导出初音.json 原始字节（前 400）===')
console.log(JSON.stringify(Buffer.from(j.subarray(0, 400)).toString('latin1')))
console.log()
const pm = parsePuppetMdl(read('models/导出初音_puppet.mdl'))
console.log('骨骼数: ' + pm.bones.length)
const b0 = pm.bones[0]
console.log('骨骼0: name=' + b0.name + ' parent=' + b0.parent + ' bind=' + JSON.stringify(b0.bind !== undefined ? Array.from(b0.bind) : null))
// 所有骨骼 bind 平移范围
let minTx = Infinity, maxTx = -Infinity, minTy = Infinity, maxTy = -Infinity
for (const b of pm.bones) {
  if (b.bind !== undefined) {
    const tx = b.bind[12], ty = b.bind[13]
    if (tx < minTx) minTx = tx
    if (tx > maxTx) maxTx = tx
    if (ty < minTy) minTy = ty
    if (ty > maxTy) maxTy = ty
  }
}
console.log('bind 平移范围: x[' + minTx + ',' + maxTx + '] y[' + minTy + ',' + maxTy + ']')
console.log('网格顶点范围: x[' + pm.mesh.minX + ',' + pm.mesh.maxX + '] y[' + pm.mesh.minY + ',' + pm.mesh.maxY + ']')
// 蒙皮后范围（每个顶点 × 其权重骨骼的 bind）
if (pm.mesh.vertices.length > 0) {
  let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity
  for (const v of pm.mesh.vertices) {
    let x = v.pos[0], y = v.pos[1]
    if (v.weights !== undefined) {
      let sx = 0, sy = 0
      let wsum = 0
      for (let i = 0; i < 4; i++) {
        const w = v.weights[i] ?? 0
        if (w === 0 || i >= v.boneIndices.length) continue
        const b = pm.bones[v.boneIndices[i]]
        if (b === undefined || b.bind === undefined) continue
        const m = b.bind
        const lx = m[0] * v.pos[0] + m[1] * v.pos[1] + m[3] * v.pos[2] + m[12]
        const ly = m[4] * v.pos[0] + m[5] * v.pos[1] + m[7] * v.pos[2] + m[13]
        sx += w * lx
        sy += w * ly
        wsum += w
      }
      if (wsum > 0) { x = sx; y = sy }
    }
    if (x < mnx) mnx = x
    if (y < mny) mny = y
    if (x > mxx) mxx = x
    if (y > mxy) mxy = y
  }
  console.log('蒙皮后范围: x[' + mnx.toFixed(1) + ',' + mxx.toFixed(1) + '] y[' + mny.toFixed(1) + ',' + mxy.toFixed(1) + ']')
}
