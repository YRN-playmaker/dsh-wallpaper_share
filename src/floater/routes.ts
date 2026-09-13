/**
 * 桌面悬浮球的 HTTP 路由（node 半），与 launcher/routes.ts 同契约（纯 handler，假 req 可测）：
 *   GET  /we-sync/floater → { supported, ...hub 状态 }
 *   POST /we-sync/floater JSON{pageId?, enabled, state:'visible'|'hidden'|'unloading', title?, color?}
 *        → 200 hub 快照；400 非法体；平台不支持时接受请求但恒 ok（客户端自行置灰开关）
 */
import type { Req, Res, Route } from '../launcher/routes.ts'
import { FloaterHub, parseSync } from './hub.ts'

export type { Req, Res, Route } from '../launcher/routes.ts'

export interface FloaterRoutesDeps {
  hub: Pick<FloaterHub, 'sync' | 'status'>
  /** 当前宿主能否真正显示悬浮球（win32 + exe 存在） */
  supported(): boolean
  base?: string
}

const MAX_BODY_BYTES = 16 * 1024 // sync 体只有开关/状态/标题/颜色，极小

function json(res: Res, code: number, body: unknown): void {
  res.statusCode = code
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}

interface BodyReq extends Req {
  on(event: string, cb: (chunk: Buffer) => void): unknown
}

function readBody(req: Req): Promise<Uint8Array> {
  const stream = req as BodyReq
  if (typeof stream.on !== 'function') return Promise.resolve(new Uint8Array(0))
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    let settled = false
    const done = (fn: () => void): void => { if (!settled) { settled = true; fn() } }
    stream.on('data', (c) => {
      size += c.length
      if (size > MAX_BODY_BYTES) { done(() => reject(new Error('请求体超过上限'))) ; return }
      chunks.push(c)
    })
    stream.on('end', () => done(() => resolve(new Uint8Array(Buffer.concat(chunks)))))
  })
}

export function createFloaterRoutes(deps: FloaterRoutesDeps): Route[] {
  const base = deps.base ?? '/we-sync/floater'
  const status = (): unknown => ({ supported: deps.supported(), ...deps.hub.status() })

  const route: Route = { kind: 'exact', path: base, handler: async (req, res) => {
    if (req.method === 'GET' || req.method === undefined || req.method === '') {
      return json(res, 200, status())
    }
    if (req.method !== 'POST') {
      return json(res, 405, { error: 'method not allowed' })
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(new TextDecoder().decode(await readBody(req))) as unknown
    } catch (e) {
      return json(res, 400, { error: '请求体非法: ' + ((e as Error).message ?? e) })
    }
    const sync = parseSync(parsed)
    if (sync === null) return json(res, 400, { error: '字段非法：需 enabled:boolean 与 state:visible|hidden|unloading' })
    deps.hub.sync(sync)
    return json(res, 200, status())
  } }

  return [route]
}
