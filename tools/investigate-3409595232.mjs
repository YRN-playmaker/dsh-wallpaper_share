// 调查 3409595232 的格式：puppet 文件魔数、是否解析成功
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
const f32At = (b, q) => new Float32Array(new Int32Array([(b[q] | (b[q+1]<<8) | (b[q+2]<<16) | (b[q+3]<<24)) | 0]).buffer)[0]
const u32At = (b, q) => (b[q] | (b[q+1]<<8) | (b[q+2]<<16) | (b[q+3]<<24)) >>> 0
const u16At = (b, q) => b[q] | (b[q+1]<<8)
const findTag = (b, tag) => {
  const t = new Uint8Array(tag.length)
  for (let i = 0; i < t.length; i++) t[i] = tag.charCodeAt(i)
  for (let i = 0; i < b.length - t.length; i++) {
    let ok = true
    for (let k = 0; k < t.length; k++) if (b[i+k] !== t[k]) { ok = false; break }
    if (ok) return i
  }
  return -1
}
for (const [id, label] of [['3409595232', '第二个壁纸']]) {
  const pkg = readPkg(`D:/SteamLibrary/steamapps/workshop/content/431960/${id}/scene.pkg`)
  console.log(`=== ${label} ${id} ===`)
  // 列出所有 .json 模型文件（含 puppet 引用）
  for (const e of pkg.entries) {
    if (e.name.endsWith('.json') && e.name.startsWith('models/')) {
      const buf = pkg.read(e.name)
      const text = Buffer.from(buf).toString('utf8')
      console.log(`  ${e.name}: ${text.slice(0, 200)}`)
    }
  }
  // 列出所有 _puppet.mdl 文件
  for (const e of pkg.entries) {
    if (e.name.includes('_puppet')) {
      const b = pkg.read(e.name)
      const magic = String.fromCharCode(...b.slice(0, 8))
      console.log(`  ${e.name}: len=${b.length} magic="${magic}"`)
      // 检查魔数 + 段落
      for (const tag of ['MDLV0001','MDLV0002','MDLV0020','MDLV0021','MDLV0023','MDLS0001','MDLS0003','MDLS0004','MDLA0001','MDLA0006','MDAT0001','MDLE0002']) {
        const at = findTag(b, tag)
        if (at >= 0) console.log(`    ${tag}@${at}`)
      }
    }
  }
}
