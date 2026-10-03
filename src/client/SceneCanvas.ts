/**
 * SceneCanvas —— 浏览器半的 scene 动态背景层。
 *
 * 通过 WebSocket（/we-sync/scene/stream）接收 Node 中继的编码帧，
 * 解码为 ImageBitmap 后按 requestAnimationFrame 画到 <canvas>。
 * 原生捕获按页面桌面位置取对应区域；没有屏幕坐标的 renderer 使用 cover。
 *
 * 职责：canvas resize / devicePixelRatio / 帧解码 / rAF 调度 / 可见性暂停 /
 *       自动重连 / 窗口位置跟随 / CSS 模糊。
 */
import { WS_HEADER_BYTES, parseCaptureScreen, type CaptureScreenRect } from '../scene/SceneProtocol.ts'
import { captureDrawRect, estimateViewportInsets } from './capture-viewport.ts'

export interface SceneCanvasHandlers {
  /** 首帧到达 → true；连接彻底失败（重试耗尽）→ false，由调用方回退纹理 */
  onLiveChange?: (live: boolean) => void
}

/** 重连基础间隔（秒数 = 失败次数，线性退避） */
const RECONNECT_DELAY_MS = 1000
/** 重连间隔上限：renderer 崩溃自动重启 / 睡眠唤醒可能远超几秒，必须一直等到它回来 */
const RECONNECT_DELAY_MAX_MS = 10000

export class SceneCanvas {
  private el: HTMLCanvasElement | null = null
  private ctx: CanvasRenderingContext2D | null = null
  private ws: WebSocket | null = null
  private rafId = 0
  private needDraw = false
  private latest: ImageBitmap | null = null
  private dpr = 1
  private live = false
  private closed = false
  private retries = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private blurPx = 0
  private scale = 1
  private handlers: SceneCanvasHandlers
  private captureScreen: CaptureScreenRect | null = null
  private positionKey = ''
  private calibratedInsets: { x: number; y: number; key: string } | null = null

  constructor(handlers: SceneCanvasHandlers = {}) {
    this.handlers = handlers
  }

  get isLive(): boolean {
    return this.live
  }

  start(monitor: string, version: number): void {
    this.stop()
    this.closed = false
    this.retries = 0

    this.el = document.createElement('canvas')
    this.el.style.position = 'fixed'
    this.el.style.top = '0'
    this.el.style.left = '0'
    this.el.style.width = '100%'
    this.el.style.height = '100%'
    this.el.style.zIndex = '-2'
    this.el.style.pointerEvents = 'none'
    this.el.style.border = '0'
    document.body.appendChild(this.el)
    this.ctx = this.el.getContext('2d')
    this.resize()
    this.applyVisuals()

    window.addEventListener('resize', this.onResize)
    window.addEventListener('pointermove', this.onPointerMove, { passive: true })
    document.addEventListener('visibilitychange', this.onVisibility)

    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const query = (monitor !== '' ? 'monitor=' + encodeURIComponent(monitor) : '') +
      (monitor !== '' ? '&v=' : 'v=') + encodeURIComponent(String(version))
    this.connect(proto + '//' + location.host + '/we-sync/scene/stream?' + query)
  }

  stop(): void {
    this.closed = true
    this.setLive(false)
    if (this.reconnectTimer !== null) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null }
    if (this.rafId !== 0) { cancelAnimationFrame(this.rafId); this.rafId = 0 }
    if (this.ws !== null) {
      try { this.ws.onclose = null; this.ws.onerror = null; this.ws.onmessage = null; this.ws.close() } catch { /* 忽略 */ }
      this.ws = null
    }
    if (this.latest !== null) { try { this.latest.close() } catch { /* 忽略 */ } this.latest = null }
    window.removeEventListener('resize', this.onResize)
    window.removeEventListener('pointermove', this.onPointerMove)
    document.removeEventListener('visibilitychange', this.onVisibility)
    if (this.el !== null) { this.el.remove(); this.el = null; this.ctx = null }
    this.captureScreen = null
    this.positionKey = ''
    this.calibratedInsets = null
  }

  applyVisuals(blurPx?: number, scale?: number): void {
    if (blurPx !== undefined) this.blurPx = blurPx
    if (scale !== undefined) this.scale = scale
    if (this.el !== null) {
      this.el.style.filter = 'blur(' + Math.round(this.blurPx) + 'px)'
      // 捕获画面按桌面坐标对齐，模糊留边通过额外采样实现，不能再放大窗口内容。
      const padding = this.captureScreen !== null ? Math.ceil(Math.max(0, this.blurPx) * 3) : 0
      this.el.style.top = this.el.style.left = -padding + 'px'
      this.el.style.width = this.el.style.height = 'calc(100% + ' + padding * 2 + 'px)'
      this.el.style.transform = this.captureScreen !== null ? 'none' : 'scale(' + this.scale.toFixed(3) + ')'
      this.resize()
      this.scheduleDraw()
    }
  }

  private connect(url: string): void {
    if (this.closed) return
    let ws: WebSocket
    try {
      ws = new WebSocket(url)
    } catch {
      this.scheduleReconnect(url)
      return
    }
    ws.binaryType = 'arraybuffer'
    this.ws = ws
    ws.onopen = () => { this.retries = 0 }
    ws.onmessage = (ev) => this.onMessage(ev)
    ws.onerror = () => { /* 交给 onclose 处理 */ }
    ws.onclose = () => {
      if (this.closed) return
      this.ws = null
      this.setLive(false)
      this.scheduleReconnect(url)
    }
  }

  /** 断线后无限重连（线性退避到上限）。服务端 renderer 崩溃会自动重启并继续广播，
   *  客户端不能因「重试耗尽」永久放弃——那会让 live 背景冻结成最后一帧直到换壁纸。 */
  private scheduleReconnect(url: string): void {
    if (this.closed) return
    this.retries += 1
    const delay = Math.min(RECONNECT_DELAY_MS * this.retries, RECONNECT_DELAY_MAX_MS)
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect(url)
    }, delay)
  }

  private onMessage(ev: MessageEvent): void {
    if (this.closed) return
    if (typeof ev.data === 'string') {
      try {
        const message = JSON.parse(ev.data) as { type?: string; screen?: unknown }
        if (message.type === 'capture-screen') {
          this.captureScreen = parseCaptureScreen(message.screen)
          this.positionKey = ''
          this.calibratedInsets = null
          this.applyVisuals()
        }
      } catch { /* 其他或损坏的元数据不影响帧解码 */ }
      return
    }
    const buf = ev.data as ArrayBuffer
    if (!(buf instanceof ArrayBuffer)) return
    const view = new DataView(buf)
    if (buf.byteLength < WS_HEADER_BYTES) return
    const format = view.getUint8(0)
    const w = view.getUint32(1, true)
    const h = view.getUint32(5, true)
    if (w < 1 || h < 1 || w > 16384 || h > 16384) return
    const payload = new Uint8Array(buf, WS_HEADER_BYTES)
    this.decode(format, w, h, payload)
  }

  private decode(format: number, w: number, h: number, payload: Uint8Array): void {
    let promise: Promise<ImageBitmap>
    if (format === 0) {
      promise = createImageBitmap(new Blob([payload as BlobPart], { type: 'image/jpeg' }))
    } else if (format === 1) {
      promise = createImageBitmap(new Blob([payload as BlobPart], { type: 'image/webp' }))
    } else if (format === 2 || format === 3) {
      // RAW / BGRA 像素帧：payload 必须 ≥ w*h*4，否则 renderer 帧错位 / 残留缓冲
      // 会同步抛 RangeError（ImageData 构造），这里先校验、截断并跳过坏帧。
      const need = w * h * 4
      if (payload.length < need) return
      const slice = payload.subarray(0, need)
      const px = format === 3 ? this.bgraToRgba(slice) : new Uint8ClampedArray(slice.buffer.slice(slice.byteOffset, slice.byteOffset + need))
      promise = createImageBitmap(new ImageData(px, w, h))
    } else {
      return
    }
    void promise.then((bmp) => {
      if (this.closed) { bmp.close(); return }
      if (this.latest !== null) { try { this.latest.close() } catch { /* 忽略 */ } }
      this.latest = bmp
      this.retries = 0
      this.setLive(true)
      this.scheduleDraw()
    }).catch(() => { /* 解码失败，跳过该帧 */ })
  }

  private bgraToRgba(payload: Uint8Array): Uint8ClampedArray {
    const out = new Uint8ClampedArray(payload.length)
    for (let i = 0; i < payload.length; i += 4) {
      out[i] = payload[i + 2]
      out[i + 1] = payload[i + 1]
      out[i + 2] = payload[i]
      out[i + 3] = payload[i + 3]
    }
    return out
  }

  private scheduleDraw(): void {
    this.needDraw = true
    if (this.rafId === 0 && !document.hidden) this.rafId = requestAnimationFrame(this.draw)
  }

  private draw = (): void => {
    this.rafId = 0
    if (this.closed || this.ctx === null || this.el === null) return
    if (document.hidden) return
    if (this.captureScreen !== null) {
      // 浏览器没有通用的窗口移动事件；即使 WE 暂停出帧，也要跟随窗口移动。
      const key = [window.screenX, window.screenY, window.outerWidth, window.outerHeight,
        window.innerWidth, window.innerHeight, window.devicePixelRatio, !!document.fullscreenElement].join(',')
      if (key !== this.positionKey) {
        this.positionKey = key
        this.resize()
        this.needDraw = true
      }
    }
    if (this.needDraw && this.latest !== null) {
      this.needDraw = false
      if (this.captureScreen !== null) this.drawCapture(this.ctx, this.latest)
      else this.drawCover(this.ctx, this.latest, this.el.width, this.el.height)
    }
    if (this.captureScreen !== null) this.rafId = requestAnimationFrame(this.draw)
  }

  private chromeKey(zoom: number): string {
    return [window.outerWidth - window.innerWidth * zoom, window.outerHeight - window.innerHeight * zoom,
      zoom, !!document.fullscreenElement].join(',')
  }

  private onPointerMove = (ev: PointerEvent): void => {
    if (this.captureScreen === null || !ev.isTrusted) return
    const zoom = (window.devicePixelRatio || 1) / this.captureScreen.pixelRatio
    const key = this.chromeKey(zoom)
    if (this.calibratedInsets?.key === key) return
    const x = ev.screenX - window.screenX - ev.clientX * zoom
    const y = ev.screenY - window.screenY - ev.clientY * zoom
    // 用真实指针校准页面原点，兼容 Chrome 工具栏和无边框桌面窗口。
    if (x >= -32 && x <= 64 && y >= -32 && y <= window.outerHeight) {
      this.calibratedInsets = { x, y, key }
      this.scheduleDraw()
    }
  }

  private drawCapture(ctx: CanvasRenderingContext2D, bmp: ImageBitmap): void {
    const screen = this.captureScreen!, el = this.el!
    const zoom = (window.devicePixelRatio || 1) / screen.pixelRatio
    const inset = this.calibratedInsets?.key === this.chromeKey(zoom) ? this.calibratedInsets
      : estimateViewportInsets(window.outerWidth, window.outerHeight, window.innerWidth, window.innerHeight, zoom, !!document.fullscreenElement)
    const rect = el.getBoundingClientRect()
    const viewport = { left: window.screenX + inset.x + rect.left * zoom,
      top: window.screenY + inset.y + rect.top * zoom, width: rect.width * zoom, height: rect.height * zoom }
    const draw = captureDrawRect(screen, viewport, bmp.width, bmp.height, el.width, el.height)
    ctx.clearRect(0, 0, el.width, el.height)
    if (draw !== null) ctx.drawImage(bmp, draw.sx, draw.sy, draw.sw, draw.sh, draw.dx, draw.dy, draw.dw, draw.dh)
  }

  /** 以 cover 方式绘制（等比裁切铺满），与 background-size: cover 对齐 */
  private drawCover(ctx: CanvasRenderingContext2D, bmp: ImageBitmap, cw: number, ch: number): void {
    const iw = bmp.width
    const ih = bmp.height
    if (iw === 0 || ih === 0) return
    const scale = Math.max(cw / iw, ch / ih)
    const sw = cw / scale
    const sh = ch / scale
    const sx = (iw - sw) / 2
    const sy = (ih - sh) / 2
    ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, cw, ch)
  }

  private resize(): void {
    if (this.el === null) return
    this.dpr = window.devicePixelRatio || 1
    const w = Math.max(1, Math.round(this.el.clientWidth * this.dpr))
    const h = Math.max(1, Math.round(this.el.clientHeight * this.dpr))
    if (this.el.width !== w) this.el.width = w
    if (this.el.height !== h) this.el.height = h
  }

  private onResize = (): void => {
    this.resize()
    this.scheduleDraw()
  }

  private onVisibility = (): void => {
    if (document.hidden) {
      // 暂停绘制（冻结最后一帧），WS 保持连接
      if (this.rafId !== 0) { cancelAnimationFrame(this.rafId); this.rafId = 0 }
    } else {
      this.scheduleDraw()
    }
  }

  private setLive(live: boolean): void {
    if (this.live === live) return
    this.live = live
    if (this.handlers.onLiveChange !== undefined) this.handlers.onLiveChange(live)
  }
}
