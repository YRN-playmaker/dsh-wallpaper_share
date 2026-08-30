// 打印 2164591875 scene.json 的 conditions 定义 + general 段
import fs from 'fs'
function utf8Slice(buf: Uint8Array, a: number, b: number): string { return Buffer.from(buf.subarray(a, b)).toString('utf8') }
interface Entry { name: string; offset: number; size: number }
function readPkg(path: string): { entries: Entry[]; dataStart: number; read(name: string): Uint8Array | null } {
  const buf = fs.readFileSync(path)
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  let pos = 0
  const readI32 = () => { const v = view.getInt32(pos, true); pos += 4; return v }
  const magicLen = readI32(); pos += magicLen; const version = readI32()
  const entries: Entry[] = []
  while (pos + 8 <= buf.length) {
    const nameLen = readI32(); if (nameLen <= 0 || nameLen > 2048 || pos + nameLen + 8 > buf.length) break
    const name = utf8Slice(buf, pos, pos + nameLen); pos += nameLen
    const offset = readI32(); const size = readI32()
    if (offset < 0 || size < 0 || offset + size > buf.length) break
    entries.push({ name, offset, size })
  }
  const dataStart = pos
  return { entries, dataStart, read: (n) => { const e = entries.find((x) => x.name === n); return e !== undefined ? buf.subarray(dataStart + e.offset, dataStart + e.offset + e.size) : null } }
}
const dir = 'D:/SteamLibrary/steamapps/workshop/content/431960/2164591875'
const pkg = readPkg(dir + '/scene.pkg')
const sceneText = Buffer.from(pkg.read('scene.json')!).toString('utf8')
const start = sceneText.indexOf('{')
const end = sceneText.lastIndexOf('}')
let jsonStr = sceneText.slice(start, end + 1)
// 找 conditions 段
const condIdx = jsonStr.indexOf('"conditions"')
console.log('=== "conditions" 位置: ' + condIdx + ' ===')
if (condIdx >= 0) {
  // 提取 conditions 数组
  const cStart = jsonStr.indexOf('[', condIdx)
  let d = 0; let cEnd = -1
  for (let i = cStart; i < jsonStr.length; i++) {
    if (jsonStr[i] === '[') d++
    else if (jsonStr[i] === ']') { d--; if (d === 0) { cEnd = i; break } }
  }
  if (cEnd >= 0) {
    console.log(jsonStr.slice(cStart, cEnd + 1).replace(/\s+/g, ' ').slice(0, 2000))
  }
}
// 找 general 段（clearcolor / timeday 等）
const genIdx = jsonStr.indexOf('"general"')
console.log('\n=== "general" 段 ===')
if (genIdx >= 0) {
  const gStart = jsonStr.indexOf('{', genIdx)
  let d = 0; let gEnd = -1
  for (let i = gStart; i < jsonStr.length; i++) {
    if (jsonStr[i] === '{') d++
    else if (jsonStr[i] === '}') { d--; if (d === 0) { gEnd = i; break } }
  }
  if (gEnd >= 0) console.log(jsonStr.slice(gStart, gEnd + 1).replace(/\s+/g, ' ').slice(0, 1500))
}
// 搜索 timeday/timestate/suncycle/dayNight 关键字
console.log('\n=== 时间相关关键字 ===')
for (const kw of ['timeday', 'timestate', 'suncycle', 'dayNight', 'day_night', 'timeofday', 'userconfig']) {
  const re = new RegExp(kw, 'gi')
  const hits = [...jsonStr.matchAll(re)]
  if (hits.length > 0) console.log('-- ' + kw + ' (' + hits.length + '次) --')
}
