// 3766677415（漫画文字框 / 车窗 壁纸）scene.json：图层 + 效果参数调查
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const PKG = 'D:/SteamLibrary/steamapps/workshop/content/431960/3766677415/scene.pkg'
const OUT = resolve(import.meta.dirname, 'w3766-out')

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
  return { magic: magicLen, entries, read: (n) => { const e = entries.find((x) => x.name === n); return e === undefined ? null : buf.subarray(dataStart + e.offset, dataStart + e.offset + e.size) } }
}
import { mkdirSync } from 'node:fs'
mkdirSync(OUT, { recursive: true })
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
L.push(`objects=${objs.length}`)
objs.forEach((o, i) => {
  const eff = (o.effects ?? []).map((e) => e.name + '(' + String(e.file).split('/').slice(-2)[0] + ')').join(',')
  L.push(`#${i} id=${o.id} ${JSON.stringify(o.name)} image=${JSON.stringify(o.image ?? null)} alpha=${o.alpha ?? '-'} effects=[${eff}]`)
  for (const e of o.effects ?? []) {
    const p = (e.passes ?? [])[0] ?? {}
    L.push('    file=' + e.file + ' visible=' + JSON.stringify(e.visible))
    L.push('    combos=' + JSON.stringify(p.combos ?? {}) + ' csv=' + JSON.stringify(p.constantshadervalues ?? {}))
    L.push('    textures=' + JSON.stringify(p.textures ?? []))
  }
})
writeFileSync(resolve(OUT, 'layers.txt'), L.join('\n'), 'utf8')
console.log('layers.txt written; objects=' + objs.length)
const shakeRefs = (raw.match(/effects\/shake/g) ?? []).length
const wwRefs = (raw.match(/effects\/waterwaves/g) ?? []).length
console.log('shake refs=' + shakeRefs + ' waterwaves refs=' + wwRefs)
const maskEntries = pkg.entries.filter((e) => /masks|texture/i.test(e.name)).map((e) => e.name)
console.log('mask-ish entries: ' + maskEntries.slice(0, 40).join(', '))
