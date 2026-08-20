// 扫描 Miku MDLA 区找 id=1054 (1E 04 00 00) 和 id=377 (79 01 00 00) 目录项
// 解析数据段并统计值变化 → 真实部件动画？
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

const pkg = parsePkg('D:/SteamLibrary/steamapps/workshop/content/431960/3409595232/scene.pkg')
const m = pkg.read('models/导出初音_puppet.mdl')
const mdla = m.indexOf('MDLA0006')
const mdle = m.indexOf('MDLE0002')
console.log('MDLA@' + mdla + ' region=' + (mdle - mdla))
for (const [id, bytes] of [[1054, [0x1e, 0x04, 0x00, 0x00]], [377, [0x79, 0x01, 0x00, 0x00]]]) {
  const hits = []
  for (let i = mdla; i < mdle - 4; i++) {
    if (m[i] === bytes[0] && m[i + 1] === bytes[1] && m[i + 2] === bytes[2] && m[i + 3] === bytes[3]) hits.push(i)
  }
  console.log('\nid=' + id + ' hits: ' + hits.map((h) => h + ' (mdla+' + (h - mdla) + ')').join(', '))
  for (const h of hits) {
    // 目录项：id + u32 + name\0 + loop\0 + 字段... dataLen（找 4B 后跟 02/00 extra + 数据）
    // 直接看目录项后 ~64B
    console.log('  @' + h + ' context: ' + m.subarray(h, h + 80).toString('hex'))
    // ASCII
    let asc = ''
    for (let i = h + 8; i < Math.min(h + 80, m.length); i++) asc += m[i] >= 32 && m[i] < 127 ? String.fromCharCode(m[i]) : '.'
    console.log('  ascii: ' + asc)
  }
}
