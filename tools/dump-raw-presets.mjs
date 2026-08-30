// 临时诊断：打印 pkg 中 particles/*.json 的原始内容（聚焦 smoke/fog/ember/spark）
import { readFileSync } from 'node:fs'
import { parseScenePkg } from '../src/scene/ScenePkg.ts'

const buf = readFileSync(process.argv[2])
const pkg = parseScenePkg(new Uint8Array(buf))
const wanted = ['smoke1.json', 'fog1.json', 'spark.json', 'magic_charge.json', 'discharge.json', 'torch.json', 'emberglow_small.json']
for (const e of pkg.entries) {
  if (!e.name.startsWith('particles/')) continue
  const name = e.name.toLowerCase()
  if (!wanted.some((w) => name.includes(w))) continue
  const data = pkg.read(e.name)
  if (data === null) continue
  const raw = Buffer.from(data).toString('utf8')
  console.log('========== ' + e.name + ' ==========')
  console.log(raw.slice(0, 6000))
  console.log('')
}
