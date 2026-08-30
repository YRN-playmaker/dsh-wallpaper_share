// 测试 parseDayNightAlpha 和 dayNightFactor 逻辑
import { buildSceneModel } from '../src/scene/SceneModel.ts'
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
// parseScenePkg needed - use a simpler approach: replicate
const model = await import('../src/scene/SceneModel.ts')
console.log('=== 2164591875 图层 dayNight ===')
// 直接读 scene.json 手动验证 parseDayNightAlpha
// 提取 alpha 脚本
const sceneText = Buffer.from(pkg.read('scene.json')!).toString('utf8')
const jsonStr = sceneText.slice(sceneText.indexOf('{'), sceneText.lastIndexOf('}') + 1)
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
  // 构造 alpha 对象
  const scriptM = /"alpha"\s*:\s*\{[^}]*"script"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(blk)
  let alphaObj: unknown = null
  if (scriptM) {
    const sc = scriptM[1].replace(/\\n/g, '\n')
    alphaObj = { script: sc, value: 1.0 }
  }
  // 调 parseDayNightAlpha（需导出）。这里重新写一份逻辑测试
  console.log('id=' + id + ' name="' + name + '" alphaScript=' + (alphaObj !== null ? 'yes' : 'no'))
  if (alphaObj !== null) {
    const testRes = testParse(alphaObj as { script: string })
    console.log('    => ' + JSON.stringify(testRes))
  }
  idx = end + 1; count++
}
function testParse(o: { script: string }): unknown {
  const script = o.script
  if (!script.includes('engine') || !script.includes('timeOfDay')) return 'no timeOfDay'
  let startH = 7, endH = 18, hasStart = false, hasEnd = false
  const sh = /START_HOUR\s*=\s*([0-9.]+)/.exec(script)
  if (sh !== null) { startH = Number(sh[1]); hasStart = true }
  const eh = /END_HOUR\s*=\s*([0-9.]+)/.exec(script)
  if (eh !== null) { endH = Number(eh[1]); hasEnd = true }
  if (!hasStart || !hasEnd) return 'no start/end'
  const negated = /1\s*-\s*WEMath\.smoothStep/.test(script)
  return { dayStartH: startH, dayEndH: endH, nightWhenStart: !negated, nightWhenEnd: !negated }
}
