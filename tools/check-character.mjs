// 检查 models/人物.json 的 puppet 及其动画（人物异常上下运动来源）
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
const pkg = readPkg('D:/SteamLibrary/steamapps/workshop/content/431960/2804379697/scene.pkg')
const charBuf = pkg.read('models/人物.json')
if (!charBuf) { console.log('人物.json 不存在'); process.exit(0) }
const text = Buffer.from(charBuf).toString('utf8')
console.log('models/人物.json:', text.slice(0, 300))
const puppetPath = text.match(/"puppet"\s*:\s*"([^"]+)"/)?.[1]
console.log('puppet:', puppetPath)
if (!puppetPath) { console.log('人物.json 无 puppet'); process.exit(0) }
const b = pkg.read(puppetPath)
if (!b) { console.log('puppet 文件不存在'); process.exit(0) }
const magic = String.fromCharCode(...b.slice(0, 8))
console.log('\npuppet 魔数: "' + magic + '" len=' + b.length)
const findTag = (bb, tag) => {
  const t = new Uint8Array(tag.length)
  for (let i = 0; i < t.length; i++) t[i] = tag.charCodeAt(i)
  for (let i = 0; i < bb.length - t.length; i++) {
    let ok = true
    for (let k = 0; k < t.length; k++) if (bb[i+k] !== t[k]) { ok = false; break }
    if (ok) return i
  }
  return -1
}
const mdls = findTag(b, 'MDLS0001')
const mdla = findTag(b, 'MDLA0001')
console.log('mdls@' + mdls + ' mdla@' + mdla)
// 骨骼
if (mdls >= 0) {
  const bc = u32At(b, mdls + 13)
  console.log('boneCount=' + bc)
  let q = mdls + 17
  for (let i = 0; i < Math.min(bc, 30) && q + 77 <= b.length; i++) {
    const parent = (b[q+5] | (b[q+6]<<8) | (b[q+7]<<16) | (b[q+8]<<24)) | 0
    const mp = q + 13
    const m = []
    for (let k = 0; k < 16; k++) m.push(f32At(b, mp + k * 4))
    let j = mp + 64
    let nm = ''
    while (j < b.length && b[j] !== 0 && nm.length < 40) { nm += String.fromCharCode(b[j]); j++ }
    console.log('  bone' + i + ': t=(' + m[12].toFixed(1) + ',' + m[13].toFixed(1) + ') parent=' + parent + ' name="' + nm + '"')
    q = j + 1
  }
}
// 动画
if (mdla >= 0) {
  const ac = Math.min(8, u32At(b, mdla + 13))
  console.log('animCount=' + ac)
  let q = mdla + 17
  for (let a = 0; a < ac && q + 8 <= b.length; a++) {
    const id = u32At(b, q); q += 4
    q += 4
    let nm = ''
    while (b[q] !== 0 && nm.length < 40) { nm += String.fromCharCode(b[q]); q++ }
    q++
    let lp = ''
    while (b[q] !== 0 && lp.length < 40) { lp += String.fromCharCode(b[q]); q++ }
    q++
    if (nm === '' || q + 20 > b.length) break
    const duration = f32At(b, q); q += 4
    const bc2 = u32At(b, q); q += 4
    q += 4
    const boneCount2 = u32At(b, q); q += 4
    q += 4
    const dataLen = u32At(b, q); q += 4
    console.log('  anim id=' + id + ' name="' + nm + '" loop="' + lp + '" dur=' + duration + ' bc=' + bc2 + ' boneCount=' + boneCount2 + ' dataLen=' + dataLen)
    if (dataLen > 0 && dataLen <= b.length - q) {
      const frames = Math.floor(dataLen / 36)
      console.log('    frames=' + frames)
      // 骨骼0 关键帧抽样
      let bq = q
      for (let bi = 0; bi < Math.min(boneCount2, 3); bi++) {
        if (bi > 0) {
          const h0 = u32At(b, bq), h1 = u32At(b, bq + 4)
          if (h0 !== 0 || h1 !== dataLen) { console.log('    !! 骨骼' + bi + ' 头不匹配'); break }
          bq += 8
        }
        // maxSpan
        let maxSpan = 0
        for (let vi = 0; vi < 9; vi++) {
          let mn = Infinity, mx = -Infinity
          for (let f = 0; f < frames; f++) {
            const v = f32At(b, bq + f * 36 + vi * 4)
            if (v < mn) mn = v
            if (v > mx) mx = v
          }
          if (mx - mn > maxSpan) maxSpan = mx - mn
        }
        const v0 = [0,1,2,3,4,5,6,7,8].map(k => f32At(b, bq + k * 4))
        const v1 = [0,1,2,3,4,5,6,7,8].map(k => f32At(b, bq + 36 + k * 4))
        console.log('    骨骼' + bi + ': maxSpan=' + maxSpan.toFixed(1) + ' f0=(' + v0[0].toFixed(1) + ',' + v0[1].toFixed(1) + ',' + v0[2].toFixed(1) + ') q=(' + v0[3].toFixed(2) + ',' + v0[4].toFixed(2) + ',' + v0[5].toFixed(2) + ') s=(' + v0[6].toFixed(2) + ',' + v0[7].toFixed(2) + ',' + v0[8].toFixed(2) + ') | f1=(' + v1[0].toFixed(1) + ',' + v1[1].toFixed(1) + ')')
        bq += frames * 36
      }
    }
    q += dataLen + 8 * (boneCount2 - 1) // 粗略前进
  }
}
