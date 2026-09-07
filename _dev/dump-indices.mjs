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
  return { read: (n) => { const e = entries.find((x) => x.name === n); return e ? buf.subarray(dataStart + e.offset, dataStart + e.offset + e.size) : null } }
}
for (const [id, mn] of [['3479521040', 'models/人物_puppet.mdl'], ['3479521040', 'models/气球_puppet.mdl'], ['3463520581', 'models/asuna body_puppet.mdl']]) {
  const pkg = parsePkg(`D:/SteamLibrary/steamapps/workshop/content/431960/${id}/scene.pkg`)
  const b = pkg.read(mn)
  if (!b) { console.log(id, mn, 'NOT FOUND'); continue }
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const mdls = b.indexOf('MDLS')
  // 网格块
  let blk = null
  for (let offset = 9; offset + 12 < mdls; offset++) {
    const cvb = dv.getUint32(offset + 4, true)
    const vo = offset + 8
    if (cvb === 0 || cvb % 80 !== 0) continue
    const ilo = vo + cvb
    if (ilo + 4 > mdls) continue
    const cib = dv.getUint32(ilo, true)
    if (cib === 0 || cib % 2 !== 0 || ilo + 4 + cib > mdls) continue
    blk = { vo, vc: cvb / 80 }; break
  }
  const boneCount = dv.getUint32(mdls + 9 + 4, true)
  // 索引两种读法统计
  let u32ok = 0, u16ok = 0
  let u32max = 0, u16max = 0
  const sample = []
  for (let i = 0; i < Math.min(blk.vc, 6); i++) {
    const vo = blk.vo + i * 80
    const u32 = [dv.getUint32(vo + 40, true), dv.getUint32(vo + 44, true), dv.getUint32(vo + 48, true), dv.getUint32(vo + 52, true)]
    const u16 = [dv.getUint16(vo + 48, true), dv.getUint16(vo + 50, true), dv.getUint16(vo + 52, true), dv.getUint16(vo + 54, true)]
    sample.push({ u32: u32.join('/'), u16: u16.join('/'), w: [dv.getFloat32(vo + 56, true), dv.getFloat32(vo + 60, true), dv.getFloat32(vo + 64, true), dv.getFloat32(vo + 68, true)].map((x) => x.toFixed(3)).join('/') })
    if (u32.every((x) => x < boneCount)) u32ok++
    if (u16.every((x) => x < boneCount)) u16ok++
    for (const x of u32) if (x > u32max) u32max = x
    for (const x of u16) if (x > u16max) u16max = x
  }
  console.log(`\n=== ${id} ${mn} (bones=${boneCount}, vc=${blk.vc}) ===`)
  console.log(`  u32@40 idxOk=${u32ok}/6 max=${u32max} | u16@48 idxOk=${u16ok}/6 max=${u16max}`)
  for (const s of sample) console.log(`    u32=[${s.u32}] u16=[${s.u16}] w=[${s.w}]`)
}
