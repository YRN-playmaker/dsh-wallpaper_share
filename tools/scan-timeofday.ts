// 从 scene.pkg 读 scene.json，扫描 timeOfDay / day_night / smoothStep 脚本
import fs from 'fs'
function utf8Slice(buf: Uint8Array, a: number, b: number): string { return Buffer.from(buf.subarray(a, b)).toString('utf8') }
interface Entry { name: string; offset: number; size: number }
function readSceneJson(path: string): string | null {
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
  const e = entries.find(x => x.name === 'scene.json')
  if (e === undefined) return null
  return Buffer.from(buf.subarray(dataStart + e.offset, dataStart + e.offset + e.size)).toString('utf8')
}
const workshop = 'D:/SteamLibrary/steamapps/workshop/content/431960'
const dirs = fs.readdirSync(workshop).filter(d => /^\d+$/.test(d))
let tot = 0, timeOfDay = 0, dayNight = 0, smooth = 0, script = 0, anyCond = 0
const todList: string[] = []
const condList: string[] = []
for (const dir of dirs) {
  const projPath = workshop + '/' + dir + '/project.json'
  if (!fs.existsSync(projPath)) continue
  try {
    const proj = JSON.parse(fs.readFileSync(projPath, 'utf8'))
    if (!/scene/i.test(proj.type || '')) continue
  } catch { continue }
  const pkgPath = workshop + '/' + dir + '/scene.pkg'
  if (!fs.existsSync(pkgPath)) continue
  const text = readSceneJson(pkgPath)
  if (text === null) continue
  tot++
  const hasTod = /engine\.timeOfDay/.test(text)
  const hasDn = /"name"\s*:\s*"day_night"/.test(text)
  const hasSmooth = /smoothStep/.test(text)
  const hasScript = /"script"\s*:/.test(text)
  const hasCond = /"condition"\s*:\s*"[1-4]"/.test(text)
  if (hasTod) { timeOfDay++; todList.push(dir) }
  if (hasDn) dayNight++
  if (hasSmooth) smooth++
  if (hasScript) script++
  if (hasCond) { anyCond++; condList.push(dir) }
}
console.log('scene 壁纸总数: ' + tot)
console.log('含 engine.timeOfDay: ' + timeOfDay)
console.log('含 day_night 变量: ' + dayNight)
console.log('含 smoothStep: ' + smooth)
console.log('含 script: ' + script)
console.log('含 condition "1"-"4": ' + anyCond)
console.log('\n含 timeOfDay:')
for (const w of todList) console.log('  ' + w)
console.log('\n含 condition 1-4:')
for (const w of condList) console.log('  ' + w)
