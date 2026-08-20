// 检查 3463520581 scene.json 的时间轴动画结构（keyframes/animation/timeline 字段）
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
  return { read }
}

const pkg = parsePkg('D:/SteamLibrary/steamapps/workshop/content/431960/3463520581/scene.pkg')
const s = pkg.read('scene.json').toString('utf8')
// 找关键字段
const keys = ['keyframe', 'animation', 'timeline', 'animationmode', 'sequence', 'effect', 'blend', 'track', 'motion', 'wave']
for (const k of keys) {
  let i = 0
  let count = 0
  while ((i = s.indexOf(k, i)) !== -1 && count < 5) { count++; i += k.length }
  console.log(k + ': ' + count + ' occurrences')
}
// dump 含 keyframe/animation 的片段（前后 200B）
for (const k of ['keyframe', '"animation"', 'animationmode']) {
  const i = s.indexOf(k)
  if (i >= 0) {
    console.log('\n--- ' + k + ' @' + i + ' ---')
    console.log(JSON.stringify(s.slice(Math.max(0, i - 120), i + 300)))
  }
}
