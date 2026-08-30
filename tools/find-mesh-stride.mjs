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
// 头部结构分析：magic "0013" + json 材质 + 后面的数据
console.log('=== 头部 0-48 ===')
for (let i = 0; i < 48; i += 4) {
  const u32 = u32At(b, i)
  console.log(String(i).padStart(5), Array.from(b.subarray(i, i+4)).map(x=>x.toString(16).padStart(2,'0')).join(' '), 'u32=' + u32, 'f32=' + (Number.isFinite(f32At(b,i)) ? f32At(b,i).toFixed(3) : '?'))
}
// 材质路径在 offset 17 起（materials/右眼.json）
// 找材质结尾
let matEnd = 17
while (b[matEnd] !== 0 && matEnd < 200) matEnd++
console.log('材质结束 @', matEnd, JSON.stringify(utf8Slice(b, 17, matEnd)))
// 材质后结构（从 matEnd+1 开始）
let q = matEnd + 1
console.log()
console.log('=== 材质后 @' + q + ' ===')
for (let i = 0; i < 96 && q + i + 4 < b.length; i += 4) {
  const off = q + i
  const u32 = u32At(b, off)
  console.log(String(off).padStart(6), Array.from(b.subarray(off, off+4)).map(x=>x.toString(16).padStart(2,'0')).join(' '), 'u32=' + u32, 'f32=' + (Number.isFinite(f32At(b,off)) ? f32At(b,off).toFixed(3) : '?'))
}
// 尝试各种 stride 找网格
console.log()
console.log('=== 尝试不同 stride 找网格（0-79575） ===')
for (const stride of [60, 64, 72, 76, 80, 84, 88, 96, 100]) {
  for (let offset = 9; offset + 12 < 79575; offset++) {
    const cvb = u32At(b, offset + 4)
    if (cvb === 0 || cvb % stride !== 0) continue
    const vo = offset + 8
    const ilo = vo + cvb
    if (ilo + 4 > 79575) continue
    const cib = u32At(b, ilo)
    if (cib === 0 || cib % 6 !== 0 || ilo + 4 + cib > 79575) continue
    // 合理性：顶点位置有限
    const vc = cvb / stride
    const first = f32At(b, vo)
    const last = f32At(b, vo + (vc - 1) * stride)
    if (Number.isFinite(first) && Number.isFinite(last) && Math.abs(first) < 10000 && Math.abs(last) < 10000) {
      console.log('stride=' + stride, 'offset=' + offset, 'verts=' + vc, 'idxBytes=' + cib)
    }
  }
}
