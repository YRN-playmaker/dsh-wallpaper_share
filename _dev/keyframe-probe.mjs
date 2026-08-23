// 手动分析动画 463（呼吸）keyframe 数据区原始字节
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

// 目录项 0（动画 463）：从 mdla+17 起
let q = mdla + 17
const id = u32(q); q += 4
q += 4
let nm = ''
while (mdl[q] !== 0) { nm += String.fromCharCode(mdl[q]); q++ }
q++
let lp = ''
while (mdl[q] !== 0) { lp += String.fromCharCode(mdl[q]); q++ }
q++
const duration = f32(q); q += 4
const bc = u32(q); q += 4
q += 4; q += 4; q += 4
const dataLen = u32(q); q += 4
const extra = mdl[q]; q++
console.log('动画 463: duration=' + duration + ' bones=' + bc + ' dataLen=' + dataLen + ' extra=' + extra)
console.log('keyframe 数据起点（相对文件）: ' + q)
console.log('前 72B hex:')
console.log(Buffer.from(mdl.subarray(q, q + 72)).toString('hex'))
// 尝试不同帧结构
console.log()
console.log('--- 尝试帧结构 A：[1B pad][t:3B][8f32] = 36B ---')
for (let f = 0; f < 6; f++) {
  const fp = q + f * 36
  const t = (mdl[fp + 1] | (mdl[fp + 2] << 8) | (mdl[fp + 3] << 16)) >>> 0
  const vals = []
  for (let k = 0; k < 8; k++) vals.push(f32(fp + 4 + k * 4))
  console.log('帧 ' + f + ': t=' + t + ' [' + vals.map((v) => v.toFixed(3)).join(', ') + ']')
}
console.log()
console.log('--- 尝试帧结构 B：[t:3B][8f32][1B pad] = 36B ---')
for (let f = 0; f < 6; f++) {
  const fp = q + f * 36
  const t = (mdl[fp] | (mdl[fp + 1] << 8) | (mdl[fp + 2] << 16)) >>> 0
  const vals = []
  for (let k = 0; k < 8; k++) vals.push(f32(fp + 3 + k * 4))
  console.log('帧 ' + f + ': t=' + t + ' [' + vals.map((v) => v.toFixed(3)).join(', ') + ']')
}
console.log()
console.log('--- 尝试帧结构 C：[t:4B u32][8f32] = 36B ---')
for (let f = 0; f < 6; f++) {
  const fp = q + f * 36
  const t = u32(fp)
  const vals = []
  for (let k = 0; k < 8; k++) vals.push(f32(fp + 4 + k * 4))
  console.log('帧 ' + f + ': t=' + t + ' [' + vals.map((v) => v.toFixed(3)).join(', ') + ']')
}
// 帧长猜测：扫描 t 单调递增的帧长
console.log()
console.log('--- 帧长扫描（前 200B 内找 t 递增模式）---')
for (const stride of [24, 28, 32, 36, 40, 44, 48]) {
  const ts = []
  for (let f = 0; f < 5; f++) {
    const fp = q + f * stride
    const t = (mdl[fp + 1] | (mdl[fp + 2] << 8) | (mdl[fp + 3] << 16)) >>> 0
    ts.push(t)
  }
  const mono = ts.every((t, i) => i === 0 || t >= ts[i - 1])
  console.log('stride=' + stride + ': t=' + ts.join(', ') + (mono ? ' ← 单调' : ''))
}
