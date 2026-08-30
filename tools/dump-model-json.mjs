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
// 读取 右眼.json
const eyeJson = pkg.read('models/右眼.json')
if (eyeJson) {
  const text = Buffer.from(eyeJson).toString('utf8')
  console.log('models/右眼.json:')
  console.log(text)
}
// 右睫毛.json
const lashJson = pkg.read('models/右睫毛.json')
if (lashJson) {
  const text = Buffer.from(lashJson).toString('utf8')
  console.log('models/右睫毛.json:')
  console.log(text)
}
// 左眼球.json
const leyeJson = pkg.read('models/左眼球.json')
if (leyeJson) {
  const text = Buffer.from(leyeJson).toString('utf8')
  console.log('models/左眼球.json:')
  console.log(text)
}
// z左睫毛.json
const llashJson = pkg.read('models/z左睫毛.json')
if (llashJson) {
  const text = Buffer.from(llashJson).toString('utf8')
  console.log('models/z左睫毛.json:')
  console.log(text)
}
// 材质文件
const matJson = pkg.read('materials/右眼.json')
if (matJson) {
  const text = Buffer.from(matJson).toString('utf8')
  console.log('materials/右眼.json:')
  console.log(text)
}