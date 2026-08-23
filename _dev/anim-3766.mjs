// dump 3766677415 #25 角色的 puppet 动画帧：分量变化 + 值域 → 语义判断
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = fileURLToPath(import.meta.url).replace(/\\/g, '/')
const root = here.slice(0, here.lastIndexOf('/_dev/'))
const { parsePuppetMdl } = await import(pathToFileURL(join(root, 'src/scene/ScenePuppet.ts')).href)

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
  const read = (n) => {
    const e = entries.find((x) => x.name === n)
    if (!e) return null
    return buf.subarray(dataStart + e.offset, dataStart + e.offset + e.size)
  }
  return { read, entries }
}

const pkg = parsePkg(readFileSync('D:/SteamLibrary/steamapps/workshop/content/431960/3766677415/scene.pkg'))
console.log('puppet mdls: ' + pkg.entries.filter((e) => e.name.endsWith('_puppet.mdl')).map((e) => e.name).join(', '))
// 所有 puppet mdl 的动画分量分析
for (const n of pkg.entries.filter((e) => e.name.endsWith('_puppet.mdl')).map((e) => e.name)) {
  const pm = parsePuppetMdl(pkg.read(n))
  if (!pm || pm.animations.length === 0) { console.log(n.split('/').pop() + ': no anim'); continue }
  for (const anim of pm.animations) {
    const kf = anim.keyframes
    if (kf.length < 2) continue
    const spans = []
    for (let vi = 0; vi < 8; vi++) {
      let mn = Infinity, mx = -Infinity, ok = true
      for (const k of kf) {
        const v = k.values[vi]
        if (!Number.isFinite(v)) { ok = false; break }
        if (v < mn) mn = v
        if (v > mx) mx = v
      }
      spans.push(ok ? [mn, mx, mx - mn] : [NaN, NaN, NaN])
    }
    const changing = spans.map((s, i) => (s[2] > 0.005 ? 'v' + i + '[' + s[0].toFixed(2) + ',' + s[1].toFixed(2) + ']Δ' + s[2].toFixed(2) : null)).filter(Boolean)
    console.log('\n' + n.split('/').pop() + ' anim="' + anim.name + '" id=' + anim.id + ' dur=' + anim.duration + ' kf=' + kf.length)
    console.log('  changing: ' + (changing.length ? changing.join(' ') : 'NONE'))
    // 首/中/尾帧
    for (const fi of [0, Math.floor(kf.length / 4), Math.floor(kf.length / 2), kf.length - 1]) {
      console.log('  f' + fi + ' [' + kf[fi].values.map((x) => x.toFixed(3)).join(', ') + ']')
    }
  }
}
