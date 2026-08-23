// 全样本系统分析：纹理 alpha 内容中心、网格中心、cropoffset 关系
import { readFileSync } from 'node:fs'
import zlib from 'node:zlib'
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

function decodePNG(buf) {
  let pos = 8, w = 0, h = 0, colorType = 0
  const idat = []
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('ascii', pos + 4, pos + 8)
    const data = buf.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); colorType = data[9] }
    else if (type === 'IDAT') idat.push(data)
    pos += 12 + len
  }
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 4 ? 2 : 1
  const stride = w * channels
  const out = new Uint8Array(w * h * 4)
  const prev = new Uint8Array(stride)
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)]
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    const cur = new Uint8Array(stride)
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0
      const b = prev[x]
      const c = x >= channels ? prev[x - channels] : 0
      let v = line[x]
      if (filter === 1) v = (v + a) & 0xff
      else if (filter === 2) v = (v + b) & 0xff
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 0xff
      else if (filter === 4) { const p = a + b - c; const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff }
      cur[x] = v
    }
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4
      if (channels === 4) { out[o] = cur[x * 4]; out[o + 1] = cur[x * 4 + 1]; out[o + 2] = cur[x * 4 + 2]; out[o + 3] = cur[x * 4 + 3] }
      else if (channels === 3) { out[o] = cur[x * 3]; out[o + 1] = cur[x * 3 + 1]; out[o + 2] = cur[x * 3 + 2]; out[o + 3] = 255 }
      else if (channels === 2) { const g = cur[x * 2], al = cur[x * 2 + 1]; out[o] = g; out[o + 1] = g; out[o + 2] = g; out[o + 3] = al }
      else { const g = cur[x]; out[o] = g; out[o + 1] = g; out[o + 2] = g; out[o + 3] = 255 }
    }
    prev.set(cur)
  }
  return { w, h, rgba: out }
}

function alphaCenter(rgba, w, h) {
  let sx = 0, sy = 0, n = 0
  let mnx = w, mny = h, mxx = -1, mxy = -1
  for (let y = 0; y < h; y += 4) {
    for (let x = 0; x < w; x += 4) {
      const a = rgba[(y * w + x) * 4 + 3]
      if (a > 8) {
        sx += x; sy += y; n++
        if (x < mnx) mnx = x
        if (y < mny) mny = y
        if (x > mxx) mxx = x
        if (y > mxy) mxy = y
      }
    }
  }
  return { cx: sx / n, cy: sy / n, mnx, mny, mxx, mxy }
}

const samples = [
  ['3409595232', 'models/导出初音.json'],
  ['3195212886', 'models/左眉.json'],
  ['3463520581', 'models/hair back big chunk.json'],
  ['3463520581', 'models/kirito face.json'],
  ['3463520581', 'models/main hair back c2.json'],
  ['3463520581', 'models/asuna body bottom.json'],
  ['3463520581', 'models/asuna body.json'],
  ['3463520581', 'models/kirito arm.json'],
  ['3770263871', 'models/草.json'],
  ['3759313716', 'models/7.json'],
  ['3759313716', 'models/6.json'],
  ['3759313716', 'models/5.json'],
  ['3759313716', 'models/4.json'],
  ['3759313716', 'models/3.json'],
  ['3759313716', 'models/2.json'],
  ['3759313716', 'models/1.json'],
  ['3759313716', 'models/skırt.json'],
]

for (const [id, modelName] of samples) {
  const buf = readFileSync('D:/SteamLibrary/steamapps/workshop/content/431960/' + id + '/scene.pkg')
  const pkg = parsePkg(buf)
  const j = Buffer.from(pkg.get(modelName)).toString('utf8')
  const crop = /"cropoffset"\s*:\s*"([^"]+)"/.exec(j)
  const mdl = /"puppet"\s*:\s*"([^"]+)"/.exec(j)
  const mat = /"material"\s*:\s*"([^"]+)"/.exec(j)
  if (!mdl) continue
  let pm
  try { pm = parsePuppetMdl(pkg.get(mdl[1])) } catch { continue }
  if (!pm.mesh) continue
  let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity
  for (const v of pm.mesh.vertices) {
    if (v.pos[0] < mnx) mnx = v.pos[0]
    if (v.pos[0] > mxx) mxx = v.pos[0]
    if (v.pos[1] < mny) mny = v.pos[1]
    if (v.pos[1] > mxy) mxy = v.pos[1]
  }
  const gcx = (mnx + mxx) / 2, gcy = (mny + mxy) / 2
  let texInfo = ''
  if (mat) {
    const mj = Buffer.from(pkg.get(mat[1])).toString('utf8')
    const tex = /"textures"\s*:\s*\[\s*"([^"]+)"/.exec(mj)
    if (tex) {
      const t = decodeTex(pkg.get('materials/' + tex[1] + '.tex'))
      if (t && t.mip0 && t.mip0.kind !== 'raw') {
        try {
          const png = decodePNG(t.mip0.data)
          const ac = alphaCenter(png.rgba, png.w, png.h)
          const ccx = ac.cx - png.w / 2
          const ccy = -(ac.cy - png.h / 2)
          texInfo = ' 内容中心(模型空间) (' + ccx.toFixed(0) + ',' + ccy.toFixed(0) + ') 内容范围 x[' + ac.mnx + ',' + ac.mxx + '] y[' + ac.mny + ',' + ac.mxy + ']'
        } catch { texInfo = ' (png fail)' }
      }
    }
  }
  console.log(id.slice(-4) + ' ' + modelName.replace('models/', '').padEnd(22) + ' 网格中心 (' + gcx.toFixed(1) + ',' + gcy.toFixed(1) + ')' + (crop ? ' crop=(' + crop[1] + ')' : ' crop=无') + texInfo)
}
