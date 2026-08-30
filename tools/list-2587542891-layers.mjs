// 列出 2587542891 的图层及引用
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
const pkg = readPkg('D:/SteamLibrary/steamapps/workshop/content/431960/2587542891/scene.pkg')
const text = Buffer.from(pkg.read('scene.json')).toString('utf8')
// 找 objects 数组，切分每个对象
const objStart = text.indexOf('"objects"')
const objBlock = text.slice(objStart)
let idx = 0
let count = 0
while (idx < objBlock.length && count < 80) {
  const st = objBlock.indexOf('{', idx)
  if (st < 0) break
  let depth = 0
  let end = -1
  for (let i = st; i < objBlock.length; i++) {
    const c = objBlock[i]
    if (c === '{') depth++
    else if (c === '}') { depth--; if (depth === 0) { end = i; break } }
  }
  if (end < 0) break
  const blk = objBlock.slice(st, end + 1)
  const idM = /"id"\s*:\s*(\d+)/.exec(blk)
  const nameM = /"name"\s*:\s*"([^"]*)"/.exec(blk)
  const kindM = /"kind"\s*:\s*"([^"]+)"/.exec(blk)
  const imageM = /"image"\s*:\s*"([^"]+)"/.exec(blk)
  const particleM = /"particle"\s*:\s*"([^"]+)"/.exec(blk)
  const effM = /"effects"\s*:\s*\[([^\]]*)\]/.exec(blk)
  const effCnt = effM !== null && effM[1].trim() !== '' ? (effM[1].match(/\{/g) || []).length : 0
  const parentM = /"parent"\s*:\s*(\d+)/.exec(blk)
  const animM = /"animationlayers"\s*:\s*\[/.test(blk)
  console.log('id=' + (idM !== null ? idM[1] : '?') + ' name="' + (nameM !== null ? nameM[1] : '') + '"' +
    (kindM !== null ? ' kind=' + kindM[1] : '') +
    (parentM !== null ? ' parent=' + parentM[1] : '') +
    (imageM !== null ? ' img=' + imageM[1] : '') +
    (particleM !== null ? ' part=' + particleM[1] : '') +
    ' effs=' + effCnt + (animM ? ' animLayers' : ''))
  idx = end + 1
  count++
}
