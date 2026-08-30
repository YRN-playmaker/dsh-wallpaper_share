// 完整解析 2164591875 scene.json 每个图层的 visible/alpha/copybackground/image
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
const sceneText = Buffer.from(pkg.read('scene.json')!).toString('utf8')
const jsonStr = sceneText.slice(sceneText.indexOf('{'), sceneText.lastIndexOf('}') + 1)
// 直接用 JSON.parse（scene.json 是标准 JSON 吗？之前解析说缺头括号，试试）
let obj: any = null
try { obj = JSON.parse(jsonStr) } catch (e) { console.log('JSON.parse 失败: ' + e); }
if (obj !== null && Array.isArray(obj.objects)) {
  for (const o of obj.objects) {
    console.log('\n===== id=' + o.id + ' name="' + o.name + '" =====')
    console.log('  image: ' + (o.image ?? '-'))
    console.log('  copybackground: ' + (o.copybackground ?? '-'))
    // visible
    if (typeof o.visible === 'object') {
      const u = o.visible.user
      console.log('  visible: ' + JSON.stringify(o.visible).slice(0, 120))
    } else console.log('  visible: ' + o.visible)
    // alpha
    if (typeof o.alpha === 'object' && o.alpha.script !== undefined) {
      console.log('  alpha: <script>')
      const sc = o.alpha.script as string
      // 提取 START_HOUR / END_HOUR
      const sh = /START_HOUR\s*=\s*([\d.]+)/.exec(sc)
      const eh = /END_HOUR\s*=\s*([\d.]+)/.exec(sc)
      console.log('    START_HOUR=' + (sh ? sh[1] : '?') + ' END_HOUR=' + (eh ? eh[1] : '?'))
      console.log('    timeOfDay? ' + /engine\.timeOfDay/.test(sc))
    } else {
      console.log('  alpha: ' + o.alpha)
    }
    console.log('  size: ' + (o.size ?? '-') + ' origin: ' + (o.origin ?? '-') + ' scale: ' + (o.scale ?? '-'))
    // solid / alignment
    console.log('  solid: ' + (o.solid ?? '-') + ' alignment: ' + (o.alignment ?? '-'))
  }
} else {
  console.log('objects 解析失败，回退正则提取')
}
