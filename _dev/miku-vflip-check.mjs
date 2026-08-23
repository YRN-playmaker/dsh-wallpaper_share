// 自检：网格顶部/底部顶点的 UV 采样区域（判断 v 翻转方向）
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = fileURLToPath(import.meta.url).replace(/\\/g, '/')
const root = here.slice(0, here.lastIndexOf('/_dev/'))
const { parsePuppetMdl } = await import(pathToFileURL(join(root, 'src/scene/ScenePuppet.ts')).href)
const pkgBuf = readFileSync('D:/SteamLibrary/steamapps/workshop/content/431960/3409595232/scene.pkg')
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
const pkg = parsePkg(pkgBuf)
const pm = parsePuppetMdl(pkg.read('models/导出初音_puppet.mdl'))
const mesh = pm.mesh
// 顶点按 pos y 排序
const sorted = mesh.vertices.map((v, i) => ({ i, y: v.pos[1], u: v.uv[0], vv: v.uv[1], x: v.pos[0] })).sort((a, b) => b.y - a.y)
console.log('顶部 10 顶点（pos y 最大）:')
for (const v of sorted.slice(0, 10)) console.log('  pos=(' + v.x.toFixed(0) + ',' + v.y.toFixed(0) + ') uv=(' + v.u.toFixed(3) + ',' + v.vv.toFixed(3) + ')')
console.log('底部 10 顶点（pos y 最小）:')
for (const v of sorted.slice(-10)) console.log('  pos=(' + v.x.toFixed(0) + ',' + v.y.toFixed(0) + ') uv=(' + v.u.toFixed(3) + ',' + v.vv.toFixed(3) + ')')
// 头部顶点（y 最大区域）的 v 均值
const topV = sorted.slice(0, 100).reduce((s, v) => s + v.vv, 0) / 100
const botV = sorted.slice(-100).reduce((s, v) => s + v.vv, 0) / 100
console.log('顶部 100 顶点 v 均值=' + topV.toFixed(3) + ' 底部 100 顶点 v 均值=' + botV.toFixed(3))
// 立绘人物：如果头部在立绘上部（v 小），顶部网格应采样 v 小 → 不翻（v 直接用）
// 如果顶部采样 v 大 → 需要 v' = 1 - v
console.log(topV < 0.5 ? '→ 顶部采样立绘上部（v 小）：v 不翻转' : '→ 顶部采样立绘下部（v 大）：v 需要翻转')
