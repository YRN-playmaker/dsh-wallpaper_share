// 图层 origin/size ↔ cropoffset 关系（3463520581 + 3770263871 + 3195212886 + 3409595232）
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
  return (n) => { const e = entries.find((x) => x.name === n); if (!e) return null; return buf.subarray(dataStart + e.offset, dataStart + e.offset + e.size).toString('utf8') }
}

for (const id of ['3463520581', '3770263871', '3195212886', '3409595232']) {
  const get = parsePkg(readFileSync('D:/SteamLibrary/steamapps/workshop/content/431960/' + id + '/scene.pkg'))
  const scene = get('scene.json')
  console.log('========== ' + id + ' ==========')
  // 找所有 image 图层块：image + origin + size + 模型 JSON 的 cropoffset
  const re = /"image"\s*:\s*"([^"]+)"[\s\S]*?"name"\s*:\s*"([^"]*)"[\s\S]*?"origin"\s*:\s*"([^"]+)"[\s\S]*?"size"\s*:\s*"([^"]+)"/g
  let m
  while ((m = re.exec(scene)) !== null) {
    const modelName = m[1]
    const j = get(modelName)
    if (j === null || !j.includes('puppet')) continue
    const crop = /"cropoffset"\s*:\s*"([^"]+)"/.exec(j)
    console.log('  ' + m[2] + ' origin=(' + m[3] + ') size=(' + m[4] + ')' + (crop ? ' crop=(' + crop[1] + ')' : ' crop=无'))
  }
}
