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
for (const eye of ['右眼', '右睫毛', '左眼球', 'z左睫毛']) {
  const mdlBuf = pkg.read(`models/${eye}_puppet.mdl`)
  console.log(`=== ${eye}_puppet.mdl ===`)
  // 前 64 字节 hex
  const hex = Array.from(mdlBuf.subarray(0, 64)).map(b => b.toString(16).padStart(2, '0')).join(' ')
  console.log('head hex:', hex)
  // 魔数字符串（到第一个 null）
  let magic = ''
  let i = 0
  while (i < 64 && mdlBuf[i] !== 0) { magic += String.fromCharCode(mdlBuf[i]); i++ }
  console.log('magic string:', JSON.stringify(magic))
  console.log('total len:', mdlBuf.length)
  console.log()
}
