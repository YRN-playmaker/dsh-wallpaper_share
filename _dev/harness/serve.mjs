// 端到端渲染验证服务器：复刻插件 node 半的 4 个接口，让浏览器渲染器能独立跑起来。
// 用法：node _dev/harness/serve.mjs <workshopId> <port> [repoRoot] [weDir]
import { createServer } from 'node:http'
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { parseScenePkg } from '../../src/scene/ScenePkg.ts'
import { buildSceneModel } from '../../src/scene/SceneModel.ts'
import { decodeTex, texMipToPng, texMimeOf } from '../../src/scene/SceneTex.ts'
import { SHAKETEST_PAGE } from './shaketest-page.mjs'
import { isSafeAssetTextureName } from '../../src/scene/asset-texture-name.ts'

const workshopId = process.argv[2] ?? '3766677415'
const port = Number(process.argv[3] ?? 8791)
const repoRoot = resolve(process.argv[4] ?? '.')
const weDir = process.argv[5] ?? 'D:/SteamLibrary/steamapps/common/wallpaper_engine'
const sceneFile = `D:/SteamLibrary/steamapps/workshop/content/431960/${workshopId}/scene.pkg`
const previewFile = `D:/SteamLibrary/steamapps/workshop/content/431960/${workshopId}/preview.jpg`

const pkgBuf = new Uint8Array(readFileSync(sceneFile))
const model = buildSceneModel(pkgBuf, {
  particleRateScale: 1,
  particleSizeScale: 1,
  effectStrengthScale: 0.6,
  puppetMeshRender: true,
})
if (model === null) throw new Error('buildSceneModel failed')
console.log(`model: ${model.layers.length} layers, ${model.width}x${model.height}, clearColor=${JSON.stringify(model.clearColor)}`)

const page = `<!doctype html>
<html><head><meta charset="utf-8"><title>harness</title>
<style>html,body{margin:0;padding:0;background:transparent}canvas{z-index:-2}</style></head>
<body>
<script>
// 页面级错误上报（模块导入失败 / 渲染器异常都能被服务器看到）
window.addEventListener('error', function (e) {
  try { navigator.sendBeacon('/__log?tag=harness', 'ERROR ' + (e.message || (e.error && e.error.message) || (e.target && e.target.src) || 'unknown')) } catch (err) {}
})
window.addEventListener('unhandledrejection', function (e) {
  try { navigator.sendBeacon('/__log?tag=harness', 'REJECT ' + ((e.reason && e.reason.message) || e.reason)) } catch (err) {}
})
</script>
<script type="module">
import { SceneModelRenderer } from './renderer.mjs'
const params = new URLSearchParams(location.search)
if (params.get('freeze') === '1') {
  // 冻结时钟：animTime 恒为 0（逐帧对比时排除动画相位差异）
  const t0 = 1000
  performance.now = () => t0
}
const r = new SceneModelRenderer()
window.__r = r
r.start('harness', 1)
setTimeout(() => { document.title = 'READY ' + (r.isLive ? 'live' : 'not-live') }, 3000)
// 自截图：延时后把主画布 PNG POST 回 harness 服务器（避免依赖 chrome --screenshot）
const delay = Number(params.get('shot') ?? '0')
if (delay > 0) {
  setTimeout(async () => {
    const canvases = Array.from(document.querySelectorAll('canvas'))
    const canvas = canvases.sort((a, b) => b.width * b.height - a.width * a.height)[0]
    if (!canvas) { document.title = 'NO_CANVAS'; return }
    try {
      const dataUrl = canvas.toDataURL('image/png')
      const res = await fetch('/__shot?tag=' + encodeURIComponent(params.get('tag') ?? 'shot'), { method: 'POST', body: dataUrl })
      document.title = 'SHOT ' + res.status + ' ' + canvas.width + 'x' + canvas.height
    } catch (e) { document.title = 'SHOT_ERR ' + e.message }
  }, delay)
}
</script></body></html>`

const mimeOf = (name) => (/\.png$/i.test(name) ? 'image/png' : /\.jpe?g$/i.test(name) ? 'image/jpeg' : 'application/octet-stream')
let stripEffects = false

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  const name = url.searchParams.get('name')
  const send = (code, body, headers = {}) => {
    if (url.pathname !== '/__shot' && url.pathname !== '/__log') {
      console.log('  ' + code + ' ' + url.pathname + (name !== null ? ' name=' + name : ''))
    }
    res.statusCode = code
    for (const [k, v] of Object.entries(headers)) res.setHeader(k, v)
    res.end(body)
  }
  try {
    if (req.method === 'POST' && url.pathname === '/__log') {
      const chunks = []
      req.on('data', (c) => chunks.push(c))
      req.on('end', () => {
        const tag = url.searchParams.get('tag') ?? 'log'
        mkdirSync(join(repoRoot, '_dev/harness/out'), { recursive: true })
        const out = join(repoRoot, '_dev/harness/out', tag + '.log')
        writeFileSync(out, Buffer.concat(chunks).toString('utf8'))
        console.log('PAGE LOG ' + out + ': ' + Buffer.concat(chunks).toString('utf8').slice(0, 300))
        send(200, 'ok')
      })
      return
    }
    if (req.method === 'POST' && url.pathname === '/__shot') {
      const chunks = []
      req.on('data', (c) => chunks.push(c))
      req.on('end', () => {
        try {
          const body = Buffer.concat(chunks).toString('utf8')
          const b64 = body.replace(/^data:image\/png;base64,/, '')
          const tag = url.searchParams.get('tag') ?? 'shot'
          mkdirSync(join(repoRoot, '_dev/harness/out'), { recursive: true })
          const out = join(repoRoot, '_dev/harness/out', tag + '.png')
          const bytes = Buffer.from(b64, 'base64')
          writeFileSync(out, bytes)
          console.log('SHOT saved ' + out + ' (' + bytes.length + ' bytes)')
          send(200, 'ok')
        } catch (e) {
          console.error('shot failed: ' + e.message)
          send(500, 'shot failed')
        }
      })
      return
    }
    if (url.pathname === '/') return send(200, page, { 'Content-Type': 'text/html; charset=utf-8' })
    if (url.pathname === '/shaketest.mjs' || url.pathname === '/waterwaves.mjs' || url.pathname === '/nitro.mjs') {
      const map = { '/shaketest.mjs': 'ShakeGL.mjs', '/waterwaves.mjs': 'WaterwavesGL.mjs', '/nitro.mjs': 'NitroGL.mjs' }
      const f = join(repoRoot, '_dev/harness/dist', map[url.pathname])
      if (!existsSync(f)) return send(404, 'build it first: ' + map[url.pathname])
      return send(200, readFileSync(f), { 'Content-Type': 'text/javascript' })
    }
    if (url.pathname === '/shaketest') {
      return send(200, SHAKETEST_PAGE, { 'Content-Type': 'text/html; charset=utf-8' })
    }
    if (url.pathname === '/renderer.mjs') {
      const f = join(repoRoot, '_dev/harness/dist', process.env.HARNESS_BUNDLE ?? 'SceneModelRenderer.mjs')
      return send(200, readFileSync(f), { 'Content-Type': 'text/javascript' })
    }
    if (url.pathname.startsWith('/out/')) {
      const f = join(repoRoot, '_dev/harness/out', url.pathname.slice('/out/'.length))
      if (!existsSync(f)) return send(404, 'no such out file')
      return send(200, readFileSync(f), { 'Content-Type': 'image/png' })
    }
    if (url.pathname === '/compare') {
      const page = `<!doctype html><html><head><meta charset="utf-8"><title>compare</title></head><body>
<script>
const q = new URLSearchParams(location.search)
function load(src) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('load ' + src)); i.src = src }) }
function px(img, w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0); return g.getImageData(0, 0, w, h).data }
;(async () => {
  const [a, b] = await Promise.all([load('/out/' + q.get('a')), load('/out/' + q.get('b'))])
  const W = Math.min(a.naturalWidth, b.naturalWidth), H = Math.min(a.naturalHeight, b.naturalHeight)
  const A = px(a, W, H), B = px(b, W, H)
  const BS = 64, blocks = []
  for (let by = 0; by < Math.ceil(H / BS); by++) for (let bx = 0; bx < Math.ceil(W / BS); bx++) {
    let d = 0, n = 0
    for (let y = by * BS; y < Math.min(H, (by + 1) * BS); y++) for (let x = bx * BS; x < Math.min(W, (bx + 1) * BS); x++) {
      const o = (y * W + x) * 4
      d += Math.abs(A[o] - B[o]) + Math.abs(A[o + 1] - B[o + 1]) + Math.abs(A[o + 2] - B[o + 2]); n++
    }
    blocks.push({ bx: bx * BS, by: by * BS, d: d / (n * 3) })
  }
  blocks.sort((p, q2) => q2.d - p.d)
  const diff = new Uint8ClampedArray(W * H * 4)
  let total = 0
  for (let i = 0; i < W * H * 4; i += 4) {
    const v = Math.min(255, (Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2])) * 2)
    total += v
    diff[i] = v; diff[i + 1] = v; diff[i + 2] = v; diff[i + 3] = 255
  }
  const c = document.createElement('canvas'); c.width = W; c.height = H
  c.getContext('2d').putImageData(new ImageData(diff, W, H), 0, 0)
  const w = Math.ceil(Math.sqrt(W * H))
  
  await fetch('/__shot?tag=' + encodeURIComponent(q.get('tag') || 'diff'), { method: 'POST', body: c.toDataURL('image/png') })
  document.title = 'CMP meanDiff=' + (total / (W * H * 4) / 2).toFixed(3) + ' top=' + blocks.slice(0, 6).map(b => '(' + b.bx + ',' + b.by + '):' + b.d.toFixed(1)).join(' ')
  await fetch('/__log?tag=compare', { method: 'POST', body: document.title })
})().catch(e => { document.title = 'CMP_ERR ' + e.message })
</script></body></html>`
      return send(200, page, { 'Content-Type': 'text/html; charset=utf-8' })
    }
    if (url.pathname === '/wavetest') {
      const p = `<!doctype html><html><head><meta charset="utf-8"><title>wavetest</title></head><body>
<script type="module">
import { WaterwavesGL } from './waterwaves.mjs'
function marker() { const c = document.createElement('canvas'); c.width = 8; c.height = 8; const g = c.getContext('2d')
  g.fillStyle = 'rgb(255,0,0)'; g.fillRect(0,0,4,4); g.fillStyle = 'rgb(0,255,0)'; g.fillRect(4,0,4,4)
  g.fillStyle = 'rgb(0,0,255)'; g.fillRect(0,4,4,4); g.fillStyle = 'rgb(255,255,0)'; g.fillRect(4,4,4,4); return c }
function read(canvas) { const c2 = document.createElement('canvas'); c2.width = canvas.width; c2.height = canvas.height
  const g = c2.getContext('2d', { willReadFrequently: true }); g.drawImage(canvas, 0, 0)
  const px = g.getImageData(0,0,c2.width,c2.height).data
  const at = (x,y) => { const o = (y*c2.width+x)*4; return px[o]+','+px[o+1]+','+px[o+2] }
  return 'TL('+at(1,1)+') TR('+at(6,1)+') BL('+at(1,6)+') BR('+at(6,6)+')' }
try {
  const src = marker()
  const bmp = await createImageBitmap(src)
  const ww = new WaterwavesGL()
  const wave = [{ direction: 0, speed: 0, scale: 0, strength: 0, exponent: 1 }]
  const a = ww.render(src, 8, 8, null, false, wave, 0, 'a')
  const b = ww.render(bmp, 8, 8, null, false, wave, 0, 'b')
  const msg = 'REF ' + read(src) + ' | WATER(canvas) ' + (a === null ? 'null' : read(a)) + ' | WATER(bitmap) ' + (b === null ? 'null' : read(b))
  document.title = msg
  await fetch('/__log?tag=wavetest', { method: 'POST', body: msg })
} catch (e) { document.title = 'WT_ERR ' + e.message; await fetch('/__log?tag=wavetest', { method: 'POST', body: 'WT_ERR ' + e.message }) }
</script></body></html>`
      return send(200, p, { 'Content-Type': 'text/html; charset=utf-8' })
    }
    if (url.pathname === '/config') {
      stripEffects = url.searchParams.get('strip') ?? ''
      console.log('stripEffects=' + JSON.stringify(stripEffects))
      return send(200, 'ok stripEffects=' + stripEffects)
    }
    if (url.pathname === '/we-sync/scene/model') {
      // /config?strip=effects|shake|waterwaves|shakefirst：按类型清空/裁剪图层效果（二分定位差异来源）
      if (stripEffects !== '') {
        const drop = (e) => (stripEffects === 'effects' ? true : stripEffects === 'shake' ? e.type === 'shake' : e.type === 'waterwaves')
        const layers = model.layers.map((l) => {
          if (stripEffects === 'shakefirst') {
            // 只保留第一个 shake（复现"每个图层只应用一次 shake"的旧行为）
            let seen = false
            return { ...l, effects: l.effects.filter((e) => { if (e.type !== 'shake') return true; if (seen) return false; seen = true; return true }) }
          }
          return { ...l, effects: l.effects.filter((e) => !drop(e)) }
        })
        return send(200, JSON.stringify({ ...model, layers }), { 'Content-Type': 'application/json' })
      }
      return send(200, JSON.stringify(model), { 'Content-Type': 'application/json' })
    }
    if (url.pathname === '/we-sync/preview') {
      if (!existsSync(previewFile)) return send(404, 'no preview')
      return send(200, readFileSync(previewFile), { 'Content-Type': 'image/jpeg' })
    }
    if (url.pathname === '/we-sync/scene/texture' || url.pathname === '/we-sync/asset/texture') {
      const name = url.searchParams.get('name') ?? ''
      const pkg = parseScenePkg(pkgBuf)
      const headers = { 'Cache-Control': 'no-store' }
      if (url.pathname === '/we-sync/asset/texture') {
        if (!isSafeAssetTextureName(name)) return send(403, 'forbidden')
        const f = join(weDir, 'assets/materials', name + '.tex')
        const bytes = pkg.read('materials/' + name + '.tex') ?? (existsSync(f) ? new Uint8Array(readFileSync(f)) : null)
        if (bytes === null) return send(404, 'no asset texture')
        const tex = decodeTex(bytes)
        if (tex === null || tex.mip0 === null) return send(415, 'asset tex decode failed')
        if (tex.imageWidth > 0) headers['X-WE-Image-W'] = String(tex.imageWidth)
        if (tex.imageHeight > 0) headers['X-WE-Image-H'] = String(tex.imageHeight)
        const mf = f + '-json'
        const meta = pkg.read('materials/' + name + '.tex-json') ?? (existsSync(mf) ? new Uint8Array(readFileSync(mf)) : null)
        let info = null
        if (meta !== null) {
          try { info = JSON.parse(new TextDecoder().decode(meta)).spritesheetsequences?.[0] } catch {}
        }
        if (!info || !(info.frames > 1 && info.width > 0 && info.height > 0)) {
          const match = /(\d{2,4})x(\d{2,4})/.exec(name)
          if (match) {
            const small = Math.min(Number(match[1]), Number(match[2]))
            const large = Math.max(Number(match[1]), Number(match[2]))
            const count = large / small
            if (Number.isInteger(count) && count >= 2 && count <= 64 && small >= 32) {
              info = { frames: count, width: small, height: small }
            }
          }
        }
        if (info?.frames > 1 && info.width > 0 && info.height > 0) {
          headers['X-Sprite-Frames'] = String(info.frames)
          headers['X-Sprite-Width'] = String(info.width)
          headers['X-Sprite-Height'] = String(info.height)
        }
        return send(200, Buffer.from(texMipToPng(tex)), { ...headers, 'Content-Type': 'image/png' })
      }
      const entry = pkg.entries.find((e) => e.name === name)
      if (entry === undefined) return send(404, 'no such texture entry')
      if (/\.(png|jpe?g)$/i.test(name)) {
        const data = pkgBuf.subarray(pkg.dataStart + entry.offset, pkg.dataStart + entry.offset + entry.size)
        return send(200, Buffer.from(data), { 'Content-Type': mimeOf(name) })
      }
      const data = pkgBuf.subarray(pkg.dataStart + entry.offset, pkg.dataStart + entry.offset + entry.size)
      const tex = decodeTex(data)
      if (tex === null || tex.mip0 === null) return send(415, 'tex decode failed: ' + name)
      if (tex.imageWidth > 0) headers['X-WE-Image-W'] = String(tex.imageWidth)
      if (tex.imageHeight > 0) headers['X-WE-Image-H'] = String(tex.imageHeight)
      const png = texMipToPng(tex)
      if (png === null) return send(500, 'png encode failed')
      return send(200, Buffer.from(png), { ...headers, 'Content-Type': texMimeOf(tex) ?? 'image/png' })
    }
    return send(404, 'not found: ' + url.pathname)
  } catch (e) {
    console.error('route error ' + url.pathname + ': ' + e.message)
    return send(500, 'error: ' + e.message)
  }
})
server.listen(port, '127.0.0.1', () => console.log('harness on http://127.0.0.1:' + port + '/?freeze=1 (id=' + workshopId + ')'))
