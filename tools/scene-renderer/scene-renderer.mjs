#!/usr/bin/env node
/**
 * scene-renderer.mjs —— dsh-wallpaper_share 的「参考 renderer」。
 *
 * ⚠ 重要：这不是真正的 Wallpaper Engine Scene renderer。它是一个
 *   协议参考实现 / 管线验证桩，用来端到端验证：
 *     spawn → stdin JSON 控制 → 二进制帧 stdout → Node 中继 → WebSocket
 *     → 浏览器 canvas → 30fps 稳定显示。
 *   它输出的是「按场景配色生成的诊断动画」（RGBA），不是 scene.pkg 的
 *   真实渲染画面。真实 scene 渲染由用户通过 CONFIG.sceneRendererPath
 *   提供的 renderer（如 GPL 的 linux-wallpaperengine 离屏封装）完成。
 *
 * 协议（与 src/scene/SceneProtocol.ts 一致）：
 *   stdin  换行分隔 JSON 命令：load/pause/resume/resize/stop/ping
 *   stdout 帧：`[4B LE payloadLen][1B format][4B LE width][4B LE height][像素/编码字节]`
 *          format 2 = RGBA（本参考 renderer 使用）
 *   stderr 日志 + `[VERSION]reference-0.1.0` + `[STATUS]{"fps":..,"frame":..}`
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

const VERSION = 'reference-0.1.0'
const FORMAT_RGBA = 2
const STATUS_INTERVAL_MS = 1000

// ---- 状态 ----
let state = 'idle' // idle | running | paused
let scenePath = ''
let assetsPath = ''
let width = 640
let height = 360
let fps = 30
let frame = 0
let t0 = Date.now()
let framesThisSecond = 0
let fpsMeasured = 0
let colorA = [15, 16, 20]
let colorB = [46, 160, 67]
let gradient = null // 预计算背景渐变（rows）

// ---- 工具 ----
function log(line) {
  process.stderr.write('[SceneRenderer] ' + line + '\n')
}
function status(obj) {
  process.stderr.write('[STATUS]' + JSON.stringify(obj) + '\n')
}

function sendFrame(rgba) {
  const header = Buffer.alloc(9)
  header[0] = FORMAT_RGBA
  header.writeUInt32LE(width, 1)
  header.writeUInt32LE(height, 5)
  const len = header.length + rgba.length
  const out = Buffer.alloc(4 + len)
  out.writeUInt32LE(len, 0)
  header.copy(out, 4)
  rgba.copy(out, 4 + header.length)
  process.stdout.write(out)
}

// ---- 场景读取（只做元数据，不做真实渲染） ----
function parseSchemeColor(v) {
  try {
    const parts = String(v).trim().split(/\s+/).map(Number)
    if (parts.length < 3 || parts.some((n) => !Number.isFinite(n))) return null
    const max = Math.max(...parts)
    const scale = max > 1.5 ? 1 : 255
    return parts.slice(0, 3).map((n) => Math.max(0, Math.min(255, Math.round(n * scale))))
  } catch {
    return null
  }
}

function readSceneMeta(pkg) {
  const dir = dirname(pkg)
  const meta = { title: '', scheme: null, textureW: 0, textureH: 0, entries: 0 }
  try {
    const project = JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8'))
    meta.title = typeof project.title === 'string' ? project.title : ''
    if (project.general?.properties?.schemecolor?.value !== undefined) {
      meta.scheme = parseSchemeColor(project.general.properties.schemecolor.value)
    }
  } catch { /* project.json 不可用 */ }
  try {
    // 粗略扫描 scene.pkg 内最大 JPEG 尺寸（只读尺寸，不解码）
    const b = readFileSync(pkg)
    let pos = 0
    while (pos < b.length - 9) {
      if (b[pos] === 0xff && b[pos + 1] === 0xd8 && b[pos + 2] === 0xff) {
        let scan = pos + 2
        for (let g = 0; scan < b.length - 9 && g < 64; g++) {
          if (b[scan] !== 0xff) { scan++; continue }
          const marker = b[scan + 1]
          if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) { scan += 2; continue }
          const len = b.readUInt16BE(scan + 2)
          if (len < 2) break
          if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
            const h = b.readUInt16BE(scan + 5)
            const w = b.readUInt16BE(scan + 7)
            if (w * h > meta.textureW * meta.textureH) { meta.textureW = w; meta.textureH = h }
            break
          }
          scan += 2 + len
        }
        const eoi = b.indexOf(Buffer.from([0xff, 0xd9]), scan)
        pos = eoi >= 0 ? eoi + 1 : b.length
        continue
      }
      pos++
    }
  } catch { /* scene.pkg 不可读 */ }
  return meta
}

// ---- 诊断动画渲染 ----
function rebuildGradient() {
  gradient = Buffer.alloc(height * 4)
  for (let y = 0; y < height; y++) {
    const k = y / Math.max(1, height - 1)
    const r = Math.round(colorA[0] + (colorB[0] - colorA[0]) * k)
    const g = Math.round(colorA[1] + (colorB[1] - colorA[1]) * k)
    const b = Math.round(colorA[2] + (colorB[2] - colorA[2]) * k)
    gradient.writeUInt8(r, y * 4)
    gradient.writeUInt8(g, y * 4 + 1)
    gradient.writeUInt8(b, y * 4 + 2)
    gradient.writeUInt8(255, y * 4 + 3)
  }
}

function renderFrame() {
  if (gradient === null) rebuildGradient()
  const buf = Buffer.alloc(width * height * 4)
  // 背景：逐行渐变
  for (let y = 0; y < height; y++) {
    const src = y * 4
    const dstStart = y * width * 4
    for (let x = 0; x < width; x++) {
      gradient.copy(buf, dstStart + x * 4, src, src + 4)
    }
  }
  const t = frame / Math.max(1, fps)
  // 移动的高亮横条（正弦上下扫）
  const barY = Math.round(height / 2 + Math.sin(t * 1.3) * (height / 3))
  for (let x = 0; x < width; x++) {
    for (let dy = -3; dy <= 3; dy++) {
      const y = barY + dy
      if (y < 0 || y >= height) continue
      const i = (y * width + x) * 4
      buf[i] = Math.min(255, buf[i] + 90)
      buf[i + 1] = Math.min(255, buf[i + 1] + 70)
      buf[i + 2] = Math.min(255, buf[i + 2] + 50)
    }
  }
  // 轨道圆点
  const cx = width / 2 + Math.cos(t * 0.9) * (Math.min(width, height) * 0.3)
  const cy = height / 2 + Math.sin(t * 0.7) * (Math.min(width, height) * 0.25)
  const radius = Math.max(4, Math.round(Math.min(width, height) * 0.04))
  for (let y = Math.max(0, Math.floor(cy - radius)); y < Math.min(height, Math.ceil(cy + radius)); y++) {
    for (let x = Math.max(0, Math.floor(cx - radius)); x < Math.min(width, Math.ceil(cx + radius)); x++) {
      const dx = x - cx
      const dy = y - cy
      if (dx * dx + dy * dy <= radius * radius) {
        const i = (y * width + x) * 4
        buf[i] = 255
        buf[i + 1] = 255
        buf[i + 2] = 255
      }
    }
  }
  // 底部帧进度条
  const progress = ((frame % (fps * 3)) / (fps * 3)) * width
  for (let y = height - 6; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      if (x < progress) {
        buf[i] = 255; buf[i + 1] = 255; buf[i + 2] = 255
      } else {
        buf[i] = 60; buf[i + 1] = 60; buf[i + 2] = 60
      }
    }
  }
  return buf
}

function tick() {
  if (state !== 'running') return
  const rgba = renderFrame()
  sendFrame(rgba)
  frame++
  framesThisSecond++
}

// ---- 命令处理 ----
function handleLine(line) {
  line = line.trim()
  if (line === '') return
  let cmd
  try { cmd = JSON.parse(line) } catch { log('ignoring non-JSON stdin: ' + line); return }
  switch (cmd.cmd) {
    case 'load': {
      scenePath = cmd.scene ?? ''
      assetsPath = cmd.assets ?? ''
      width = clampInt(cmd.width, 160, 1920, 640)
      height = clampInt(cmd.height, 90, 1080, 360)
      fps = clampInt(cmd.fps, 5, 60, 30)
      const meta = readSceneMeta(scenePath)
      if (meta.scheme !== null) { colorA = [Math.round(meta.scheme[0] * 0.25), Math.round(meta.scheme[1] * 0.25), Math.round(meta.scheme[2] * 0.25)]; colorB = meta.scheme }
      gradient = null
      frame = 0
      log('Scene loaded: ' + (meta.title || scenePath) + ' (texture ' + meta.textureW + 'x' + meta.textureH + ', assets ' + (existsSync(join(assetsPath, 'shaders')) ? 'ok' : 'missing') + ')')
      log('Streaming ' + width + 'x' + height + ' @' + fps + 'fps (RGBA diagnostic animation, NOT real scene render)')
      state = 'running'
      restartTick()
      status({ fps: 0, frame: 0 })
      break
    }
    case 'pause': state = 'paused'; log('paused'); break
    case 'resume': state = 'running'; t0 = Date.now(); log('resumed'); break
    case 'resize':
      width = clampInt(cmd.width, 160, 3840, width)
      height = clampInt(cmd.height, 90, 2160, height)
      gradient = null
      log('resized to ' + width + 'x' + height)
      break
    case 'ping': status({ fps: fpsMeasured, frame }); break
    case 'stop': log('stopping'); state = 'idle'; setTimeout(() => process.exit(0), 20); break
    default: log('unknown cmd: ' + (cmd.cmd ?? ''))
  }
}

function clampInt(v, min, max, dflt) {
  const n = Math.round(Number(v))
  if (!Number.isFinite(n)) return dflt
  return Math.max(min, Math.min(max, n))
}

// ---- 启动 ----
process.stderr.write('[VERSION]' + VERSION + '\n')
log('reference scene renderer started (pid ' + process.pid + ')')

let tickTimer = null
function restartTick() {
  if (tickTimer !== null) clearInterval(tickTimer)
  tickTimer = setInterval(tick, 1000 / fps)
}

// stdin 换行缓冲
let stdinBuf = ''
process.stdin.on('data', (chunk) => {
  stdinBuf += chunk.toString('utf8')
  let nl = stdinBuf.indexOf('\n')
  while (nl >= 0) {
    handleLine(stdinBuf.slice(0, nl))
    stdinBuf = stdinBuf.slice(nl + 1)
    nl = stdinBuf.indexOf('\n')
  }
})
process.stdin.on('end', () => process.exit(0))
process.on('SIGTERM', () => process.exit(0))

// 帧循环（load 后按实际 fps 重建）+ 每秒状态上报
restartTick()
setInterval(() => {
  fpsMeasured = framesThisSecond
  framesThisSecond = 0
  if (state === 'running') status({ fps: fpsMeasured, frame })
}, STATUS_INTERVAL_MS)
