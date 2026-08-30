// 检查 2164591875：图层 + 白天/黑夜切换相关（scene.json 中 time/clock/day/night/state 等）
import fs from 'fs'
function utf8Slice(buf: Uint8Array, a: number, b: number): string { return Buffer.from(buf.subarray(a, b)).toString('utf8') }
interface Entry { name: string; offset: number; size: number }
function readPkg(path: string): { entries: Entry[]; dataStart: number; read(name: string): Uint8Array | null } {
  const buf = fs.readFileSync(path)
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  let pos = 0
  const readI32 = () => { const v = view.getInt32(pos, true); pos += 4; return v }
  const magicLen = readI32(); pos += magicLen; const version = readI32()
  const entries: Entry[] = []
  while (pos + 8 <= buf.length) {
    const nameLen = readI32(); if (nameLen <= 0 || nameLen > 2048 || pos + nameLen + 8 > buf.length) break
    const name = utf8Slice(buf, pos, pos + nameLen); pos += nameLen
    const offset = readI32(); const size = readI32()
    if (offset < 0 || size < 0 || offset + size > buf.length) break
    entries.push({ name, offset, size })
  }
  const dataStart = pos
  return { entries, dataStart, read: (n) => { const e = entries.find((x) => x.name === n); return e !== undefined ? buf.subarray(dataStart + e.offset, dataStart + e.offset + e.size) : null } }
}
const dir = 'D:/SteamLibrary/steamapps/workshop/content/431960/2164591875'
const pkg = readPkg(dir + '/scene.pkg')
console.log('=== pkg 条目 ===')
for (const e of pkg.entries) console.log('  ' + e.name + ' (' + e.size + 'B)')
const sceneText = Buffer.from(pkg.read('scene.json')!).toString('utf8')
console.log('\n=== scene.json 图层（含 name） ===')
const objStart = sceneText.indexOf('"objects"')
const objBlock = objStart >= 0 ? sceneText.slice(objStart) : ''
let idx = 0; let count = 0
while (idx < objBlock.length && count < 80) {
  const st = objBlock.indexOf('{', idx)
  if (st < 0) break
  let depth = 0; let end = -1
  for (let i = st; i < objBlock.length; i++) {
    const c = objBlock[i]
    if (c === '{') depth++
    else if (c === '}') { depth--; if (depth === 0) { end = i; break } }
  }
  if (end < 0) break
  const blk = objBlock.slice(st, end + 1)
  const idM = /"id"\s*:\s*(\d+)/.exec(blk)
  const nameM = /"name"\s*:\s*"([^"]*)"/.exec(blk)
  const imageM = /"image"\s*:\s*"([^"]+)"/.exec(blk)
  const prtM = /"particle"\s*:\s*"([^"]+)"/.exec(blk)
  const typeM = /"type"\s*:\s*"([^"]+)"/.exec(blk)
  if (idM !== null) {
    console.log('  id=' + idM[1] + ' name="' + (nameM !== null ? nameM[1] : '') + '"' +
      (imageM !== null ? ' img=' + imageM[1] : '') + (prtM !== null ? ' particle=' + prtM[1] : '') +
      (typeM !== null ? ' type=' + typeM[1] : ''))
  }
  idx = end + 1; count++
}
// 搜索时间/时钟/白天黑夜相关关键字
console.log('\n=== 含 time/clock/day/night/state/period 关键字的片段 ===')
for (const kw of ['time', 'clock', 'day', 'night', 'state', 'period', 'sun', 'moon', 'auto']) {
  const re = new RegExp('"' + kw + '[^"]*"', 'gi')
  const hits = [...sceneText.matchAll(re)]
  if (hits.length > 0) {
    console.log('-- ' + kw + ' (' + hits.length + '次) --')
    for (const h of hits.slice(0, 8)) {
      const s = Math.max(0, h.index! - 60)
      console.log('   ...' + sceneText.slice(s, h.index! + 60).replace(/\n/g, ' ') + '...')
    }
  }
}
