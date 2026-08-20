// 调试 MDLA 解析：asuna body
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = fileURLToPath(import.meta.url).replace(/\\/g, '/')
const root = here.slice(0, here.lastIndexOf('/_dev/'))
const { parsePuppetMdl } = await import(pathToFileURL(join(root, 'src/scene/ScenePuppet.ts')).href)

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
  return { read }
}

const pkg = parsePkg('D:/SteamLibrary/steamapps/workshop/content/431960/3463520581/scene.pkg')
const m = pkg.read('models/asuna body_puppet.mdl')
const mdla = m.indexOf('MDLA0006')
console.log('mdla=' + mdla + ' animCount@+13=' + m.readUInt32LE(mdla + 13))
console.log('head32: ' + m.subarray(mdla, mdla + 32).toString('hex'))
console.log('anim1 area: ' + m.subarray(mdla + 17, mdla + 60).toString('hex'))
const pm = parsePuppetMdl(m)
console.log('parsed anims: ' + JSON.stringify(pm.animations.map((a) => ({ id: a.id, name: a.name, loop: a.loop, bc: a.boneCount, kf: a.keyframes.length }))))
// 手动检查 parseKeyframes 探测：数据区从 mdla+50 起 2196B
const dataStart = mdla + 50
console.log('frame data start: ' + m.subarray(dataStart, dataStart + 40).toString('hex'))
console.log('first t: ' + (m[dataStart] | (m[dataStart + 1] << 8) | (m[dataStart + 2] << 16)))
console.log('last 40B of anim0 data: ' + m.subarray(dataStart + 2196 - 40, dataStart + 2196).toString('hex'))
// 帧 0 的 8 floats
for (let i = 0; i < 8; i++) console.log('  f' + i + '=' + m.readFloatLE(dataStart + 3 + i * 4).toFixed(3))
