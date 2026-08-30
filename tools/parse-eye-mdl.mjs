// 解析右眼 puppet.mdl，检查动画 id 与 animationlayers 引用（479）是否匹配
import fs from 'fs'
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
// 直接从 src 编译产物或 ts 源读取？用 tsx 太重，改用简单方式：读取 lib 里的 parsePuppetMdl
// 先看 lib/index.js 是否有导出
import { parsePuppetMdl } from '../lib/index.js'
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
const pkg = readPkg('D:/SteamLibrary/steamapps/workshop/content/431960/2804379697/scene.pkg')
for (const eye of ['右眼', '右睫毛', '左眼球', 'z左睫毛']) {
  const mdlBuf = pkg.read(`models/${eye}_puppet.mdl`)
  if (!mdlBuf) { console.log(eye, ': no mdl'); continue }
  const model = parsePuppetMdl(mdlBuf)
  if (!model) { console.log(eye, ': parse FAILED'); continue }
  console.log(`=== ${eye} ===`)
  console.log('material:', model.material)
  console.log('bones:', model.bones.length, 'animations:', model.animations.length, 'mesh:', model.mesh ? model.mesh.vertices.length + ' verts' : 'null')
  for (const a of model.animations) {
    console.log('  anim id=' + a.id, 'name=' + a.name, 'loop=' + a.loop, 'duration=' + a.duration.toFixed(3), 'kf=' + a.keyframes.length, 'boneCount=' + a.boneCount)
    if (a.keyframes.length > 0) {
      const k0 = a.keyframes[0].values
      const k1 = a.keyframes[a.keyframes.length - 1].values
      console.log('    kf0 t=' + a.keyframes[0].t.toFixed(3), k0.map(v=>v.toFixed(2)).join(', '))
      console.log('    kfN t=' + a.keyframes[a.keyframes.length - 1].t.toFixed(3), k1.map(v=>v.toFixed(2)).join(', '))
    }
  }
}
