// Chrome 像素回归：串联 pass、4K Canvas2D 回退、mask 与内容裁剪。
// 用法：node tools/test-shake-browser.mjs [Chrome 可执行文件路径]
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const tempRoot = resolve(tmpdir())
const requireBuild = createRequire(import.meta.resolve('tsdown'))
const { rolldown } = await import(pathToFileURL(requireBuild.resolve('rolldown')).href)
const work = mkdtempSync(join(tempRoot, 'we-shake-'))
const chromePath = process.argv[2] ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'

async function browserTests() {
  const { ShakeGL } = await import('/gl.mjs')
  const { applyShake2D, SHAKE_2D_PIXEL_BUDGET } = await import('/cpu.mjs')
  const check = (ok, message) => { if (!ok) throw new Error(message) }
  const canvas = (w, h) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h; return c
  }
  const pixel = (c, x, y) => {
    const copy = canvas(c.width, c.height)
    const g = copy.getContext('2d', { willReadFrequently: true })
    g.drawImage(c, 0, 0)
    return Array.from(g.getImageData(x, y, 1, 1).data)
  }
  const source = canvas(128, 64)
  const g = source.getContext('2d')
  for (let x = 0; x < 128; x++) {
    g.fillStyle = `rgb(${x * 2},${x},0)`; g.fillRect(x, 0, 1, 64)
  }
  const flow = canvas(128, 64)
  const fg = flow.getContext('2d')
  fg.fillStyle = 'rgb(255,127,0)'; fg.fillRect(0, 0, 128, 32)
  fg.fillStyle = 'rgb(0,127,0)'; fg.fillRect(0, 32, 128, 32)
  const a = new ShakeGL(), b = new ShakeGL()
  const params = { offset: 1, strength: 0.3 }
  const run = (offset) => {
    const first = a.render(source, 128, 64, flow, false, null, false, { ...params, offset }, 'first')
    check(first !== null, 'WebGL unavailable')
    const last = b.render(first, 128, 64, flow, false, null, false, { offset: 0, strength: 0 }, 'last')
    check(last !== null, 'second pass unavailable')
    return [pixel(last, 64, 16)[0], pixel(last, 64, 48)[0]]
  }
  const positive = run(1), negative = run(-1)
  check(positive[0] > 140 && positive[1] < 115, 'GL must deform upper/lower regions in opposite directions')
  check(negative[0] < 115 && negative[1] > 140, 'chained canvas must update between frames')
  a.reset(); b.reset()
  const fresh = run(-1)
  check(fresh.every((v, i) => Math.abs(v - negative[i]) <= 1), 'cached chain differs from fresh render')
  const marker = canvas(128, 64), mg = marker.getContext('2d')
  mg.fillStyle = 'red'; mg.fillRect(0, 0, 128, 32)
  mg.fillStyle = 'blue'; mg.fillRect(0, 32, 128, 32)
  const bitmap = await createImageBitmap(marker)
  const straight = a.render(bitmap, 128, 64, flow, false, null, false, { offset: 0, strength: 0 }, 'bitmap')
  check(pixel(straight, 64, 16)[0] === 255 && pixel(straight, 64, 48)[2] === 255, 'ImageBitmap orientation changed')
  bitmap.close(); a.dispose(); b.dispose()

  // RG88 的 alpha 保存方向 y，不能预乘进方向 x；中性场应几乎直通。
  const rg = canvas(128, 64), rgc = rg.getContext('2d')
  rgc.fillStyle = 'rgba(128,128,128,0.5019607843137255)'; rgc.fillRect(0, 0, 128, 64)
  const rgBlob = await new Promise(r => rg.toBlob(r))
  const rgBitmap = await createImageBitmap(rgBlob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' })
  const rgGL = new ShakeGL()
  const neutral = rgGL.render(source, 128, 64, rgBitmap, true, null, false, params, 'rg88')
  check(Math.abs(pixel(neutral, 64, 16)[0] - 128) <= 1, 'neutral RG88 ImageBitmap caused whole-image displacement')
  rgBitmap.close(); rgGL.dispose()

  // 高于预算的 4K 图层：同一 x 位置的上下区域必须向相反方向采样。
  const large = canvas(3840, 2160)
  check(large.width * large.height > SHAKE_2D_PIXEL_BUDGET, 'test must exceed CPU budget')
  large.getContext('2d').drawImage(source, 0, 0, large.width, large.height)
  const cpu = applyShake2D({ src: large, sw: large.width, sh: large.height,
    flow, flowYFromAlpha: false, mask: null, maskFromAlpha: false, ...params })
  check(cpu !== null && cpu.width === 3840 && cpu.height === 2160, 'CPU output size changed')
  const cpuRegions = [pixel(cpu, 1920, 540)[0], pixel(cpu, 1920, 1620)[0]]
  check(cpuRegions[0] > 140 && cpuRegions[1] < 115, '4K fallback translated whole layer instead of local deformation')

  const zeroMask = canvas(128, 64)
  const zg = zeroMask.getContext('2d'); zg.fillStyle = 'white'; zg.fillRect(0, 0, 128, 32)
  const masked = applyShake2D({ src: source, sw: 128, sh: 64,
    flow, flowYFromAlpha: false, mask: zeroMask, maskFromAlpha: true, ...params })
  check(pixel(masked, 64, 16)[0] > 140 && pixel(masked, 64, 48)[0] === 128, 'alpha mask must preserve excluded regions')

  // 中性方向场的内容区，右侧未用边距填强位移值：不能误采样边距。
  const padded = canvas(256, 64), pg = padded.getContext('2d')
  pg.fillStyle = 'rgb(127,127,127)'; pg.fillRect(0, 0, 128, 64)
  pg.fillStyle = 'rgb(255,255,255)'; pg.fillRect(128, 0, 128, 64)
  const cropped = applyShake2D({ src: source, sw: 128, sh: 64,
    flow: padded, flowYFromAlpha: false, mask: null, maskFromAlpha: false,
    rects: { flow: { w: 128, h: 64 } }, ...params })
  check(Math.abs(pixel(cropped, 96, 32)[0] - 192) <= 1, 'CPU sampled unused texture padding')
  const single = canvas(1, 1); single.getContext('2d').fillStyle = 'red'; single.getContext('2d').fillRect(0, 0, 1, 1)
  const tiny = applyShake2D({ src: single, sw: 1, sh: 1, flow,
    flowYFromAlpha: false, mask: null, maskFromAlpha: false, ...params })
  check(pixel(tiny, 0, 0).join(',') === '255,0,0,255', '1px clamped sample became invalid')
  return { positive, negative, fresh, cpuRegions, checks: 9 }
}

let server, chrome, ws
try {
  for (const [name, src] of [['gl', 'ShakeGL'], ['cpu', 'Shake2D']]) {
    const build = await rolldown({ input: join(root, 'src/client', src + '.ts'), platform: 'browser' })
    await build.write({ file: join(work, name + '.mjs'), format: 'esm' }); await build.close()
  }
  server = createServer((req, res) => {
    if (req.url === '/gl.mjs' || req.url === '/cpu.mjs') {
      res.setHeader('Content-Type', 'text/javascript'); res.end(readFileSync(join(work, req.url.slice(1)))); return
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.end(`<script type="module">window.result = (${browserTests.toString()})().then(value => ({value}), error => ({error: error.stack}))</script>`)
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  chrome = spawn(chromePath, ['--headless=new', '--enable-unsafe-swiftshader', '--use-angle=swiftshader',
    '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0',
    '--user-data-dir=' + join(work, 'profile'), 'about:blank'], { stdio: 'ignore', windowsHide: true })
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  let port
  for (let i = 0; i < 100; i++) {
    try { port = Number(readFileSync(join(work, 'profile/DevToolsActivePort'), 'utf8').split('\n')[0]); break } catch {}
    await sleep(100)
  }
  assert.ok(port, 'Chrome remote debugger did not start')
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
  await send('Page.navigate', { url: 'http://127.0.0.1:' + server.address().port })
  let result
  for (let i = 0; i < 100; i++) {
    await sleep(100)
    const response = await send('Runtime.evaluate', { expression: 'window.result', awaitPromise: true, returnByValue: true })
    result = response.result?.value
    if (result) break
  }
  assert.ok(result, 'browser tests did not finish')
  assert.ok(!result.error, result.error)
  console.log('PASS shake browser pixel regression: ' + JSON.stringify(result.value))
} finally {
  ws?.close(); chrome?.kill(); server?.close()
  // Only remove the unique temporary workspace created above.
  assert.ok(resolve(work).startsWith(tempRoot + sep) && dirname(resolve(work)) === tempRoot)
  try { rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) } catch {}
}
