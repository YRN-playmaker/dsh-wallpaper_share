// dump 2804379697 的粒子系统：scene.json 里带 particle 的图层 + instanceoverride + 预设关键参数
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
const dir = 'D:/SteamLibrary/steamapps/workshop/content/431960/2804379697'
const pkg = readPkg(dir + '/scene.pkg')
console.log('=== 粒子预设文件 ===')
for (const e of pkg.entries) if (e.name.startsWith('particles/') && e.name.endsWith('.json')) console.log('  ' + e.name)
const sceneText = Buffer.from(pkg.read('scene.json')!).toString('utf8')
// 找带 particle 的对象
console.log('\n=== scene.json 带 particle 的图层 ===')
const objStart = sceneText.indexOf('"objects"')
const objBlock = objStart >= 0 ? sceneText.slice(objStart) : ''
let idx = 0
while (idx < objBlock.length) {
  const st = objBlock.indexOf('{', idx)
  if (st < 0) break
  let depth = 0; let end = -1
  for (let i = st; i < objBlock.length; i++) { const c = objBlock[i]; if (c === '{') depth++; else if (c === '}') { depth--; if (depth === 0) { end = i; break } } }
  if (end < 0) break
  const blk = objBlock.slice(st, end + 1)
  const pm = /"particle"\s*:\s*"([^"]+)"/.exec(blk)
  if (pm !== null) {
    const idM = /"id"\s*:\s*(\d+)/.exec(blk)
    const nameM = /"name"\s*:\s*"([^"]*)"/.exec(blk)
    const ioM = /"instanceoverride"\s*:\s*(\{[^}]*\})/.exec(blk)
    console.log('  id=' + (idM?.[1] ?? '?') + ' name="' + (nameM?.[1] ?? '') + '" particle=' + pm[1])
    if (ioM !== null) console.log('    instanceoverride=' + ioM[1])
  }
  idx = end + 1
}
// dump 每个粒子预设的关键参数
for (const e of pkg.entries) {
  if (!e.name.startsWith('particles/') || !e.name.endsWith('.json')) continue
  const t = Buffer.from(pkg.read(e.name)!).toString('utf8')
  const grab = (re: RegExp): string | null => { const m = re.exec(t); return m !== null ? m[1] : null }
  console.log('\n=== ' + e.name + ' ===')
  console.log('  material=' + (grab(/"material"\s*:\s*"([^"]+)"/) ?? '-'))
  console.log('  maxcount=' + (grab(/"maxcount"\s*:\s*"?([\d.]+)/) ?? '-'))
  console.log('  rate=' + (grab(/"rate"\s*:\s*"?([\d.]+)/) ?? '-'))
  console.log('  alpharandom=' + (grab(/"alpharandom"[^}]*"min"\s*:\s*"?([\d. ]+)/) ?? '-'))
  // 打印 initializer 里 alpharandom / sizerandom / colorrandom 段
  for (const key of ['alpharandom', 'sizerandom', 'colorrandom', 'lifetimerandom']) {
    const i = t.indexOf('"' + key + '"')
    if (i >= 0) console.log('  [' + key + '] ' + t.slice(i, i + 120).replace(/\s+/g, ' '))
  }
}
// dump 材质 blending / overbright
console.log('\n=== 材质 blending / overbright ===')
for (const e of pkg.entries) {
  if (!e.name.startsWith('materials/') || !e.name.endsWith('.json')) continue
  const t = Buffer.from(pkg.read(e.name)!).toString('utf8')
  const bl = /"blending"\s*:\s*"([^"]+)"/.exec(t)
  const ob = /ui_editor_properties_overbright"\s*:\s*"?([\d.]+)/.exec(t)
  const sp = /"spritesheet"\s*:\s*"?([\d.]+)/.exec(t)
  if (bl !== null || ob !== null) console.log('  ' + e.name + ' blending=' + (bl?.[1] ?? '-') + ' overbright=' + (ob?.[1] ?? '-') + ' spritesheet=' + (sp?.[1] ?? '-'))
}
