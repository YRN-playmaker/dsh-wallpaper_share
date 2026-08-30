// 测试 stride=52（64896/1248=52，1248 顶点恰好全部被索引连续引用）
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
for (const stride of [52, 44, 40, 36, 68, 76]) {
  if (vertexBytes % stride !== 0) continue
  const vc = vertexBytes / stride
  console.log(`\n=== stride=${stride} verts=${vc} ===`)
  // 检查是否全部索引 < vc
  let ok = true
  for (let i = 0; i < indexBytes / 2; i++) if (u16At(b, io + i*2) >= vc) { ok = false; break }
  console.log('  索引全部有效:', ok)
  // 打印前 4 顶点完整字节 + 关键 f32
  for (let i = 0; i < 4; i++) {
    const vp = vo + i * stride
    const bytes = Array.from(b.subarray(vp, vp + stride)).map(x => x.toString(16).padStart(2, '0')).join(' ')
    const f = []
    for (let k = 0; k < Math.floor(stride / 4); k++) f.push(f32At(b, vp + k*4).toFixed(2))
    console.log('  v' + i + ': f32[' + f.join(', ') + ']')
  }
}
