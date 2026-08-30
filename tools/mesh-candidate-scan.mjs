// 彻底验证 0013 mesh：找到真正的顶点布局（pos/uv/weights/boneIndices 偏移）
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
console.log('文件总长:', b.length)
// 找 MDLS0001
const mdls = (() => {
  const t = new Uint8Array('MDLS0001'.length)
  for (let i = 0; i < t.length; i++) t[i] = 'MDLS0001'.charCodeAt(i)
  for (let i = 0; i < b.length - t.length; i++) {
    let ok = true
    for (let k = 0; k < t.length; k++) if (b[i+k] !== t[k]) { ok = false; break }
    if (ok) return i
  }
  return -1
})()
console.log('MDLS0001 @', mdls)
// 材质路径 @17..38
const matPath = utf8Slice(b, 17, 38)
console.log('材质路径:', JSON.stringify(matPath))
// 39 起：看头几个 u32/u16
console.log()
console.log('=== offset 39..80 逐字节 ===')
for (let off = 39; off < 80; off += 16) {
  const bytes = Array.from(b.subarray(off, off + 16)).map(x => x.toString(16).padStart(2, '0')).join(' ')
  console.log(String(off).padStart(4) + ': ' + bytes)
}
console.log()
// 检查 u32@43 到底是不是 64896
console.log('u32@39 =', u32At(b, 39))
console.log('u32@43 =', u32At(b, 43))
console.log('u32@47 =', u32At(b, 47))
// 网格扫描：尝试所有 offset（39..mdls），stride=64，检查顶点位置合理性
console.log()
console.log('=== 网格候选扫描 (stride=64, offset 39..200) ===')
for (let off = 39; off < 200 && off + 12 < mdls; off++) {
  const vb = u32At(b, off + 4)
  if (vb === 0 || vb % 64 !== 0) continue
  const vo = off + 8
  const ilo = vo + vb
  if (ilo + 4 > mdls) continue
  const ib = u32At(b, ilo)
  if (ib === 0 || ib % 6 !== 0 || ilo + 4 + ib > mdls) continue
  const vc = vb / 64
  // 检查第一个顶点 pos 合理性
  const x = f32At(b, vo)
  const y = f32At(b, vo + 4)
  const z = f32At(b, vo + 8)
  if (!Number.isFinite(x) || Math.abs(x) > 100000) continue
  // 索引范围
  let valid = true
  for (let i = 0; i < ib / 2 && valid; i++) {
    const v = u16At(b, ilo + 4 + i * 2)
    if (v >= vc) valid = false
  }
  if (!valid) continue
  console.log(`off=${off} vertexBytes=${vb} verts=${vc} indexBytes=${ib} idx=${ib/2} 首顶点=(${x.toFixed(1)},${y.toFixed(1)},${z.toFixed(1)})`)
}
