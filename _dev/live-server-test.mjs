// B 阶段验证：加载「已安装副本」的 lib/index.js，用真实 HTTP 服务器 + 真实 WS 客户端
// 验证：路由注册 / state / diag / scene/model / scene/texture / WS 帧流
import { createServer } from 'node:http'
import { connect } from 'node:net'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'

const INSTALLED = 'C:/Users/倪哥儿/.dsh/profiles/web/node_modules/dsh-wallpaper_share/lib/index.js'
const { apply } = await import(pathToFileURL(INSTALLED).href)

// —— 真实 HTTP 服务器 + 路由注册（模拟 DSH webServer 的 register/registerUpgrade）——
const routes = new Map()
const upgrades = new Map()
const server = createServer((req, res) => {
  const path = new URL(req.url ?? '/', 'http://x').pathname
  const handler = routes.get(path)
  if (handler === undefined) { res.writeHead(404); res.end(); return }
  Promise.resolve(handler(req, res)).catch(() => { try { res.writeHead(500); res.end() } catch { /* 已关闭 */ } })
})
server.on('upgrade', (req, socket, head) => {
  const path = new URL(req.url ?? '/', 'http://x').pathname
  const handler = upgrades.get(path)
  if (handler === undefined) { socket.destroy(); return }
  Promise.resolve(handler(req, socket, head)).catch(() => socket.destroy())
})

const webServer = {
  register(route) { routes.set(route.path, route.handler); return () => routes.delete(route.path) },
  registerUpgrade(route) { upgrades.set(route.path, route.handler); return () => upgrades.delete(route.path) },
}
const ctx = { get: (n) => (n === 'webServer' ? webServer : undefined), effect: (cb) => cb() }

console.log('>> applying INSTALLED plugin:', INSTALLED)
apply(ctx)
console.log('>> routes:', [...routes.keys()].join(', '))
console.log('>> upgrades:', [...upgrades.keys()].join(', '))

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
console.log('>> server on 127.0.0.1:' + port)

function get(path) {
  return new Promise((resolve) => {
    const req = server.request ? null : null // 不使用自请求（避免死锁），用 fetch
    void req
    fetch('http://127.0.0.1:' + port + path, { cache: 'no-store' }).then(async (r) => {
      resolve({ status: r.status, headers: Object.fromEntries(r.headers.entries()), body: await r.arrayBuffer() })
    }).catch((e) => resolve({ error: e.message }))
  })
}

// 1) diag
const diag = await get('/we-sync/diag')
console.log('>> /we-sync/diag status=' + diag.status)
const diagJson = JSON.parse(Buffer.from(diag.body).toString('utf8'))
console.log('>> diag: weDir=' + diagJson.weDir + ' monitors=' + diagJson.monitorCount + ' sceneMode=' + diagJson.sceneMode + ' sceneModel=' + JSON.stringify(diagJson.sceneModel ?? null))
const sceneMon = diagJson.monitors.find((m) => m.kind === 'scene')
console.log('>> scene monitor:', sceneMon ? sceneMon.key + ' ' + sceneMon.file : 'NONE')

// 2) scene/model
let modelOk = false
let texRef = null
if (sceneMon) {
  const m = await get('/we-sync/scene/model?monitor=' + sceneMon.key)
  const model = JSON.parse(Buffer.from(m.body).toString('utf8'))
  modelOk = Array.isArray(model.layers) && model.layerCount > 0
  console.log('>> scene/model status=' + m.status + ' layers=' + model.layerCount + ' w=' + model.width + 'x' + model.height + ' textures=' + model.textures.length)
  texRef = model.layers.map((l) => l.textureRefs[0]).find((t) => t !== undefined) ?? null
  // 3) scene/texture
  if (texRef) {
    const t = await get('/we-sync/scene/texture?monitor=' + sceneMon.key + '&name=' + encodeURIComponent(texRef))
    console.log('>> scene/texture ' + texRef + ': status=' + t.status + ' mime=' + (t.headers['content-type'] ?? '?') + ' bytes=' + t.body.byteLength)
  }
}

// 4) state
const st = await get('/we-sync/state')
console.log('>> state status=' + st.status + ' len=' + st.body.byteLength)

// 5) WS 帧流（真实 socket 握手 + 收帧）
let wsOk = false
if (sceneMon) {
  const key = Buffer.from('dsh-live-test-key').toString('base64')
  await new Promise((resolve) => {
    const sock = connect(port, '127.0.0.1', () => {
      sock.write(
        'GET /we-sync/scene/stream?monitor=' + sceneMon.key + ' HTTP/1.1\r\n' +
        'Host: 127.0.0.1:' + port + '\r\n' +
        'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
        'Sec-WebSocket-Key: ' + key + '\r\nSec-WebSocket-Version: 13\r\n\r\n',
      )
    })
    let buf = Buffer.alloc(0)
    let handshaked = false
    let frames = 0
    const accept = createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64')
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d])
      if (!handshaked) {
        const head = buf.toString('latin1')
        const idx = head.indexOf('\r\n\r\n')
        if (idx < 0) return
        handshaked = true
        const got = head.slice(0, idx).includes('101') && head.includes('Sec-WebSocket-Accept: ' + accept)
        console.log('>> WS handshake: ' + (got ? 'OK' : 'FAIL') + ' :: ' + head.slice(0, 60).replace(/\r\n/g, ' | '))
        buf = buf.subarray(idx + 4)
      }
      // 解析服务端帧（无掩码）
      for (;;) {
        if (buf.length < 2) return
        const fin = (buf[0] & 0x80) !== 0
        const opcode = buf[0] & 0x0f
        let len = buf[1] & 0x7f
        let off = 2
        if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4 }
        else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10 }
        if (buf.length < off + len) return
        const payload = buf.subarray(off, off + len)
        buf = buf.subarray(off + len)
        if (opcode === 0x2) {
          frames++
          if (frames === 1) {
            const fmt = payload[0]
            const w = payload.readUInt32LE(1)
            const h = payload.readUInt32LE(5)
            wsOk = fmt === 2 && payload.length === 9 + w * h * 4
            console.log('>> WS frame#1: fmt=' + fmt + ' w=' + w + 'h=' + h + ' payload=' + payload.length + ' => ' + (wsOk ? 'OK' : 'FAIL'))
          }
        }
        if (opcode === 0x8) { sock.destroy(); return }
        if (!fin) { /* 忽略分片 */ }
      }
    })
    setTimeout(() => { sock.destroy(); resolve() }, 6000)
  })
}

const ok = modelOk && texRef !== null && wsOk
console.log('>> LIVE-SERVER: ' + (ok ? 'PASS' : 'FAIL'))
console.log('>> summary: model=' + modelOk + ' texture=' + (texRef !== null) + ' ws-frames=' + wsOk)
server.close()
process.exit(ok ? 0 : 1)
