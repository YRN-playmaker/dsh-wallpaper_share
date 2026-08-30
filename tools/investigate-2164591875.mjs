// 调查 2164591875：找切分图片帧动画（sequence/spritegrid/animation 相关字段）
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
const pkg = readPkg('D:/SteamLibrary/steamapps/workshop/content/431960/2164591875/scene.pkg')
const text = Buffer.from(pkg.read('scene.json')).toString('utf8')
const lines = text.split('\n')
// 找所有图层名和 image 字段
console.log('=== 场景条目总数 ===')
console.log('entries: ' + pkg.entries.length)
console.log('\n=== 图层列表（name/image/type）===')
const nameRe = /"name"\s*:\s*"([^"]*)"/g
let m
const names = []
while ((m = nameRe.exec(text)) !== null) names.push(m[1])
console.log(names.join(', '))
// 找 sequence / spritegrid / animation 相关
console.log('\n=== 动画相关字段 ===')
for (const kw of ['sequence', 'spritegrid', 'spritelength', 'framerate', 'fps', 'playback', 'imagetype', 'animation']) {
  const re = new RegExp('"' + kw + '"\\s*:', 'g')
  let cnt = 0
  while (re.exec(text) !== null) cnt++
  if (cnt > 0) console.log('  "' + kw + '": ' + cnt + ' 处')
}
// 打印包含 sequence 或 spritegrid 的上下文
console.log('\n=== sequence/spritegrid 上下文 ===')
for (const kw of ['sequence', 'spritegrid', 'spritelength', 'framerate']) {
  const idx = text.indexOf('"' + kw + '"')
  if (idx >= 0) {
    console.log('--- ' + kw + ' @' + idx + ' ---')
    console.log(text.slice(Math.max(0, idx - 200), idx + 300))
  }
}
