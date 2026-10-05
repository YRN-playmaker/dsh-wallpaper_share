// 通过 CDP 打开页面：收集控制台/异常、等页面自报就绪、截图存盘。
// 用法：node _dev/harness/cdp-shot.mjs <url> <outPng> [waitMs]
import { spawn } from 'node:child_process'
import { writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { resolve, dirname } from 'node:path'

const url = process.argv[2]
const outPng = resolve(process.argv[3] ?? '_dev/harness/out/cdp.png')
const waitMs = Number(process.argv[4] ?? 12000)
const evalExpr = process.argv[5] ?? null
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 9333
const profile = resolve(process.env.TEMP ?? '.', 'harness-cdp-profile')
rmSync(profile, { recursive: true, force: true })

const chrome = spawn(CHROME, [
  '--headless=new',
  '--disable-gpu',
  '--enable-unsafe-swiftshader',
  '--use-angle=swiftshader',
  '--no-first-run',
  '--no-default-browser-check',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  '--window-size=1267,813',
  'about:blank',
], { stdio: 'ignore' })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function getJson(path) {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`)
  return await res.json()
}

let targets = null
for (let i = 0; i < 40; i++) {
  try {
    targets = await getJson('/json/list')
    if (Array.isArray(targets) && targets.length > 0) break
  } catch { /* 未就绪 */ }
  await sleep(500)
}
if (!Array.isArray(targets) || targets.length === 0) {
  console.error('CDP not reachable')
  chrome.kill()
  process.exit(2)
}
const page = targets.find((t) => t.type === 'page') ?? targets[0]
console.log('target: ' + page.url + ' ws=' + (page.webSocketDebuggerUrl ? 'ok' : 'MISSING'))

const ws = new WebSocket(page.webSocketDebuggerUrl)
let nextId = 1
const pending = new Map()
const logs = []
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.id !== undefined) {
    const p = pending.get(msg.id)
    if (p !== undefined) { pending.delete(msg.id); msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result) }
    return
  }
  if (msg.method === 'Runtime.consoleAPICalled') {
    logs.push('[' + msg.params.type + '] ' + msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(' '))
  } else if (msg.method === 'Runtime.exceptionThrown') {
    const d = msg.params.exceptionDetails
    logs.push('[exception] ' + (d.exception?.description ?? d.text))
  } else if (msg.method === 'Log.entryAdded') {
    logs.push('[log:' + msg.params.entry.level + '] ' + msg.params.entry.text)
  }
})
const send = (method, params = {}) => new Promise((resolve_, reject) => {
  const id = nextId++
  pending.set(id, { resolve: resolve_, reject })
  ws.send(JSON.stringify({ id, method, params }))
})
await new Promise((r) => ws.addEventListener('open', r, { once: true }))
await send('Runtime.enable')
await send('Log.enable')
await send('Page.enable')
await send('Page.navigate', { url })
await sleep(waitMs)
const title = await send('Runtime.evaluate', { expression: 'document.title', returnByValue: true })
if (evalExpr !== null) {
  try {
    const r = await send('Runtime.evaluate', { expression: evalExpr, returnByValue: true, awaitPromise: true })
    console.log('eval=' + JSON.stringify(r.result?.value ?? r.result?.description ?? r.exceptionDetails?.text))
  } catch (e) {
    console.log('eval error: ' + e.message)
  }
}
const canvasInfo = await send('Runtime.evaluate', {
  expression: `(() => { const cs = Array.from(document.querySelectorAll('canvas')); return cs.map(c => c.width + 'x' + c.height).join(',') })()`,
  returnByValue: true,
})
const shot = await send('Page.captureScreenshot', { format: 'png' })
mkdirSync(dirname(outPng), { recursive: true })
writeFileSync(outPng, Buffer.from(shot.data, 'base64'))
console.log('title=' + JSON.stringify(title.result?.value))
console.log('canvases=' + JSON.stringify(canvasInfo.result?.value))
console.log('page logs:\n' + (logs.length === 0 ? '  (none)' : logs.slice(0, 40).map((l) => '  ' + l.slice(0, 400)).join('\n')))
console.log('screenshot -> ' + outPng)
ws.close()
chrome.kill()
process.exit(0)
