// 达妮娅眼睛层 + 眨眼用的两张 mask 纹理探测：解码 .tex → 统计 + 导出 PNG
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { decodeTex, texMipToPng } from '../src/scene/SceneTex.ts'

const PKG = 'D:/SteamLibrary/steamapps/workshop/content/431960/3791428510/scene.pkg'
const OUT = resolve(import.meta.dirname, 'denia-out')

function parsePkg(buf) {
  let pos = 0
  const i32 = () => { const v = buf.readInt32LE(pos); pos += 4; return v }
  const magicLen = i32()
  const magic = buf.subarray(pos, pos + magicLen).toString('utf8'); pos += magicLen
  const version = i32()
  const entries = []
  for (;;) {
    if (pos + 8 > buf.length) break
    const nameLen = buf.readInt32LE(pos); pos += 4
    if (nameLen <= 0 || nameLen > 2048 || pos + nameLen + 8 > buf.length) break
    const name = buf.subarray(pos, pos + nameLen).toString('utf8'); pos += nameLen
    const offset = buf.readInt32LE(pos); pos += 4
    const size = buf.readInt32LE(pos); pos += 4
    if (offset < 0 || size < 0 || offset + size > buf.length) break
    entries.push({ name, offset, size })
  }
  const dataStart = pos
  return { read: (n) => { const e = entries.find((x) => x.name === n); return e === undefined ? null : buf.subarray(dataStart + e.offset, dataStart + e.offset + e.size) } }
}

const pkg = parsePkg(readFileSync(PKG))
mkdirSync(resolve(OUT, 'png'), { recursive: true })
const names = [
  'materials/09眼睛.tex',
  'materials/masks/shake_mask_73999545.tex',
  'materials/masks/shake_mask_5bdb3707.tex',
]
for (const n of names) {
  const b = pkg.read(n)
  if (b === null) { console.log('MISSING ' + n); continue }
  const tex = decodeTex(b)
  if (tex === null) { console.log('DECODE FAIL ' + n); continue }
  const png = texMipToPng(tex)
  const safe = n.replace(/[\\/]/g, '__').replace(/\.tex$/, '') + '.png'
  if (png !== null) writeFileSync(resolve(OUT, 'png', safe), png)
  const m = tex.mip0
  let stat = 'rgba=null'
  if (m !== null && m.rgba !== null) {
    const a = m.rgba
    const mins = [255, 255, 255, 255], maxs = [0, 0, 0, 0], sums = [0, 0, 0, 0]
    let n498 = 0
    const cnt = a.length / 4
    for (let i = 0; i < a.length; i += 4) {
      for (let c = 0; c < 4; c++) {
        const v = a[i + c]
        if (v < mins[c]) mins[c] = v
        if (v > maxs[c]) maxs[c] = v
        sums[c] += v
      }
      if (Math.abs(a[i] - 127) <= 2 && Math.abs(a[i + 1] - 127) <= 2) n498++
    }
    stat = `min=[${mins}] max=[${maxs}] mean=[${sums.map((s) => (s / cnt).toFixed(1))}] near127rg=${(n498 / cnt * 100).toFixed(1)}%`
  }
  console.log(`${n}\n  format=${tex.format} flags=${tex.flags} tex=${tex.textureWidth}x${tex.textureHeight} img=${tex.imageWidth}x${tex.imageHeight} mips=${tex.mipCount} mip0kind=${m?.kind} frames=${tex.frames === null ? 'none' : tex.frames.length}\n  ${stat}`)
}
