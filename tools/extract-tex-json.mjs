// 提取 TEXB 内嵌 JSON 元数据（TEXB0003/0004 的 mipmap json）
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
for (const dir of ['2164591875', '2325500626', '2022733184', '1438064333', '3774904326']) {
  const pkg = readPkg(workshop + '/' + dir + '/scene.pkg')
  const texFiles = pkg.entries.filter(e => e.name.endsWith('.tex'))
  console.log('=== ' + dir + ' ===')
  for (const tf of texFiles) {
    const b = pkg.read(tf.name)
    if (!b) continue
    // 找 TEXB 标记
    let texb = -1
    for (let i = 0; i < b.length - 4; i++) {
      if (b[i] === 0x54 && b[i+1] === 0x45 && b[i+2] === 0x58 && b[i+3] === 0x42) { texb = i; break }
    }
    if (texb < 0) continue
    // TEXB + 版本 9B，然后 imageCount u32，然后逐 mipmap
    let q = texb + 9
    const imageCount = (b[q] | (b[q+1]<<8) | (b[q+2]<<16) | (b[q+3]<<24)) >>> 0; q += 4
    // 对每个 mipmap：TEXB0003/0004 有 [u32 w][u32 h][u32 comp][i32 uncompSize][i32 compSize]，0004 还有 json
    // 直接在整个 tex 中搜索 json 键
    const s = b.toString('latin1')
    for (const kw of ['spritesheetsequences', 'spritesheet', 'frames', 'duration', 'width', 'height', 'fps']) {
      let idx = s.indexOf(kw)
      if (idx >= 0) {
        console.log('  ' + tf.name + ' 含 "' + kw + '"@' + idx)
        // 打印附近可读文本
        const chunk = s.slice(idx, Math.min(idx + 300, s.length))
        const printable = chunk.replace(/[^\x20-\x7e]/g, '.')
        console.log('    ...' + printable.slice(0, 250))
        break
      }
    }
  }
  console.log()
}
