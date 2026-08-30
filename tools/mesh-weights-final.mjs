// 最终验证：stride=52 布局 [pos3 @0][boneIdx 4×u32 @12][weights 4×f32 @28][uv2 @44]
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
const stride = 52
const vc = 1248
// 验证权重 @28-43 和=1（采样前 200 顶点）
let sum1 = 0
let partial = 0
for (let i = 0; i < vc; i++) {
  const vp = vo + i * stride
  const w = [0,1,2,3].map(k => f32At(b, vp + 28 + k * 4))
  const s = w.reduce((a, bb) => a + bb, 0)
  if (Math.abs(s - 1) < 0.01) sum1++
  else if (s > 0.5 && s < 1.5) partial++
}
console.log('权重和=1 的顶点: ' + sum1 + '/' + vc)
console.log('权重和∈(0.5,1.5) 的顶点: ' + partial + '/' + vc)
// 打印有混合权重的示例
console.log()
console.log('=== 混合权重示例（非纯单骨骼） ===')
let shown = 0
for (let i = 0; i < vc && shown < 8; i++) {
  const vp = vo + i * stride
  const w = [0,1,2,3].map(k => f32At(b, vp + 28 + k * 4))
  const bi = [0,1,2,3].map(k => u32At(b, vp + 12 + k * 4))
  if (w.some(x => x > 0.01 && x < 0.99)) {
    console.log('v' + i + ': boneIdx=[' + bi.join(',') + '] weights=[' + w.map(x=>x.toFixed(2)).join(',') + '] pos=(' + f32At(b,vp).toFixed(1) + ',' + f32At(b,vp+4).toFixed(1) + ') uv=(' + f32At(b,vp+44).toFixed(3) + ',' + f32At(b,vp+48).toFixed(3) + ')')
    shown++
  }
}
// 纯单骨骼示例
console.log()
console.log('=== 单骨骼示例 ===')
shown = 0
for (let i = 0; i < vc && shown < 6; i++) {
  const vp = vo + i * stride
  const w = [0,1,2,3].map(k => f32At(b, vp + 28 + k * 4))
  const bi = [0,1,2,3].map(k => u32At(b, vp + 12 + k * 4))
  if (w[0] === 1 && bi[0] < 5) {
    console.log('v' + i + ': boneIdx=[' + bi.join(',') + '] weights=[' + w.map(x=>x.toFixed(2)).join(',') + '] pos=(' + f32At(b,vp).toFixed(1) + ',' + f32At(b,vp+4).toFixed(1) + ')')
    shown++
  }
}
