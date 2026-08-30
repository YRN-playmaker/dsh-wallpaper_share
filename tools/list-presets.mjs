// 列出 pkg 中所有 particles/ 与 materials/presets/ 条目
import { readFileSync } from 'node:fs'
import { parseScenePkg } from '../src/scene/ScenePkg.ts'

const buf = readFileSync(process.argv[2])
const pkg = parseScenePkg(new Uint8Array(buf))
for (const e of pkg.entries) {
  if (e.name.startsWith('particles/') || e.name.startsWith('materials/presets/')) {
    console.log(e.name, '(' + e.size + 'B)')
  }
}
