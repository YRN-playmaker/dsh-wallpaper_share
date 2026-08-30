import fs from 'fs'
function utf8Slice(buf, a, b) { return Buffer.from(buf.subarray(a, b)).toString('utf8') }
const readPkg = (path) => {
  const buf = fs.readFileSync(path)
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  let pos = 0
  const readI32 = () => { const v = view.getInt32(pos, true); pos += 4; return v }
  const magicLen = readI32(); pos += magicLen; const version = readI32()
  const entries = []
  while (pos + 8 <= buf.length) {
    const nameLen = readI32(); if (nameLen <= 0 || nameLen > 2048 || pos + nameLen + 8 > buf.length) break
    const name = utf8Slice(buf, pos, pos + nameLen); pos += nameLen
    const offset = readI32(); const size = readI32()
    if (offset < 0 || size < 0 || offset + size > buf.length) break
    entries.push({ name, offset, size })
  }
  const dataStart = pos
  const read = (n) => { const e = entries.find((x) => x.name === n); return e ? buf.subarray(dataStart + e.offset, dataStart + e.offset + e.size) : null }
  return { read, entries }
}
const pkg = readPkg('D:/SteamLibrary/steamapps/workshop/content/431960/2804379697/scene.pkg')
const b = pkg.read('models/右眼_puppet.mdl')
const f32At = (q) => new Float32Array(new Int32Array([(b[q] | (b[q+1]<<8) | (b[q+2]<<16) | (b[q+3]<<24)) | 0]).buffer)[0]
const u32At = (q) => (b[q] | (b[q+1]<<8) | (b[q+2]<<16) | (b[q+3]<<24)) >>> 0
const i32At = (q) => (b[q] | (b[q+1]<<8) | (b[q+2]<<16) | (b[q+3]<<24)) | 0
// MDLS0001 @79575, count@+13
const mdls = 79575
const boneCount = u32At(mdls + 13)
console.log('MDLS0001 boneCount:', boneCount)
// 尝试 0004 布局：定义表 @+18
let q = mdls + 18
console.log('0004布局 定义表起点:', q)
for (let i = 0; i < Math.min(boneCount, 5); i++) {
  const parent = i32At(q + 4)
  const mp = q + 12
  const bind = []
  for (let k = 0; k < 16; k++) bind.push(f32At(mp + k * 4))
  console.log(`  bone${i}: parent=${parent} bind[0..3]=${bind.slice(0,4).map(v=>v.toFixed(2)).join(',')}`)
  let j = mp + 64
  while (j < b.length && b[j] !== 0 && j < q + 4096) j++
  q = j + 2
}
console.log('0004 布局骨骼区结束后 q =', q, ' MDLA0001@79982, 差 =', 79982 - q)
// 尝试 0003 布局：定义表 @+17
q = mdls + 17
console.log()
console.log('0003布局 定义表起点:', q)
for (let i = 0; i < Math.min(boneCount, 5); i++) {
  const parent = i32At(q + 5)
  const mp = q + 13
  const bind = []
  for (let k = 0; k < 16; k++) bind.push(f32At(mp + k * 4))
  console.log(`  bone${i}: parent=${parent} bind[0..3]=${bind.slice(0,4).map(v=>v.toFixed(2)).join(',')}`)
  let j = mp + 64
  while (j < b.length && b[j] !== 0 && j < q + 4096) j++
  q = j + 1
}
console.log('0003 布局骨骼区结束后 q =', q, ' MDLA0001@79982, 差 =', 79982 - q)
