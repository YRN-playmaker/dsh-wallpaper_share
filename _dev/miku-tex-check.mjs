// 检查 Miku tex 解码详情：mip0.kind、尺寸、image 区域 vs tex 画布
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = fileURLToPath(import.meta.url).replace(/\\/g, '/')
const root = here.slice(0, here.lastIndexOf('/_dev/'))
const { decodeTex } = await import(pathToFileURL(join(root, 'src/scene/SceneTex.ts')).href)

function parsePkg(buf) {
  let pos = 16
  const entries = []
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
  return (n) => { const e = entries.find((x) => x.name === n); if (!e) return null; return buf.subarray(dataStart + e.offset, dataStart + e.offset + e.size) }
}

const read = parsePkg(readFileSync('D:/SteamLibrary/steamapps/workshop/content/431960/3409595232/scene.pkg'))
const tex = decodeTex(read('materials/导出初音.tex'))
if (tex === null) { console.log('tex null'); process.exit(0) }
console.log('tex 画布: ' + tex.textureWidth + 'x' + tex.textureHeight)
console.log('image 区域: ' + tex.imageWidth + 'x' + tex.imageHeight)
console.log('mip0.kind: ' + tex.mip0.kind)
console.log('mip0 数据长度: ' + tex.mip0.data.length)
console.log('mip0.dataOffset: ' + tex.mip0.dataOffset)
// 若内嵌 PNG：读 PNG 头拿真实尺寸
const d = tex.mip0.data
if (tex.mip0.kind === 'image-png' && d.length > 24) {
  const w = d.readUInt32BE(16)
  const h = d.readUInt32BE(20)
  console.log('内嵌 PNG 尺寸: ' + w + 'x' + h)
}
// 若 image-jpeg：JPEG SOF 找尺寸
if (tex.mip0.kind === 'image-jpeg') {
  let i = 2
  while (i + 9 < d.length) {
    if (d[i] !== 0xff) { i++; continue }
    const marker = d[i + 1]
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const h = d.readUInt16BE(i + 5)
      const w = d.readUInt16BE(i + 7)
      console.log('内嵌 JPEG 尺寸: ' + w + 'x' + h)
      break
    }
    i += 2 + d.readUInt16BE(i + 2)
  }
}
