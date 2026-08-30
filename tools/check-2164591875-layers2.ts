// 稳健提取 2164591875 每个图层：visible/alpha(image/copybackground 关联）
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
const jsonStr = sceneText.slice(sceneText.indexOf('{'), sceneText.lastIndexOf('}') + 1)
// 对象数组：按顶层 "id": 分割（平衡括号）
const objBlock = jsonStr.slice(jsonStr.indexOf('"objects"'))
let idx = 0; let count = 0
while (idx < objBlock.length && count < 20) {
  const st = objBlock.indexOf('{', idx)
  if (st < 0) break
  let d = 0; let end = -1
  for (let i = st; i < objBlock.length; i++) {
    if (objBlock[i] === '{') d++
    else if (objBlock[i] === '}') { d--; if (d === 0) { end = i; break } }
  }
  if (end < 0) break
  const blk = objBlock.slice(st, end + 1)
  const id = /"id"\s*:\s*(\d+)/.exec(blk)?.[1]
  const name = /"name"\s*:\s*"([^"]*)"/.exec(blk)?.[1]
  const image = /"image"\s*:\s*"([^"]+)"/.exec(blk)?.[1]
  const cb = /"copybackground"\s*:\s*(true|false)/.exec(blk)?.[1]
  const cond = /"condition"\s*:\s*"([^"]+)"/.exec(blk)?.[1]
  const visVal = /"visible"[^}]*"value"\s*:\s*(true|false)/.exec(blk)?.[1]
  // alpha 脚本提取
  let alphaDesc = ''
  const alphaScriptM = /"alpha"\s*:\s*\{[^}]*"script"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(blk)
  if (alphaScriptM) {
    const sc = alphaScriptM[1].replace(/\\n/g, '\n')
    const sh = /START_HOUR\s*=\s*([\d.]+)/.exec(sc)?.[1]
    const eh = /END_HOUR\s*=\s*([\d.]+)/.exec(sc)?.[1]
    alphaDesc = 'SCRIPT sh=' + (sh ?? '?') + ' eh=' + (eh ?? '?') + ' tod=' + /engine\.timeOfDay/.test(sc)
  } else {
    alphaDesc = /"alpha"\s*:\s*([\d.]+)/.exec(blk)?.[1] ?? '-'
  }
  console.log('id=' + id + ' name="' + name + '" cond=' + cond + ' visible=' + visVal + ' cb=' + cb + ' img=' + (image ?? '-') + ' alpha=' + alphaDesc)
  idx = end + 1; count++
}
