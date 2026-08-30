import fs from 'fs'
function utf8Slice(buf, a, b) { return Buffer.from(buf.subarray(a, b)).toString('utf8') }
const readPkg = (path) => {
  const buf = fs.readFileSync(path)
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  let pos = 0
  const readI32 = () => { const v = view.getInt32(pos, true); pos += 4; return v }
  const magicLen = readI32(); pos += magicLen; const version = readI32()
  const entries = []
  while (pos + 8 <= buf.length) {
    const nameLen = readI32(); if (nameLen <= 0 || nameLen > 2048 || pos + nameLen + 8 > buf.length) break
    const name = utf8Slice(buf, pos, pos + nameLen); pos += nameLen
    const offset = readI32(); const size = readI32()
    if (offset < 0 || size < 0 || offset + size > buf.length) break
    entries.push({ name, offset, size })
  }
  const dataStart = pos
  const read = (n) => { const e = entries.find((x) => x.name === n); return e ? buf.subarray(dataStart + e.offset, dataStart + e.offset + e.size) : null }
  return { read, entries }
}
const pkg = readPkg('D:/SteamLibrary/steamapps/workshop/content/431960/2804379697/scene.pkg')
const raw = pkg.read('scene.json')
const text = Buffer.from(raw).toString('utf8').trim()
// 无外括号，加 {}
const json = '{' + text + '}'
try {
  const scene = JSON.parse(json)
  console.log('scene keys:', Object.keys(scene).join(', '))
  const byId = new Map()
  if (scene.layers) for (const l of scene.layers) byId.set(l.id, l)
  if (scene.layers) {
    console.log('layers count:', scene.layers.length)
    for (const l of scene.layers) {
      const parentName = l.parent !== undefined && byId.has(l.parent) ? byId.get(l.parent).name : '(root)'
      const anims = l.animationlayers ? l.animationlayers.map(a => `${a.animation}@${a.rate ?? 1}`).join(',') : ''
      console.log(`id=${String(l.id).padStart(3)} name="${l.name}" parent="${parentName}" image=${l.image ?? '-'} anims=[${anims}] visible=${l.visible??true} alpha=${l.alpha??1}`)
    }
  }
  console.log()
  console.log('=== 眼睛相关图层详情 ===')
  if (scene.layers) for (const l of scene.layers) {
    if (['右眼','右睫毛','左眼球','z左睫毛','左眼'].some(k => l.name.includes(k))) {
      console.log(`id=${l.id} name="${l.name}" origin=${JSON.stringify(l.origin)} scale=${JSON.stringify(l.scale)} size=${JSON.stringify(l.size)} image=${l.image} angles=${JSON.stringify(l.angles)}`)
    }
  }
} catch(e) {
  // 如果失败，尝试逐行解析
  console.log('JSON parse error:', e.message)
  console.log('json length:', json.length, 'first 200:', json.slice(0, 200))
  // 找最后一个 }
  const lastBrace = json.lastIndexOf('}')
  const firstBrace = json.indexOf('{')
  // 尝试截取到最后一个正确闭合的位置
  // 可能有多余的 } 在末尾
  let depth = 0
  let validEnd = lastBrace
  for (let i = 0; i < json.length; i++) {
    if (json[i] === '{') depth++
    else if (json[i] === '}') { depth--; if (depth === 0) validEnd = i }
  }
  console.log('valid end at', validEnd, 'depth ends at', depth)
  const trimmed = json.slice(0, validEnd + 1)
  try {
    const scene = JSON.parse(trimmed)
    console.log('Parsed with trimmed. Keys:', Object.keys(scene).join(', '))
  } catch(e2) {
    console.log('Still fails:', e2.message)
  }
}