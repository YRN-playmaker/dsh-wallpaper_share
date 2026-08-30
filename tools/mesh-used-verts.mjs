// 检查真正被索引引用的顶点（25,26,27,49,50,51,...）在 stride=64 pos@0 下的位置，
// 判断它们是否构成连贯网格
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
const vo = 47
const vertexBytes = u32At(b, 43)
const ilo = vo + vertexBytes
const indexBytes = u32At(b, ilo)
const io = ilo + 4
const stride = 64
const vc = vertexBytes / stride
console.log('verts=' + vc + ' idx=' + (indexBytes/2))
// 被引用的唯一顶点
const used = new Set()
for (let i = 0; i < indexBytes / 2; i++) used.add(u16At(b, io + i * 2))
console.log('被引用顶点数:', used.size)
// 打印被引用顶点的 pos@0 和 uv@? 
console.log()
console.log('=== 前 40 个被引用顶点的 pos@0 ===')
let count = 0
const arrUsed = [...used].sort((a,b)=>a-b)
for (const vi of arrUsed) {
  if (count >= 40) break
  const vp = vo + vi * stride
  const x = f32At(b, vp), y = f32At(b, vp+4), z = f32At(b, vp+8)
  console.log('v' + vi + ': (' + x.toFixed(1) + ',' + y.toFixed(1) + ',' + z.toFixed(1) + ')')
  count++
}
// 找相邻顶点间距：25,26,27 之间距离
console.log()
console.log('=== 相邻索引顶点间距 (25,26,27 / 49,50,51) ===')
for (const trio of [[25,26,27],[49,50,51],[50,49,52],[61,62,63]]) {
  const pts = trio.map(vi => {
    const vp = vo + vi * stride
    return [f32At(b,vp), f32At(b,vp+4)]
  })
  const d = (a,bb) => Math.hypot(a[0]-bb[0], a[1]-bb[1])
  console.log(trio.join(',') + ': pts=' + pts.map(p=>'('+p[0].toFixed(1)+','+p[1].toFixed(1)+')').join(' ') + ' d01=' + d(pts[0],pts[1]).toFixed(1) + ' d12=' + d(pts[1],pts[2]).toFixed(1))
}
