// 一次性自测：spawn 参考 renderer → 发 load 命令 → 校验 stdout 帧协议 → 测 1s FPS
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const REF = fileURLToPath(new URL('../tools/scene-renderer/scene-renderer.mjs', import.meta.url))
const SCENE = process.argv[2] ?? 'D:/SteamLibrary/steamapps/workshop/content/431960/904233689/scene.pkg'
const ASSETS = process.argv[3] ?? 'D:/SteamLibrary/steamapps/common/wallpaper_engine/assets'

const child = spawn(process.execPath, [REF], { stdio: ['pipe', 'pipe', 'pipe'] })
let buf = Buffer.alloc(0)
let frames = 0
let firstOk = false
const t0 = Date.now()

child.stderr.on('data', (d) => process.stdout.write('[stderr] ' + d.toString()))

child.stdout.on('data', (chunk) => {
  buf = Buffer.concat([buf, chunk])
  // 解析 length-prefixed 帧
  for (;;) {
    if (buf.length < 4) break
    const len = buf.readUInt32LE(0)
    if (buf.length < 4 + len) break
    const payload = buf.subarray(4, 4 + len)
    buf = buf.subarray(4 + len)
    frames++
    if (!firstOk) {
      const format = payload[0]
      const w = payload.readUInt32LE(1)
      const h = payload.readUInt32LE(5)
      const body = payload.length - 9
      const expect = w * h * 4
      const ok = format === 2 && w > 0 && h > 0 && body === expect
      firstOk = ok
      console.log('FRAME#1 format=' + format + ' w=' + w + ' h=' + h + ' body=' + body + ' expect=' + expect + ' => ' + (ok ? 'OK' : 'FAIL'))
    }
  }
})

child.on('exit', (code) => {
  const secs = (Date.now() - t0) / 1000
  console.log('renderer exited code=' + code + ' after ' + secs.toFixed(1) + 's, frames=' + frames + ' fps=' + (frames / secs).toFixed(1))
  console.log('FRAME PROTOCOL: ' + (firstOk ? 'PASS' : 'FAIL'))
  process.exit(firstOk ? 0 : 1)
})

// 发送 load
child.stdin.write(JSON.stringify({
  cmd: 'load',
  scene: SCENE,
  assets: ASSETS,
  width: 960,
  height: 540,
  fps: 30,
  quality: 80,
}) + '\n')
if (!existsSync(SCENE)) console.log('WARN scene not found: ' + SCENE)

// 6 秒后停止
setTimeout(() => { child.stdin.write(JSON.stringify({ cmd: 'stop' }) + '\n') }, 6000)
setTimeout(() => { if (child.exitCode === null) child.kill('SIGKILL') }, 9000)
