// Miku anim[1]（当前解析）帧值详情：判断真实动画还是错位假象
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
  return { read, entries }
}

const { read, entries } = parsePkg('D:/SteamLibrary/steamapps/workshop/content/431960/3409595232/scene.pkg')
const m = read('models/导出初音_puppet.mdl')
const mdla = m.indexOf('MDLA0006')
// 数据区起点：目录项 1（id=463）@+17 —— 直接找数据块：从 @+60 起扫描 36B 对齐的合理帧
// 打印 @+60..@+300 的 hex 人工看
console.log('MDLA@' + mdla)
console.log('region @+60..+300:')
console.log(m.subarray(mdla + 60, mdla + 300).toString('hex'))
// 尝试多个起点解析帧（每 36B），打印 t + v0,v1,v4
for (let baseOff = 60; baseOff <= 80; baseOff++) {
  const base = mdla + baseOff
  const t0 = (m[base] | (m[base + 1] << 8) | (m[base + 2] << 16)) >>> 0
  const t1 = (m[base + 36] | (m[base + 37] << 8) | (m[base + 38] << 16)) >>> 0
  const v0 = m.readFloatLE(base + 3)
  const v4 = m.readFloatLE(base + 19)
  const v0b = m.readFloatLE(base + 39)
  console.log('  base+' + baseOff + ': t0=' + t0 + ' t1=' + t1 + ' v0=' + v0.toFixed(2) + ' v4=' + v4.toFixed(3) + ' | v0b=' + v0b.toFixed(2))
}
