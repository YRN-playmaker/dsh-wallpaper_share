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
// 网格：gridOff=39, vertexBytes=64896, verts=1014, stride=64
const gridOff = 39
const vo = gridOff + 8
console.log('=== 20 个顶点的关键偏移采样（找权重/索引/UV 规律） ===')
for (let i = 0; i < 20; i++) {
  const vp = vo + i * 64
  const row = []
  for (let off = 0; off < 64; off += 4) row.push(f32At(b, vp + off))
  // 汇总：位置、可能的uv、可能的权重
  const pos = [row[0], row[1], row[2]].map(v=>v.toFixed(1)).join(',')
  const uvs = [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15].map(o => row[o] >= -0.5 && row[o] <= 1.5 && (o===11||o===12||o===3||o===4||o===7||o===8) ? o + ':' + row[o].toFixed(2) : '').filter(Boolean).join(' ')
  console.log('v' + String(i).padStart(2), 'pos=(' + pos + ')', uvs)
}
console.log()
console.log('=== u16 探测每个 2B 偏移（10 顶点） ===')
for (let off = 0; off < 64; off += 2) {
  const samples = []
  for (let i = 0; i < 10; i++) samples.push(u16At(b, vo + i * 64 + off))
  const maxV = Math.max(...samples)
  const allSmall = samples.every(v => v < 20)
  if (allSmall || maxV < 100) console.log('  @+' + String(off).padStart(2) + ' 样本: ' + samples.join(',') + '  max=' + maxV)
}
// 检查具体顶点：顶点0 完整 64B
console.log()
console.log('=== 顶点0 完整 64B 字节 ===')
console.log(Array.from(b.subarray(vo, vo + 64)).map(x => x.toString(16).padStart(2, '0')).join(' '))
