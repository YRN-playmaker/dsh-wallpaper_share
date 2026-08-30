// 合成模拟：2164591875 白天图+夜空图 按 dayNight factor 合成的最终帧亮度
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
function getFrame(texName: string, frameIdx: number): { rgba: Uint8ClampedArray; w: number; h: number } | null {
  const b = pkg.read(texName)!
  const tex = decodeTex(b)
  if (tex === null || tex.mip0 === null || tex.frames === null) return null
  const W = tex.mip0.width
  const rgba = tex.mip0.rgba!
  const f = tex.frames[frameIdx]
  const fw = Math.round(Math.abs(f.w)); const fh = Math.round(Math.abs(f.h)); const fx = Math.round(f.x); const fy = Math.round(f.y)
  const crop = new Uint8ClampedArray(fw * fh * 4)
  for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) {
    const s = ((fy + y) * W + (fx + x)) * 4
    crop.set(rgba.subarray(s, s + 4), (y * fw + x) * 4)
  }
  return { rgba: crop, w: fw, h: fh }
}
const day = getFrame('materials/a26caf8007678c9c489207faf8230ac6.tex', 0)!
const night = getFrame('materials/h8hsv5S.tex', 0)!
const W = day.w, H = day.h
// alpha 合成：src = 夜空 (上层, a=nightFactor), dst = 白天 (下层)
// 逐像素 source-over
function composite(nightFactor: number): number {
  let sum = 0
  for (let i = 0; i < W * H * 4; i += 4) {
    const dr = day.rgba[i], dg = day.rgba[i + 1], db = day.rgba[i + 2]
    const sr = night.rgba[i], sg = night.rgba[i + 1], sb = night.rgba[i + 2], sa = night.rgba[i + 3] * nightFactor
    const a = sa / 255
    const outR = Math.round(sr * a + dr * (1 - a))
    const outG = Math.round(sg * a + dg * (1 - a))
    const outB = Math.round(sb * a + db * (1 - a))
    sum += (outR + outG + outB) / 3
  }
  return sum / (W * H)
}
console.log('白天图亮度: ' + per(day))
console.log('夜空图亮度: ' + per(night))
console.log('--- 合成（夜空在上层，source-over）---')
for (const f of [0, 0.25, 0.5, 0.75, 1]) {
  console.log('  nightFactor=' + f.toFixed(2) + ' -> 合成亮度=' + composite(f).toFixed(1))
}
console.log('\n  nightFactor=0 (纯白天): 亮度应≈白天图 ' + per(day).toFixed(1))
console.log('  nightFactor=1 (纯夜空): 亮度应≈夜空图 ' + per(night).toFixed(1))
function per(fr: { rgba: Uint8ClampedArray }): number {
  const r = fr.rgba; let s = 0
  for (let i = 0; i < r.length; i += 4) s += (r[i] + r[i + 1] + r[i + 2]) / 3
  return s / (W * H)
}
