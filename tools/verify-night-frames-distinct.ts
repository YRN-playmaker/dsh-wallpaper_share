// 确认夜空图集 3 帧内容互不相同（frame0 vs frame2=image1）
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
const dir = 'D:/SteamLibrary/steamapps/workshop/content/431960/2164591875'
const pkg = readPkg(dir + '/scene.pkg')
const tex = decodeTex(pkg.read('materials/h8hsv5S.tex')!)!
const W = tex.mip0!.width
const rgba = tex.mip0!.rgba!
function regionMean(fx: number, fy: number, fw: number, fh: number): number[] {
  let r = 0, g = 0, b = 0, n = 0
  for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) {
    const s = ((fy + y) * W + (fx + x)) * 4
    r += rgba[s]; g += rgba[s + 1]; b += rgba[s + 2]; n++
  }
  return [r / n, g / n, b / n]
}
function regionDiff(a: [number, number], b: [number, number], fw: number, fh: number): number {
  let sum = 0, n = 0
  for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) {
    const sa = ((a[1] + y) * W + (a[0] + x)) * 4
    const sb = ((b[1] + y) * W + (b[0] + x)) * 4
    sum += Math.abs(rgba[sa] - rgba[sb]) + Math.abs(rgba[sa + 1] - rgba[sb + 1]) + Math.abs(rgba[sa + 2] - rgba[sb + 2])
    n++
  }
  return sum / n / 3
}
const frames = tex.frames!
console.log('图集 ' + W + 'x' + tex.mip0!.height + '，' + frames.length + ' 帧')
frames.forEach((f, i) => {
  const m = regionMean(Math.round(f.x), Math.round(f.y), Math.round(f.w), Math.round(f.h))
  console.log('  帧' + i + ' @(' + Math.round(f.x) + ',' + Math.round(f.y) + ') RGB均值=(' + m.map((v) => v.toFixed(1)).join(',') + ')')
})
console.log('  帧0 vs 帧1 平均像素差: ' + regionDiff([frames[0].x, frames[0].y], [frames[1].x, frames[1].y], 624, 384).toFixed(2))
console.log('  帧0 vs 帧2 平均像素差: ' + regionDiff([frames[0].x, frames[0].y], [frames[2].x, frames[2].y], 624, 384).toFixed(2))
console.log('  帧1 vs 帧2 平均像素差: ' + regionDiff([frames[1].x, frames[1].y], [frames[2].x, frames[2].y], 624, 384).toFixed(2))
