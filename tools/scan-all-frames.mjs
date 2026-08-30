// 全库扫描：找出所有被解析出 frames 的纹理 + 它们的容器类型，
// 检查是否有非 spritesheet 的静态纹理被误判
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
const results = []
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
    const texFiles = pkg.entries.filter(e => e.name.endsWith('.tex'))
    for (const tf of texFiles) {
      const b = pkg.read(tf.name)
      if (b === undefined || b === null) continue
      let tex = null
      try { tex = decodeTex(b) } catch { continue }
      if (tex === null) continue
      if (tex.frames !== null && tex.frames.length > 1) {
        const f0 = tex.frames[0]
        results.push(`${dir} ${tf.name}: ${tex.frames.length}帧 ${f0.w}x${f0.h} t=${f0.t.toFixed(3)}s container=${tex.containerMagic}`)
      }
    }
  } catch {}
}
console.log('=== 全库被解析为动画的纹理 ===')
for (const r of results) console.log(r)
console.log('\n总计: ' + results.length)
