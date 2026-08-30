// 列出所有图层 + 所有 puppet 文件 + 检查人物上下运动来源
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
const pkg = readPkg('D:/SteamLibrary/steamapps/workshop/content/431960/2804379697/scene.pkg')
// 列出所有条目
console.log('=== 所有条目 ===')
for (const e of pkg.entries) {
  if (e.name.includes('_puppet') || e.name.includes('models/')) console.log('  ' + e.name)
}
// 场景 JSON 完整解读：所有图层 id/name/parent/image/attachment/animationlayers/origin
const sceneBuf = pkg.read('scene.json')
const sceneText = Buffer.from(sceneBuf).toString('utf8')
// 提取每个 object 块
console.log('\n=== 场景图层 ===')
const objRe = /\{\s*"type"[^}]*\}/g
// 简化：按 id 切分
const blocks = sceneText.split(/\n\s*\}/).filter(x => x.includes('"id"'))
for (const blk of blocks) {
  const id = blk.match(/"id"\s*:\s*(\d+)/)?.[1]
  const name = blk.match(/"name"\s*:\s*"([^"]*)"/)?.[1] ?? ''
  const image = blk.match(/"image"\s*:\s*"([^"]*)"/)?.[1] ?? ''
  const parent = blk.match(/"parent"\s*:\s*(\d+)/)?.[1] ?? 'null'
  const att = blk.match(/"attachment"\s*:\s*"([^"]*)"/)?.[1] ?? ''
  const anim = blk.match(/"animationlayers"\s*:\s*\[([^\]]*)\]/)?.[1]?.trim() ?? ''
  const copybg = blk.includes('"copybackground" : true')
  console.log(`id=${id} name="${name}" parent=${parent} att="${att}" anim=[${anim}] copybg=${copybg} img="${image}"`)
}
