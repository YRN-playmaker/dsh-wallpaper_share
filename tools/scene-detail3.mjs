// 直接打印 scene.json 中人物/眼睛图层的原始文本（手动定位）
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
// 用行索引定位
const lines = text.split('\n')
for (const name of ['"人物"', '"右眼"', '"右睫毛"', '"左眼球"', '"z左睫毛"']) {
  let li = lines.findIndex(l => l.includes(name))
  if (li < 0) { console.log('\n=== ' + name + ' 未找到 ==='); continue }
  // 向上找到 "id"
  let start = li
  for (let j = li; j >= 0 && j > li - 40; j--) {
    if (lines[j].includes('"id"')) { start = j; break }
  }
  console.log('\n===== ' + name + ' (行' + start + '..' + (li+30) + ') =====')
  for (let j = start; j <= Math.min(li + 40, lines.length - 1); j++) {
    console.log(lines[j].slice(0, 160))
  }
}
