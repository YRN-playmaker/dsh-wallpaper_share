// 诊断：①3409595232 雾2 z 序/纹理 ②3463520581 asuna 1953 动画帧 ③root 1949 插值平滑性
import { readFileSync } from 'node:fs'

function parsePkg(path) {
  const buf = readFileSync(path)
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
  const read = (n) => {
    const e = entries.find((x) => x.name === n)
    if (!e) return null
    return buf.subarray(dataStart + e.offset, dataStart + e.offset + e.size)
  }
  return { buf, read }
}

function sceneJson(pkg) {
  const raw = pkg.read('scene.json').toString('utf8')
  const lb = raw.lastIndexOf('}')
  return JSON.parse((raw.startsWith('{') ? '' : '{') + raw.slice(0, lb + 1))
}
function parseJ(pkg, name) {
  const b = pkg.read(name)
  if (!b) return null
  const raw = b.toString('utf8')
  const lb = raw.lastIndexOf('}')
  try { return JSON.parse((raw.startsWith('{') ? '' : '{') + raw.slice(0, lb + 1)) } catch { return null }
}

// ① 雪花场景对象顺序（雾2 vs 背景）
const p1 = parsePkg('D:/SteamLibrary/steamapps/workshop/content/431960/3409595232/scene.pkg')
const s1 = sceneJson(p1)
console.log('== 3409595232 对象数组顺序（id: name kind）==')
s1.objects.forEach((o, i) => {
  const kind = o.particle ? 'PARTICLE' : o.image ? 'image' : 'other'
  if (o.id === 116 || o.id === 101 || o.id === 16 || kind === 'PARTICLE') console.log(`  [${i}] #${o.id} ${o.name ?? ''} ${kind} origin=${o.origin ?? ''}`)
})
// fog2 材质纹理
const fogMat = parseJ(p1, 'materials/presets/fog2.json')
console.log('fog2 材质 passes:', JSON.stringify(fogMat?.passes?.map((p) => p.textures)))
// 雾2 对象完整
const fog2 = s1.objects.find((o) => o.id === 116)
console.log('雾2 对象:', JSON.stringify({ particle: fog2?.particle, origin: fog2?.origin, scale: fog2?.scale, visible: fog2?.visible }))
// asset 纹理存在？
const { existsSync } = await import('node:fs')
const texName = fogMat?.passes?.[0]?.textures?.[0]
if (texName) {
  const p = `D:/SteamLibrary/steamapps/common/wallpaper_engine/assets/materials/${texName}.tex`
  console.log(`asset 纹理 ${texName}: ${existsSync(p) ? '存在' : '不存在'} @ ${p}`)
}

// ② asuna root 动画帧
const p2 = parsePkg('D:/SteamLibrary/steamapps/workshop/content/431960/3463520581/scene.pkg')
const { parsePuppetMdl, sampleAnimation } = await import('../src/scene/ScenePuppet.ts')
const asunaRoot = parsePuppetMdl(p2.read('models/puppet_puppet.mdl'))
console.log('\n== asuna root（puppet_puppet.mdl）动画 ==')
for (const a of asunaRoot.animations) {
  console.log(`动画 id=${a.id} name=${JSON.stringify(a.name)} loop=${a.loop} frames=${a.keyframes.length}`)
  if (a.id === 1953) {
    // 打印前 8 帧 + 中间帧的 8 值
    for (const f of [0, 1, 2, 5, 10, 20, 30, 40, 50, 60]) {
      const k = a.keyframes[f]
      if (!k) continue
      console.log(`  f${f}: t=${k.t} vals=${k.values.map((v) => v.toFixed(3)).join(' ')}`)
    }
  }
}

// ③ root 1949 插值平滑性（模拟 3 秒内每 0.1s 采样 rot）
const rootMdl = parsePuppetMdl(p2.read('models/puppet - Copy_puppet.mdl'))
const anim1949 = rootMdl.animations.find((a) => a.id === 1949)
if (anim1949) {
  const kf = anim1949.keyframes
  let peak = 0
  for (let i = 1; i < kf.length; i++) if (kf[i].t > kf[peak].t) peak = i
  const period = kf[peak].t - kf[0].t
  console.log(`\n== 1949 插值采样（period=${period}，每 0.3s 一个点，3 秒）==`)
  let prev = null
  for (let i = 0; i <= 30; i++) {
    const t = (i / 10) * period / 3
    const s = sampleAnimation(anim1949, t)
    const v4 = s.values[4]
    const jump = prev !== null && Math.abs(v4 - prev) > 0.001 ? '  <<JUMP' : ''
    console.log(`t=${t.toFixed(0)} v4=${v4.toFixed(5)}${jump}`)
    prev = v4
  }
}
