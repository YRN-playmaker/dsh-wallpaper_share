/**
 * SceneCanvas —— 浏览器半的 scene 动态背景层。
 *
 * 通过 WebSocket（/we-sync/scene/stream）接收 Node 中继的编码帧，
 * 解码为 ImageBitmap 后按 requestAnimationFrame 画到 <canvas>，覆盖铺满。
 *
 * 职责：canvas resize / devicePixelRatio / 帧解码 / rAF 调度 / 可见性暂停 /
 *       自动重连 / 模糊与缩放（模糊 opacity 仍在 CSS 层，不进 renderer）。
 */
import { WS_HEADER_BYTES } from '../scene/SceneProtocol.ts'

export interface SceneCanvasHandlers {
  /** 首帧到达 → true；连接彻底失败（重试耗尽）→ false，由调用方回退纹理 */
  onLiveChange?: (live: boolean) => void
}

const MAX_RECONNECT = 5
const RECONNECT_DELAY_MS = 1000

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
    document.removeEventListener('visibilitychange', this.onVisibility)
    if (this.el !== null) { this.el.remove(); this.el = null; this.ctx = null }
  }

  applyVisuals(blurPx?: number, scale?: number): void {
    if (blurPx !== undefined) this.blurPx = blurPx
    if (scale !== undefined) this.scale = scale
    if (this.el !== null) {
      this.el.style.filter = 'blur(' + Math.round(this.blurPx) + 'px)'
      this.el.style.transform = 'scale(' + this.scale.toFixed(3) + ')'
    }
  }

  private connect(url: string): void {
    if (this.closed) return
    let ws: WebSocket
    try { ws = new WebSocket(url) } catch { this.fail(); return }
    ws.binaryType = 'arraybuffer'
    this.ws = ws
    ws.onopen = () => { this.retries = 0 }
    ws.onmessage = (ev) => this.onMessage(ev)
    ws.onerror = () => { /* 交给 onclose 处理 */ }
    ws.onclose = () => {
      if (this.closed) return
      this.ws = null
      if (this.retries < MAX_RECONNECT) {
        this.retries += 1
        this.reconnectTimer = setTimeout(() => this.connect(url), RECONNECT_DELAY_MS)
      } else {
        this.fail()
      }
    }
  }

  private fail(): void {
    this.setLive(false)
    this.closed = true
    // 通知调用方回退（texture/preview）
    // 注意：不在此处自毁，交给调用方 stop()
  }

  private onMessage(ev: MessageEvent): void {
    if (this.closed) return
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
      let px = new Uint8ClampedArray(payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength))
      if (format === 3) {
        px = this.bgraToRgba(payload)
      }
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
    if (this.needDraw && this.latest !== null) {
      this.needDraw = false
      this.drawCover(this.ctx, this.latest, this.el.width, this.el.height)
    }
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
