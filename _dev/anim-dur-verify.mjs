// 验证 MDLA dur 字段 vs 帧 t 跨度：确定动画周期语义
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
  return { read }
}

// 直接从 mdl 读 dur（目录项 f32）与帧 t 跨度对比
for (const [wid, mdlName] of [
  ['3463520581', 'models/puppet_puppet.mdl'],
  ['3463520581', 'models/puppet - Copy_puppet.mdl'],
  ['3759313716', 'models/hairfrontside_puppet.mdl'],
  ['3759313716', 'models/skırt_puppet.mdl'],
  ['3770263871', 'models/草_puppet.mdl'],
]) {
  const pkg = parsePkg(readFileSync('D:/SteamLibrary/steamapps/workshop/content/431960/' + wid + '/scene.pkg'))
  const m = pkg.read(mdlName)
  const mdla = m.indexOf('MDLA0006')
  if (mdla < 0) { console.log(mdlName + ': no MDLA'); continue }
  const animCount = m.readUInt32LE(mdla + 13)
  let q = mdla + 17
  for (let a = 0; a < animCount && q + 20 < m.length; a++) {
    const id = m.readUInt32LE(q)
    q += 8
    let nm = ''
    while (m[q] !== 0 && nm.length < 64) { nm += String.fromCharCode(m[q]); q++ }
    q++
    while (m[q] !== 0) { q++ }
    q++
    const f32v = m.readFloatLE(q)
    q += 4
    const bc = m.readUInt32LE(q)
    q += 16
    const dataLen = m.readUInt32LE(q)
    q += 4
    // 数据区起点（跳过 extra + 探测帧 t 跨度）
    q++
    // 帧 t 序列（探测偏移）
    let bestSpan = 0
    for (let off = 0; off <= 8; off++) {
      const n = Math.floor(dataLen / 36)
      if (n < 2) break
      let mn = Infinity, mx = -Infinity
      for (let f = 0; f < n; f++) {
        const fp = q + off + f * 36
        const t = (m[fp] | (m[fp + 1] << 8) | (m[fp + 2] << 16)) >>> 0
        if (t < mn) mn = t
        if (t > mx) mx = t
      }
      if (mx - mn > bestSpan) bestSpan = mx - mn
    }
    console.log(mdlName.split('/').pop() + ' anim#' + a + ' id=' + id + ' f32(dur?)=' + f32v + ' bones=' + bc + ' dataLen=' + dataLen + ' tSpan=' + bestSpan + ' tSpan/f32=' + (f32v > 0 ? (bestSpan / f32v).toFixed(0) : '-'))
    q += dataLen
  }
}
