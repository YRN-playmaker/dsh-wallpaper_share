// Chrome + 真实帧中继回归：窗口移动、标题栏、网页缩放、静态帧及旧协议回退。
// 用法：node tools/test-capture-browser.mjs [Chrome 路径] [--native]
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { SceneFrameHub } from '../src/scene/SceneWebSocket.ts'
import { SceneAdapter } from '../src/scene/SceneAdapter.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const requireBuild = createRequire(import.meta.resolve('tsdown'))
const { rolldown } = await import(pathToFileURL(requireBuild.resolve('rolldown')).href)
const tempRoot = resolve(tmpdir()), work = mkdtempSync(join(tempRoot, 'we-capture-view-'))
const native = process.argv.includes('--native')
const adapter = native ? new SceneAdapter({
  weDir: resolve(root, '..'),
  config: { sceneRendererPath: join(root, 'bin/we-capture.exe'), wallpaperEngineAssetsDir: '', width: 1920, height: 1080, fps: 30, quality: 85 },
  log: () => {},
}) : null
adapter?.setTarget({ key: 'Monitor1', file: resolve(root, '../../../workshop/content/431960/3465215190/scene.pkg'), kind: 'scene' })
const hub = adapter?.hub ?? new SceneFrameHub()
const screen = { left: 0, top: 0, width: 1920, height: 1080, pixelRatio: 1 }
if (!native) hub.setCaptureScreen('Monitor1', screen)
const pixels = new Uint8Array(480 * 270 * 4)
for (let y = 0; y < 270; y++) for (let x = 0; x < 480; x++) {
  pixels.set([Math.round(x / 480 * 255), Math.round(y / 270 * 255), 50, 255], (y * 480 + x) * 4)
}

async function browserTests() {
  const { SceneCanvas } = await import('/canvas.mjs')
  const check = (ok, message) => { if (!ok) throw new Error(message) }
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const metrics = values => {
    for (const [key, value] of Object.entries(values)) Object.defineProperty(window, key, { configurable: true, value })
  }
  metrics({ screenX: 300, screenY: 180, outerWidth: 616, outerHeight: 496, innerWidth: 600, innerHeight: 400, devicePixelRatio: 1 })
  const r = new SceneCanvas(), read = (x, y) => Array.from(r.ctx.getImageData(x, y, 1, 1).data)
  const expect = (pixel, x, y, message) => check(Math.abs(pixel[0] - x / 1920 * 255) <= 2
    && Math.abs(pixel[1] - y / 1080 * 255) <= 2 && pixel[3] === 255, message + ': ' + pixel)
  const ready = async () => {
    for (let i = 0; i < 100 && (!r.isLive || !r.captureScreen || r.needDraw); i++) await sleep(20)
    check(r.isLive && r.captureScreen, 'cached capture geometry / initial binary frame missing')
    await sleep(50)
  }
  r.start('Monitor1', 1); await ready()
  check(read(200, 100)[3] > 0, 'initial draw state: ' + JSON.stringify({ hidden: document.hidden, needDraw: r.needDraw,
    raf: r.rafId, dims: [r.el.width, r.el.height], rect: r.el.getBoundingClientRect().toJSON(), position: [screenX, screenY], screen: r.captureScreen }))
  const initial = read(200, 100)
  expect(initial, 508, 368, 'small window displayed a fitted full-screen frame')
  metrics({ screenX: 500, screenY: 260 }); await sleep(80)
  const moved = read(200, 100)
  expect(moved, 708, 448, 'paused frame did not follow window movement')
  check(moved[0] > initial[0] + 20, 'moving the window kept a centered crop')

  // 用真实指针的屏幕/页面坐标语义校准页面原点（不同宿主的标题栏高度不同）。
  r.onPointerMove({ isTrusted: true, screenX: 614, screenY: 412, clientX: 100, clientY: 50 })
  await sleep(50)
  expect(read(200, 100), 714, 462, 'browser chrome offset was not calibrated')

  // 网页 125% 缩放：CSS 480×320 对应逻辑屏幕 600×400，不能改变壁纸桌面比例。
  metrics({ innerWidth: 480, innerHeight: 320, devicePixelRatio: 1.25 })
  r.el.style.width = '480px'; r.el.style.height = '320px'; window.dispatchEvent(new Event('resize')); await sleep(60)
  check(r.el.width === 600 && r.el.height === 400, 'device pixel ratio not applied')
  expect(read(200, 100), 708, 448, 'page zoom changed desktop crop scale')

  metrics({ screenX: -100, screenY: -100, innerWidth: 600, innerHeight: 400, devicePixelRatio: 1 })
  r.el.style.width = '600px'; r.el.style.height = '400px'; window.dispatchEvent(new Event('resize')); await sleep(60)
  check(read(20, 5)[3] === 0, 'off-screen region stretched an edge / retained old pixels')
  expect(read(200, 100), 114, 102, 'partial clipping shifted the visible source')

  metrics({ screenX: 0, screenY: 0, outerWidth: 1920, outerHeight: 1080, innerWidth: 1920, innerHeight: 1080 })
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: document.documentElement })
  r.el.style.width = '1920px'; r.el.style.height = '1080px'; window.dispatchEvent(new Event('resize')); await sleep(60)
  expect(read(960, 540), 960, 540, 'fullscreen shifted or zoomed the desktop')
  r.applyVisuals(8, 1.02); await sleep(60)
  check(r.el.style.transform === 'none' && r.el.style.left === '-24px', 'blur enlarged desktop content')
  // canvas 留边左上角 -24px；可见页面中心对应 canvas 中心+24。
  expect(read(300 + 24, 200 + 24), 300, 200, 'blur padding moved the desktop crop')

  await fetch('/clear'); await sleep(60)
  check(r.captureScreen === null && r.el.style.transform.startsWith('scale('), 'legacy renderer did not retain cover fallback')
  await fetch('/restore'); await sleep(60)
  r.start('Monitor1', 1); await ready()
  check(r.captureScreen.width === 1920, 'reconnecting client lost cached geometry')
  const oldEl = r.el; r.stop(); await sleep(50)
  check(r.rafId === 0 && !oldEl.isConnected, 'stop left polling or a background canvas alive')
  return { initial, moved, checks: 10 }
}

async function browserNativeTests() {
  const { SceneCanvas } = await import('/canvas.mjs')
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const check = (ok, message) => { if (!ok) throw new Error(message) }
  const metrics = values => { for (const [key, value] of Object.entries(values)) Object.defineProperty(window, key, { configurable: true, value }) }
  metrics({ screenX: 100, screenY: 130, outerWidth: 616, outerHeight: 496, innerWidth: 600, innerHeight: 400, devicePixelRatio: 1 })
  const r = new SceneCanvas(); r.start('Monitor1', 1)
  for (let i = 0; i < 200 && (!r.isLive || !r.captureScreen || r.needDraw); i++) await sleep(25)
  check(r.isLive && r.captureScreen, 'actual native geometry / frame did not arrive')
  // 暂停接收新帧，以同一张真实 WE 图像比较移动前后画面。
  r.ws.onmessage = null
  metrics({ devicePixelRatio: r.captureScreen.pixelRatio })
  r.scheduleDraw(); await sleep(100)
  const compare = (left, top) => {
    const ref = document.createElement('canvas'); ref.width = r.el.width; ref.height = r.el.height
    const g = ref.getContext('2d'), screen = r.captureScreen
    g.scale(screen.pixelRatio, screen.pixelRatio)
    g.drawImage(r.latest, screen.left - left, screen.top - top, screen.width, screen.height)
    const a = r.ctx.getImageData(0, 0, ref.width, ref.height).data, b = g.getImageData(0, 0, ref.width, ref.height).data
    let max = 0, sum = 0
    for (let i = 0; i < a.length; i++) { const d = Math.abs(a[i] - b[i]); max = Math.max(max, d); sum += d }
    check(max <= 2 && sum / a.length < 0.05, 'actual desktop crop mismatch: ' + max + '/' + sum / a.length)
    return { max, mean: sum / a.length }
  }
  const initial = compare(108, 218), initialPixel = Array.from(r.ctx.getImageData(200, 100, 1, 1).data)
  metrics({ screenX: 350, screenY: 200 }); await sleep(100)
  const moved = compare(358, 288), movedPixel = Array.from(r.ctx.getImageData(200, 100, 1, 1).data)
  const geometry = r.captureScreen, frame = [r.latest.width, r.latest.height]
  r.stop()
  return { geometry, frame, initial, moved, initialPixel, movedPixel, checks: 3 }
}

let server, chrome, ws
try {
  const build = await rolldown({ input: join(root, 'src/client/SceneCanvas.ts'), platform: 'browser' })
  await build.write({ file: join(work, 'canvas.mjs'), format: 'esm' }); await build.close()
  server = createServer((req, res) => {
    if (req.url === '/canvas.mjs') {
      res.setHeader('Content-Type', 'text/javascript'); res.end(readFileSync(join(work, 'canvas.mjs'))); return
    }
    if (req.url === '/clear' || req.url === '/restore') {
      hub.setCaptureScreen('Monitor1', req.url === '/clear' ? null : screen); res.end('ok'); return
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.end(`<style>html,body{margin:0}</style><script type="module">window.result = (${(native ? browserNativeTests : browserTests).toString()})().then(value => ({value}), error => ({error: error.stack}))</script>`)
  })
  server.on('upgrade', (req, socket, head) => {
    hub.handleUpgrade(req, socket, head)
    if (!native) setTimeout(() => hub.broadcast('Monitor1', { format: 'rgba', width: 480, height: 270, data: pixels, ts: Date.now() }), 10)
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  chrome = spawn(process.argv.slice(2).find(arg => arg !== '--native') ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    ['--headless=new', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0',
      '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
      '--window-size=600,400', '--user-data-dir=' + join(work, 'profile'), 'about:blank'], { stdio: 'ignore', windowsHide: true })
  let launchError; chrome.once('error', e => { launchError = e })
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  let port
  for (let i = 0; i < 100; i++) {
    if (launchError) throw launchError
    try { port = Number(readFileSync(join(work, 'profile/DevToolsActivePort'), 'utf8').split('\n')[0]); break } catch {}
    await sleep(100)
  }
  assert.ok(port, 'Chrome debugger did not start')
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl)
  const pending = new Map(); let id = 0
  const send = (method, params = {}) => new Promise((resolveCall, rejectCall) => {
    const key = ++id; pending.set(key, { resolveCall, rejectCall }); ws.send(JSON.stringify({ id: key, method, params }))
  })
  ws.addEventListener('message', ({ data }) => {
    const msg = JSON.parse(data), p = pending.get(msg.id)
    if (p) { pending.delete(msg.id); msg.error ? p.rejectCall(new Error(JSON.stringify(msg.error))) : p.resolveCall(msg.result) }
  })
  await new Promise(r => ws.addEventListener('open', r, { once: true }))
  await send('Emulation.setDeviceMetricsOverride', { width: 600, height: 400, deviceScaleFactor: 1, mobile: false })
  await send('Page.navigate', { url: 'http://127.0.0.1:' + server.address().port })
  await send('Page.bringToFront')
  let result
  for (let i = 0; i < 100; i++) {
    await sleep(100)
    result = (await send('Runtime.evaluate', { expression: 'window.result', awaitPromise: true, returnByValue: true })).result?.value
    if (result) break
  }
  assert.ok(result, 'browser tests did not finish'); assert.ok(!result.error, result.error)
  console.log('PASS capture viewport ' + (native ? 'native ' : '') + 'browser regression: ' + JSON.stringify(result.value))
} finally {
  ws?.close(); hub.closeAll(); adapter?.dispose(); chrome?.kill(); server?.close()
  assert.ok(resolve(work).startsWith(tempRoot + sep) && dirname(resolve(work)) === tempRoot)
  try { rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) } catch {}
}
