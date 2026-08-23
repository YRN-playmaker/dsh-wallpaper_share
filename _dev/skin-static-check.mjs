// 静态蒙皮判据：raw vs 蒙皮（Σ w × bind_i × pos）包围盒对比
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
  const read = (n) => {
    const e = entries.find((x) => x.name === n)
    if (!e) return null
    return buf.subarray(dataStart + e.offset, dataStart + e.offset + e.size)
  }
  return { read }
}

function bounds(pts) {
  let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity
  for (const p of pts) {
    if (p[0] < mnx) mnx = p[0]
    if (p[0] > mxx) mxx = p[0]
    if (p[1] < mny) mny = p[1]
    if (p[1] > mxy) mxy = p[1]
  }
  return { mnx, mny, mxx, mxy, w: mxx - mnx, h: mxy - mny }
}

for (const [wid, mdlName, label] of [
  ['3463520581', 'models/asuna body_puppet.mdl', 'asuna（raw 对）'],
  ['3409595232', 'models/导出初音_puppet.mdl', 'miku（raw 炸？）'],
]) {
  const pkg = parsePkg(readFileSync('D:/SteamLibrary/steamapps/workshop/content/431960/' + wid + '/scene.pkg'))
  const pm = parsePuppetMdl(pkg.read(mdlName))
  const mesh = pm.mesh
  const raw = mesh.vertices.map((v) => [v.pos[0], v.pos[1]])
  // 静态蒙皮：skinPos = Σ w_i × bind_i × [pos,1]
  const skin = mesh.vertices.map((v) => {
    let x = 0, y = 0
    for (let w = 0; w < 4; w++) {
      const wt = v.weights[w] ?? 0
      if (wt === 0 || w >= pm.bones.length) continue
      const M = pm.bones[w].bind ?? pm.bones[w].pose
      if (!M) continue
      x += wt * (M[0] * v.pos[0] + M[4] * v.pos[1] + M[8] * v.pos[2] + M[12])
      y += wt * (M[1] * v.pos[0] + M[5] * v.pos[1] + M[9] * v.pos[2] + M[13])
    }
    return [x, y]
  })
  const rb = bounds(raw)
  const sb = bounds(skin)
  console.log('\n' + label)
  console.log('  raw:   x[' + rb.mnx.toFixed(0) + ',' + rb.mxx.toFixed(0) + '] y[' + rb.mny.toFixed(0) + ',' + rb.mxy.toFixed(0) + '] w=' + rb.w.toFixed(0) + ' h=' + rb.h.toFixed(0))
  console.log('  skin:  x[' + sb.mnx.toFixed(0) + ',' + sb.mxx.toFixed(0) + '] y[' + sb.mny.toFixed(0) + ',' + sb.mxy.toFixed(0) + '] w=' + sb.w.toFixed(0) + ' h=' + sb.h.toFixed(0))
  console.log('  skin 相对 raw: w ' + (sb.w / rb.w).toFixed(2) + 'x, h ' + (sb.h / rb.h).toFixed(2) + 'x')
}
