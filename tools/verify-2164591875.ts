// 数据级视觉验证：2164591875 白天图/夜空图帧的亮度+alpha 统计，并算当前 dayNightFactor
import { decodeTex } from '../src/scene/SceneTex.ts'
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
function frameStats(texName: string, frameIdx: number): void {
  const b = pkg.read(texName)!
  const tex = decodeTex(b)
  if (tex === null || tex.mip0 === null || tex.frames === null) { console.log(texName + ' 无法解析'); return }
  const W = tex.mip0.width
  const rgba = tex.mip0.rgba!
  const f = tex.frames[frameIdx]
  const fw = Math.round(Math.abs(f.w)); const fh = Math.round(Math.abs(f.h)); const fx = Math.round(f.x); const fy = Math.round(f.y)
  let sum = 0; let cnt = 0; let alphaSum = 0; let alphaCnt = 0; let opaque = 0
  for (let y = 0; y < fh; y++) {
    for (let x = 0; x < fw; x++) {
      const s = ((fy + y) * W + (fx + x)) * 4
      const r = rgba[s], g = rgba[s + 1], bch = rgba[s + 2], a = rgba[s + 3]
      sum += (r + g + bch) / 3
      cnt++
      alphaSum += a; alphaCnt++
      if (a >= 250) opaque++
    }
  }
  const avgLum = (sum / cnt).toFixed(1)
  const avgAlpha = (alphaSum / alphaCnt).toFixed(1)
  const opaquePct = ((opaque / alphaCnt) * 100).toFixed(1)
  console.log(`  ${texName.split('/').pop()} 帧${frameIdx}: ${fw}x${fh} 平均亮度=${avgLum} 平均alpha=${avgAlpha} 不透明像素=${opaquePct}%`)
}
console.log('=== 白天图 (a26caf) ===')
frameStats('materials/a26caf8007678c9c489207faf8230ac6.tex', 0)
frameStats('materials/a26caf8007678c9c489207faf8230ac6.tex', 5)
console.log('=== 夜空图 (h8hsv5S) ===')
frameStats('materials/h8hsv5S.tex', 0)
frameStats('materials/h8hsv5S.tex', 1)
frameStats('materials/h8hsv5S.tex', 3)
// buildSceneModel 图层 dayNight
console.log('\n=== buildSceneModel 图层 ===')
const model = buildSceneModel(new Uint8Array(fs.readFileSync(dir + '/scene.pkg')))
for (const l of model!.layers) {
  console.log('  id=' + l.id + ' name="' + l.name + '" alpha=' + l.alpha.toString().slice(0,5) +
    (l.dayNight !== undefined ? ' DN=' + JSON.stringify(l.dayNight) : '') + ' copybg=' + (l.copybackground ?? false))
}
// 当前 dayNightFactor
function dayNightFactor(dn: { dayStartH: number; dayEndH: number; nightWhenStart: boolean; nightWhenEnd: boolean }): number {
  const now = new Date()
  const hour = now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600
  const { dayStartH: s, dayEndH: e, nightWhenStart } = dn
  if (s > e) { const isNight = hour >= s || hour < e; return isNight ? (nightWhenStart ? 1 : 0) : (nightWhenStart ? 0 : 1) }
  const isNight = hour < s || hour >= e
  return isNight ? (nightWhenStart ? 1 : 0) : (nightWhenStart ? 0 : 1)
}
const now = new Date()
const nowH = now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600
console.log(`\n当前本地时间: ${now.toString()}`)
console.log(`当前小时: ${nowH.toFixed(3)}`)
const dnLayer = model!.layers.find((l) => l.dayNight !== undefined)
if (dnLayer !== undefined && dnLayer.dayNight !== undefined) {
  console.log('夜空图 id=' + dnLayer.id + ' 当前 dayNightFactor=' + dayNightFactor(dnLayer.dayNight) + ' (DN=' + JSON.stringify(dnLayer.dayNight) + ')')
}
