// 解析 we-capture --selftest 协议帧文件：[4B LE payloadLen][1B format][4B LE w][4B LE h][payload]
// 输出：_dev/denia-out/truth/fNNN.jpg
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

const BIN = resolve(import.meta.dirname, 'denia-out', 'we-truth.bin')
const OUT = resolve(import.meta.dirname, 'denia-out', 'truth')
rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

const buf = readFileSync(BIN)
let pos = 0
let i = 0
const dims = new Set()
while (pos + 9 <= buf.length) {
  const len = buf.readUInt32LE(pos)
  if (len === 0 || pos + 4 + len > buf.length) break
  const payload = buf.subarray(pos + 4, pos + 4 + len)
  const fmt = payload[0]
  const w = payload.readUInt32LE(1)
  const h = payload.readUInt32LE(5)
  dims.add(`${fmt} ${w}x${h}`)
  const data = payload.subarray(9)
  writeFileSync(resolve(OUT, 'f' + String(i).padStart(3, '0') + (fmt === 0 ? '.jpg' : '.bin')), data)
  pos += 4 + len
  i++
}
console.log('frames=' + i + ' dims=' + [...dims].join(', '))
