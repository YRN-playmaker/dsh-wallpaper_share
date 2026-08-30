// 检查 2164591875 两个 spritesheet 纹理的 TEXS 帧时长解析 + per 计算
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
for (const texName of ['materials/a26caf8007678c9c489207faf8230ac6.tex', 'materials/h8hsv5S.tex']) {
  const b = pkg.read(texName)
  const tex = b !== null ? decodeTex(b) : null
  console.log('===== ' + texName + ' =====')
  if (tex === null) { console.log('  decodeTex FAILED'); continue }
  console.log('  mip0: ' + tex.mip0?.width + 'x' + tex.mip0?.height + ' kind=' + tex.mip0?.kind)
  if (tex.frames !== null) {
    console.log('  frames=' + tex.frames.length)
    const total = tex.frames.reduce((a, f) => a + f.t, 0)
    console.log('  totalDur=' + total)
    for (const f of tex.frames.slice(0, 6)) {
      console.log('    frame x=' + f.x + ' y=' + f.y + ' w=' + f.w + ' h=' + f.h + ' t=' + f.t)
    }
    if (tex.frames.length > 6) console.log('    ...(共' + tex.frames.length + '帧)')
    // 模拟 per 计算
    const per = total / tex.frames.length
    console.log('  per(单帧时长)= ' + per + ' s')
  } else {
    console.log('  frames=null (非动画)')
  }
}
