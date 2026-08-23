// 检查 asuna/kirito 部件图层的 animation 引用 + Miku 壁纸 composelayer 动画
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

for (const id of ['3463520581', '3409595232']) {
  const get = parsePkg(readFileSync('D:/SteamLibrary/steamapps/workshop/content/431960/' + id + '/scene.pkg'))
  const scene = get('scene.json')
  console.log('========== ' + id + ' ==========')
  // 找每个图层块的 animation 字段（图层块：以 "castshadow" 开头）
  const blocks = scene.split(/\n\t\t\{/)
  let shown = 0
  for (const b of blocks) {
    const nameM = /"name"\s*:\s*"([^"]+)"/.exec(b)
    const animM = /"animation"\s*:\s*(\d+)/.exec(b)
    const imgM = /"image"\s*:\s*"([^"]+)"/.exec(b)
    if (animM && nameM) {
      console.log('  animation=' + animM[1] + ' name=' + nameM[1] + ' image=' + (imgM ? imgM[1] : '?'))
      shown++
    }
  }
  console.log('  有 animation 引用图层数: ' + shown)
}
