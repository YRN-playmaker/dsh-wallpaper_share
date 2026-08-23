// 扫描所有壁纸的 models/*.json，收集 cropoffset/autosize + 网格范围 + 纹理尺寸，反推 cropoffset 语义
import { readFileSync, existsSync, readdirSync } from 'node:fs'
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

const base = 'D:/SteamLibrary/steamapps/workshop/content/431960'
const dirs = readdirSync(base).filter((d) => /^\d+$/.test(d))
for (const d of dirs) {
  const pkgPath = join(base, d, 'scene.pkg')
  if (!existsSync(pkgPath)) continue
  let read
  try { read = parsePkg(readFileSync(pkgPath)) } catch { continue }
  const entries = []
  // 枚举 models/*.json
  let pos = 16
  const buf = readFileSync(pkgPath)
  while (pos + 8 <= buf.length) {
    const nameLen = buf.readInt32LE(pos); pos += 4
    if (nameLen <= 0 || nameLen > 1024 || pos + nameLen + 8 > buf.length) break
    const name = buf.subarray(pos, pos + nameLen).toString('utf8'); pos += nameLen
    const offset = buf.readInt32LE(pos); pos += 4
    const size = buf.readInt32LE(pos); pos += 4
    if (offset < 0 || size < 0 || offset + size > buf.length) break
    if (name.startsWith('models/') && name.endsWith('.json')) entries.push(name)
    pos += 0
  }
  for (const mn of entries) {
    const j = read(mn)
    if (j === null) continue
    const s = Buffer.from(j).toString('utf8')
    if (!s.includes('puppet')) continue
    const crop = /"cropoffset"\s*:\s*"([^"]+)"/.exec(s)
    const autosize = /"autosize"\s*:\s*(true|false)/.exec(s)
    const mdl = /"puppet"\s*:\s*"([^"]+)"/.exec(s)
    if (mdl === null) continue
    let info = ''
    try {
      const pm = parsePuppetMdl(read(mdl[1]))
      if (pm.mesh !== null) {
        let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity
        for (const v of pm.mesh.vertices) {
          if (v.pos[0] < mnx) mnx = v.pos[0]
          if (v.pos[1] < mny) mny = v.pos[1]
          if (v.pos[0] > mxx) mxx = v.pos[0]
          if (v.pos[1] > mxy) mxy = v.pos[1]
        }
        info = ' mesh[' + mnx.toFixed(0) + ',' + mxx.toFixed(0) + ']x[' + mny.toFixed(0) + ',' + mxy.toFixed(0) + ']'
      }
    } catch { info = ' (parse fail)' }
    console.log(d + ' | ' + mn + ' | autosize=' + (autosize ? autosize[1] : '?') + ' | cropoffset=' + (crop ? crop[1] : '无') + info)
  }
}
