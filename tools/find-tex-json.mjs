// 在 scene.pkg 原始内容中搜索 spritesheet/sequence/fps 元数据（可能在 .tex 内嵌 JSON）
import fs from 'fs'
const workshop = 'D:/SteamLibrary/steamapps/workshop/content/431960'
for (const dir of ['2164591875', '2325500626', '2022733184', '1438064333', '3774904326']) {
  const pkgPath = workshop + '/' + dir + '/scene.pkg'
  if (!fs.existsSync(pkgPath)) { console.log(dir + ': no pkg'); continue }
  const buf = fs.readFileSync(pkgPath)
  const s = buf.toString('latin1')
  console.log('=== ' + dir + ' pkg=' + buf.length + 'B ===')
  // 找 spritesheet / sequence / framerate / frames 等关键字在 pkg 中的位置
  for (const kw of ['spritesheet', 'sequence', 'framerate', 'sprites', 'imagetype', 'fps', 'seq', 'frames']) {
    let idx = 0, cnt = 0
    const positions = []
    while ((idx = s.indexOf(kw, idx)) >= 0 && cnt < 5) {
      positions.push(idx)
      idx += kw.length; cnt++
    }
    if (cnt > 0) console.log('  "' + kw + '": ' + positions.slice(0, 3).join(', ') + (cnt > 3 ? '...' : ''))
  }
  // 检查 .tex 内嵌 JSON（TEXB 段附近常有 json 元数据）
  const texb = s.indexOf('TEXB')
  if (texb >= 0) {
    const chunk = s.slice(texb, texb + 2000)
    if (chunk.includes('{')) {
      const braceStart = chunk.indexOf('{')
      const snippet = chunk.slice(braceStart, Math.min(braceStart + 800, chunk.length))
      console.log('  TEXB@' + texb + ' 内嵌 JSON 片段:')
      console.log('    ' + snippet.slice(0, 500).replace(/\x00/g, ' '))
    }
  }
  console.log()
}
