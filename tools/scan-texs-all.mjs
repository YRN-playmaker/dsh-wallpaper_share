// 全库扫描：所有 spritesheet 材质纹理的 TEXS 帧解析验证
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
const workshop = 'D:/SteamLibrary/steamapps/workshop/content/431960'
const dirs = fs.readdirSync(workshop).filter(d => /^\d+$/.test(d))
let matCount = 0
for (const dir of dirs) {
  const projPath = workshop + '/' + dir + '/project.json'
  if (!fs.existsSync(projPath)) continue
  let proj = null
  try { proj = JSON.parse(fs.readFileSync(projPath, 'utf8')) } catch { continue }
  if (!/scene/i.test(proj.type || '')) continue
  const pkgPath = workshop + '/' + dir + '/scene.pkg'
  if (!fs.existsSync(pkgPath)) continue
  try {
    const pkg = readPkg(pkgPath)
    // 找材质 json 里 spritesheet combos 对应的 .tex
    const mats = pkg.entries.filter(e => e.name.startsWith('materials/') && e.name.endsWith('.json'))
    for (const mf of mats) {
      try {
        const mt = Buffer.from(pkg.read(mf.name)).toString('utf8')
        if (!/"spritesheet"\s*:\s*[1-9]/.test(mt)) continue
        matCount++
        // 提取 textures 名
        const texNames = [...mt.matchAll(/"textures"\s*:\s*\[\s*"([^"]+)"/g)].map(m => m[1])
        if (texNames.length === 0) { console.log(dir + ' ' + mf.name + ': 无 textures 字段'); continue }
        for (const tn of texNames) {
          const texName = tn.startsWith('materials/') ? tn : 'materials/' + tn + '.tex'
          const b = pkg.read(texName)
          if (b === undefined || b === null) { console.log(dir + ' ' + mf.name + ': 纹理 ' + texName + ' 不存在'); continue }
          const tex = decodeTex(b)
          if (tex === null) { console.log(dir + ' ' + mf.name + ': 纹理 ' + texName + ' decodeTex FAILED'); continue }
          const frames = tex.frames !== null ? tex.frames.length : 0
          const f0 = tex.frames !== null && tex.frames[0] !== undefined ? tex.frames[0] : null
          console.log(dir + ' ' + texName + ': ' + (frames > 0 ? frames + '帧 ' + f0.w + 'x' + f0.h + ' 单帧' + f0.t.toFixed(3) + 's' : '静态(无TEXS)'))
        }
      } catch {}
    }
  } catch {}
}
console.log('\nspritesheet 材质总数: ' + matCount)
