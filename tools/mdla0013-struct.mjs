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
const f32At = (b, q) => new Float32Array(new Int32Array([(b[q] | (b[q+1]<<8) | (b[q+2]<<16) | (b[q+3]<<24)) | 0]).buffer)[0]
const u32At = (b, q) => (b[q] | (b[q+1]<<8) | (b[q+2]<<16) | (b[q+3]<<24)) >>> 0
const u16At = (b, q) => b[q] | (b[q+1]<<8)
const pkg = readPkg('D:/SteamLibrary/steamapps/workshop/content/431960/2804379697/scene.pkg')
const b = pkg.read('models/右眼_puppet.mdl')
const find = (bytes, tag, from = 0) => {
  const len = bytes.length
  const t = new Uint8Array(tag.length)
  for (let i = 0; i < tag.length; i++) t[i] = tag.charCodeAt(i)
  let i = from
  while (i < len - tag.length) {
    let ok = true
    for (let k = 0; k < tag.length; k++) if (bytes[i+k] !== t[k]) { ok = false; break }
    if (ok) return i
    i++
  }
  return -1
}
const mdla = find(b, 'MDLA0001')
console.log('MDLA0001 @', mdla)
// 逐字节 dump 从 mdla 到 +200
const dumpRow = (off, n) => {
  const bytes = Array.from(b.subarray(off, off + n)).map(x => x.toString(16).padStart(2, '0')).join(' ')
  const ascii = Array.from(b.subarray(off, off + n)).map(x => x >= 32 && x < 127 ? String.fromCharCode(x) : '.').join('')
  console.log(String(off).padStart(7) + ': ' + bytes.padEnd(48) + ' |' + ascii + '|')
}
for (let off = mdla; off < mdla + 200; off += 16) dumpRow(off, 16)
// 字段解读（尝试对齐 MDLA0006 结构）
console.log()
console.log('=== 结构解读 ===')
let q = mdla
console.log('magic:', utf8Slice(b, q, q + 8), '@', q)
q += 8
console.log('b[+8]=', b[q], '(\\0?)')
q += 1
const uA = u32At(b, q); q += 4
console.log('u32@+9 =', uA, '(可能是数据长度)')
const uB = u32At(b, q); q += 4
console.log('u32@+13 =', uB, '(animCount=1?)')
// 条目从 mdla+17
const id = u32At(b, q); q += 4
console.log('id@+17 =', id)
const uC = u32At(b, q); q += 4
console.log('id后 u32 =', uC)
// name
let nm = ''
let s = q
while (b[s] !== 0) { nm += String.fromCharCode(b[s]); s++ }
console.log('name =', JSON.stringify(nm), '@', q)
q = s + 1
let lp = ''
s = q
while (b[s] !== 0) { lp += String.fromCharCode(b[s]); s++ }
console.log('loop =', JSON.stringify(lp), '@', q)
q = s + 1
console.log('duration f32 =', f32At(b, q))
q += 4
console.log('bc u32 =', u32At(b, q))
q += 4
for (let i = 0; i < 4; i++) {
  const v = u32At(b, q)
  console.log('u32[' + i + '] @' + q + ' =', v)
  q += 4
}
console.log('q now =', q, '(数据起点?)')
console.log('数据区首16B f32:', Array.from({length:4},(_,k)=>f32At(b, q + k*4).toFixed(4)).join(', '))
