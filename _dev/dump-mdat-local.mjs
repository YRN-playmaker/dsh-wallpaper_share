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
  return { read: (n) => { const e = entries.find((x) => x.name === n); return e ? buf.subarray(dataStart + e.offset, dataStart + e.offset + e.size) : null }, names: () => entries.map((e) => e.name) }
}
function matMulRow(a, b) { const o = new Array(16); for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) o[r * 4 + c] = a[r * 4 + 0] * b[0 * 4 + c] + a[r * 4 + 1] * b[1 * 4 + c] + a[r * 4 + 2] * b[2 * 4 + c] + a[r * 4 + 3] * b[3 * 4 + c]; return o }

for (const [id, mn] of [['3363252053', 'models/身体部件_puppet.mdl'], ['3426865175', 'models/fll_puppet.mdl']]) {
  const pkg = parsePkg(`D:/SteamLibrary/steamapps/workshop/content/431960/${id}/scene.pkg`)
  const b = pkg.read(mn)
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const mdls = b.indexOf('MDLS')
  const mdat = b.indexOf('MDAT')
  // 骨骼 (对方布局)
  const bones = []
  let p = mdls + 9 + 4
  const boneCount = dv.getUint32(p, true); p += 4
  for (let i = 0; i < boneCount; i++) {
    let headExtra = 0
    let tmp = b[p], type = dv.getUint32(p + 1, true), parent = dv.getInt32(p + 5, true), len = dv.getUint32(p + 9, true)
    if (len === 0 || len > 4096) { tmp = dv.getUint16(p, true); type = dv.getUint32(p + 2, true); parent = dv.getInt32(p + 6, true); len = dv.getUint32(p + 10, true); headExtra = 1 }
    p += 9 + headExtra + 4
    const m = new Array(16); for (let k = 0; k < 16; k++) m[k] = dv.getFloat32(p + k * 4, true)
    p += len
    while (p < b.length && b[p] !== 0) p++
    p++
    bones.push({ parent, bind: m })
  }
  // bind world 链乘
  const bindWorld = new Array(bones.length)
  for (let i = 0; i < bones.length; i++) bindWorld[i] = bones[i].parent >= 0 && bindWorld[bones[i].parent] ? matMulRow(bindWorld[bones[i].parent], bones[i].bind) : bones[i].bind
  // MDAT 锚点
  const anchors = []
  p = mdat + 9 + 4
  const count = dv.getUint16(p, true); p += 2
  for (let e = 0; e < count; e++) {
    const boneIdx = dv.getUint16(p, true); p += 2
    const ne = b.indexOf(0, p); const name = b.toString('utf8', p, ne); p = ne + 1
    const m = new Array(16); for (let k = 0; k < 16; k++) m[k] = dv.getFloat32(p + k * 4, true)
    p += 64
    anchors.push({ name, boneIdx, tx: m[12], ty: m[13] })
  }
  console.log(`\n=== ${id} ${mn} (${bones.length} bones) ===`)
  for (const a of anchors) {
    const bw = bindWorld[a.boneIdx]
    console.log(`  anchor "${a.name}" boneIdx=${a.boneIdx}`)
    console.log(`    锚点矩阵平移      = (${a.tx.toFixed(1)}, ${a.ty.toFixed(1)})`)
    console.log(`    骨骼 bind 世界平移 = (${bw[12].toFixed(1)}, ${bw[13].toFixed(1)})`)
    console.log(`    差值               = (${(a.tx - bw[12]).toFixed(1)}, ${(a.ty - bw[13]).toFixed(1)})  → ${Math.hypot(a.tx - bw[12], a.ty - bw[13]) < 1 ? '≈全局(矩阵=骨位)' : '≠全局(矩阵=局部偏移)'}`)
  }
}
