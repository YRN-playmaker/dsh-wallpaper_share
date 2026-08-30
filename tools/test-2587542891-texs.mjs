// 测试 2587542891 所有 .tex 的解码结果（对比 mip0 是否正常）
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
const texFiles = pkg.entries.filter(e => e.name.endsWith('.tex'))
let fail = 0
for (const tf of texFiles) {
  const b = pkg.read(tf.name)
  const tex = decodeTex(b)
  if (tex === null) {
    fail++
    console.log('FAIL ' + tf.name + ' (' + b.length + 'B)')
  } else {
    const m0 = tex.mip0
    const frames = tex.frames !== null ? tex.frames.length : 0
    console.log('OK   ' + tf.name + ' mip0=' + (m0 !== null ? m0.width + 'x' + m0.height + ' ' + m0.kind : 'null') + (frames > 0 ? ' frames=' + frames : ''))
  }
}
console.log('\n失败: ' + fail + '/' + texFiles.length)
