// 一次性勘察：正确解析 PKGV0001（nameLen+name+offset+size），dump scene.json
// 注意：WE 导出的 scene.json 去掉了最外层花括号，解析时需补 { }
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const WS = 'D:/SteamLibrary/steamapps/workshop/content/431960'
const SCENES = ['904233689', '2865923273', '3151551777', '1516043085', '2804379697', '2627185285', '2125735009', '3463520581']

function parsePkg(path) {
  const buf = readFileSync(path)
  let pos = 0
  const magicLen = buf.readInt32LE(pos); pos += 4
  const magic = buf.subarray(pos, pos + magicLen).toString('ascii'); pos += magicLen
  const version = buf.readInt32LE(pos); pos += 4
  const entries = []
  let guard = 0
  while (pos + 8 <= buf.length && guard++ < 100000) {
    const nameLen = buf.readInt32LE(pos); pos += 4
    if (nameLen <= 0 || nameLen > 1024 || pos + nameLen + 8 > buf.length) break
    const name = buf.subarray(pos, pos + nameLen).toString('utf8'); pos += nameLen
    const offset = buf.readInt32LE(pos); pos += 4
    const size = buf.readInt32LE(pos); pos += 4
    if (offset < 0 || size < 0 || offset + size > buf.length) break
    entries.push({ name, offset, size })
  }
  const dataStart = pos
  const read = (e) => buf.subarray(dataStart + e.offset, dataStart + e.offset + e.size)
  const get = (n) => { const e = entries.find((x) => x.name === n); return e === undefined ? null : read(e) }
  return { magic, version, entries, get, read }
}

function parseSceneJson(buf) {
  // WE 导出的 scene.json：缺开头 {、尾部有 \r\n// 注释 / \0 / 其他垃圾
  const raw = buf.toString('utf8')
  const last = lastUnquotedBrace(raw)
  if (last < 0) throw new Error('scene.json: no closing brace')
  let text = raw.slice(0, last + 1).trim()
  if (!text.startsWith('{')) text = '{' + text
  return JSON.parse(text)
}

/** 找最后一个不在字符串内的 }（字符串内可能含 }） */
function lastUnquotedBrace(text) {
  let inStr = false
  let esc = false
  let last = -1
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') inStr = false
    } else if (c === '"') {
      inStr = true
    } else if (c === '}') {
      last = i
    }
  }
  return last
}

for (const id of SCENES) {
  const pkgPath = join(WS, id, 'scene.pkg')
  try {
    const p = parsePkg(pkgPath)
    console.log('\n===== ' + id + ' (' + p.magic + ' v' + p.version + ', ' + p.entries.length + ' entries) =====')
    console.log('  entries:', p.entries.slice(0, 24).map((e) => e.name).join(', '))
    const sceneBuf = p.get('scene.json')
    if (sceneBuf === null) { console.log('  NO scene.json'); continue }
    const sc = parseSceneJson(sceneBuf)
    console.log('  top keys:', Object.keys(sc).join(', '))
    if (Array.isArray(sc.objects)) {
      console.log('  objects:', sc.objects.length)
      for (const o of sc.objects.slice(0, 5)) {
        const pick = {}
        for (const k of ['id', 'name', 'image', 'material', 'texture', 'origin', 'angles', 'scale', 'parallaxDepth', 'visible', 'blendmode', 'copybackground', 'width', 'height', 'type', 'zindex', 'animation']) {
          if (o[k] !== undefined) {
            const v = o[k]
            pick[k] = typeof v === 'string' && v.length > 90 ? v.slice(0, 90) + '...' : (Array.isArray(v) ? 'array[' + v.length + ']' : v)
          }
        }
        console.log('    obj:', JSON.stringify(pick))
      }
      const animCount = sc.objects.filter((o) => o.animation !== undefined && o.animation !== null).length
      const particleCount = sc.objects.filter((o) => o.particlesystem !== undefined || o.particles !== undefined).length
      console.log('  objects with animation:', animCount, '| particle objects:', particleCount)
    }
    const g = sc.general ?? {}
    console.log('  general:', JSON.stringify(g).slice(0, 220))
    console.log('  camera:', JSON.stringify(sc.camera ?? null))
  } catch (e) {
    console.log('===== ' + id + ' ERROR: ' + e.message)
  }
}
