// 打印 2164591875 scene.json 中 timeofday 上下文 + 全局状态变量定义
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
const jsonStr = sceneText.slice(start, end + 1)
console.log('=== timeofday 上下文 ===')
for (const m of jsonStr.matchAll(/"timeofday"/g)) {
  const s = Math.max(0, m.index! - 200)
  console.log('...' + jsonStr.slice(s, m.index! + 200).replace(/\s+/g, ' ') + '...\n')
}
// 搜索变量定义段（类似 "state" / "user" / "property" / "variables"）
console.log('=== 各关键字出现次数 ===')
for (const kw of ['timeday', 'timeofday', 'sunrise', 'sunset', 'dayNight', 'clocktime', 'hour', 'minute', 'seconds', 'timeScale', 'timenow']) {
  const hits = [...jsonStr.matchAll(new RegExp(kw, 'gi'))]
  if (hits.length) console.log('  ' + kw + ': ' + hits.length + '次')
}
// 打印整个 scene.json 里非 objects 的顶层键
console.log('\n=== scene.json 顶层键 ===')
for (const m of jsonStr.matchAll(/"([a-zA-Z_]+)"\s*:/g)) {
  const key = m[1]
  const val = jsonStr.slice(m.index! + m[0].length, jsonStr.indexOf(',', m.index! + m[0].length))
  if (!/^(id|name|image|parent|visible|angles|origin|scale|size|solid|alignment|transform|alpha|layer|effect|particle|material|passes|textures|shader|snap|attach|position|camera|fov|zoom|clear|general|orthogonal|type|condition|value|user)$/i.test(key) && !key.includes('bloom') && !key.includes('cam')) {
    // 优先打印有含义的键
  }
}
console.log('--- 完整 scene.json（前 3000 字符）---')
console.log(jsonStr.slice(0, 3000).replace(/\s+/g, ' '))
