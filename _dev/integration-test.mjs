// 一次性集成自测：加载构建产物 lib/index.js，用假 Cordis ctx + 假 WebSocket socket
// 验证：路由注册 / state / diag / WS 握手 / renderer 子进程 → 帧 → hub → socket 广播
import { EventEmitter } from 'node:events'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = fileURLToPath(import.meta.url).replace(/\\/g, '/')
const libPath = here.slice(0, here.lastIndexOf('/_dev/')) + '/lib/index.js'
const { apply } = await import(pathToFileURL(libPath).href)

const routes = new Map()
const upgrades = new Map()
const webServer = {
  register(route) { routes.set(route.path, route.handler); return () => routes.delete(route.path) },
  registerUpgrade(route) { upgrades.set(route.path, route.handler); return () => upgrades.delete(route.path) },
}
const ctx = {
  get(name) { return name === 'webServer' ? webServer : undefined },
  effect(cb) { cb() }, // 立即执行（轮询 effect 会启动真实 setInterval，测试进程结束时自然退出）
}

console.log('>> applying plugin (node half)...')
apply(ctx)

console.log('>> routes:', [...routes.keys()].join(', '))
console.log('>> upgrades:', [...upgrades.keys()].join(', '))

function fakeRes() {
  const res = { statusCode: 0, headers: {}, body: '', ended: false, chunks: [] }
  res.setHeader = (k, v) => { res.headers[k] = v }
  res.end = (b) => {
    res.body = b ?? ''
    res.ended = true
    // 直接 end 的二进制（raw 纹理 PNG 路径）也计入 chunks
    if (b instanceof Buffer || b instanceof Uint8Array) res.chunks.push(Buffer.from(b))
  }
  // 支持流式 pipe（serveSlice 用）：把流内容累积到 chunks
  res.write = (chunk) => { res.chunks.push(Buffer.from(chunk)); return true }
  res.on = () => res
  res.once = () => res
  res.emit = () => res
  res.removeListener = () => res
  return res
}

// 1) /we-sync/diag
const dres = fakeRes()
routes.get('/we-sync/diag')({ url: '/we-sync/diag' }, dres)
const diag = JSON.parse(dres.body)
console.log('>> diag: weDir=' + diag.weDir + ' monitors=' + diag.monitors.length + ' latest=' + diag.latestMonitor)
const sceneMonitor = diag.monitors.find((m) => m.kind === 'scene')
console.log('>> scene monitor found:', sceneMonitor !== undefined ? sceneMonitor.key + ' (' + sceneMonitor.file + ')' : 'NONE')

// 2) /we-sync/state
const sres = fakeRes()
routes.get('/we-sync/state')({ url: '/we-sync/state' }, sres)
const state = JSON.parse(sres.body)
console.log('>> state: kind=' + state.kind + ' monitor=' + state.monitor + ' scene=' + JSON.stringify(state.scene ?? null))

// 2.5) /we-sync/scene/model（SceneModel 构建）
let modelOk = false
if (sceneMonitor !== undefined) {
  const mres = fakeRes()
  routes.get('/we-sync/scene/model')({ url: '/we-sync/scene/model?monitor=' + sceneMonitor.key }, mres)
  if (mres.statusCode === 200 && mres.body !== '') {
    const model = JSON.parse(mres.body)
    modelOk = Array.isArray(model.layers) && model.layerCount > 0 && typeof model.width === 'number'
    console.log('>> scene model:', JSON.stringify({ w: model.width, h: model.height, layers: model.layerCount, textures: model.textures.length, decodable: model.decodableTextureCount, firstLayer: model.layers[0] ? model.layers[0].name : null }))
  } else {
    console.log('>> scene model route: status=' + mres.statusCode)
  }
}

// 2.6) /we-sync/scene/texture：.tex 内嵌图片（Rebecca.tex 应为 PNG）+ raw tex 415
let texOk = false
if (sceneMonitor !== undefined) {
  // 先取 model 拿到第一个纹理引用
  const mres = fakeRes()
  routes.get('/we-sync/scene/model')({ url: '/we-sync/scene/model?monitor=' + sceneMonitor.key }, mres)
  const model = JSON.parse(mres.body)
  const texRef = model.layers.map((l) => l.textureRefs[0]).find((t) => t !== undefined)
  if (texRef !== undefined) {
    const tres = fakeRes()
    routes.get('/we-sync/scene/texture')({ url: '/we-sync/scene/texture?monitor=' + sceneMonitor.key + '&name=' + encodeURIComponent(texRef) }, tres)
    // 流式响应异步到达：等一小段让 createReadStream 刷完
    await new Promise((resolve) => setTimeout(resolve, 200))
    const bodyLen = tres.chunks.reduce((n, c) => n + c.length, 0)
    const mime = tres.headers['Content-Type']
    const looksImage = bodyLen > 1000 && (mime === 'image/png' || mime === 'image/jpeg')
    texOk = looksImage
    console.log('>> texture route ' + texRef + ': status=' + tres.statusCode + ' mime=' + mime + ' bytes=' + bodyLen + ' => ' + (looksImage ? 'OK' : 'FAIL'))
  } else {
    console.log('>> texture route: no textureRef in model')
  }
}

// 3) WS 握手 + 帧流（仅当存在 scene 显示器时）
if (sceneMonitor !== undefined) {
  const captured = []
  const socket = new EventEmitter()
  socket.write = (d) => captured.push(Buffer.from(d))
  socket.destroy = () => { socket.destroyed = true }
  socket.destroyed = false

  console.log('>> connecting fake WS client (monitor=' + sceneMonitor.key + ')...')
  const upgrade = upgrades.get('/we-sync/scene/stream')
  upgrade(
    { url: '/we-sync/scene/stream?monitor=' + sceneMonitor.key, headers: { 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==' } },
    socket,
    Buffer.alloc(0),
  )

  const t0 = Date.now()
  await new Promise((resolve) => setTimeout(resolve, 4000))

  const handshake = captured.find((b) => b.toString('utf8').startsWith('HTTP/1.1 101'))
  const frameWrites = captured.filter((b) => b.length > 2 && (b[0] & 0x80) === 0x80 && (b[0] & 0x0f) === 0x02)
  console.log('>> handshake 101:', handshake !== undefined ? 'OK' : 'FAIL')
  console.log('>> ws binary frames received:', frameWrites.length)

  let framePayloadOk = false
  if (frameWrites.length > 0) {
    const first = frameWrites[0]
    // WS 帧头：FIN+opcode(0x82) + len(7bit) [+ext] → 负载 = [1B format][4B w][4B h][body]
    let off = 2
    const len7 = first[1] & 0x7f
    if (len7 === 126) off += 2
    else if (len7 === 127) off += 8
    const payload = first.subarray(off)
    const format = payload[0]
    const w = payload.readUInt32LE(1)
    const h = payload.readUInt32LE(5)
    const expect = 9 + w * h * 4
    framePayloadOk = format === 2 && payload.length === expect
    console.log('>> first frame: format=' + format + ' w=' + w + ' h=' + h + ' payload=' + payload.length + ' expect=' + expect + ' => ' + (framePayloadOk ? 'OK' : 'FAIL'))
  }

  // 4) diag 再次确认 renderer 状态
  const dres2 = fakeRes()
  routes.get('/we-sync/diag')({ url: '/we-sync/diag' }, dres2)
  const diag2 = JSON.parse(dres2.body)
  console.log('>> diag2 scene.status:', JSON.stringify(diag2.scene?.status ?? null))
  console.log('>> diag2 scene.available:', diag2.scene?.available, 'fallback:', diag2.scene?.fallback)

  const ok = handshake !== undefined && frameWrites.length > 0 && framePayloadOk && modelOk && texOk
  console.log('>> INTEGRATION: ' + (ok ? 'PASS' : 'FAIL'))
  process.exit(ok ? 0 : 1)
} else {
  console.log('>> INTEGRATION: SKIP (no scene wallpaper currently applied)')
  process.exit(0)
}
