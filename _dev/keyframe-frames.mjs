// 精确定位 keyframe 帧结构：dump 前 200B 逐字节 + 尝试多种帧布局
import { readFileSync } from 'node:fs'

function parsePkg(buf) {
  let pos = 16
  const entries = []
  while (pos + 8 <= buf.length) {
    const nameLen = buf.readInt32LE(pos); pos += 4
    if (nameLen <= 0 || nameLen > 1024 || pos + nameLen + 8 > buf.length) break
    const name = buf.subarray(pos, pos + nameLen).toString('utf8'); pos += nameLen
    const offset = buf.readInt32LE(pos); pos += 4
    const size = buf.readInt32LE(pos); pos += 4
    if (offset < 0 || size < 0 || offset + size > buf.length) break
    entries.push({ name, offset, size })
  }
  const dataStart = pos
  return (n) => { const e = entries.find((x) => x.name === n); if (!e) return null; return buf.subarray(dataStart + e.offset, dataStart + e.offset + e.size) }
}

const buf = readFileSync('D:/SteamLibrary/steamapps/workshop/content/431960/3409595232/scene.pkg')
const read = parsePkg(buf)
const mdl = read('models/导出初音_puppet.mdl')
const find = (magic) => {
  for (let i = 0; i + magic.length < mdl.length; i++) {
    if (Buffer.from(mdl.subarray(i, i + magic.length)).toString('ascii') === magic) return i
  }
  return -1
}
const mdla = find('MDLA0006')
const u32 = (p) => (mdl[p] | (mdl[p + 1] << 8) | (mdl[p + 2] << 16) | (mdl[p + 3] << 24)) >>> 0
const f32 = (p) => { const v = (mdl[p] | (mdl[p + 1] << 8) | (mdl[p + 2] << 16) | (mdl[p + 3] << 24)) | 0; return new Float32Array(new Int32Array([v]).buffer)[0] }
const i16 = (p) => (mdl[p] | (mdl[p + 1] << 8)) | 0
const i32 = (p) => (mdl[p] | (mdl[p + 1] << 8) | (mdl[p + 2] << 16) | (mdl[p + 3] << 24)) | 0

let q = mdla + 17
q += 8
while (mdl[q] !== 0) q++
q++
while (mdl[q] !== 0) q++
q++
q += 4 + 4 + 4 + 4 + 4 // duration, bones, 3×u32, dataLen
q++ // extra
const dataStart = q
console.log('dataStart=' + dataStart + ' dataLen=5436')
console.log('前 200B（16 列）:')
for (let i = 0; i < 12; i++) {
  const off = dataStart + i * 16
  const hex = Buffer.from(mdl.subarray(off, off + 16)).toString('hex')
  const f32s = []
  for (let k = 0; k < 4; k++) f32s.push(f32(off + k * 4).toFixed(2))
  console.log('+' + (i * 16).toString().padStart(3) + ': ' + hex + '  f32: ' + f32s.join(' '))
}
// 找"帧"模式：v0 从 -365.731 微变 → 帧起点
console.log()
console.log('--- 扫描 v0（f32）变化模式 ---')
// 假设帧结构 = [8 f32][t 3B][pad]？看 f32@0,-365.731；f32@36,-365.732？
for (const stride of [32, 35, 36, 40]) {
  const pts = []
  for (let f = 0; f < 6; f++) {
    const v0 = f32(dataStart + f * stride)
    const t3 = (mdl[dataStart + f * stride + 32] | (mdl[dataStart + f * stride + 33] << 8) | (mdl[dataStart + f * stride + 34] << 16)) >>> 0
    pts.push('f' + f + ' v0=' + v0.toFixed(4) + ' t3@32=' + t3)
  }
  console.log('stride=' + stride + ': ' + pts.join(' | '))
}
