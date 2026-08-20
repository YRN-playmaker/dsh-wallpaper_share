// 三场景粒子图层 + origin 分布诊断（y-up 假设验证）
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
  return { buf, entries, read }
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

const WS = 'D:/SteamLibrary/steamapps/workshop/content/431960'

for (const pid of ['3409595232', '1771607909', '3463520581']) {
  const pkg = parsePkg(`${WS}/${pid}/scene.pkg`)
  const scene = sceneJson(pkg)
  console.log(`\n===== ${pid} 场景 ${scene.general?.orthogonalprojection?.width ?? 1920}x${scene.general?.orthogonalprojection?.height ?? 1080} =====`)
  // 非居中（y≠H/2）图层的 origin —— 验证 y-up
  const H = Number(scene.general?.orthogonalprojection?.height ?? 1080)
  for (const o of scene.objects) {
    const name = String(o.name ?? '')
    if (typeof o.origin !== 'string') continue
    if (o.particle || /particle|wind|snow|leaf|fog|spark|ember/i.test(name)) {
      console.log(`#${o.id} [${name}] particle=${o.particle ?? '-'} origin=${o.origin ?? '-'} scale=${o.scale ?? '-'} visible=${typeof o.visible === 'object' ? JSON.stringify(o.visible) : o.visible} parent=${o.parent ?? '-'}`)
    }
  }
  // 粒子预设详情
  const seen = new Set()
  for (const o of scene.objects) {
    if (!o.particle || seen.has(o.particle)) continue
    seen.add(o.particle)
    const p = parseJ(pkg, o.particle)
    if (!p) continue
    const em = Array.isArray(p.emitter) ? p.emitter[0] : null
    const ops = Array.isArray(p.operator) ? p.operator.map((x) => ({ n: x.name, ...Object.fromEntries(Object.entries(x).filter(([k]) => k !== 'name')) })) : []
    console.log(`  preset ${o.particle}: maxcount=${p.maxcount} starttime=${p.starttime} mat=${p.material} renderer=${JSON.stringify(Array.isArray(p.renderer) ? p.renderer[0]?.name : null)}`)
    if (em) console.log(`    emitter: ${JSON.stringify(Object.fromEntries(Object.entries(em).filter(([k]) => k !== 'name')))}`)
    const inits = Array.isArray(p.initializer) ? p.initializer.map((x) => ({ n: x.name, ...Object.fromEntries(Object.entries(x).filter(([k]) => k !== 'name')) })) : []
    for (const i of inits) console.log(`    init: ${JSON.stringify(i)}`)
    for (const op of ops) console.log(`    op: ${JSON.stringify(op)}`)
  }
}
