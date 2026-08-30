// 提取 2587542891 每个 image 图层的全部纹理引用（decodableTexture + textureRefs），
// 并检查是否任何引用的纹理带 TEXS（会导致误判 sprite）
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
const pkg = readPkg('D:/SteamLibrary/steamapps/workshop/content/431960/2587542891/scene.pkg')
// 材质 json → 纹理名
const matTexMap = new Map()
for (const e of pkg.entries) {
  if (!e.name.startsWith('materials/') || !e.name.endsWith('.json')) continue
  const t = Buffer.from(pkg.read(e.name)).toString('utf8')
  const texs = [...t.matchAll(/"textures"\s*:\s*\[\s*"([^"]+)"/g)].map(m => m[1])
  matTexMap.set(e.name, texs)
}
// 材质名 → 是否 spritesheet
const matSprite = new Map()
for (const e of pkg.entries) {
  if (!e.name.startsWith('materials/') || !e.name.endsWith('.json')) continue
  const t = Buffer.from(pkg.read(e.name)).toString('utf8')
  matSprite.set(e.name, /"spritesheet"\s*:\s*[1-9]/.test(t))
}
// 模型 json → 材质名
const modelMatMap = new Map()
for (const e of pkg.entries) {
  if (!e.name.startsWith('models/') || !e.name.endsWith('.json')) continue
  const t = Buffer.from(pkg.read(e.name)).toString('utf8')
  const m = /"material"\s*:\s*"([^"]+)"/.exec(t)
  modelMatMap.set(e.name, m !== null ? m[1] : null)
}
// scene.json 图层
const sceneText = Buffer.from(pkg.read('scene.json')).toString('utf8')
const objStart = sceneText.indexOf('"objects"')
const objBlock = sceneText.slice(objStart)
let idx = 0; let count = 0
while (idx < objBlock.length && count < 80) {
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
  const imageM = /"image"\s*:\s*"([^"]+)"/.exec(blk)
  const particleM = /"particle"\s*:\s*"([^"]+)"/.exec(blk)
  if (idM !== null && imageM !== null) {
    const model = imageM[1]
    const mat = modelMatMap.get(model) ?? '(未找到)'
    const texs = matTexMap.get(mat) ?? []
    const spriteAny = matSprite.get(mat) === true
    // 检查每个纹理的 TEXS
    const texS = texs.map((tn) => {
      const tname = tn.startsWith('materials/') ? tn : 'materials/' + tn + '.tex'
      const b = pkg.read(tname)
      if (b === undefined) return tn + '(无)'
      let f = 0
      try { const tex = decodeTex(b); f = tex !== null && tex.frames !== null ? tex.frames.length : 0 } catch {}
      return tn + (f > 1 ? '[' + f + 'TEXS]' : '')
    })
    console.log('id=' + idM[1] + ' model=' + model + ' mat=' + mat + ' sprite=' + spriteAny +
      (texS.length ? ' tex=' + texS.join(',') : ' (无tex)'))
  }
  idx = end + 1; count++
}
