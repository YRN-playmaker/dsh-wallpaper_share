// 完整解析 MDLA 3 个动画项（修正 dataLen 位置），找"呼吸"动态数据
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
const u32 = (p) => (mdl[p] | (mdl[p + 1] << 8) | (mdl[p + 2] << 16) | (mdl[p + 3] << 24)) >>> 0
const f32 = (p) => { const v = (mdl[p] | (mdl[p + 1] << 8) | (mdl[p + 2] << 16) | (mdl[p + 3] << 24)) | 0; return new Float32Array(new Int32Array([v]).buffer)[0] }

const mdla = find('MDLA0006')
const count = u32(mdla + 13)
console.log('MDLA count=' + count)
let q = mdla + 17
for (let a = 0; a < count && q + 8 < mdl.length; a++) {
  const id = u32(q)
  q += 4
  const id2 = u32(q)
  q += 4
  let nm = ''
  while (q < mdl.length && mdl[q] !== 0 && nm.length < 128) { nm += String.fromCharCode(mdl[q]); q++ }
  q++
  let lp = ''
  while (q < mdl.length && mdl[q] !== 0 && lp.length < 128) { lp += String.fromCharCode(mdl[q]); q++ }
  q++
  if (q + 24 > mdl.length) { console.log('项 ' + a + ' 头部截断'); break }
  const duration = f32(q); q += 4
  const bones = u32(q); q += 4
  const u1 = u32(q); q += 4
  const u2 = u32(q); q += 4
  const u3 = u32(q); q += 4
  const dataLen = u32(q); q += 4
  const extra = mdl[q]; q++
  console.log('=== 项 ' + a + ': id=' + id + ' name=[' + nm + '] loop=[' + lp + '] duration=' + duration + ' bones=' + bones + ' u1=' + u1 + ' u2=' + u2 + ' u3=' + u3 + ' dataLen=' + dataLen + ' extra=' + extra)
  if (dataLen <= 0 || dataLen > mdl.length - q) { console.log('  dataLen 非法，跳过'); break }
  // 分析 keyframe 数据：36B 帧（[t3B][8f32][1B]）或 35B（[t3B][8f32]）
  const hex = Buffer.from(mdl.subarray(q, q + Math.min(36, dataLen))).toString('hex')
  console.log('  数据前 36B: ' + hex)
  // 探测帧结构：尝试 [t3B][8f32] = 35B 和 [t3B][8f32][1B] = 36B
  for (const [label, stride, tOff] of [['35B', 35, 0], ['36B', 36, 0], ['36B+t4', 36, 1]]) {
    const frameCount = Math.floor(dataLen / stride)
    const ts = []
    const v0s = []
    let ok = true
    for (let f = 0; f < Math.min(8, frameCount); f++) {
      const fp = q + f * stride + tOff
      if (fp + 3 > mdl.length) { ok = false; break }
      const t = (mdl[fp] | (mdl[fp + 1] << 8) | (mdl[fp + 2] << 16)) >>> 0
      ts.push(t)
      if (tOff + 3 + 4 <= stride) v0s.push(f32(fp + 3).toFixed(2))
      else v0s.push('?')
    }
    console.log('  [' + label + '] 帧数=' + frameCount + ' t=' + ts.join(',') + ' v0=' + v0s.join(','))
  }
  q += dataLen
}
