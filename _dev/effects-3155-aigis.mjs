// 检查 3151551777 #5754 Aigis / #29716 Protag_clean 的 effects 完整结构（visible）
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
// 找 #5754 图层块
const layerRe = /\{\s*"id"\s*:\s*(5754|29716|605|31181)[\s\S]*?(?="visible"\s*:\s*\{[\s\S]*?\}\s*\}\s*,?\s*"\s*id"\s*:|\z)/g
for (const id of ['5754', '29716', '605', '31181']) {
  const i = s.indexOf('"id" : ' + id)
  if (i < 0) { console.log('#' + id + ' not found'); continue }
  // 该 layer 对象范围：从 { "id" 到下一个 "id" : 或文件尾
  const start = s.lastIndexOf('{', i)
  const next = s.indexOf('"id" :', i + 10)
  const end = next > 0 ? s.lastIndexOf('}', next) : s.lastIndexOf('}')
  const body = s.slice(start, end + 1)
  console.log('\n=== layer #' + id + ' effects ===')
  // 提取每个 effect 的 visible + file
  const effRe = /\{\s*"file"\s*:\s*"([^"]*)"[\s\S]*?"visible"\s*:\s*\{([\s\S]*?)\}\s*\}/g
  let m
  while ((m = effRe.exec(body)) !== null) {
    const vis = m[2].replace(/\s+/g, ' ').slice(0, 120)
    console.log('  ' + m[1].split('/').pop() + ' visible={' + vis + '}')
  }
}
