// 完整解析 scene.json 图层：origin/angles/scale/parent/effects 关键字段
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
const pkg = readPkg('D:/SteamLibrary/steamapps/workshop/content/431960/2804379697/scene.pkg')
const sceneBuf = pkg.read('scene.json')
const text = Buffer.from(sceneBuf).toString('utf8')
// 输出每个人物/眼睛相关图层的完整对象文本
for (const key of ['"人物"', '"右眼"', '"右睫毛"', '"左眼球"', '"z左睫毛"', '"背景"', '"动画 1"']) {
  const idx = text.indexOf(key)
  if (idx < 0) { console.log(key + ' 未找到'); continue }
  // 找到所属对象起点（向前找最近的 '{' 且包含 id）
  let start = text.lastIndexOf('{', idx)
  // 从 start 找配对的 '}'
  let depth = 0, end = -1
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}') { depth--; if (depth === 0) { end = i; break } }
  }
  if (end < 0) { console.log(key + ' 对象未匹配'); continue }
  console.log('\n===== ' + key + ' =====')
  console.log(text.slice(start, end + 1).slice(0, 900))
}
