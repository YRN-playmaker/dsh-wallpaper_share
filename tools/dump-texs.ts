// dump h8hsv5S 和 a26caf 的 TEXS 原始字节，手动解码帧布局
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
function dump(texName: string): void {
  const b = pkg.read(texName)!
  // 找 TEXS magic
  let idx = -1
  for (let i = 0; i + 9 <= b.length; i++) {
    const m = String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3], b[i + 4], b[i + 5], b[i + 6], b[i + 7], b[i + 8])
    if (m === 'TEXS0001\u0000' || m === 'TEXS0002\u0000' || m === 'TEXS0003\u0000') { idx = i; break }
  }
  console.log('=== ' + texName.split('/').pop() + ' TEXS@' + idx + ' (total ' + b.length + ' bytes) ===')
  if (idx < 0) { console.log('  no TEXS'); return }
  const magic = String.fromCharCode(b[idx], b[idx + 1], b[idx + 2], b[idx + 3], b[idx + 4], b[idx + 5], b[idx + 6], b[idx + 7])
  console.log('  magic=' + magic)
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  let p = idx + 9
  const frameCount = dv.getUint32(p, true); p += 4
  console.log('  frameCount=' + frameCount)
  if (magic === 'TEXS0003') { console.log('  gifW=' + dv.getUint32(p, true) + ' gifH=' + dv.getUint32(p + 4, true)); p += 8 }
  // dump 每帧 32 字节
  for (let f = 0; f < frameCount && p + 32 <= b.length; f++) {
    const u = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => dv.getUint32(p + k * 4, true))
    const fl = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => dv.getFloat32(p + k * 4, true))
    console.log(`  帧${f}: u32=[${u.join(',')}]  f32=[${fl.map((x) => x.toFixed(2)).join(',')}]`)
    p += 32
  }
  // 剩余字节
  console.log('  TEXS 后剩余 ' + (b.length - p) + ' 字节')
}
dump('materials/h8hsv5S.tex')
dump('materials/a26caf8007678c9c489207faf8230ac6.tex')
