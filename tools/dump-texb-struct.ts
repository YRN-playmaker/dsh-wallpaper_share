// dump h8hsv5S / a26caf 的完整 TEXB 结构：header 字段 + imageCount + 每 image 的 mip0 尺寸 + 帧 frameNumber
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
function dumpStruct(texName: string): void {
  const b = pkg.read(texName)!
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  let pos = 0
  const readNString = (): string => { let s = ''; while (pos < b.length) { const c = b[pos++]; if (c === 0) break; s += String.fromCharCode(c) } return s }
  const readI32 = (): number => { const v = dv.getInt32(pos, true); pos += 4; return v }
  const magic1 = readNString(); const magic2 = readNString()
  console.log('=== ' + texName.split('/').pop() + ' ===')
  console.log('  magic=' + magic1 + '/' + magic2)
  const format = readI32(); const flags = readI32()
  const texW = readI32(); const texH = readI32()
  const imgW = readI32(); const imgH = readI32()
  readI32() // UnkInt0
  console.log('  format=' + format + ' flags=' + flags + ' texWH=' + texW + 'x' + texH + ' imgWH=' + imgW + 'x' + imgH)
  const containerMagic = readNString()
  const imageCount = readI32()
  let imageFormat = 0
  if (containerMagic === 'TEXB0003') imageFormat = readI32()
  else if (containerMagic === 'TEXB0004') { imageFormat = readI32(); readI32() }
  console.log('  container=' + containerMagic + ' imageCount=' + imageCount + ' imageFormat=' + imageFormat)
  // 逐 image 解析 mip0
  for (let img = 0; img < imageCount; img++) {
    const mipCount = readI32()
    let firstW = 0, firstH = 0
    for (let mm = 0; mm < mipCount; mm++) {
      const w = readI32(); const h = readI32(); const isLz4 = readI32(); const dec = readI32(); const bc = readI32()
      if (mm === 0) { firstW = w; firstH = h }
      pos += bc
    }
    console.log('  image' + img + ': mipCount=' + mipCount + ' mip0=' + firstW + 'x' + firstH)
  }
  // TEXS
  const magic3 = String.fromCharCode(b[pos], b[pos + 1], b[pos + 2], b[pos + 3], b[pos + 4], b[pos + 5], b[pos + 6], b[pos + 7], b[pos + 8])
  console.log('  TEXS magic=' + JSON.stringify(magic3))
  if (magic3.startsWith('TEXS')) {
    let fp = pos + 9
    const readU32 = (): number => { const v = dv.getUint32(fp, true); fp += 4; return v }
    const readF32 = (): number => { const v = dv.getInt32(fp, true); fp += 4; return new Float32Array(new Int32Array([v]).buffer)[0] }
    const frameCount = readU32()
    console.log('  frameCount=' + frameCount)
    if (magic3 === 'TEXS0003\u0000') { console.log('  gifW=' + readU32() + ' gifH=' + readU32()) }
    for (let f = 0; f < frameCount && fp + 32 <= b.length; f++) {
      const frameNumber = readU32(); const t = readF32()
      const x = readF32(); const y = readF32(); const w1 = readF32(); const w2 = readF32(); const h2 = readF32(); const h1 = readF32()
      console.log(`  帧${f}: frameNumber=${frameNumber} t=${t.toFixed(3)} x=${x} y=${y} w1=${w1} w2=${w2} h2=${h2} h1=${h1}`)
    }
  }
}
dumpStruct('materials/h8hsv5S.tex')
dumpStruct('materials/a26caf8007678c9c489207faf8230ac6.tex')
