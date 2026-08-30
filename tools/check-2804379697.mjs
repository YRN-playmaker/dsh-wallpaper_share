// 检查 2804379697：图层结构 + 背景图层纹理（是否带 TEXS / spritesheet）
import { decodeTex } from '../src/scene/SceneTex.ts'
import fs from 'fs'
function utf8Slice(buf, a, b) { return Buffer.from(buf.subarray(a, b)).toString('utf8') }
const readPkg = (path) => {
  const buf = fs.readFileSync(path)
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  let pos = 0
  const readI32 = () => { const v = view.getInt32(pos, true); pos += 4; return v }
  const magicLen = readI32(); pos += magicLen; const version = readI32()
  const entries = []
  while (pos + 8 <= buf.length) {
    const nameLen = readI32(); if (nameLen <= 0 || nameLen > 2048 || pos + nameLen + 8 > buf.length) break
    const name = utf8Slice(buf, pos, pos + nameLen); pos += nameLen
    const offset = readI32(); const size = readI32()
    if (offset < 0 || size < 0 || offset + size > buf.length) break
    entries.push({ name, offset, size })
  }
  const dataStart = pos
  const read = (n) => { const e = entries.find((x) => x.name === n); return e ? buf.subarray(dataStart + e.offset, dataStart + e.offset + e.size) : null }
  return { read, entries }
}
const dir = 'D:/SteamLibrary/steamapps/workshop/content/431960/2804379697'
const pkg = readPkg(dir + '/scene.pkg')
console.log('=== pkg 条目 ===')
for (const e of pkg.entries) console.log('  ' + e.name + ' (' + e.size + 'B)')
// 材质 json → 纹理名 + spritesheet
const matTexMap = new Map()
const matSprite = new Map()
for (const e of pkg.entries) {
  if (!e.name.startsWith('materials/') || !e.name.endsWith('.json')) continue
  const t = Buffer.from(pkg.read(e.name)).toString('utf8')
  matTexMap.set(e.name, [...t.matchAll(/"textures"\s*:\s*\[\s*"([^"]+)"/g)].map(m => m[1])])
  matSprite.set(e.name, { has: /"spritesheet"\s*:\s*[1-9]/.test(t), text: t.slice(0, 300) })
}
// scene.json 图层
const sceneText = Buffer.from(pkg.read('scene.json')).toString('utf8')
console.log('\n=== scene.json 图层（id/name/image/effect） ===')
const objStart = sceneText.indexOf('"objects"')
const objBlock = objStart >= 0 ? sceneText.slice(objStart) : ''
let idx = 0; let count = 0
while (idx < objBlock.length && count < 60) {
  const st = objBlock.indexOf('{', idx)
  if (st < 0) break
  let depth = 0; let end = -1
  for (let i = st; i < objBlock.length; i++) {
    const c = objBlock[i]
    if (c === '{') depth++
    else if (c === '}') { depth--; if (depth === 0) { end = i; break } }
  }
  if (end < 0) break
  const blk = objBlock.slice(st, end + 1)
  const idM = /"id"\s*:\s*(\d+)/.exec(blk)
  const nameM = /"name"\s*:\s*"([^"]*)"/.exec(blk)
  const imageM = /"image"\s*:\s*"([^"]+)"/.exec(blk)
  const effM = /"effects"\s*:\s*\[([^\]]*)\]/.exec(blk)
  const effCnt = effM !== null && effM[1].trim() !== '' ? (effM[1].match(/\{/g) || []).length : 0
  if (idM !== null) {
    console.log('  id=' + idM[1] + ' name="' + (nameM ? nameM[1] : '') + '"' +
      (imageM ? ' img=' + imageM[1] : '') + ' effs=' + effCnt)
  }
  idx = end + 1; count++
}
// 所有带 image 的 model → 材质 → 纹理
console.log('\n=== model → 材质 → 纹理 ===')
const modelMatMap = new Map()
for (const e of pkg.entries) {
  if (!e.name.startsWith('models/') || !e.name.endsWith('.json')) continue
  const t = Buffer.from(pkg.read(e.name)).toString('utf8')
  const m = /"material"\s*:\s*"([^"]+)"/.exec(t)
  modelMatMap.set(e.name, m !== null ? m[1] : null)
}
const imgModelRefs = [...[{ m: /"image"\s*:\s*"([^"]+)"/.exec(sceneText) }].filter(x => x.m !== null).map(x => x.m[1])]
for (const mr of [...new Set([...sceneText.matchAll(/"image"\s*:\s*"([^"]+)"/g)].map(m => m[1]))]) {
  const mat = modelMatMap.get(mr) ?? '(未找到)'
  const texs = matTexMap.get(mat) ?? []
  const sp = matSprite.get(mat) ?? { has: false }
  for (const tn of texs) {
    const tname = tn.startsWith('materials/') ? tn : 'materials/' + tn + '.tex'
    const b = pkg.read(tname)
    let frames = 0; let kind = ''
    if (b !== undefined && b !== null) {
      try { const tex = decodeTex(b); frames = tex !== null && tex.frames !== null ? tex.frames.length : 0; kind = tex?.mip0?.kind ?? '' } catch {}
    }
    console.log('  ' + mr + ' → ' + mat + ' → ' + tname +
      ' spritesheet=' + sp.has + (frames > 0 ? ' [TEXS ' + frames + '帧 kind=' + kind + ']' : ' kind=' + kind))
  }
}
