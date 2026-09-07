import { readFileSync } from 'node:fs'
function parsePkg(path) {
  const buf = readFileSync(path)
  let pos = 16; const entries = []
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
  const read = (n) => { const e = entries.find((x) => x.name === n); return e ? buf.subarray(dataStart + e.offset, dataStart + e.offset + e.size) : null }
  return { read, names: () => entries.map((e) => e.name) }
}
const hex = (b, from, n) => { let s = ''; for (let i = from; i < Math.min(from + n, b.length); i++) s += b[i].toString(16).padStart(2, '0') + ' '; return s }

for (const [id, mn] of [['3363252053', 'models/身体部件_puppet.mdl'], ['3426865175', 'models/fll_puppet.mdl'], ['3426865175', 'models/XME_puppet.mdl'], ['3759313716', 'models/body_puppet.mdl']]) {
  const pkg = parsePkg(`D:/SteamLibrary/steamapps/workshop/content/431960/${id}/scene.pkg`)
  const b = pkg.read(mn)
  const mdat = b.indexOf('MDAT')
  console.log(`\n=== ${id} ${mn} MDAT@${mdat} ===`)
  if (mdat < 0) { console.log('  (no MDAT)'); continue }
  // 前 96 字节
  console.log('  head:', hex(b, mdat, 96))
  // 尝试解析：9B 魔数 + u32 + u16 + u16，然后条目
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const u16 = (o) => dv.getUint16(o, true)
  const f32 = (o) => dv.getFloat32(o, true)
  console.log('  @+9 u32:', dv.getUint32(mdat + 9, true), ' @+13 u16:', u16(mdat + 13), ' @+15 u16:', u16(mdat + 15))
  // 扫描条目：找 ascii 名字
  let p = mdat + 17
  for (let i = 0; i < 8 && p + 64 < b.length; i++) {
    // 找名字起点（可打印 ascii 序列）
    let s = p
    while (s < b.length && !(b[s] >= 32 && b[s] < 127)) s++
    if (s - p > 8) { console.log(`  [entry ${i}] 无名字 near ${p}`); break }
    let e = s
    while (e < b.length && b[e] >= 32 && b[e] < 127) e++
    const name = b.toString('utf8', s, e)
    const mp = e + 1
    console.log(`  [entry ${i}] name="${name}" @${s} (pad ${s - p}B); u16 before=${s >= 2 ? u16(s - 2) : '?'}; mat tx=${mp + 64 <= b.length ? f32(mp + 48).toFixed(1) + ',' + f32(mp + 52).toFixed(1) : '?'}`)
    p = mp + 64
  }
}
