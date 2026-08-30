// 解码 2164591875 两个纹理的 mip0，裁剪出每一帧并导出 PNG，供视觉验证
import { decodeTex } from '../src/scene/SceneTex.ts'
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
// PNG 编码（最小）：IHDR + IDAT(zlib 存储) + IEND
function encodePng(w: number, h: number, rgba: Uint8Array): Uint8Array {
  const crcTable = (() => {
    const t = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
      t[n] = c >>> 0
    }
    return t
  })()
  const crc = (buf: Uint8Array): number => {
    let c = 0xffffffff
    for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type: string, data: Uint8Array): Uint8Array => {
    const len = data.length
    const out = new Uint8Array(12 + len)
    const dv = new DataView(out.buffer)
    dv.setUint32(0, len)
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
    out.set(data, 8)
    out.set(data, 8)
    dv.setUint32(8 + len, crc(out.subarray(4, 8 + len)))
    return out
  }
  // IHDR
  const ihdr = new Uint8Array(13)
  const id = new DataView(ihdr.buffer)
  id.setUint32(0, w); id.setUint32(4, h)
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  // IDAT: zlib 存储块（不压缩，够用）
  const raw = new Uint8Array(h * (1 + w * 4))
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 4)] = 0
    raw.set(rgba.subarray(y * w * 4, (y + 1) * w * 4), y * (1 + w * 4) + 1)
  }
  const zlib = new Uint8Array(2 + raw.length + 4)
  zlib[0] = 0x78; zlib[1] = 0x01
  zlib.set(raw, 2)
  const dv2 = new DataView(zlib.buffer)
  let ad = 1
  for (let i = 0; i < raw.length; i++) ad = (ad + raw[i]) & 0xffff
  dv2.setUint16(2 + raw.length, ad >>> 0)
  const outParts = [chunk('IHDR', ihdr), chunk('IDAT', zlib), chunk('IEND', new Uint8Array(0))]
  const total = outParts.reduce((a, b) => a + b.length, 0)
  const out = new Uint8Array(8 + total)
  out[0] = 137; out[1] = 80; out[2] = 78; out[3] = 71
  out[4] = 13; out[5] = 10; out[6] = 26; out[7] = 10
  let off = 8
  for (const p of outParts) { out.set(p, off); off += p.length }
  return out
}
const outDir = 'D:/SteamLibrary/steamapps/workshop/content/431960/2164591875/_frames'
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir)
const dir = 'D:/SteamLibrary/steamapps/workshop/content/431960/2164591875'
const pkg = readPkg(dir + '/scene.pkg')
for (const texName of ['materials/a26caf8007678c9c489207faf8230ac6.tex', 'materials/h8hsv5S.tex']) {
  const b = pkg.read(texName)!
  const tex = decodeTex(b)
  if (tex === null || tex.mip0 === null) { console.log('FAIL ' + texName); continue }
  const W = tex.mip0.width
  const H = tex.mip0.height
  const rgba = tex.mip0.rgba
  if (rgba === null || rgba === undefined) { console.log('no rgba ' + texName); continue }
  const base = texName.split('/').pop()!.replace('.tex', '')
  console.log('tex=' + texName + ' W=' + W + ' H=' + H + ' frames=' + (tex.frames !== null ? tex.frames.length : 0))
  if (tex.frames !== null) {
    tex.frames.forEach((f, i) => {
      const fw = Math.round(Math.abs(f.w))
      const fh = Math.round(Math.abs(f.h))
      const fx = Math.round(f.x)
      const fy = Math.round(f.y)
      if (fw <= 0 || fh <= 0 || fx < 0 || fy < 0 || fx + fw > W || fy + fh > H) { console.log('  帧' + i + ' 越界 fw=' + fw + ' fh=' + fh + ' fx=' + fx + ' fy=' + fy); return }
      const crop = new Uint8Array(fw * fh * 4)
      for (let y = 0; y < fh; y++) {
        for (let x = 0; x < fw; x++) {
          const src = ((fy + y) * W + (fx + x)) * 4
          crop.set(rgba.subarray(src, src + 4), (y * fw + x) * 4)
        }
      }
      const png = encodePng(fw, fh, crop)
      const fn = base + '_frame' + i + '.png'
      fs.writeFileSync(outDir + '/' + fn, png)
      console.log('  导出 ' + fn + ' ' + fw + 'x' + fh)
    })
  } else {
    const png = encodePng(W, H, rgba)
    const fn = base + '_full.png'
    fs.writeFileSync(outDir + '/' + fn, png)
    console.log('  导出(整图) ' + fn + ' ' + W + 'x' + H)
  }
}
console.log('导出目录: ' + outDir)
