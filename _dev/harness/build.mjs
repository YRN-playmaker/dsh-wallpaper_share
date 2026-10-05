// 把浏览器渲染器打成可独立运行的 ESM（供 headless Chrome 端到端渲染验证）。
// 用法：node _dev/harness/build.mjs [repoRoot] [outFile]
import { resolve } from 'node:path'
import { existsSync, mkdirSync } from 'node:fs'

const repoRoot = resolve(process.argv[2] ?? '.')
const outFile = resolve(process.argv[3] ?? resolve(repoRoot, '_dev/harness/dist/SceneModelRenderer.mjs'))
const inputFile = resolve(process.argv[4] ?? resolve(repoRoot, 'src/client/SceneModelRenderer.ts'))
const rolldownPath = resolve(repoRoot, 'node_modules/.pnpm/rolldown@1.2.4/node_modules/rolldown/dist/index.mjs')
if (!existsSync(rolldownPath)) throw new Error('rolldown not found at ' + rolldownPath)
const { rolldown } = await import('file:///' + rolldownPath.replace(/\\/g, '/'))

mkdirSync(resolve(outFile, '..'), { recursive: true })
const bundle = await rolldown({
  input: inputFile,
  platform: 'browser',
})
await bundle.write({ file: outFile, format: 'esm' })
await bundle.close()
console.log('bundled ' + inputFile + ' -> ' + outFile)
