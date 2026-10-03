// Chrome 像素回归：雨滴旋转折射、独立法线图集、alpha 与 .tex 内容裁剪。
// 用法：node tools/test-particle-browser.mjs [Chrome 可执行文件路径]
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const requireBuild = createRequire(import.meta.resolve('tsdown'))
const { rolldown } = await import(pathToFileURL(requireBuild.resolve('rolldown')).href)
const tempRoot = resolve(tmpdir()), work = mkdtempSync(join(tempRoot, 'we-rain-'))

async function browserTests() {
  const { ParticleGL } = await import('/gl.mjs')
  const { decodeParticleBitmap } = await import('/texture.mjs')
  const check = (ok, message) => { if (!ok) throw new Error(message) }
  const canvas = (w, h, color) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h
    if (color) { const g = c.getContext('2d'); g.fillStyle = color; g.fillRect(0, 0, w, h) }
    return c
  }
  const read = (c, x = 64, y = 64) => {
    const copy = canvas(c.width, c.height), g = copy.getContext('2d', { willReadFrequently: true })
    g.drawImage(c, 0, 0); return Array.from(g.getImageData(x, y, 1, 1).data)
  }
  const blob = c => new Promise(r => c.toBlob(r))
  const bitmap = async (c, normal = false, headers = {}) => decodeParticleBitmap(new Response(await blob(c), { headers }), normal)
  const bg = canvas(128, 128), bgc = bg.getContext('2d')
  const data = bgc.createImageData(128, 128)
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    const i = (y * 128 + x) * 4; data.data.set([x * 2, y * 2, 50, 255], i)
  }
  bgc.putImageData(data, 0, 0)
  const target = canvas(128, 128), gl = new ParticleGL(target)
  check(gl.available, 'WebGL2 unavailable')
  const white = await bitmap(canvas(8, 8, 'white'))
  // x=+1 在 A，y≈0 在 G，R=1 遮罩。上/下颜色编码可辨背景采样方向。
  const nx = await bitmap(canvas(8, 8, 'rgba(255,128,128,1)'), true)
  const particle = { x: 64, y: 64, size: 48, aspect: 1, rot: 0, r: 255, g: 255, b: 255, a: 1, frame: 0 }
  const opts = { viewW: 128, viewH: 128, additive: false, refract: true, frames: 0, fw: 0, fh: 0, refractAmount: 0.1, trail: false }
  const draw = (normal, params = {}, p = {}, tex = white) => {
    gl.clear(); gl.uploadBackground(bg)
    gl.render([{ ...particle, ...p }], { ...opts, ...params }, tex, normal, 128, 128)
    check(gl.gl.getError() === 0, 'WebGL draw error')
    return read(target)
  }
  const first = draw(nx), repeat = draw(nx)
  check(first.every((v, i) => v === repeat[i]), 'first normal upload replaced background binding')
  check(first[0] > 145 && Math.abs(first[1] - 128) <= 2, 'horizontal normal did not sample expected background')
  const rotated = draw(nx, {}, { rot: Math.PI / 2 })
  check(rotated[1] > 145 && Math.abs(rotated[0] - 128) <= 2, 'refraction did not rotate with particle')
  const zero = draw(nx, { refractAmount: 0 })
  check(Math.abs(zero[0] - 128) <= 1 && Math.abs(zero[1] - 128) <= 1, 'explicit zero refraction changed background')
  const negative = draw(nx, { refractAmount: -0.1 })
  check(negative[0] < 110, 'negative refraction amount lost its sign')

  // 主纹理是二帧横排，但法线是单帧；不能用主图集 UV 去取法线的一半。
  const normals = canvas(8, 8), nc = normals.getContext('2d')
  nc.fillStyle = 'rgba(255,128,128,1)'; nc.fillRect(0, 0, 4, 8)
  // 右半边的 A=128 表示中性法线 x，不能预乘进 RGB。
  nc.fillStyle = 'rgba(255,128,128,0.5019607843137255)'; nc.fillRect(4, 0, 4, 8)
  const singleNormal = await bitmap(normals, true)
  const atlas = await bitmap(canvas(16, 8, 'white'))
  const independent = draw(singleNormal, { frames: 2, fw: 8, fh: 8 }, { frame: 1 }, atlas)
  const standalone = draw(singleNormal)
  check(independent.every((v, i) => Math.abs(v - standalone[i]) <= 1), 'single normal map followed color atlas frame')

  // .tex 内容仅占画布左侧：裁剪后宽高和帧位置必须正确。
  const padded = canvas(16, 8, 'red'), pc = padded.getContext('2d')
  pc.fillStyle = 'blue'; pc.fillRect(8, 0, 8, 8)
  const cropped = await bitmap(padded, false, { 'X-WE-Image-W': '8', 'X-WE-Image-H': '8' })
  check(cropped.width === 8 && cropped.height === 8, 'unused texture padding remains')
  check(read(drawCanvas(cropped), 4, 4)[0] === 255, 'crop changed content')
  function drawCanvas(b) { const c = canvas(b.width, b.height); c.getContext('2d').drawImage(b, 0, 0); return c }
  const invalid = await bitmap(padded, false, { 'X-WE-Image-W': '9999', 'X-WE-Image-H': '-1' })
  check(invalid.width === 16 && invalid.height === 8, 'invalid content metadata changed bitmap size')

  const faded = await bitmap(canvas(8, 8, 'rgba(200,100,50,0.5019607843137255)'))
  const alpha = draw(nx, { refract: false }, {}, faded)
  check(Math.abs(alpha[0] - 200) <= 2 && Math.abs(alpha[3] - 128) <= 1, 'particle texture was premultiplied twice')
  const changed = canvas(128, 128, 'rgb(0,255,0)')
  gl.clear(); gl.uploadBackground(changed); gl.render([particle], opts, white, nx, 128, 128)
  check(read(target)[1] === 255 && read(target)[0] === 0, 'reused background texture did not refresh')
  for (const b of [white, nx, singleNormal, atlas, cropped, invalid, faded]) b.close()
  gl.dispose()
  return { first, rotated, zero, negative, independent, alpha, checks: 10 }
}

let server, chrome, ws
try {
  for (const [name, src] of [['gl', 'ParticleGL'], ['texture', 'particle-texture']]) {
    const build = await rolldown({ input: join(root, 'src/client', src + '.ts'), platform: 'browser' })
    await build.write({ file: join(work, name + '.mjs'), format: 'esm' }); await build.close()
  }
  server = createServer((req, res) => {
    if (req.url === '/gl.mjs' || req.url === '/texture.mjs') {
      res.setHeader('Content-Type', 'text/javascript'); res.end(readFileSync(join(work, req.url.slice(1)))); return
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.end(`<script type="module">window.result = (${browserTests.toString()})().then(value => ({value}), error => ({error: error.stack}))</script>`)
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  chrome = spawn(process.argv[2] ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    ['--headless=new', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-first-run', '--no-default-browser-check',
      '--remote-debugging-port=0', '--user-data-dir=' + join(work, 'profile'), 'about:blank'], { stdio: 'ignore', windowsHide: true })
  let launchError
  chrome.once('error', e => { launchError = e })
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  let port
  for (let i = 0; i < 100; i++) {
    if (launchError) throw launchError
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
    result = (await send('Runtime.evaluate', { expression: 'window.result', awaitPromise: true, returnByValue: true })).result?.value
    if (result) break
  }
  assert.ok(result, 'browser tests did not finish'); assert.ok(!result.error, result.error)
  console.log('PASS rain browser pixel regression: ' + JSON.stringify(result.value))
} finally {
  ws?.close(); chrome?.kill(); server?.close()
  assert.ok(resolve(work).startsWith(tempRoot + sep) && dirname(resolve(work)) === tempRoot)
  try { rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) } catch {}
}
