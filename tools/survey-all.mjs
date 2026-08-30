// 全面扫描所有壁纸的 puppet 格式：0013/0021/0023 + 动画帧旋转分量验证
import fs from 'fs'
function utf8Slice(buf, a, b) { return Buffer.from(buf.subarray(a, b)).toString('utf8') }
const readPkg = (path) => {
  const buf = fs.readFileSync(path)
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  let pos = 0
  const readI32 = () => { const v = view.getInt32(pos, true); pos += 4; return v }
  const magicLen = readI32(); pos += magicLen; const version = readI32()
  const entries = []
  while (pos + 8 <= buf.length) {
    const nameLen = readI32(); if (nameLen <= 0 || nameLen > 2048 || pos + nameLen + 8 > buf.length) break
    const name = utf8Slice(buf, pos, pos + nameLen); pos += nameLen
    const offset = readI32(); const size = readI32()
    if (offset < 0 || size < 0 || offset + size > buf.length) break
    entries.push({ name, offset, size })
  }
  const dataStart = pos
  const read = (n) => { const e = entries.find((x) => x.name === n); return e ? buf.subarray(dataStart + e.offset, dataStart + e.offset + e.size) : null }
  return { read, entries }
}
const f32At = (b, q) => new Float32Array(new Int32Array([(b[q] | (b[q+1]<<8) | (b[q+2]<<16) | (b[q+3]<<24)) | 0]).buffer)[0]
const u32At = (b, q) => (b[q] | (b[q+1]<<8) | (b[q+2]<<16) | (b[q+3]<<24)) >>> 0
const findTag = (b, tag) => {
  const t = new Uint8Array(tag.length)
  for (let i = 0; i < t.length; i++) t[i] = tag.charCodeAt(i)
  for (let i = 0; i < b.length - t.length; i++) {
    let ok = true
    for (let k = 0; k < t.length; k++) if (b[i+k] !== t[k]) { ok = false; break }
    if (ok) return i
  }
  return -1
}
const workshop = 'D:/SteamLibrary/steamapps/workshop/content/431960'
const dirs = fs.readdirSync(workshop).filter(d => /^\d+$/.test(d))
let found = 0
for (const dir of dirs) {
  const pkgPath = workshop + '/' + dir + '/scene.pkg'
  if (!fs.existsSync(pkgPath)) continue
  try {
    const pkg = readPkg(pkgPath)
    for (const e of pkg.entries) {
      if (e.name.includes('_puppet')) {
        const b = pkg.read(e.name)
        if (!b || b.length < 8) continue
        const magic = String.fromCharCode(...b.slice(0, 4))
        const mls1 = findTag(b, 'MDLS0001'); const mls3 = findTag(b, 'MDLS0003')
        const mla1 = findTag(b, 'MDLA0001'); const mla6 = findTag(b, 'MDLA0006')
        const mdat = findTag(b, 'MDAT0001')
        // 动画骨骼数
        let bc = 0, boneCount = 0, dur = 0, frames = 0, maxQz = 0, maxQzSpan = 0, hasQ = 0
        const mdla = mla6 >= 0 ? mla6 : mla1
        if (mdla >= 0) {
          let q = mdla + 17
          const animCount = u32At(b, mdla + 13)
          q += 4; q += 4
          while (b[q] !== 0) q++; q++
          while (b[q] !== 0) q++; q++
          dur = f32At(b, q); q += 4
          bc = u32At(b, q); q += 4
          q += 4
          boneCount = u32At(b, q); q += 4
          q += 4
          const dataLen = u32At(b, q); q += 4
          if (mla6 >= 0) q++ // extra 1B
          frames = Math.floor(dataLen / 36)
          if (frames > 0 && frames < 10000) {
            // 检查旋转分量范围（骨骼0 首帧 qz 绝对值 + 全帧 qz span 最大值）
            for (let bi = 0; bi < Math.min(boneCount, 5); bi++) {
              let bq = q
              if (bi > 0) {
                if (mla1 >= 0) bq += 8 // 0013 有 8B 头
                else bq = q + bi * (dataLen + 8) // 0006 也可能有
              }
              // 找该块内 qz 的最大跨度
              let mnQz = Infinity, mxQz = -Infinity
              for (let f = 0; f < Math.min(frames, 5); f++) {
                let fp = bq + f * 36
                // 帧格式：3B t + 8 f32 (0006) 或 9 f32 无 t (0001)
                const qzOff = mla6 >= 0 ? 3 + 5*4 : 5*4  // 0006: 3B t + 8 f32, qz=5th f32; 0001: 9 f32, qz=5th f32
                const qz = f32At(b, fp + qzOff)
                if (Number.isFinite(qz) && Math.abs(qz) < 100) {
                  if (qz < mnQz) mnQz = qz
                  if (qz > mxQz) mxQz = qz
                }
              }
              if (Number.isFinite(mnQz) && mxQz - mnQz > 1) { maxQzSpan = Math.max(maxQzSpan, mxQz - mnQz); hasQ++ }
              if (Number.isFinite(mnQz) && Math.abs(mnQz) > maxQz) maxQz = Math.abs(mnQz)
              if (Number.isFinite(mxQz) && Math.abs(mxQz) > maxQz) maxQz = Math.abs(mxQz)
            }
          }
        }
        found++
        let fmt = '?'
        if (magic === '0013') fmt = '0013'
        else if (magic === '0021') fmt = '0021'
        else if (magic === '0023') fmt = '0023'
        const qzFlag = maxQz > 1 ? ' QZ>1(EULER!)' : maxQz > 0.3 ? ' QZ>0.3' : ''
        const hasMulti = boneCount > 1 ? ' bones=' + boneCount : ''
        console.log(dir + ' ' + fmt + ' ' + e.name + ' anim=' + animCount + ' bc=' + bc + ' frames=' + frames + ' dur=' + dur + ' maxQz=' + maxQz.toFixed(3) + qzFlag + hasMulti)
        break
      }
    }
  } catch {}
}
console.log('\n总计 puppet 壁纸数: ' + found)