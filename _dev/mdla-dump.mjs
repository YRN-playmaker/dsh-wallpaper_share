// dump MDLA 动画区原始字节，手动分析 keyframe 结构
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
    if (mdl[i] === magic.charCodeAt(0) && Buffer.from(mdl.subarray(i, i + magic.length)).toString('ascii') === magic) return i
  }
  return -1
}
const mdla = find('MDLA0006')
console.log('MDLA offset: ' + mdla)
if (mdla < 0) process.exit(0)
const u32 = (p) => (mdl[p] | (mdl[p + 1] << 8) | (mdl[p + 2] << 16) | (mdl[p + 3] << 24)) >>> 0
const i32 = (p) => (mdl[p] | (mdl[p + 1] << 8) | (mdl[p + 2] << 16) | (mdl[p + 3] << 24)) | 0
const f32 = (p) => { const v = i32(p); return new Float32Array(new Int32Array([v]).buffer)[0] }
console.log('MDLA+13 count: ' + u32(mdla + 13))
console.log('MDLA+17 起 64B hex:')
console.log(Buffer.from(mdl.subarray(mdla + 17, mdla + 17 + 128)).toString('hex'))
// 逐字节显示前 128B（hex + ascii）
for (let i = 0; i < 16; i++) {
  const off = mdla + 17 + i * 16
  const hex = Buffer.from(mdl.subarray(off, off + 16)).toString('hex')
  const asc = Buffer.from(mdl.subarray(off, off + 16)).toString('latin1').replace(/[^\x20-\x7e]/g, '.')
  console.log('+' + (i * 16).toString().padStart(4) + ': ' + hex + '  ' + asc)
}
// 找动画 463 的目录项
console.log()
console.log('--- 扫描动画目录项 ---')
let q = mdla + 17
for (let a = 0; a < 8 && q + 8 < mdl.length; a++) {
  const id = u32(q)
  const id2 = u32(q + 4)
  let nm = ''
  let s = q + 8
  while (s < mdl.length && mdl[s] !== 0 && nm.length < 128) { nm += String.fromCharCode(mdl[s]); s++ }
  console.log('项 ' + a + ': offset=' + (q - mdla) + ' id=' + id + ' id2=' + id2 + ' name=[' + nm + ']')
  // 显示名称后 48B hex
  if (nm.length > 0) {
    const after = s + 1
    console.log('  name后48B: ' + Buffer.from(mdl.subarray(after, after + 48)).toString('hex'))
    // 尝试 f32 duration 等
    let p = after
    for (let k = 0; k < 6; k++) {
      console.log('  f32@' + (p - mdla) + ' = ' + f32(p))
      p += 4
    }
  }
  // 前进：跳过 name + 后续（粗略 20B 头 + dataLen）
  q = s + 1
  if (q + 20 > mdl.length) break
  const dataLen = u32(q + 16)
  console.log('  dataLen(u32@+16): ' + dataLen)
  q += 20 + dataLen + 1
}
