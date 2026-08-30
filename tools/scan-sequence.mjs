// 扫描所有壁纸 scene.json / model json 中的 sequence / spritesheet 动画
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
const workshop = 'D:/SteamLibrary/steamapps/workshop/content/431960'
const dirs = fs.readdirSync(workshop).filter(d => /^\d+$/.test(d))
for (const dir of dirs) {
  const projPath = workshop + '/' + dir + '/project.json'
  if (!fs.existsSync(projPath)) continue
  let proj = null
  try { proj = JSON.parse(fs.readFileSync(projPath, 'utf8')) } catch { continue }
  if (!/scene/i.test(proj.type || '')) continue
  const pkgPath = workshop + '/' + dir + '/scene.pkg'
  if (!fs.existsSync(pkgPath)) continue
  try {
    const pkg = readPkg(pkgPath)
    const jsonFiles = pkg.entries.filter(e => e.name.endsWith('.json'))
    for (const jf of jsonFiles) {
      const text = Buffer.from(pkg.read(jf.name)).toString('utf8')
      if (!text) continue
      // sequence 对象（image 动画）
      if (/"(sequence|seqfps|seqframes|seqrow|seqcol|spritesheet|spritelength|framerate)"\s*:/.test(text)) {
        // 提取该 json 的相关片段
        const idx = text.search(/"(sequence|seqfps|seqframes|seqrow|seqcol|spritesheet|spritelength|framerate)"\s*:/)
        console.log('### ' + dir + ' ' + jf.name)
        console.log('  ' + text.slice(Math.max(0, idx - 120), idx + 250).replace(/\s+/g, ' ').slice(0, 350))
      }
    }
    // 检查 material combos spritesheet
    const mats = pkg.entries.filter(e => e.name.startsWith('materials/') && e.name.endsWith('.json'))
    for (const mf of mats) {
      const text = Buffer.from(pkg.read(mf.name)).toString('utf8')
      if (/spritesheet\s*:\s*[1-9]/.test(text)) {
        console.log('SPRITE-MAT ' + dir + ' ' + mf.name)
      }
    }
  } catch {}
}
console.log('\n=== 完成 ===')
