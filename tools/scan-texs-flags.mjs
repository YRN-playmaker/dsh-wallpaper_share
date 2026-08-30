// 检查所有被解析出 frames 的纹理：flags 是否含 IsGif(4)，TEXS 是否为真实动画
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
      if (tex === null || tex.frames === null || tex.frames.length <= 1) continue
      const f0 = tex.frames[0]
      const isGif = (tex.flags & 4) !== 0
      console.log(dir + ' ' + tf.name + ': flags=' + tex.flags + ' isGif=' + isGif + ' frames=' + tex.frames.length +
        ' f0=' + f0.w + 'x' + f0.h + ' container=' + tex.containerMagic +
        (isGif ? '' : ' *** 非GIF(flags无4)但解析出帧——可疑 ***'))
    }
  } catch {}
}
