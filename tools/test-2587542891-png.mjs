// 验证 2587542891 所有纹理：decodeTex + texMipToPng 是否产出有效 PNG
import { decodeTex, texMipToPng } from '../src/scene/SceneTex.ts'
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
let bad = 0
for (const tf of texFiles) {
  const b = pkg.read(tf.name)
  const tex = decodeTex(b)
  if (tex === null) { console.log('DECODE_FAIL ' + tf.name); bad++; continue }
  const png = texMipToPng(tex)
  if (png === null) { console.log('PNG_FAIL ' + tf.name + ' mip0kind=' + tex.mip0?.kind); bad++; continue }
  // PNG 签名校验
  const sig = png.length > 8 ? (png[0] === 0x89 && png[1] === 0x50 && png[2] === 0x4e && png[3] === 0x47) : false
  if (!sig) { console.log('PNG_SIG_FAIL ' + tf.name + ' len=' + png.length); bad++; continue }
  // 尝试用 node 解码 PNG（确认有效）
  console.log('OK ' + tf.name + ' png=' + png.length + 'B mip0=' + tex.mip0?.width + 'x' + tex.mip0?.height + ' kind=' + tex.mip0?.kind)
}
console.log('\n失败: ' + bad + '/' + texFiles.length)
