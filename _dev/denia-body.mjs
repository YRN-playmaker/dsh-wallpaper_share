// 导出达妮娅身体纹理（03身-改），确认面部是否自带眼睛
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { decodeTex, texMipToPng } from '../src/scene/SceneTex.ts'

const PKG = 'D:/SteamLibrary/steamapps/workshop/content/431960/3791428510/scene.pkg'
const OUT = resolve(import.meta.dirname, 'denia-out')

function parsePkg(buf) {
  let pos = 0
  const i32 = () => { const v = buf.readInt32LE(pos); pos += 4; return v }
  const magicLen = i32(); pos += magicLen; pos += 4
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
  return {
    entries,
    read: (n) => { const e = entries.find((x) => x.name === n); return e === undefined ? null : buf.subarray(dataStart + e.offset, dataStart + e.offset + e.size) },
  }
}
const pkg = parsePkg(readFileSync(PKG))
mkdirSync(resolve(OUT, 'png'), { recursive: true })
for (const n of ['materials/03身-改.tex', 'materials/08头发-脸部上层.tex']) {
  const b = pkg.read(n)
  if (b === null) { console.log('MISSING ' + n); continue }
  const tex = decodeTex(b)
  if (tex === null) { console.log('DECODE FAIL ' + n); continue }
  const png = texMipToPng(tex)
  const safe = n.replace(/[\\/]/g, '__').replace(/\.tex$/, '') + '.png'
  writeFileSync(resolve(OUT, 'png', safe), png)
  console.log(`${n}: format=${tex.format} tex=${tex.textureWidth}x${tex.textureHeight} img=${tex.imageWidth}x${tex.imageHeight} -> ${safe}`)
}
// 模型 json 的 cropoffset
for (const n of ['models/03身-改.json', 'models/09眼睛.json']) {
  const b = pkg.read(n)
  console.log(n + ': ' + (b === null ? 'missing' : b.toString('utf8').replace(/\s+/g, ' ').slice(0, 160)))
}
