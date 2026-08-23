// 验证内嵌 PNG 实际尺寸（mip0.data 的 PNG 头）
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
  const read = (n) => {
    const e = entries.find((x) => x.name === n)
    if (!e) return null
    return buf.subarray(dataStart + e.offset, dataStart + e.offset + e.size)
  }
  return { read }
}

const pkg = parsePkg(readFileSync('D:/SteamLibrary/steamapps/workshop/content/431960/3409595232/scene.pkg'))
const tex = decodeTex(pkg.read('materials/导出初音.tex'))
console.log('tex texture=' + tex.textureWidth + 'x' + tex.textureHeight + ' image=' + tex.imageWidth + 'x' + tex.imageHeight)
const d = tex.mip0.data
console.log('mip0 kind=' + tex.mip0.kind + ' dataLen=' + d.length + ' dataOffset=' + tex.mip0.dataOffset)
// PNG 头：89 50 4E 47 0D 0A 1A 0A + IHDR len(4) + 'IHDR' + W(4) H(4)
if (d[0] === 0x89 && d[1] === 0x50) {
  const w = d.readUInt32BE(16)
  const h = d.readUInt32BE(20)
  console.log('embedded PNG: ' + w + 'x' + h)
} else if (d[0] === 0xff && d[1] === 0xd8) {
  // JPEG: SOI + APP0/APP1 找 SOF
  console.log('embedded JPEG')
} else {
  console.log('not png/jpeg, head: ' + d.subarray(0, 16).toString('hex'))
}
// 对比：图层纹理路由的 bmp 实际尺寸（fetch 返回）
console.log('layerTexImage（路由头）= ' + tex.imageWidth + 'x' + tex.imageHeight)
