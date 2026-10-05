// 二分定位：分别停用 shake / waterwaves 后，对比「我的构建」与「HEAD 构建」的渲染差异
// 用法：node _dev/harness/bisect.mjs <minePort> <headPort> <stripMode>
import { execFileSync } from 'node:child_process'

const minePort = process.argv[2]
const headPort = process.argv[3]
const mode = process.argv[4] ?? ''

const run = (args) => {
  try {
    return execFileSync(process.execPath, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })
  } catch (e) {
    return String(e.stdout ?? '') + String(e.message ?? '')
  }
}
const shot = (url, out) => run(['_dev/harness/cdp-shot.mjs', url, out, '11000']).trim().split('\n').slice(-1)[0]
const config = async (port) => {
  const res = await fetch(`http://127.0.0.1:${port}/config?strip=${encodeURIComponent(mode)}`)
  return await res.text()
}
const compare = async (tag, a, b) => {
  const out = run(['_dev/harness/cdp-shot.mjs', `http://127.0.0.1:${minePort}/compare?a=${a}&b=${b}&tag=${tag}`, '_dev/harness/out/ignore.png', '11000'])
  const m = /title="([^"]*)"/.exec(out)
  return m !== null ? m[1] : out.trim().split('\n').slice(-1)[0]
}

console.log('mode=' + JSON.stringify(mode))
console.log('mine config: ' + (await config(minePort)))
console.log('head config: ' + (await config(headPort)))
shot(`http://127.0.0.1:${minePort}/?freeze=1`, `_dev/harness/out/bisect-mine${mode}.png`)
shot(`http://127.0.0.1:${headPort}/?freeze=1`, `_dev/harness/out/bisect-head${mode}.png`)
console.log('diff: ' + (await compare(`d${mode}`, `bisect-mine${mode}.png`, `bisect-head${mode}.png`)))
