// 通过 project.json 找 scene 类型壁纸，扫描其 puppet 格式
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
let sceneCount = 0, puppetCount = 0
for (const dir of dirs) {
  const projPath = workshop + '/' + dir + '/project.json'
  if (!fs.existsSync(projPath)) continue
  let proj = null
  try { proj = JSON.parse(fs.readFileSync(projPath, 'utf8')) } catch { continue }
  const type = typeof proj.type === 'string' ? proj.type : ''
  const isScene = /scene/i.test(type)
  if (!isScene) continue
  sceneCount++
  // scene 文件：project.json 的 file 字段（如 scene.json / scene.pkg），或目录中的 scene.pkg
  const fileField = typeof proj.file === 'string' ? proj.file : ''
  let pkgPath = workshop + '/' + dir + '/scene.pkg'
  if (!fs.existsSync(pkgPath)) continue
  try {
    const pkg = readPkg(pkgPath)
    // 找所有 json 模型文件带 puppet 字段
    const modelFiles = pkg.entries.filter(e => e.name.startsWith('models/') && e.name.endsWith('.json'))
    const puppets = new Set()
    for (const mf of modelFiles) {
      try {
        const buf = pkg.read(mf.name)
        const text = Buffer.from(buf).toString('utf8')
        const m = text.match(/"puppet"\s*:\s*"([^"]+)"/)
        if (m) puppets.add(m[1])
      } catch {}
    }
    for (const pn of puppets) {
      const b = pkg.read(pn)
      if (!b || b.length < 8) continue
      const magic = String.fromCharCode(...b.slice(0, 4))
      const mla1 = findTag(b, 'MDLA0001'); const mla6 = findTag(b, 'MDLA0006')
      let boneCount = 0, maxQz = 0, animCount = 0
      const mdla = mla6 >= 0 ? mla6 : mla1
      if (mdla >= 0) {
        let q = mdla + 17
        animCount = u32At(b, mdla + 13)
        if (animCount > 0 && animCount < 100) {
          q += 4; q += 4
          while (b[q] !== 0) q++; q++
          while (b[q] !== 0) q++; q++
          q += 4 // duration
          q += 4 // bc
          q += 4
          boneCount = u32At(b, q); q += 4
          q += 4
          const dataLen = u32At(b, q); q += 4
          if (mla6 >= 0) q++
          const frames = Math.floor(dataLen / 36)
          if (frames > 0 && frames < 10000) {
            for (let bi = 0; bi < Math.min(boneCount, 4); bi++) {
              let bq = q
              if (bi > 0) {
                if (mla1 >= 0) bq += 8
                else bq = q + bi * dataLen
              }
              for (let f = 0; f < Math.min(frames, 8); f++) {
                const fp = bq + f * 36
                const qzOff = mla6 >= 0 ? 3 + 5 * 4 : 5 * 4
                const qz = f32At(b, fp + qzOff)
                if (Number.isFinite(qz) && Math.abs(qz) < 100 && Math.abs(qz) > maxQz) maxQz = Math.abs(qz)
              }
            }
          }
        }
      }
      puppetCount++
      const qzFlag = maxQz > 1 ? ' QZ>1(EULER!)' : maxQz > 0.3 ? ' QZ>0.3' : ''
      console.log(dir + ' ' + type + ' ' + pn + ' fmt=' + magic + ' anims=' + animCount + ' bones=' + boneCount + ' maxQz=' + maxQz.toFixed(3) + qzFlag)
    }
  } catch {}
}
console.log('\nscene 壁纸: ' + sceneCount + ' 含 puppet 壁纸数: ' + dirs.filter(d => { try { const j = JSON.parse(fs.readFileSync(workshop + '/' + d + '/project.json', 'utf8')); return /scene/i.test(j.type) && fs.existsSync(workshop + '/' + d + '/scene.pkg') } catch { return false } }).length)