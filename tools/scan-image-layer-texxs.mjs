// 全库扫描：找出 image 图层引用了带 TEXS 纹理的图层（可能被误判为 spritesheet 动画）
import { decodeTex } from '../src/scene/SceneTex.ts'
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
let found = 0
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
    // 材质 json → 纹理名 + 是否 spritesheet
    const matTexMap = new Map()
    const matSprite = new Map()
    for (const e of pkg.entries) {
      if (!e.name.startsWith('materials/') || !e.name.endsWith('.json')) continue
      try {
        const t = Buffer.from(pkg.read(e.name)).toString('utf8')
        matTexMap.set(e.name, [...t.matchAll(/"textures"\s*:\s*\[\s*"([^"]+)"/g)].map(m => m[1]))
        matSprite.set(e.name, /"spritesheet"\s*:\s*[1-9]/.test(t))
      } catch {}
    }
    const modelMatMap = new Map()
    for (const e of pkg.entries) {
      if (!e.name.startsWith('models/') || !e.name.endsWith('.json')) continue
      try {
        const t = Buffer.from(pkg.read(e.name)).toString('utf8')
        const m = /"material"\s*:\s*"([^"]+)"/.exec(t)
        modelMatMap.set(e.name, m !== null ? m[1] : null)
      } catch {}
    }
    // scene.json 图层
    const sceneText = Buffer.from(pkg.read('scene.json')).toString('utf8')
    const objStart = sceneText.indexOf('"objects"')
    const objBlock = objStart >= 0 ? sceneText.slice(objStart) : ''
    let idx = 0; let count = 0
    while (idx < objBlock.length && count < 120) {
      const st = objBlock.indexOf('{', idx)
      if (st < 0) break
      let depth = 0; let end = -1
      for (let i = st; i < objBlock.length; i++) {
        const c = objBlock[i]
        if (c === '{') depth++
        else if (c === '}') { depth--; if (depth === 0) { end = i; break } }
      }
      if (end < 0) break
      const blk = objBlock.slice(st, end + 1)
      const idM = /"id"\s*:\s*(\d+)/.exec(blk)
      const imageM = /"image"\s*:\s*"([^"]+)"/.exec(blk)
      if (idM !== null && imageM !== null) {
        const mat = modelMatMap.get(imageM[1]) ?? null
        if (mat !== null && matSprite.get(mat) !== true) {
          const texs = matTexMap.get(mat) ?? []
          for (const tn of texs) {
            const tname = tn.startsWith('materials/') ? tn : 'materials/' + tn + '.tex'
            const b = pkg.read(tname)
            if (b === undefined) continue
            let f = 0
            try { const tex = decodeTex(b); f = tex !== null && tex.frames !== null ? tex.frames.length : 0 } catch {}
            if (f > 1) {
              found++
              console.log('*** 误判风险: ' + dir + ' id=' + idM[1] + ' model=' + imageM[1] + ' mat=' + mat + ' tex=' + tn + ' ' + f + 'TEXS (材质无spritesheet)')
            }
          }
        }
      }
      idx = end + 1; count++
    }
  } catch {}
}
console.log('\n误判总数: ' + found)
