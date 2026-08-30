// 系统性扫描：0013 mesh 到底在哪、顶点布局如何
// 对每个 (offset, stride, posOffset) 组合，检查顶点位置分布是否聚成眼睛形状
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
// 思路：也许 offset47 的"顶点"里，pos 不在 @0，而在某处。
// 但更可能：真正 mesh 布局 = [pos3 @0][?][uv2][?][weights][indices]
// 我们用"位置分布是否呈椭圆/眼睛轮廓"判定正确 pos offset
console.log('=== 对 offset=47 stride=64，尝试 pos@每个4B偏移 ===')
const stride = 64
const vc = 1014
const vo = 47
for (let posOff = 0; posOff <= 60; posOff += 4) {
  const xs = [], ys = []
  let bad = false
  for (let i = 0; i < vc; i++) {
    const vp = vo + i * stride
    const x = f32At(b, vp + posOff)
    const y = f32At(b, vp + posOff + 4)
    if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 100000) { bad = true; break }
    xs.push(x); ys.push(y)
  }
  if (bad) continue
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (let i = 0; i < vc; i++) {
    if (xs[i] < minX) minX = xs[i]
    if (xs[i] > maxX) maxX = xs[i]
    if (ys[i] < minY) minY = ys[i]
    if (ys[i] > maxY) maxY = ys[i]
  }
  const w = maxX - minX, h = maxY - minY
  // 眼睛图像 size 186x142 → 期望宽高比 ~1.3
  const aspect = w / h
  const plausible = w > 50 && w < 400 && h > 30 && h < 300
  console.log(`pos@${String(posOff).padStart(2)}: 范围 X[${minX.toFixed(0)},${maxX.toFixed(0)}] Y[${minY.toFixed(0)},${maxY.toFixed(0)}] w=${w.toFixed(0)} h=${h.toFixed(0)} aspect=${aspect.toFixed(2)}${plausible?' <== 合理':' '}`)
}
