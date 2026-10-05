// 通用 scene.pkg 结构转储：图层 + 效果参数 + 模型 json（用于定位"缺失的效果类型"）
// 用法：node _dev/wl-dump.mjs <workshopId> [outName]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const id = process.argv[2] ?? '3258032485'
const outName = process.argv[3] ?? ('w' + id + '-out')
const PKG = `D:/SteamLibrary/steamapps/workshop/content/431960/${id}/scene.pkg`
const OUT = resolve(import.meta.dirname, outName)
mkdirSync(OUT, { recursive: true })

function parsePkg(buf) {
  let pos = 0
  const i32 = () => { const v = buf.readInt32LE(pos); pos += 4; return v }
  const magicLen = i32(); pos += magicLen; pos += 4
  const entries = []
  for (;;) {
    if (pos + 8 > buf.length) break
    const nameLen = buf.readInt32LE(pos); pos += 4
    if (nameLen <= 0 || nameLen > 2048 || pos + nameLen + 8 > buf.length) break
    const name = buf.subarray(pos, pos + nameLen).toString('utf8'); pos += nameLen
    const offset = buf.readInt32LE(pos); pos += 4
    const size = buf.readInt32LE(pos); pos += 4
    if (offset < 0 || size < 0 || offset + size > buf.length) break
    entries.push({ name, offset, size })
  }
  const dataStart = pos
  return { entries, read: (n) => { const e = entries.find((x) => x.name === n); return e === undefined ? null : buf.subarray(dataStart + e.offset, dataStart + e.offset + e.size) } }
}
const pkg = parsePkg(readFileSync(PKG))
const raw = pkg.read('scene.json').toString('utf8')
writeFileSync(resolve(OUT, 'scene.json.txt'), raw, 'utf8')
let scene
{
  const last = (() => { let inStr = false, esc = false, lastB = -1; for (let i = 0; i < raw.length; i++) { const c = raw[i]; if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false } else if (c === '"') inStr = true; else if (c === '}') lastB = i } return lastB })()
  let text = raw.slice(0, last + 1).trim()
  if (!text.startsWith('{')) text = '{' + text
  scene = JSON.parse(text)
}
const objs = scene.objects ?? []
const L = []
L.push(`objects=${objs.length} general=${JSON.stringify(scene.general ?? {}).slice(0, 300)}`)
L.push('')
objs.forEach((o, i) => {
  const eff = (o.effects ?? []).map((e) => e.name + '|' + String(e.file)).join(', ')
  L.push(`#${i} id=${o.id} ${JSON.stringify(o.name)} image=${JSON.stringify(o.image ?? null)} size=${JSON.stringify(o.size ?? null)} alpha=${o.alpha ?? '-'} parent=${o.parent ?? '-'} visible=${JSON.stringify(o.visible ?? true)}`)
  if (eff !== '') L.push('    effects: ' + eff)
  for (const e of o.effects ?? []) {
    const p = (e.passes ?? [])[0] ?? {}
    L.push('      file=' + e.file + ' visible=' + JSON.stringify(e.visible))
    L.push('      combos=' + JSON.stringify(p.combos ?? {}))
    L.push('      csv=' + JSON.stringify(p.constantshadervalues ?? {}))
    L.push('      textures=' + JSON.stringify(p.textures ?? []))
  }
  if (o.animationlayers !== undefined) L.push('    animationlayers=' + JSON.stringify(o.animationlayers))
  if (o.particle !== undefined) L.push('    particle=' + JSON.stringify(o.particle))
})
// 效果类型统计 + pkg 内效果/着色器条目
const types = new Map()
for (const o of objs) for (const e of o.effects ?? []) {
  const key = String(e.file)
  types.set(key, (types.get(key) ?? 0) + 1)
}
L.push('')
L.push('=== 效果文件引用计数 ===')
for (const [k, v] of [...types.entries()].sort((a, b) => b[1] - a[1])) L.push(`  ${v}  ${k}`)
L.push('')
L.push('=== pkg 内 effects/ shaders/ models/ ===')
for (const e of pkg.entries) if (/^(effects|shaders|models)\//.test(e.name)) L.push(`  ${String(e.size).padStart(8)}  ${e.name}`)
writeFileSync(resolve(OUT, 'layers.txt'), L.join('\n'), 'utf8')
console.log('written ' + resolve(OUT, 'layers.txt'))
console.log('effect files: ' + [...types.entries()].map(([k, v]) => v + 'x' + k).join('  '))
