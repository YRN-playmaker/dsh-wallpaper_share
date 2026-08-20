/**
 * 极简 RFC 6455 WebSocket 服务端（仅服务端→浏览器推送二进制帧），
 * 用于把 SceneAdapter 的最新帧广播给 SceneCanvas。
 *
 * 不依赖任何第三方 ws 库：DSH 的 webServer 提供 `registerUpgrade` 路由，
 * 回调收到已协商前的 (req, socket, head)，这里完成握手与后续帧收发。
 * 客户端只消费二进制帧（opcode 0x2），服务端只需解析 close/ping/pong。
 *
 * WS 消息负载（Node → 浏览器）：`[1B format][4B LE width][4B LE height][payload]`
 */
import { createHash } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { WS_HEADER_BYTES, type SceneFrame } from './SceneProtocol.ts'

/** RFC 6455 握手魔数 GUID */
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

interface SceneWsClient {
  socket: Duplex
  monitor: string
  buffer: Buffer
  closed: boolean
}

export interface SceneWsEvents {
  /** 新客户端接入（monitor 为查询参数，'' 表示 auto） */
  connect: (monitor: string) => void
  disconnect: (monitor: string) => void
  log: (line: string) => void
}

export class SceneFrameHub {
  private clients = new Set<SceneWsClient>()
  private logFn: (line: string) => void
  private onClientsChanged: (count: number) => void

  constructor(logFn?: (line: string) => void, onClientsChanged?: (count: number) => void) {
    this.logFn = logFn ?? (() => {})
    this.onClientsChanged = onClientsChanged ?? (() => {})
  }

  get clientCount(): number {
    return this.clients.size
  }

  /** 作为 webServer.registerUpgrade 的 handler 使用 */
  handleUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer): void => {
    const monitor = this.monitorFromQuery(req.url ?? '')
    if (!this.accept(req, socket)) return
    const client: SceneWsClient = { socket, monitor, buffer: Buffer.alloc(0), closed: false }
    this.clients.add(client)
    this.onClientsChanged(this.clients.size)
    this.logFn('[SceneRenderer] Scene stream client connected (monitor=' + (monitor === '' ? 'auto' : monitor) + ', total=' + this.clients.size + ')')

    socket.on('data', (chunk: Buffer) => this.onData(client, chunk))
    socket.on('error', () => this.drop(client))
    socket.on('close', () => this.drop(client))

    // head 里可能带着升级后的首帧数据
    if (head.length > 0) this.onData(client, head)
  }

  /** 广播一帧给匹配 monitor 的客户端（monitor='' 的客户端视为 auto，接受所有） */
  broadcast(monitor: string, frame: SceneFrame): void {
    const msg = this.encodeFrameMessage(frame)
    for (const c of this.clients) {
      if (c.closed) continue
      if (c.monitor !== '' && c.monitor !== monitor) continue
      try { c.socket.write(msg) } catch { this.drop(c) }
    }
  }

  closeAll(): void {
    for (const c of [...this.clients]) {
      try { c.socket.destroy() } catch { /* 已关闭 */ }
      c.closed = true
    }
    this.clients.clear()
  }

  private monitorFromQuery(url: string): string {
    const m = /[?&]monitor=([^&]+)/.exec(url)
    if (m === null || m[1] === undefined) return ''
    try { return decodeURIComponent(m[1]) } catch { return '' }
  }

  private accept(req: IncomingMessage, socket: Duplex): boolean {
    const key = req.headers['sec-websocket-key']
    if (typeof key !== 'string') {
      socket.destroy()
      return false
    }
    const accept = createHash('sha1').update(key + WS_GUID).digest('base64')
    try {
      socket.write(
        'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n',
      )
      return true
    } catch {
      socket.destroy()
      return false
    }
  }

  private onData(client: SceneWsClient, chunk: Buffer): void {
    if (client.closed) return
    client.buffer = Buffer.concat([client.buffer, chunk])
    for (;;) {
      const parsed = this.parseClientFrame(client.buffer)
      if (parsed === null) return
      if (parsed.needMore) return
      client.buffer = parsed.rest
      this.handleClientFrame(client, parsed.opcode, parsed.payload)
    }
  }

  private parseClientFrame(buf: Buffer): { opcode: number; payload: Buffer; rest: Buffer; needMore: boolean } | null {
    if (buf.length < 2) return { opcode: 0, payload: Buffer.alloc(0), rest: buf, needMore: true }
    const b0 = buf[0]
    const b1 = buf[1]
    const opcode = b0 & 0x0f
    const masked = (b1 & 0x80) !== 0
    let len = b1 & 0x7f
    let offset = 2
    if (len === 126) {
      if (buf.length < 4) return { opcode, payload: Buffer.alloc(0), rest: buf, needMore: true }
      len = buf.readUInt16BE(2)
      offset = 4
    } else if (len === 127) {
      if (buf.length < 10) return { opcode, payload: Buffer.alloc(0), rest: buf, needMore: true }
      const big = buf.readBigUInt64BE(2)
      if (big > BigInt(16 * 1024 * 1024)) return null // 防御：超限帧丢弃重连
      len = Number(big)
      offset = 10
    }
    let maskKey: Buffer | null = null
    if (masked) {
      if (buf.length < offset + 4) return { opcode, payload: Buffer.alloc(0), rest: buf, needMore: true }
      maskKey = buf.subarray(offset, offset + 4)
      offset += 4
    }
    if (buf.length < offset + len) return { opcode, payload: Buffer.alloc(0), rest: buf, needMore: true }
    let payload = buf.subarray(offset, offset + len)
    if (maskKey !== null) {
      const out = Buffer.alloc(len)
      for (let i = 0; i < len; i++) out[i] = payload[i] ^ maskKey[i & 3]
      payload = out
    }
    return { opcode, payload, rest: buf.subarray(offset + len), needMore: false }
  }

  private handleClientFrame(client: SceneWsClient, opcode: number, payload: Buffer): void {
    if (opcode === 0x8) { // close
      try { client.socket.write(this.encodeServerFrame(Buffer.alloc(0), 0x8)) } catch { /* 忽略 */ }
      this.drop(client)
      return
    }
    if (opcode === 0x9) { // ping → pong
      try { client.socket.write(this.encodeServerFrame(payload, 0xa)) } catch { this.drop(client) }
      return
    }
    // 0xa pong / 0x1 文本 / 0x2 二进制：客户端不应主动发数据，忽略
  }

  private drop(client: SceneWsClient): void {
    if (client.closed) return
    client.closed = true
    this.clients.delete(client)
    try { client.socket.destroy() } catch { /* 已关闭 */ }
    this.onClientsChanged(this.clients.size)
    this.logFn('[SceneRenderer] Scene stream client disconnected (total=' + this.clients.size + ')')
  }

  /** 服务端→客户端二进制帧：opcode 0x2，FIN=1，无掩码 */
  private encodeServerFrame(payload: Buffer, opcode: number): Buffer {
    const len = payload.length
    let header: Buffer
    if (len < 126) {
      header = Buffer.alloc(2)
      header[1] = len
    } else if (len < 65536) {
      header = Buffer.alloc(4)
      header[1] = 126
      header.writeUInt16BE(len, 2)
    } else {
      header = Buffer.alloc(10)
      header[1] = 127
      header.writeBigUInt64BE(BigInt(len), 2)
    }
    header[0] = 0x80 | opcode
    return Buffer.concat([header, payload])
  }

  /** 把 SceneFrame 编码为 WS 二进制消息负载 */
  private encodeFrameMessage(frame: SceneFrame): Buffer {
    const header = Buffer.alloc(WS_HEADER_BYTES)
    header[0] = frame.format === 'jpeg' ? 0 : frame.format === 'webp' ? 1 : frame.format === 'rgba' ? 2 : 3
    header.writeUInt32LE(frame.width, 1)
    header.writeUInt32LE(frame.height, 5)
    return this.encodeServerFrame(Buffer.concat([header, Buffer.from(frame.data)]), 0x2)
  }
}
