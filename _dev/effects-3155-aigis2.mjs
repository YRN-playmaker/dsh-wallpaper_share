// 3151551777 #5754 Aigis 图层的 effects 完整 dump（找 visible 结构）
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
const i = s.indexOf('"id" : 5754')
console.log('idx=' + i)
if (i >= 0) {
  // 向后找 waterwaves 附近（Aigis 的 effects 可能窗口外——扩大范围）
  const seg = s.slice(i, i + 6000)
  const ei = seg.indexOf('"effects"')
  console.log('effects at +' + ei)
  if (ei >= 0) {
    // 打印到 effects 数组结束（两个 ww）
    console.log(seg.slice(ei, ei + 1800).replace(/\r/g, ''))
  } else {
    // 可能 layer 的 effects 在更后——搜整个 scene 里 #5754 后的 waterwaves
    const ww = s.indexOf('effects/waterwaves', i)
    console.log('waterwaves at +' + (ww - i))
    console.log(s.slice(ww - 300, ww + 600).replace(/\r/g, ''))
  }
}
