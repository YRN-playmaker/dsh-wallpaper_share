// 正确提取场景 JSON 中特定名称图层的完整对象
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
// 按行分割，找 objects 数组中的对象
const lines = text.split('\n')
// 提取每个对象块（从含有 "type" 的行开始，到对应的 } 结束）
const objects = []
let i = 0
while (i < lines.length) {
  const line = lines[i]
  if (line.includes('"type"')) {
    let obj = line
    let depth = 1
    i++
    while (i < lines.length && depth > 0) {
      obj += '\n' + lines[i]
      for (const ch of lines[i]) {
        if (ch === '{') depth++
        else if (ch === '}') depth--
      }
      i++
    }
    objects.push(obj)
  } else {
    i++
  }
}
// 查找特定名称的图层
for (const name of ['人物', '右眼', '右睫毛', '左眼球', 'z左睫毛', '背景']) {
  const obj = objects.find(o => o.includes('"' + name + '"'))
  if (!obj) { console.log('\n===== ' + name + ' 未找到 ====='); continue }
  console.log('\n===== ' + name + ' =====')
  // 打印关键字段：id, name, parent, origin, angles, scale, effects, animationlayers, copybackground, attachment, alpha
  for (const field of ['id', 'name', 'parent', 'origin', 'angles', 'scale', 'alpha', 'image', 'copybackground', 'attachment', 'animationlayers', 'effects', 'bounds', 'strength', 'speed', 'friction']) {
    const m = obj.match(new RegExp('"' + field + '"\\s*:\\s*[^,}]+'))
    if (m) console.log('  ' + m[0].slice(0, 120))
  }
}