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
// 加外括号找第一个完整对象
const full = '{' + text + '}'
let depth = 0
let firstEnd = -1
for (let i = 0; i < full.length; i++) {
  if (full[i] === '{') depth++
  else if (full[i] === '}') { depth--; if (depth === 0) { firstEnd = i; break } }
}
console.log('first complete object ends at', firstEnd)
const obj = full.slice(0, firstEnd + 1)
try {
  const scene = JSON.parse(obj)
  console.log('scene keys:', Object.keys(scene).join(', '))
  const layerArr = scene.objects ?? scene.layers
  const byId = new Map()
  if (layerArr) for (const l of layerArr) byId.set(l.id, l)
  console.log('layers count:', layerArr ? layerArr.length : 'N/A')
  console.log()
  for (const l of layerArr) {
    const parentName = l.parent !== undefined && byId.has(l.parent) ? byId.get(l.parent).name : '(root)'
    const anims = l.animationlayers ? l.animationlayers.map(a => `${a.animation}@${a.rate ?? 1}`).join(',') : ''
    console.log(`id=${String(l.id).padStart(3)} name="${l.name}" parent="${parentName}" image=${l.image ?? '-'} anims=[${anims}] visible=${l.visible??true}`)
  }
  console.log()
  console.log('=== 眼睛相关层详情 ===')
  for (const l of layerArr) {
    if (['右眼','右睫毛','左眼球','z左睫毛','左眼','眼'].some(k => l.name.includes(k))) {
      console.log(`id=${l.id} name="${l.name}" origin=${JSON.stringify(l.origin)} scale=${JSON.stringify(l.scale)} size=${JSON.stringify(l.size)} image=${l.image} angles=${JSON.stringify(l.angles)} animationlayers=${JSON.stringify(l.animationlayers)}`)
    }
  }
} catch (e) {
  console.log('parse error:', e.message)
  // 找 layers 数组
  const li = text.indexOf('"layers"')
  if (li >= 0) {
    // 从 "layers" 开始找 [ 和匹配的 ]
    let depth = 0
    let arrStart = -1
    let arrEnd = -1
    for (let i = li; i < text.length; i++) {
      if (text[i] === '[') { depth++; if (arrStart < 0) arrStart = i }
      else if (text[i] === ']') { depth--; if (depth === 0) { arrEnd = i; break } }
    }
    if (arrStart >= 0 && arrEnd > arrStart) {
      const arr = JSON.parse(text.slice(arrStart, arrEnd + 1))
      console.log('layers count:', arr.length)
      const byId = new Map()
      for (const l of arr) byId.set(l.id, l)
      for (const l of arr) {
        const parentName = l.parent !== undefined && byId.has(l.parent) ? byId.get(l.parent).name : '(root)'
        const anims = l.animationlayers ? l.animationlayers.map(a => `${a.animation}@${a.rate ?? 1}`).join(',') : ''
        console.log(`id=${String(l.id).padStart(3)} name="${l.name}" parent="${parentName}" image=${l.image ?? '-'} anims=[${anims}]`)
      }
      console.log()
      console.log('=== 眼睛相关层 ===')
      for (const l of arr) {
        if (['右眼','右睫毛','左眼球','z左睫毛','左眼'].some(k => l.name.includes(k))) {
          console.log(`id=${l.id} name="${l.name}" origin=${JSON.stringify(l.origin)} scale=${JSON.stringify(l.scale)} size=${JSON.stringify(l.size)} image=${l.image} angles=${JSON.stringify(l.angles)}`)
        }
      }
    }
  }
}