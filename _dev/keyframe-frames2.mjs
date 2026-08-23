// dump 前 8 帧（36B/帧）原始字节 + t + values，确认 t 序列
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

let q = mdla + 17
q += 8
while (mdl[q] !== 0) q++
q++
while (mdl[q] !== 0) q++
q++
q += 4 // duration
q += 4 // bones
q += 4 + 4 + 4 // 3 u32
const dataLen = u32(q)
q += 4
q++ // extra
const ds = q
console.log('dataStart=' + ds + ' dataLen=' + dataLen)
// 帧结构尝试：36B = [t3B][8f32 32B][1B]
console.log('--- 36B 帧（off=0）前 10 帧 ---')
for (let f = 0; f < 10; f++) {
  const fp = ds + f * 36
  const t = (mdl[fp] | (mdl[fp + 1] << 8) | (mdl[fp + 2] << 16)) >>> 0
  const vals = []
  for (let k = 0; k < 8; k++) vals.push(f32(fp + 3 + k * 4))
  console.log('f' + f + ' t=' + t + ' vals=[' + vals.map((v) => v.toFixed(4)).join(',') + ']')
}
// 帧长扫描：找 t 单调 + 帧 0 的 f32 合理
console.log()
console.log('--- 帧长扫描 ---')
for (const stride of [28, 32, 35, 36, 40, 44]) {
  const rows = []
  let ok = true
  for (let f = 0; f < 6; f++) {
    const fp = ds + f * stride
    const t = (mdl[fp] | (mdl[fp + 1] << 8) | (mdl[fp + 2] << 16)) >>> 0
    const v0 = f32(fp + 3)
    rows.push('t=' + t + ' v0=' + v0.toFixed(3))
  }
  console.log('stride=' + stride + ': ' + rows.join(' | '))
}
