// 检查 2587542891：image 图层引用的材质 → 纹理，并标注哪些纹理有 TEXS
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
// 收集所有材质 json → 纹理名
const matMap = new Map()
for (const e of pkg.entries) {
  if (!e.name.startsWith('materials/') || !e.name.endsWith('.json')) continue
  const t = Buffer.from(pkg.read(e.name)).toString('utf8')
  const texs = [...t.matchAll(/"textures"\s*:\s*\[\s*"([^"]+)"/g)].map(m => m[1])
  matMap.set(e.name, texs)
}
// scene.json 图层 → image 引用（models/*.json → 材质名）
const sceneText = Buffer.from(pkg.read('scene.json')).toString('utf8')
const modelRefs = new Set()
const modelMatMap = new Map()
for (const e of pkg.entries) {
  if (!e.name.startsWith('models/') || !e.name.endsWith('.json')) continue
  const t = Buffer.from(pkg.read(e.name)).toString('utf8')
  const m = /"material"\s*:\s*"([^"]+)"/.exec(t)
  modelMatMap.set(e.name, m !== null ? m[1] : null)
  if (m !== null) modelRefs.add(m[1])
}
// 找到 scene.json 里 image 引用的 model
const imgModelRefs = [...sceneText.matchAll(/"image"\s*:\s*"([^"]+)"/g)].map(m => m[1])
console.log('=== image 图层引用的 model → 材质 → 纹理（含 TEXS 标记） ===')
for (const mr of [...new Set(imgModelRefs)]) {
  const mat = modelMatMap.get(mr) ?? '(model不存在)'
  const texs = matMap.get(mat) ?? []
  for (const tn of texs) {
    const texName = tn.startsWith('materials/') ? tn : 'materials/' + tn + '.tex'
    const b = pkg.read(texName)
    let frames = 0
    if (b !== undefined && b !== null) {
      try { const tex = decodeTex(b); frames = tex !== null && tex.frames !== null ? tex.frames.length : 0 } catch {}
    }
    console.log('  ' + mr + ' → ' + mat + ' → ' + texName + (frames > 0 ? ' *** ' + frames + '帧 TEXS ***' : ''))
  }
}
// 材质 json 里有 spritesheet 的
console.log('\n=== 含 spritesheet combo 的材质 ===')
for (const [mn, texs] of matMap) {
  const t = Buffer.from(pkg.read(mn)).toString('utf8')
  if (/"spritesheet"\s*:\s*[1-9]/.test(t)) console.log('  ' + mn + ' → ' + texs.join(','))
}
