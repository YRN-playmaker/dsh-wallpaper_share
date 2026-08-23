// 直接文本定位 3151551777 中 id=5754 的图层块并打印
import { readFileSync } from 'node:fs'

function parsePkg(buf) {
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
  return { read }
}

const pkg = parsePkg(readFileSync('D:/SteamLibrary/steamapps/workshop/content/431960/3151551777/scene.pkg'))
const s = pkg.read('scene.json').toString('utf8')
// 找 "id" : 5754 前后
for (const id of [5754, 29716, 605, 31181]) {
  const i = s.indexOf('"id" : ' + id)
  if (i < 0) { console.log('#' + id + ' not found'); continue }
  const start = Math.max(0, i - 50)
  const end = Math.min(s.length, i + 2500)
  const seg = s.slice(start, end)
  // 找该层 effects 段
  const ei = seg.indexOf('"effects"')
  if (ei >= 0) {
    console.log('\n=== #' + id + ' name=' + (seg.match(/"name"\s*:\s*"([^"]*)"/) ?? ['', '?'])[1] + ' ===')
    console.log(seg.slice(ei, ei + 900).replace(/\r/g, ''))
  } else {
    console.log('#' + id + ' no effects in window')
  }
}
