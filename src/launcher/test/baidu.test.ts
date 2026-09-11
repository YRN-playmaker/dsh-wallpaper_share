/**
 * 百度网盘适配器回归（2026-09-10 新增）：全部走 fixture 假 fetch，不发真实请求。
 * 覆盖：链接解析 / Cookie 归一 / resolve 四条路径（直链自带、签名单兜底、提取码、无登录态）
 * 与路由（/baiduauth 存取校验、install 分支把下载头传给 installer）。
 * 真实流量 E2E 需要用户 BDUSS + 带提取码的分享，由使用者验证；errno 契约见 baiduyun.ts 头注。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  parseBaiduShareUrl, normalizeBaiduCookie, bdussOf, baiduFileCredStore,
  BaiduClient, BaiduError, BAIDU_DOWNLOAD_UA,
} from '../baiduyun.ts'
import { LauncherInstaller, LauncherError } from '../installer.ts'
import { createLauncherRoutes, type Req, type Res, type Route } from '../routes.ts'

const enc = (s: string): Uint8Array => new TextEncoder().encode(s)

// —— 最小 zip 写入器（stored=0），与 launcher.test.ts 独立同构 ——
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 } return t })()
function crc32(b: Uint8Array): number { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0 }
function buildZip(files: Array<{ name: string; data: Uint8Array }>): Uint8Array {
  const parts: Uint8Array[] = []; const cds: Uint8Array[] = []; let off = 0
  for (const f of files) {
    const nb = enc(f.name); const crc = crc32(f.data)
    const lfh = new Uint8Array(30); const lv = new DataView(lfh.buffer)
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint32(14, crc, true); lv.setUint32(18, f.data.length, true); lv.setUint32(22, f.data.length, true); lv.setUint16(26, nb.length, true)
    parts.push(lfh, nb, f.data)
    const cdh = new Uint8Array(46); const cv = new DataView(cdh.buffer)
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint32(16, crc, true); cv.setUint32(20, f.data.length, true); cv.setUint32(24, f.data.length, true); cv.setUint16(28, nb.length, true); cv.setUint32(42, off, true)
    cds.push(new Uint8Array(Buffer.concat([Buffer.from(cdh), Buffer.from(nb)])))
    off += lfh.length + nb.length + f.data.length
  }
  const cd = new Uint8Array(Buffer.concat(cds.map(Buffer.from)))
  const eocd = new Uint8Array(22); const ev = new DataView(eocd.buffer)
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true); ev.setUint32(12, cd.length, true); ev.setUint32(16, off, true)
  return new Uint8Array(Buffer.concat([...parts, cd, eocd].map(Buffer.from)))
}

// ── 链接解析 ───────────────────────────────────────────────────────────

test('parseBaiduShareUrl：/s/1<id>、?pwd=、/share/init?surl= 三种形态', () => {
  const withPwd = parseBaiduShareUrl('https://pan.baidu.com/s/1slbWDQxCBpU8F9sfsjaZWA?pwd=ab12')
  assert.deepEqual(withPwd, { surl: 'slbWDQxCBpU8F9sfsjaZWA', pwd: 'ab12' })
  const plain = parseBaiduShareUrl(' https://pan.baidu.com/s/1slbWDQxCBpU8F9sfsjaZWA? ')
  assert.deepEqual(plain, { surl: 'slbWDQxCBpU8F9sfsjaZWA' })
  // 1 开头是 /s/ 链接的固定前缀，surl 是去掉 1 之后的部分
  const init = parseBaiduShareUrl('https://pan.baidu.com/share/init?surl=1slbWDQxCBpU8F9sfsjaZWA')
  assert.deepEqual(init, { surl: 'slbWDQxCBpU8F9sfsjaZWA' })
  const shareInit = parseBaiduShareUrl('https://pan.baidu.com/share/init?surl=slbWDQxCBpU8F9sfsjaZWA')
  assert.deepEqual(shareInit, { surl: 'slbWDQxCBpU8F9sfsjaZWA' })
  assert.equal(parseBaiduShareUrl('https://yun.139.com/shareweb/#/w/i/abc'), null)
  assert.equal(parseBaiduShareUrl('https://example.com/s/1abc'), null)
  assert.equal(parseBaiduShareUrl('不是链接'), null)
})

// ── Cookie 归一 ────────────────────────────────────────────────────────

test('normalizeBaiduCookie：整串 Cookie 只留 BDUSS/STOKEN，裸值补键名，URL 编码解开', () => {
  const bduss = 'A'.repeat(48)
  const stoken = 'B'.repeat(40)
  const full = `HOSUPPORT=1; zhixinhost=1; ${'BDUSS=' + bduss}; STOKEN=${stoken}; BAIDUID=xx`
  assert.equal(normalizeBaiduCookie(full), `BDUSS=${bduss}; STOKEN=${stoken}`)
  assert.equal(normalizeBaiduCookie(bduss), `BDUSS=${bduss}`)
  assert.equal(normalizeBaiduCookie(`BDUSS%3D${bduss}`), `BDUSS=${bduss}`)
  assert.equal(bdussOf(full), bduss)
})

test('normalizeBaiduCookie：拒绝空串 / URL / 过短值（防 Kaspersky 注入杂讯）', () => {
  for (const bad of ['', 'https://pan.baidu.com', 'BDUSS=abc', 'foo=bar', 'http://gc.kis.v2.scr.kaspersky-labs.com/x']) {
    assert.throws(() => normalizeBaiduCookie(bad), BaiduError, `应拒绝: ${bad}`)
  }
})

test('normalizeBaiduCookie：192 位现行 BDUSS / 整行 Cookie: / 引号与折行空白（用户反馈纠偏）', () => {
  const bduss192 = 'F'.repeat(192) // 2026 现行 BDUSS 长度，旧实现 128 上限误拒
  assert.equal(normalizeBaiduCookie(bduss192), `BDUSS=${bduss192}`)
  const stoken = 'B'.repeat(40)
  // F12 请求标头整行复制：Cookie: 前缀 + 杂键 + 折行空白
  const headerLine = `Cookie: BDUSS= ${bduss192};\n STOKEN=${stoken};  BAIDUID=abc`
  assert.equal(normalizeBaiduCookie(headerLine), `BDUSS=${bduss192}; STOKEN=${stoken}`)
  // 引号包裹值（F12 偶见）
  assert.equal(normalizeBaiduCookie(`BDUSS="${bduss192}"`), `BDUSS=${bduss192}`)
  // 裸值内混入折行空白 → 剥掉后放行
  assert.equal(normalizeBaiduCookie(` ${bduss192.slice(0, 96)}\n${bduss192.slice(96)} `), `BDUSS=${bduss192}`)
  // 只有 STOKEN 没有 BDUSS → 拒
  assert.throws(() => normalizeBaiduCookie(`STOKEN=${stoken}`), BaiduError)
})

test('baiduFileCredStore：写读往返（authorization 键，与 139 同结构）', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'wesync-baidu-cred-')), 'baidu-auth.json')
  const store = baiduFileCredStore(path)
  assert.equal(store.read(), '')
  store.write('BDUSS=' + 'A'.repeat(48))
  assert.equal(readFileSync(path, 'utf8').includes('"authorization"'), true)
  assert.ok(store.read().startsWith('BDUSS='))
})

// ── resolve 流程（假 fetch，按阶段回响应）───────────────────────────────

interface ResLike { ok: boolean; status: number; headers: { get(name: string): string | null }; text(): Promise<string> }
type Call = { url: string; init?: { method?: string; headers?: Record<string, string>; body?: string } }

function jsonRes(status: number, body: unknown, headers: Record<string, string> = {}): ResLike {
  return { ok: status < 400, status, headers: { get: (n) => headers[n.toLowerCase()] ?? null }, text: async () => JSON.stringify(body) }
}

/** 组一个按「阶段」回响应的假 fetch：responses 按序消费（wxlist→verify→wxlist→内容页→api/download） */
function stageFetch(responses: Array<Partial<ResLike> | ((c: Call) => ResLike)>): { fetch: BaiduClient['fetchFn']; calls: Call[] } {
  const calls: Call[] = []
  let i = 0
  const fetch: BaiduClient['fetchFn'] = async (url, init) => {
    calls.push({ url, ...(init !== undefined ? { init } : {}) })
    const r = responses[Math.min(i, responses.length - 1)]!
    i++
    if (typeof r === 'function') return r(calls[calls.length - 1]!)
    return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({}), ...r }
  }
  return { fetch, calls }
}

function mkClient(calls: { fetch: BaiduClient['fetchFn'] }): BaiduClient {
  return new BaiduClient({ fetchFn: calls.fetch, getAuth: () => `BDUSS=${'C'.repeat(48)}; STOKEN=${'B'.repeat(40)}` })
}

test('resolve：wxlist 直链自带 → 原样返回 + netdisk UA + 用户 Cookie', async () => {
  const dlink = 'https://d.pcs.baidu.com/file/x?fid=1&dstime=abc'
  const { fetch, calls } = stageFetch([
    jsonRes(200, { errno: 0, list: [{ fs_id: 42, server_filename: 'Tool.zip', size: 123, isdir: 0, dlink }] }),
  ])
  const meta = await mkClient({ fetch }).resolve('https://pan.baidu.com/s/1slbWDQxCBpU8F9sfsjaZWA')
  assert.equal(meta.downloadUrl, dlink)
  assert.equal(meta.fileName, 'Tool.zip')
  assert.equal(meta.size, 123)
  assert.equal(meta.headers['User-Agent'], BAIDU_DOWNLOAD_UA)
  assert.equal(meta.headers.Cookie!.includes('BDUSS='), true)
  assert.equal(calls.length, 1)
  assert.equal(calls[0]!.url.includes('shorturl=slbWDQxCBpU8F9sfsjaZWA'), true)
  assert.equal(calls[0]!.url.includes('root=1'), true)
})

test('resolve：9019 → verify 取 BDCLND → 再列表；无 dlink → 内容页签名单换直链', async () => {
  const html = `<script>window.yunData={sign:'SGN==',timestamp:'1789076447',shareid:'17332921381',share_uk:'3733114755',file_list:{list:[{fs_id:42,server_filename:'Tool.zip'}]}};</script>`
  const { fetch, calls } = stageFetch([
    jsonRes(200, { errno: 9019, errmsg: 'need verify' }),                                          // 第一次 wxlist
    jsonRes(200, { errno: 0 }, { 'set-cookie': 'BDCLND=opFe2%2BxY; path=/; domain=.baidu.com' }),  // verify
    jsonRes(200, { errno: 0, list: [{ fs_id: 42, server_filename: 'Tool.zip', size: 9, isdir: 0 }] }), // 带 BDCLND 再列表
    { ok: true, status: 200, headers: { get: () => null }, text: async () => html },               // 内容页
    jsonRes(200, { errno: 0, dlink: 'https://d.pcs.baidu.com/file/y' }),                            // api/download
  ])
  const meta = await mkClient({ fetch }).resolve('https://pan.baidu.com/s/1slbWDQxCBpU8F9sfsjaZWA?pwd=ab12')
  assert.equal(meta.downloadUrl, 'https://d.pcs.baidu.com/file/y')
  assert.equal(meta.fileName, 'Tool.zip')
  assert.equal(meta.headers.Cookie!.includes('BDCLND=opFe2%2BxY'), true)
  // 验证流程：verify POST 带了提取码；第二次 wxlist 带 BDCLND 且不带 pwd；download POST 带 fid_list
  const verify = calls[1]!
  assert.equal(verify.url.includes('/share/verify?'), true)
  assert.equal(verify.init?.body, 'pwd=ab12')
  const reList = calls[2]!
  assert.equal(reList.url.includes('pwd='), false)
  assert.equal(reList.init?.headers?.Cookie!.includes('BDCLND=opFe2%2BxY'), true)
  const download = calls[4]!
  assert.equal(download.url.includes('/api/download?'), true)
  assert.equal(download.url.includes('sign=SGN%3D%3D') || download.url.includes('sign=SGN=='), true)
  assert.equal(download.init?.body, 'fid_list=%5B42%5D')
})

test('resolve：9019 且无提取码 → share_passcode_required；错误提取码（verify errno 2）→ share_passcode_wrong', async () => {
  const needVerify = stageFetch([jsonRes(200, { errno: 9019 })])
  await assert.rejects(
    mkClient(needVerify).resolve('https://pan.baidu.com/s/1slbWDQxCBpU8F9sfsjaZWA'),
    (e: unknown) => e instanceof BaiduError && e.code === 'share_passcode_required',
  )
  const wrongCode = stageFetch([
    jsonRes(200, { errno: 9019 }),
    jsonRes(200, { errno: 2 }),
  ])
  await assert.rejects(
    mkClient(wrongCode).resolve('https://pan.baidu.com/s/1slbWDQxCBpU8F9sfsjaZWA', '0000'),
    (e: unknown) => e instanceof BaiduError && e.code === 'share_passcode_wrong',
  )
})

test('resolve：未配置登录态 → share_auth_required；文件夹/多文件 → share_not_file', async () => {
  const anon = new BaiduClient({ fetchFn: stageFetch([]).fetch, getAuth: () => '' })
  await assert.rejects(
    anon.resolve('https://pan.baidu.com/s/1slbWDQxCBpU8F9sfsjaZWA'),
    (e: unknown) => e instanceof BaiduError && e.code === 'share_auth_required',
  )
  const folder = stageFetch([jsonRes(200, { errno: 0, list: [{ fs_id: 1, server_filename: '目录', isdir: 1 }] })])
  await assert.rejects(
    mkClient(folder).resolve('https://pan.baidu.com/s/1slbWDQxCBpU8F9sfsjaZWA'),
    (e: unknown) => e instanceof BaiduError && e.code === 'share_not_file',
  )
  const multi = stageFetch([jsonRes(200, { errno: 0, list: [
    { fs_id: 1, server_filename: 'a.zip', isdir: 0 },
    { fs_id: 2, server_filename: 'b.zip', isdir: 0 },
  ] })])
  await assert.rejects(
    mkClient(multi).resolve('https://pan.baidu.com/s/1slbWDQxCBpU8F9sfsjaZWA'),
    (e: unknown) => e instanceof BaiduError && e.code === 'share_not_file',
  )
})

// ── 路由：/baiduauth 与 install 分支 ────────────────────────────────────

interface FakeRes extends Res { headers: Record<string, string>; body: unknown }
function fakeResShim(): FakeRes {
  return { statusCode: 0, headers: {}, body: undefined, setHeader(k, v) { this.headers[k] = v }, end(b) { this.body = b } }
}
interface BodyShim extends Req {
  handlers: Map<string, Array<(c?: Buffer | unknown) => void>>
  on(event: string, cb: (c?: Buffer | unknown) => void): unknown
  write(chunk: Buffer): void
  finish(): void
}
function fakeBodyReq(url: string, body: Buffer): BodyShim {
  const handlers = new Map<string, Array<(c?: Buffer | unknown) => void>>()
  const req: BodyShim = {
    url, method: 'POST', handlers,
    on(event, cb) { (handlers.get(event) ?? handlers.set(event, []).get(event)!).push(cb); return req },
    write(chunk) { for (const cb of handlers.get('data') ?? []) cb(chunk) },
    finish() { for (const cb of handlers.get('end') ?? []) cb() },
  }
  queueMicrotask(() => { req.write(body); req.finish() })
  return req
}
function routesOf(deps: Parameters<typeof createLauncherRoutes>[0]): Map<string, Route> {
  return new Map(createLauncherRoutes(deps).map((r) => [r.path, r]))
}
const bodyOf = (res: FakeRes) => JSON.parse(res.body as string) as Record<string, unknown>

test('routes/baiduauth：保存合法 BDUSS、拒收杂讯、GET 回掩码', async () => {
  const store = new Map<string, string>()
  const routes = routesOf({ installer: new LauncherInstaller({ root: mkdtempSync(join(tmpdir(), 'wesync-baidu-r-')) }), credBaidu: { read: () => store.get('a') ?? '', write: (v) => { store.set('a', v) } } })
  const auth = routes.get('/we-sync/launcher/baiduauth')!
  const bduss = 'D'.repeat(48)
  const save = fakeResShim()
  await auth.handler(fakeBodyReq('/we-sync/launcher/baiduauth', Buffer.from(JSON.stringify({ cookie: `BDUSS=${bduss}; STOKEN=${'B'.repeat(40)}` }))), save)
  assert.equal(save.statusCode, 200)
  assert.equal(store.get('a')!.includes('BDUSS=' + bduss), true)
  const q = fakeResShim()
  await auth.handler({ url: '/we-sync/launcher/baiduauth', method: 'GET', headers: {} }, q)
  assert.equal(bodyOf(q).present, true)
  assert.equal(String(bodyOf(q).account).includes('****'), true)
  const bad = fakeResShim()
  await auth.handler(fakeBodyReq('/we-sync/launcher/baiduauth', Buffer.from(JSON.stringify({ cookie: 'https://example.com' }))), bad)
  assert.equal(bad.statusCode, 422)
  assert.match(String(bad.body), /不是有效的百度网盘登录态/)
  assert.equal(store.get('a')!.includes('BDUSS=' + bduss), true) // 拒收不影响已存值
})

test('routes/baidu-helper：油猴助手脚本可下载（@match pan.baidu.com，POST 打到 baiduauth）', async () => {
  const routes = routesOf({ installer: new LauncherInstaller({ root: mkdtempSync(join(tmpdir(), 'wesync-baidu-helper-')) }) })
  const res = fakeResShim()
  await routes.get('/we-sync/baidu-helper.user.js')!.handler({ url: '/we-sync/baidu-helper.user.js', method: 'GET', headers: {} }, res)
  assert.equal(res.statusCode, 200)
  const text = String(res.body)
  assert.match(text, /^\/\/ ==UserScript==/)
  assert.match(text, /@match\s+https:\/\/pan\.baidu\.com\/\*/)
  assert.match(text, /baiduauth/)
  assert.match(text, /BDUSS/)
})

test('routes/install：百度分享 → resolve 换直链并把下载头传给 installer.download', async () => {
  const seen: Array<{ url: string; headers?: Record<string, string> }> = []
  const zipBytes = buildZip([{ name: 'game.exe', data: enc('MZ-baidu') }])
  const root = mkdtempSync(join(tmpdir(), 'wesync-baidu-install-'))
  const installer = new LauncherInstaller({
    root,
    fetchFn: async (url, init) => {
      seen.push({ url, headers: init?.headers })
      return { ok: true, status: 200, headers: { get: () => null }, arrayBuffer: async () => zipBytes.slice().buffer }
    },
  })
  const routes = routesOf({
    installer,
    baidu: {
      resolve: async () => ({ downloadUrl: 'https://d.pcs.baidu.com/file/x', fileName: 'MyTool.zip', headers: { 'User-Agent': BAIDU_DOWNLOAD_UA, Cookie: 'BDUSS=' + 'C'.repeat(48) } }),
    },
  })
  const res = fakeResShim()
  await routes.get('/we-sync/launcher/install')!.handler(
    fakeBodyReq('/we-sync/launcher/install', Buffer.from(JSON.stringify({ url: 'https://pan.baidu.com/s/1slbWDQxCBpU8F9sfsjaZWA?pwd=ab12' }))),
    res,
  )
  assert.equal(res.statusCode, 200)
  const rec = bodyOf(res).record as { id: string; file: string }
  assert.equal(rec.id, 'mytool')
  assert.equal(rec.file, 'game.exe')
  assert.equal(seen[0]!.url, 'https://d.pcs.baidu.com/file/x')
  assert.equal(seen[0]!.headers?.['User-Agent'], BAIDU_DOWNLOAD_UA)
  assert.equal(seen[0]!.headers?.Cookie, 'BDUSS=' + 'C'.repeat(48))
  assert.ok(existsSync(join(root, 'mytool', 'game.exe')))
})

test('routes/install：百度 resolve 抛 BaiduError → 422 + code 透传', async () => {
  const installer = new LauncherInstaller({ root: mkdtempSync(join(tmpdir(), 'wesync-baidu-err-')) })
  const routes = routesOf({
    installer,
    baidu: { resolve: async () => { throw new BaiduError('share_passcode_required', '该百度网盘分享需要提取码：请在提取码框填入后重试') } },
  })
  const res = fakeResShim()
  await routes.get('/we-sync/launcher/install')!.handler(
    fakeBodyReq('/we-sync/launcher/install', Buffer.from(JSON.stringify({ url: 'https://pan.baidu.com/s/1slbWDQxCBpU8F9sfsjaZWA' }))),
    res,
  )
  assert.equal(res.statusCode, 422)
  const body = bodyOf(res)
  assert.equal(body.code, 'share_passcode_required')
  assert.ok(typeof body.error === 'string' && body.error.includes('提取码'))
})

test('installer.download：init.headers 透传给 fetchFn（百度 dlink 下载头）', async () => {
  const seen: Array<Record<string, string> | undefined> = []
  const installer = new LauncherInstaller({
    root: mkdtempSync(join(tmpdir(), 'wesync-baidu-dl-')),
    fetchFn: async (_url, init) => {
      seen.push(init?.headers)
      return { ok: true, status: 200, headers: { get: () => null }, arrayBuffer: async () => enc('MZ').slice().buffer }
    },
  })
  await installer.download('https://d.pcs.baidu.com/file/x', { headers: { 'User-Agent': BAIDU_DOWNLOAD_UA, Cookie: 'BDUSS=' + 'C'.repeat(48) } })
  assert.equal(seen[0]?.['User-Agent'], BAIDU_DOWNLOAD_UA)
  assert.equal(seen[0]?.Cookie, 'BDUSS=' + 'C'.repeat(48))
  await assert.rejects(() => installer.download('ftp://x'), LauncherError)
})
