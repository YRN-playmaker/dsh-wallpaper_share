// 打印 2164591875 scene.json 关键片段：图层 visible/transform/image + day_night user condition
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
const sceneText = Buffer.from(pkg.read('scene.json')!).toString('utf8')
// 直接用格式化 JSON 打印（parseSceneJson 的片段提取结果）
const objStart = sceneText.indexOf('"objects"')
const objBlock = objStart >= 0 ? sceneText.slice(objStart) : ''
let idx = 0; let count = 0
while (idx < objBlock.length && count < 40) {
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
  if (idM !== null) {
    console.log('\n===== id=' + idM[1] + ' name="' + (nameM !== null ? nameM[1] : '') + '" =====')
    // 提取 visible 整段（含 user/condition/value）
    const visIdx = blk.indexOf('"visible"')
    if (visIdx >= 0) {
      // 找 visible 对象（可能是 {value:..} 或 {user:{...},value:..}）
      let vStart = blk.indexOf('{', visIdx)
      // 从 "visible" 后的第一个 { 平衡到对应 }
      let d = 0; let vEnd = -1
      for (let i = vStart; i < blk.length; i++) {
        if (blk[i] === '{') d++
        else if (blk[i] === '}') { d--; if (d === 0) { vEnd = i; break } }
      }
      if (vEnd >= 0) console.log('  visible=' + blk.slice(vStart, vEnd + 1).replace(/\s+/g, ' '))
    }
  }
  idx = end + 1; count++
}
// 打印 scene.json 中 user variables/inputs 定义段（day_night 的 source）
console.log('\n===== 含 day_night 的上下文（含前 120 字） =====')
const re = /"name"\s*:\s*"day_night"/g
for (const m of sceneText.matchAll(re)) {
  const s = Math.max(0, m.index! - 150)
  console.log('...' + sceneText.slice(s, m.index! + 80).replace(/\s+/g, ' ') + '...')
}
// 查找 "inputs" 或 "user" 段定义（state variable 定义）
console.log('\n===== 所有 "name": "xxx" 的顶层/变量定义 =====')
for (const m of sceneText.matchAll(/"name"\s*:\s*"([^"]+)"/g)) {
  console.log('  name="' + m[1] + '"')
}
