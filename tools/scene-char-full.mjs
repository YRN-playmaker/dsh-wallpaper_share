// 打印 人物 图层完整对象 + 场景前 100 行（找 general/相机）
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
const text = Buffer.from(pkg.read('scene.json')).toString('utf8')
const lines = text.split('\n')
// 人物对象：从 "id" : 24 所在行向上找到对象起点
let li = lines.findIndex(l => l.includes('"name" : "人物"'))
if (li >= 0) {
  let start = li
  for (let j = li; j >= 0 && j > li - 60; j--) {
    if (lines[j].includes('"type"') || lines[j].includes('"id"')) { start = j; break }
  }
  let end = li
  for (let j = li; j < lines.length && j < li + 40; j++) {
    if (lines[j].trim() === '},' || lines[j].trim() === '}') { end = j; break }
  }
  console.log('===== 人物 完整对象 =====')
  for (let j = start; j <= end; j++) console.log(lines[j])
}
// 场景开头 60 行
console.log('\n===== 场景开头 =====')
for (let j = 0; j < 60 && j < lines.length; j++) console.log(lines[j].slice(0, 150))
