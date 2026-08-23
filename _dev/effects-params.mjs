// 从 scene.json 提取 waterwaves/shake/opacity 的 passes 参数（字符串扫描）
import { readFileSync } from 'node:fs'

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

const pkg = parsePkg(readFileSync('D:/SteamLibrary/steamapps/workshop/content/431960/3463520581/scene.pkg'))
const s = pkg.read('scene.json').toString('utf8')
// 逐 layer 找 effects
const layerRe = /\{\s*"id"\s*:\s*(\d+)[\s\S]*?"name"\s*:\s*"([^"]*)"[\s\S]*?(?=\{\s*"id"\s*:|\}\s*\]?\s*$)/g
let m
let count = 0
while ((m = layerRe.exec(s)) !== null && count < 200) {
  const id = m[1]
  const name = m[2]
  const body = m[0]
  if (!body.includes('"effects"')) continue
  count++
  // 提取 effect 条目
  const effRe = /\{\s*"file"\s*:\s*"([^"]*)"[\s\S]*?"name"\s*:\s*"([^"]*)"([\s\S]*?)(?=\},\s*\{|"\s*\]|$)/g
  let em
  while ((em = effRe.exec(body)) !== null) {
    const file = em[1]
    const eName = em[2]
    const rest = em[3]
    // 提取 constantshadervalues
    const csv = rest.match(/"constantshadervalues"\s*:\s*\{([\s\S]*?)\}/)
    const params = csv ? csv[1].replace(/\s+/g, ' ').slice(0, 200) : ''
    console.log('layer#' + id + ' ' + name + ' effect=' + file.split('/').pop() + '("' + eName + '") ' + params)
  }
}
