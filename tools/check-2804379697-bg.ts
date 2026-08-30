// 解码 2804379697 的背景纹理，检查 dataOffset / 尺寸 / PNG 有效性
import { decodeTex, texMipToPng, texMimeOf } from '../src/scene/SceneTex.ts'
import fs from 'fs'
function utf8Slice(buf: Uint8Array, a: number, b: number): string { return Buffer.from(buf.subarray(a, b)).toString('utf8') }
interface Entry { name: string; offset: number; size: number }
function readPkg(path: string): { entries: Entry[]; dataStart: number; read(name: string): Uint8Array | null } {
  const buf = fs.readFileSync(path)
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  let pos = 0
  const readI32 = () => { const v = view.getInt32(pos, true); pos += 4; return v }
  const magicLen = readI32(); pos += magicLen; const version = readI32()
  const entries: Entry[] = []
  while (pos + 8 <= buf.length) {
    const nameLen = readI32(); if (nameLen <= 0 || nameLen > 2048 || pos + nameLen + 8 > buf.length) break
    const name = utf8Slice(buf, pos, pos + nameLen); pos += nameLen
    const offset = readI32(); const size = readI32()
    if (offset < 0 || size < 0 || offset + size > buf.length) break
    entries.push({ name, offset, size })
  }
  const dataStart = pos
  return { entries, dataStart, read: (n) => { const e = entries.find((x) => x.name === n); return e !== undefined ? buf.subarray(dataStart + e.offset, dataStart + e.offset + e.size) : null } }
}
const dir = 'D:/SteamLibrary/steamapps/workshop/content/431960/2804379697'
const pkg = readPkg(dir + '/scene.pkg')
const b = pkg.read('materials/背景.tex')!
console.log('背景.tex 总字节: ' + b.length)
const tex = decodeTex(b)
if (tex === null) { console.log('decodeTex FAILED'); process.exit(1) }
console.log('format=' + tex.format + ' flags=' + tex.flags)
console.log('tex=' + tex.textureWidth + 'x' + tex.textureHeight + ' img=' + tex.imageWidth + 'x' + tex.imageHeight)
console.log('container=' + tex.containerMagic + ' imageFormat=' + tex.imageFormat + ' mipCount=' + tex.mipCount)
console.log('mip0: ' + tex.mip0?.width + 'x' + tex.mip0?.height + ' kind=' + tex.mip0?.kind + ' dataOffset=' + tex.mip0?.dataOffset + ' dataLen=' + tex.mip0?.data.length)
console.log('frames=' + (tex.frames !== null ? tex.frames.length : 'null'))
console.log('mime=' + texMimeOf(tex))
// PNG 签名检查
const d = tex.mip0?.data
if (d !== null && d !== undefined && d.length > 8) {
  const sig = d[0] === 0x89 && d[1] === 0x50 && d[2] === 0x4e && d[3] === 0x47 && d[4] === 0x0d && d[5] === 0x0a && d[6] === 0x1a && d[7] === 0x0a
  console.log('mip0 data PNG 签名: ' + sig)
}
// 转 PNG 再验证
const png = texMipToPng(tex)
if (png !== null) {
  const sig = png[0] === 0x89 && png[1] === 0x50 && png[2] === 0x4e && png[3] === 0x47
  console.log('texMipToPng 输出: ' + png.length + 'B PNG签名=' + sig)
}
// 检查 PNG 尺寸（IHDR）
if (d !== null && d !== undefined && d[0] === 0x89 && d[12] === 0x49) {
  const w = (d[16] << 24) | (d[17] << 16) | (d[18] << 8) | d[19]
  const h = (d[20] << 24) | (d[21] << 16) | (d[22] << 8) | d[23]
  console.log('PNG IHDR: ' + w + 'x' + h)
}
// 人物纹理对比
const r = pkg.read('materials/人物.tex')!
const rt = decodeTex(r)
console.log('\n人物.tex: ' + (rt !== null ? rt.mip0?.width + 'x' + rt.mip0?.height + ' kind=' + rt.mip0?.kind + ' dataLen=' + rt.mip0?.data.length + ' dataOffset=' + rt.mip0?.dataOffset : 'FAIL'))
