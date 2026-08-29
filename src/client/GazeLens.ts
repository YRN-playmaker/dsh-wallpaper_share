/**
 * GazeLens —— 摄像头眼动追踪（透镜视线源）。
 *
 * 设计要点：
 *  - 惰性加载：WebGazer 3.5.3 依赖 MediaPipe FaceMesh（~1.9MB JS + ~10MB WASM/资产），
 *    绝不进基础包；仅当用户在面板开启「眼动追踪」时才从 CDN 动态加载。
 *  - 隐私：关闭时显式 stopVideo() 释放摄像头（webgazer.end() 并不会停流）；全程本地推理，
 *    画面不上网。
 *  - 回落：getGaze() 带时效（默认 1.2s），无脸 / 陈旧时返回 null，由调用方回落到鼠标。
 *  - 校准：webgazer 在 begin() 期间自动从点击 / 鼠标移动采样自校准；calibrate() 提供 9 点
 *    引导序列加速。params.saveDataAcrossSessions=true → 校准样本存 IndexedDB，跨会话复用。
 *
 * 依赖 window.webgazer（由 CDN 脚本挂载）。本模块不 import 任何重型包。
 */

const WEBGAZER_JS = 'https://cdn.jsdelivr.net/npm/webgazer@3.5.3/dist/webgazer.js'
// faceMeshSolutionPath 默认是相对「页面」的 './mediapipe/face_mesh'，CDN 加载时必须改成绝对 URL，
// 否则会在我们的源上 404。jsdelivr 会按 npm 包目录结构提供这些资产。
const FACEMESH_PATH = 'https://cdn.jsdelivr.net/npm/webgazer@3.5.3/dist/mediapipe/face_mesh'

export type GazeStatus = 'off' | 'loading' | 'starting' | 'running' | 'error'

interface WebgazerLike {
  params: Record<string, unknown>
  begin: (onFail?: () => void) => Promise<unknown>
  pause: () => unknown
  end: () => unknown
  stopVideo: () => unknown
  setGazeListener: (fn: (data: { x: number; y: number } | null, ts: number) => void) => unknown
  clearGazeListener: () => unknown
  setRegression: (name: string) => unknown
  removeMouseEventListeners: () => unknown
  showVideoPreview: (show: boolean) => unknown
  detectCompatibility: () => boolean
}

let wg: WebgazerLike | null = null
let loadPromise: Promise<WebgazerLike> | null = null
let running = false
let status: GazeStatus = 'off'
let lastGaze: { x: number; y: number; t: number } | null = null
let lastError = ''
const statusListeners = new Set<(s: GazeStatus, err: string) => void>()

function setStatus(s: GazeStatus, err = ''): void {
  status = s
  lastError = err
  for (const fn of statusListeners) fn(s, err)
}

/** 订阅状态变化（loading / running / error…），返回取消订阅函数 */
export function onGazeStatus(fn: (s: GazeStatus, err: string) => void): () => void {
  statusListeners.add(fn)
  fn(status, lastError)
  return () => { statusListeners.delete(fn) }
}

export function getGazeStatus(): GazeStatus { return status }
export function isGazeRunning(): boolean { return running }

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-gaze="webgazer"]')
    if (existing !== null) {
      if (existing.dataset.loaded === '1') { resolve(); return }
      existing.addEventListener('load', () => resolve())
      existing.addEventListener('error', () => reject(new Error('webgazer 脚本加载失败')))
      return
    }
    const el = document.createElement('script')
    el.src = src
    el.async = true
    el.dataset.plugin = 'dsh-wallpaper_share'
    el.dataset.gaze = 'webgazer'
    el.addEventListener('load', () => { el.dataset.loaded = '1'; resolve() })
    el.addEventListener('error', () => reject(new Error('webgazer 脚本加载失败（检查网络 / CDN 可达性）')))
    document.head.appendChild(el)
  })
}

/** 惰性加载并配置 webgazer（只加载一次） */
async function ensureWebgazer(): Promise<WebgazerLike> {
  if (wg !== null) return wg
  if (loadPromise !== null) return loadPromise
  loadPromise = (async () => {
    await loadScript(WEBGAZER_JS)
    const w = (window as unknown as { webgazer?: WebgazerLike }).webgazer
    if (w === undefined || w === null) throw new Error('window.webgazer 未挂载')
    w.params.faceMeshSolutionPath = FACEMESH_PATH
    w.params.saveDataAcrossSessions = true
    w.params.showVideoPreview = false // 不显示摄像头小窗，保持画面干净
    w.params.showGazeDot = false // 我们自己驱动透镜，不用它的红点
    w.params.showFaceOverlay = false
    w.params.showFaceFeedbackBox = false
    w.params.applyKalmanFilter = true // 平滑注视抖动
    w.params.camConstraints = { video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' } }
    wg = w
    return w
  })().catch((e) => { loadPromise = null; throw e })
  return loadPromise
}

/** 开启眼动：加载 + begin（请求摄像头）。失败置 error 并回落。 */
export async function startGaze(): Promise<void> {
  if (running) return
  if (navigator.mediaDevices?.getUserMedia === undefined) {
    setStatus('error', '浏览器不支持摄像头（getUserMedia）')
    return
  }
  setStatus('loading')
  try {
    const w = await ensureWebgazer()
    setStatus('starting')
    w.setRegression('ridge')
    w.setGazeListener((data) => {
      if (data !== null && data !== undefined) lastGaze = { x: data.x, y: data.y, t: Date.now() }
    })
    // webgazer 在非 https 且 hostname!=='localhost' 时会 alert；127.0.0.1 实为安全上下文，抑制该弹窗。
    const origAlert = window.alert
    window.alert = () => {}
    try {
      await w.begin(() => { /* onFail：无摄像头时下面统一处理 */ })
    } finally {
      window.alert = origAlert
    }
    running = true
    setStatus('running')
  } catch (e) {
    running = false
    setStatus('error', '启动失败：' + String((e as Error).message ?? e) + '（可能无摄像头 / 被拒绝 / CDN 不可达）')
  }
}

/** 关闭眼动：清监听 + 停处理 + 释放摄像头。 */
export function stopGaze(): void {
  if (wg === null) { setStatus('off'); return }
  try {
    wg.clearGazeListener()
    wg.removeMouseEventListeners()
    wg.pause()
    wg.stopVideo() // 关键：end() 不停流，必须显式 stopVideo 释放摄像头
    wg.end()
  } catch { /* 忽略拆卸期竞态 */ }
  running = false
  lastGaze = null
  setStatus('off')
}

/** 取当前注视点（视口坐标）。陈旧（默认 >1.2s 无更新，如离开座位 / 无脸）返回 null → 调用方回落鼠标。 */
export function getGaze(maxAgeMs = 1200): { x: number; y: number } | null {
  if (!running || lastGaze === null) return null
  if (Date.now() - lastGaze.t > maxAgeMs) return null
  return { x: lastGaze.x, y: lastGaze.y }
}

// —— 校准：9 点引导序列。webgazer 在 begin() 期间自动把每次点击当作训练样本，
//    这里只负责按序显示目标点并在点击后推进（不阻止冒泡，让 webgazer 捕获到点击）。

const CAL_GRID = [0.1, 0.5, 0.9]

export function isCalibrating(): boolean { return calibState !== null }

let calibState: { pts: Array<{ x: number; y: number }>; i: number; overlay: HTMLDivElement; dot: HTMLDivElement; onClick: () => void } | null = null

/** 开始 9 点校准（需先 startGaze 成功）。onDone 在全部点完或取消时调用。 */
export function calibrate(onDone?: (completed: boolean) => void): void {
  if (calibState !== null) return
  if (!running) { onDone?.(false); return }
  if (wg !== null) wg.showVideoPreview(true) // 仅校准期间把摄像头画面投影到页面（平时不显示）
  const pts: Array<{ x: number; y: number }> = []
  for (const gy of CAL_GRID) for (const gx of CAL_GRID) pts.push({ x: Math.round(window.innerWidth * gx), y: Math.round(window.innerHeight * gy) })
  const overlay = document.createElement('div')
  overlay.dataset.plugin = 'dsh-wallpaper_share'
  overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483002;background:rgba(6,8,12,0.55);cursor:crosshair;'
  const hint = document.createElement('div')
  hint.style.cssText = 'position:fixed;left:50%;top:16px;transform:translateX(-50%);color:#fff;font:14px/1.5 system-ui,sans-serif;background:rgba(0,0,0,0.5);padding:6px 14px;border-radius:999px;pointer-events:none;'
  const dot = document.createElement('div')
  dot.style.cssText = 'position:fixed;width:26px;height:26px;border-radius:50%;background:#facc15;box-shadow:0 0 0 6px rgba(250,204,21,0.25);transform:translate(-50%,-50%);pointer-events:none;transition:background 0.1s;'
  overlay.appendChild(hint)
  overlay.appendChild(dot)
  document.body.appendChild(overlay)

  const place = (): void => {
    const p = calibState!.pts[calibState!.i]
    dot.style.left = p.x + 'px'
    dot.style.top = p.y + 'px'
    dot.style.background = '#facc15'
    hint.textContent = '注视黄点并点击它（' + String(calibState!.i + 1) + ' / ' + String(pts.length) + '）· 按 Esc 取消'
  }
  const finish = (completed: boolean): void => {
    if (calibState === null) return
    document.removeEventListener('click', calibState.onClick, true)
    document.removeEventListener('keydown', onKey, true)
    overlay.remove()
    calibState = null
    if (wg !== null) wg.showVideoPreview(false) // 校准结束收回摄像头画面
    onDone?.(completed)
  }
  const onClick = (): void => {
    if (calibState === null) return
    dot.style.background = '#4ade80' // 命中反馈
    // 让 webgazer 的捕获级 click 监听先记录样本，再于下一帧推进
    setTimeout(() => {
      if (calibState === null) return
      calibState.i += 1
      if (calibState.i >= calibState.pts.length) finish(true)
      else place()
    }, 120)
  }
  const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') finish(false) }

  calibState = { pts, i: 0, overlay, dot, onClick }
  // 用捕获阶段监听，但不 stopPropagation —— webgazer 的采样监听同为捕获阶段，二者并存
  document.addEventListener('click', onClick, true)
  document.addEventListener('keydown', onKey, true)
  place()
}
