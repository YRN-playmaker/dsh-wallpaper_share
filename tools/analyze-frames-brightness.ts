// 逐帧亮度分析：模拟渲染器对 spritesheet 每帧（含越界 clamp）的实际裁剪，看是否有帧异常亮/暗
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
function analyze(texName: string): void {
  const b = pkg.read(texName)!
  const tex = decodeTex(b)
  if (tex === null || tex.mip0 === null || tex.frames === null) { console.log(texName + ' 无法解析'); return }
  const W = tex.mip0.width, H = tex.mip0.height
  const rgba = tex.mip0.rgba!
  console.log('=== ' + texName.split('/').pop() + ' ' + W + 'x' + H + ' frames=' + tex.frames.length + ' ===')
  tex.frames.forEach((f, i) => {
    // 完全模拟渲染器 clamp（line 1204-1207）
    const rx = Math.max(0, Math.min(W - 1, Math.round(f.x)))
    const ry = Math.max(0, Math.min(H - 1, Math.round(f.y)))
    const rw = Math.max(1, Math.min(W - rx, Math.round(Math.abs(f.w))))
    const rh = Math.max(1, Math.min(H - ry, Math.round(Math.abs(f.h))))
    let sum = 0, cnt = 0, alphaSum = 0
    for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) {
      const s = ((ry + y) * W + (rx + x)) * 4
      sum += (rgba[s] + rgba[s + 1] + rgba[s + 2]) / 3; alphaSum += rgba[s + 3]; cnt++
    }
    const lum = (sum / cnt).toFixed(1)
    const al = (alphaSum / cnt).toFixed(0)
    const oob = (f.x + f.w > W || f.y + f.h > H) ? '  <<越界' : ''
    console.log(`  帧${i}: rect(${Math.round(f.x)},${Math.round(f.y)},${Math.round(f.w)},${Math.round(f.h)}) → clamp(${rx},${ry},${rw},${rh}) 亮度=${lum} alpha=${al} t=${f.t.toFixed(3)}${oob}`)
  })
}
analyze('materials/a26caf8007678c9c489207faf8230ac6.tex')
analyze('materials/h8hsv5S.tex')
