// 解析 fog 材质 json（fog1_1_1.json）：blendmode/材质字段
import { readFileSync } from 'node:fs'

function parsePkg(path) {
  const buf = readFileSync(path)
  let pos = 16
  const entries = []
  while (pos + 8 <= buf.length) {
    const nameLen = buf.readInt32LE(pos); pos += 4
    if (nameLen <= 0 || nameLen > 1024 || pos + nameLen + 8 > buf.length) break
    const name = buf.subarray(pos, pos + nameLen).toString('utf8'); pos += nameLen
    const offset = buf.readInt32LE(pos); pos += 4
    const size = buf.readInt32LE(pos); pos += 4
    if (offset < 0 || size < 0 || offset + size > buf.length) break
    entries.push({ name, offset, size })
  }
  const dataStart = pos
  const read = (n) => {
    const e = entries.find((x) => x.name === n)
    if (!e) return null
    return buf.subarray(dataStart + e.offset, dataStart + e.offset + e.size)
  }
  return { read, entries }
}

const { read, entries } = parsePkg('D:/SteamLibrary/steamapps/workshop/content/431960/3463520581/scene.pkg')
for (const e of entries) {
  if (!e.name.includes('fog')) continue
  const buf = read(e.name)
  console.log('\n=== ' + e.name + ' (' + buf.length + 'B) ===')
  // 找 json 起点（第一个 {）
  let s = buf.toString('utf8')
  const lb = s.indexOf('{')
  const rb = s.lastIndexOf('}')
  try {
    const j = JSON.parse(s.slice(lb, rb + 1))
    console.log(JSON.stringify(j, null, 1))
  } catch (err) {
    // 截断法
    const cut = s.lastIndexOf('}', s.lastIndexOf('}') - 1)
    try {
      const j = JSON.parse(s.slice(lb, cut + 1))
      console.log(JSON.stringify(j, null, 1))
    } catch (err2) {
      console.log('parse fail: ' + err2.message)
      console.log('raw head: ' + s.slice(0, 600))
    }
  }
}
// 也看 fog1 纹理的 tex 文件（尺寸/格式）
for (const e of entries) {
  if (e.name.includes('particle/fog')) {
    const buf = read(e.name)
    console.log('\n=== ' + e.name + ' (' + buf.length + 'B) ===')
    console.log('head: ' + buf.subarray(0, 48).toString('hex'))
    const s = buf.toString('latin1')
    console.log('ascii: ' + s.slice(0, 80))
  }
}
