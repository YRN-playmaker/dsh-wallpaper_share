import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateRawSync } from 'node:zlib'
import { LauncherInstaller, LauncherError, buildArchiveArgs, isPasswordErrorOutput, writeBytesSafe } from '../installer.ts'
import { createLauncherRoutes, dataUrlToBytes, type Req, type Res, type Route } from '../routes.ts'
import { Yun139Error } from '../yun139.ts'
import { integrityOf, verifyIntegrity } from '../../market/integrity.ts'
import { fallbackCardPng } from '../png.ts'

// —— 测试用最小 zip 写入器（stored=0），与 market/test/unzip.test.ts 独立同构 ——
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })()
function crc32(b: Uint8Array): number { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0 }
function buildZip(files: Array<{ name: string; data: Uint8Array; deflate?: boolean }>): Uint8Array {
  const parts: Uint8Array[] = []; const cds: Uint8Array[] = []; let off = 0
  for (const f of files) {
    const nb = new TextEncoder().encode(f.name); const crc = crc32(f.data)
    const comp = f.deflate ? new Uint8Array(deflateRawSync(Buffer.from(f.data))) : f.data
    const method = f.deflate ? 8 : 0
    const lfh = new Uint8Array(30); const lv = new DataView(lfh.buffer)
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(8, method, true)
    lv.setUint32(14, crc, true); lv.setUint32(18, comp.length, true); lv.setUint32(22, f.data.length, true); lv.setUint16(26, nb.length, true)
    parts.push(lfh, nb, comp)
    const cdh = new Uint8Array(46); const cv = new DataView(cdh.buffer)
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(10, method, true)
    cv.setUint32(16, crc, true); cv.setUint32(20, comp.length, true); cv.setUint32(24, f.data.length, true); cv.setUint16(28, nb.length, true); cv.setUint32(42, off, true)
    cds.push(new Uint8Array(Buffer.concat([Buffer.from(cdh), Buffer.from(nb)])))
    off += lfh.length + nb.length + comp.length
  }
  const cd = new Uint8Array(Buffer.concat(cds.map(Buffer.from)))
  const eocd = new Uint8Array(22); const ev = new DataView(eocd.buffer)
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true)
  ev.setUint32(12, cd.length, true); ev.setUint32(16, off, true)
  return new Uint8Array(Buffer.concat([...parts, cd, eocd].map(Buffer.from)))
}

const enc = (s: string): Uint8Array => new TextEncoder().encode(s)

/** 复合文件夹具：媒体数据垫底 + 完整 zip（模拟分享圈「视频+zip」套娃包）。 */
function buildPolyglotZip(files: Array<{ name: string; data: Uint8Array }>): Uint8Array {
  const media = new Uint8Array([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70]) // ftyp 头
  const inner = buildZip(files)
  return new Uint8Array(Buffer.concat([Buffer.from(media), Buffer.from(inner)]))
}

// —— 测试用假响应（FetchLike）——
function fakeRes(bytes: Uint8Array, opts: { status?: number; fileName?: string } = {}) {
  return {
    ok: (opts.status ?? 200) < 400,
    status: opts.status ?? 200,
    headers: { get: (n: string) => (n.toLowerCase() === 'content-disposition' ? (opts.fileName !== undefined ? `attachment; filename="${opts.fileName}"` : null) : null) },
    arrayBuffer: async () => bytes.slice().buffer,
  }
}

function mkInstaller(): { installer: LauncherInstaller; root: string } {
  const root = mkdtempSync(join(tmpdir(), 'wesync-launcher-'))
  return { installer: new LauncherInstaller({ root, now: () => '2026-01-01T00:00:00Z' }), root }
}

// ── png.ts ─────────────────────────────────────────────────────────────

test('fallbackCardPng：产出合法 PNG（签名 + 尺寸段）', () => {
  const png = fallbackCardPng('测试 App')
  assert.deepEqual([...png.slice(0, 8)], [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
  assert.equal(view.getUint32(8, false), 13)           // IHDR 长度
  assert.equal(view.getUint32(16, false), 640)         // width
  assert.equal(view.getUint32(20, false), 360)         // height
})

// ── installer：slug / 探测 / 解包 ──────────────────────────────────────

test('slugify：非法字符剔除、空白转连字符', () => {
  const { installer } = mkInstaller()
  assert.equal(installer.slugify('My Game: v1.2?*'), 'my-game-v1.2')
  assert.equal(installer.slugify('  '), 'app')
})

test('detectEntryCandidates：根目录 game.exe 排第一，uninstall/setup 靠后', () => {
  const { installer } = mkInstaller()
  const cands = installer.detectEntryCandidates([
    'redist/vcredist_x64.exe',
    'uninstall.exe',
    'game.exe',
    'data/readme.txt',
  ])
  assert.equal(cands[0], 'game.exe')
  assert.ok(cands.includes('redist/vcredist_x64.exe'))
})

test('unzipToDir：正常解包 + 顶层包装目录扁平化', () => {
  const { installer, root } = mkInstaller()
  const zip = buildZip([
    { name: 'My Game v1.0/', data: new Uint8Array(0) },
    { name: 'My Game v1.0/game.exe', data: enc('MZ...') },
    { name: 'My Game v1.0/data/config.json', data: enc('{}') },
  ])
  const dir = join(root, 'wrap-test')
  const written = installer.unzipToDir(zip, dir)
  assert.deepEqual(written.sort(), ['data/config.json', 'game.exe'])
  assert.ok(existsSync(join(dir, 'game.exe')))
  assert.ok(existsSync(join(dir, 'data', 'config.json')))
})

test('unzipToDir：路径穿越条目被拒绝', () => {
  const { installer, root } = mkInstaller()
  const zip = buildZip([{ name: '../evil.exe', data: enc('x') }])
  assert.throws(() => installer.unzipToDir(zip, join(root, 'evil-test')), LauncherError)
})

test('unzipToDir：跳过 __MACOSX 噪声', () => {
  const { installer, root } = mkInstaller()
  const zip = buildZip([
    { name: 'app/game.exe', data: enc('MZ') },
    { name: '__MACOSX/app/._game.exe', data: enc('junk') },
  ])
  const written = installer.unzipToDir(zip, join(root, 'noise-test'))
  assert.deepEqual(written, ['game.exe'])
})

// ── installer：下载 ────────────────────────────────────────────────────

test('download：非 http(s) 协议拒绝', async () => {
  const { installer } = mkInstaller()
  await assert.rejects(() => installer.download('ftp://example.com/a.zip'), /http\(s\)/)
})

test('download：HTTP 404 报错', async () => {
  const { installer } = mkInstaller()
  installer['fetchFn'] = async () => fakeRes(new Uint8Array(0), { status: 404 })
  await assert.rejects(() => installer.download('https://x/a.zip'), /404/)
})

test('download：文件名取自 Content-Disposition 并解码', async () => {
  const { installer } = mkInstaller()
  installer['fetchFn'] = async () => fakeRes(enc('data'), { fileName: 'My%20Game.zip' })
  const { fileName } = await installer.download('https://x/get?file=1')
  assert.equal(fileName, 'My Game.zip')
})

// ── 完整安装流程（走 routes，注入假 fetch）────────────────────────────

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

function mkRoutes() {
  const root = mkdtempSync(join(tmpdir(), 'wesync-launcher-routes-'))
  const zipBytes = buildZip([
    { name: 'CoolTool/game.exe', data: enc('MZ-cool') },
    { name: 'CoolTool/readme.txt', data: enc('hi') },
  ])
  const installer = new LauncherInstaller({
    root,
    fetchFn: async (url) => fakeRes(zipBytes, { fileName: 'CoolTool.zip' }),
  })
  const routes = new Map(createLauncherRoutes({ installer }).map((r) => [r.path, r]))
  return { root, installer, routes, zipBytes }
}

const bodyOf = (res: FakeRes) => JSON.parse(res.body as string) as Record<string, unknown>

test('routes/install：zip 自动解包 → project.json + 索引 + 候选列表', async () => {
  const { routes, root } = mkRoutes()
  const res = fakeResShim()
  await routes.get('/we-sync/launcher/install')!.handler(
    fakeBodyReq('/we-sync/launcher/install', Buffer.from(JSON.stringify({ url: 'https://x/CoolTool.zip' }))),
    res,
  )
  assert.equal(res.statusCode, 200)
  const body = bodyOf(res)
  const rec = body.record as { id: string; slug: string; file: string; title: string }
  assert.equal(rec.id, 'cooltool')
  assert.equal(rec.file, 'game.exe')
  assert.equal(rec.title, 'CoolTool')
  // project.json 落盘且同构
  const project = JSON.parse(readFileSync(join(root, 'cooltool', 'project.json'), 'utf8')) as Record<string, unknown>
  assert.equal(project.type, 'application')
  assert.equal(project.file, 'game.exe')
  assert.ok(existsSync(join(root, 'cooltool', 'preview.png')))
  // 候选只有 game.exe
  assert.deepEqual(body.candidates, ['game.exe'])
})

test('routes/install：无 exe → 422 且目录被清理', async () => {
  const root = mkdtempSync(join(tmpdir(), 'wesync-launcher-422-'))
  const installer = new LauncherInstaller({
    root,
    fetchFn: async () => fakeRes(buildZip([{ name: 'docs/readme.txt', data: enc('no exe') }])),
  })
  const routes = new Map(createLauncherRoutes({ installer }).map((r) => [r.path, r]))
  const res = fakeResShim()
  await routes.get('/we-sync/launcher/install')!.handler(
    fakeBodyReq('/we-sync/launcher/install', Buffer.from(JSON.stringify({ url: 'https://x/docs.zip' }))),
    res,
  )
  assert.equal(res.statusCode, 422)
  assert.ok(!existsSync(join(root, 'docs')))
})

test('routes：installed → entry 切换 → uninstall 清理', async () => {
  const root = mkdtempSync(join(tmpdir(), 'wesync-launcher-mix-'))
  const installer = new LauncherInstaller({
    root,
    fetchFn: async () => fakeRes(buildZip([
      { name: 'run.exe', data: enc('MZ-a') },
      { name: 'setup.exe', data: enc('MZ-b') },
    ]), { fileName: 'multi.zip' }),
  })
  const routes = new Map(createLauncherRoutes({ installer }).map((r) => [r.path, r]))
  const call = async (path: string, req?: Req): Promise<FakeRes> => {
    const res = fakeResShim()
    // Map 以纯路径为 key，查询串不能带进去
    const clean = path.slice(0, path.indexOf('?') < 0 ? path.length : path.indexOf('?'))
    await routes.get(clean)!.handler(req ?? { url: path, method: 'GET' }, res)
    return res
  }
  // 安装（setup.exe 排 game 之后？两个都是根级：run.exe 在前）
  const inst = await call('/we-sync/launcher/install', fakeBodyReq('/we-sync/launcher/install', Buffer.from(JSON.stringify({ url: 'https://x/multi.zip' }))))
  assert.equal(inst.statusCode, 200)
  assert.equal((bodyOf(inst).record as { file: string }).file, 'run.exe')
  // 用户切换入口到 setup.exe
  const set = await call('/we-sync/launcher/entry', fakeBodyReq('/we-sync/launcher/entry', Buffer.from(JSON.stringify({ id: 'multi', file: 'setup.exe' }))))
  assert.equal(set.statusCode, 200)
  assert.equal((bodyOf(set).record as { file: string }).file, 'setup.exe')
  // installed 反映
  const list = await call('/we-sync/launcher/installed')
  assert.equal(((bodyOf(list).installed as Array<{ file: string }>)[0]).file, 'setup.exe')
  // 卸载
  const rm = await call('/we-sync/launcher/uninstall?id=multi')
  assert.equal(rm.statusCode, 200)
  assert.ok(!existsSync(join(root, 'multi')))
  const after = await call('/we-sync/launcher/installed')
  assert.equal((bodyOf(after).installed as unknown[]).length, 0)
})

test('routes/preview：dataURL 回传覆盖预览图', async () => {
  const { routes, root } = mkRoutes()
  await routes.get('/we-sync/launcher/install')!.handler(
    fakeBodyReq('/we-sync/launcher/install', Buffer.from(JSON.stringify({ url: 'https://x/CoolTool.zip' }))),
    fakeResShim(),
  )
  const png = fallbackCardPng('custom')
  const dataUrl = 'data:image/png;base64,' + Buffer.from(png).toString('base64')
  const res = fakeResShim()
  await routes.get('/we-sync/launcher/preview')!.handler(
    fakeBodyReq('/we-sync/launcher/preview', Buffer.from(JSON.stringify({ id: 'cooltool', dataUrl }))),
    res,
  )
  assert.equal(res.statusCode, 200)
  assert.deepEqual([...readFileSync(join(root, 'cooltool', 'preview.png'))], [...png])
})

test('dataUrlToBytes：合法/非法输入', () => {
  assert.equal(dataUrlToBytes('data:image/png;base64,aGVsbG8=')?.mime, 'image/png')
  assert.equal(dataUrlToBytes('data:text/html;base64,aGVsbG8='), null)
  assert.equal(dataUrlToBytes('not-a-data-url'), null)
})

// ── 加密 zip（ZipCrypto）安装流：密码三态 ─────────────────────────────
// 加密侧夹具（与 crypt-zip.test.ts 独立同构，交叉验证实现）

function zipCryptoEncrypt(password: string, plain: Uint8Array, checkByte: number): Uint8Array {
  let key0 = 0x12345678, key1 = 0x23456789, key2 = 0x34567890
  const upd = (b: number): void => {
    key0 = CRC[(key0 ^ b) & 0xFF]! ^ (key0 >>> 8)
    key1 = (key1 + (key0 & 0xFF)) >>> 0
    key1 = (Math.imul(key1, 134775813) + 1) >>> 0
    key2 = CRC[(key2 ^ (key1 >>> 24)) & 0xFF]! ^ (key2 >>> 8)
  }
  const pw = Buffer.from(password, 'utf-8')
  for (let i = 0; i < pw.length; i++) upd(pw[i]!)
  const header = new Uint8Array(12)
  for (let i = 0; i < 11; i++) header[i] = 0x5A // 固定伪随机头（测试确定性）
  header[11] = checkByte
  const out = new Uint8Array(12 + plain.length)
  for (let i = 0; i < 12 + plain.length; i++) {
    const src = i < 12 ? header[i]! : plain[i - 12]!
    const temp = (key2 | 2) >>> 0
    const c = src ^ ((Math.imul(temp, temp ^ 1) >>> 8) & 0xFF)
    out[i] = c
    upd(src)
  }
  return out
}

/** ZipCrypto 加密 zip（stored + flags bit0|bit3=0x9）；bit3 置位 → 校验字节走本地头 modtime 高字节。 */
function buildEncZip(files: Array<{ name: string; data: Uint8Array }>, password: string): Uint8Array {
  const parts: Uint8Array[] = []; const cds: Uint8Array[] = []; let off = 0
  const TIME = 0x6000
  const FLAGS = 0x9
  for (const f of files) {
    const nb = new TextEncoder().encode(f.name)
    const crc = crc32(f.data)
    const stored = zipCryptoEncrypt(password, f.data, (TIME >>> 8) & 0xFF)
    const lfh = new Uint8Array(30); const lv = new DataView(lfh.buffer)
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, FLAGS, true)
    lv.setUint16(8, 0, true); lv.setUint16(10, TIME, true)
    lv.setUint32(14, crc, true); lv.setUint32(18, stored.length, true); lv.setUint32(22, f.data.length, true)
    lv.setUint16(26, nb.length, true)
    parts.push(lfh, nb, stored)
    const cdh = new Uint8Array(46); const cv = new DataView(cdh.buffer)
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true)
    cv.setUint16(8, FLAGS, true); cv.setUint16(10, 0, true); cv.setUint16(12, TIME, true)
    cv.setUint32(16, crc, true); cv.setUint32(20, stored.length, true); cv.setUint32(24, f.data.length, true)
    cv.setUint16(28, nb.length, true); cv.setUint32(42, off, true)
    cds.push(new Uint8Array(Buffer.concat([Buffer.from(cdh), Buffer.from(nb)])))
    off += lfh.length + nb.length + stored.length
  }
  const cd = new Uint8Array(Buffer.concat(cds.map(Buffer.from)))
  const eocd = new Uint8Array(22); const ev = new DataView(eocd.buffer)
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true)
  ev.setUint32(12, cd.length, true); ev.setUint32(16, off, true)
  return new Uint8Array(Buffer.concat([...parts, cd, eocd].map(Buffer.from)))
}

const ENC_PW = 'pw-测试-123'

function mkEncRoutes(): { routes: Map<string, Route>; root: string } {
  const root = mkdtempSync(join(tmpdir(), 'wesync-launcher-enc-'))
  const zipBytes = buildEncZip([
    { name: 'SecretApp/game.exe', data: enc('MZ-secret') },
    { name: 'SecretApp/readme.txt', data: enc('top secret') },
  ], ENC_PW)
  const installer = new LauncherInstaller({
    root,
    fetchFn: async () => fakeRes(zipBytes, { fileName: 'SecretApp.zip' }),
  })
  return { routes: new Map(createLauncherRoutes({ installer }).map((r) => [r.path, r])), root }
}

test('routes/install：加密 zip 无密码 → 422 password_required 且目录清理', async () => {
  const { routes, root } = mkEncRoutes()
  const res = fakeResShim()
  await routes.get('/we-sync/launcher/install')!.handler(
    fakeBodyReq('/we-sync/launcher/install', Buffer.from(JSON.stringify({ url: 'https://x/SecretApp.zip' }))),
    res,
  )
  assert.equal(res.statusCode, 422)
  assert.equal(bodyOf(res).code, 'password_required')
  assert.ok(!existsSync(join(root, 'secretapp')))
})

test('routes/install：加密 zip 正确密码 → 200 完整入库', async () => {
  const { routes, root } = mkEncRoutes()
  const res = fakeResShim()
  await routes.get('/we-sync/launcher/install')!.handler(
    fakeBodyReq('/we-sync/launcher/install', Buffer.from(JSON.stringify({ url: 'https://x/SecretApp.zip', password: ENC_PW }))),
    res,
  )
  assert.equal(res.statusCode, 200)
  const rec = bodyOf(res).record as { id: string; file: string }
  assert.equal(rec.id, 'secretapp')
  assert.equal(rec.file, 'game.exe')
  assert.ok(existsSync(join(root, 'secretapp', 'game.exe')))
  // 密码不落盘：project.json 与 installed.json 均不含密码
  const project = readFileSync(join(root, 'secretapp', 'project.json'), 'utf8')
  const index = readFileSync(join(root, 'installed.json'), 'utf8')
  assert.ok(!project.includes(ENC_PW))
  assert.ok(!index.includes(ENC_PW))
})

test('routes/install：加密 zip 错误密码 → 422 wrong_password', async () => {
  const { routes, root } = mkEncRoutes()
  const res = fakeResShim()
  await routes.get('/we-sync/launcher/install')!.handler(
    fakeBodyReq('/we-sync/launcher/install', Buffer.from(JSON.stringify({ url: 'https://x/SecretApp.zip', password: 'wrong' }))),
    res,
  )
  assert.equal(res.statusCode, 422)
  assert.equal(bodyOf(res).code, 'wrong_password')
  assert.ok(!existsSync(join(root, 'secretapp')))
})

// ── 139 分享链接 → 适配器换直链 → 伪装后缀 zip 全流程 ─────────────────

test('routes/install：139 分享 URL 经适配器换直链，.mp4 名字的 zip 靠魔数识别', async () => {
  const root = mkdtempSync(join(tmpdir(), 'wesync-launcher-139-'))
  // 注意字节是 zip（PK 开头）但文件名叫 video.mp4 —— 魔数检测必须赢过扩展名
  const zipBytes = buildZip([
    { name: 'Tool/game.exe', data: enc('MZ-139') },
    { name: 'Tool/readme.txt', data: enc('hi') },
  ])
  const seen: string[] = []
  const installer = new LauncherInstaller({
    root,
    fetchFn: async (url) => { seen.push(url); return fakeRes(zipBytes) },
  })
  let resolvedWith: { url: string; passcode?: string } | undefined
  const routes = new Map(createLauncherRoutes({
    installer,
    yun139: {
      async resolve(shareUrl, passcode) {
        resolvedWith = { url: shareUrl, passcode }
        return { downloadUrl: 'https://download-jy.yun.139.com/real?sig=1', fileName: 'video.mp4', size: zipBytes.length }
      },
    },
  }).map((r) => [r.path, r]))
  const res = fakeResShim()
  await routes.get('/we-sync/launcher/install')!.handler(
    fakeBodyReq('/we-sync/launcher/install', Buffer.from(JSON.stringify({
      url: 'https://yun.139.com/shareweb/#/w/i/2xop5jp4Q3v5s',
      password: 'x6mh',
      title: 'Movie Tool',
    }))),
    res,
  )
  assert.equal(res.statusCode, 200, JSON.stringify(bodyOf(res)))
  const resolved: { url: string; passcode?: string } | undefined = resolvedWith
  // 适配器收到分享 URL + 提取码（复用密码框）
  assert.equal(resolved?.url, 'https://yun.139.com/shareweb/#/w/i/2xop5jp4Q3v5s')
  assert.equal(resolved?.passcode, 'x6mh')
  // 下载走换来的直链
  assert.deepEqual(seen, ['https://download-jy.yun.139.com/real?sig=1'])
  // 伪装后缀 zip 正常解包入库（PK 魔数优先于 .mp4 扩展名）
  const rec = bodyOf(res).record as { id: string; file: string }
  assert.equal(rec.id, 'movie-tool')
  assert.equal(rec.file, 'game.exe')
  assert.ok(existsSync(join(root, 'movie-tool', 'game.exe')))
})

test('routes/install：提取码（passcode）与解压密码（password）分离，缺省回落兼容旧调用', async () => {
  const root = mkdtempSync(join(tmpdir(), 'wesync-launcher-pc-'))
  const zipBytes = buildZip([{ name: 'app/tool.exe', data: enc('MZ') }])
  const installer = new LauncherInstaller({
    root,
    fetchFn: async () => fakeRes(zipBytes),
  })
  let resolvedWith: { url: string; passcode?: string } | undefined
  const routes = new Map(createLauncherRoutes({
    installer,
    yun139: {
      async resolve(shareUrl, passcode) {
        resolvedWith = { url: shareUrl, passcode }
        return { downloadUrl: 'https://download-jy.yun.139.com/real2', fileName: 'app.mp4', size: zipBytes.length }
      },
    },
  }).map((r) => [r.path, r]))
  // 显式双字段：提取码只进 139 解析，解压密码只进解包（此处包未加密，二者无需相等）
  const res = fakeResShim()
  await routes.get('/we-sync/launcher/install')!.handler(
    fakeBodyReq('/we-sync/launcher/install', Buffer.from(JSON.stringify({
      url: 'https://yun.139.com/shareweb/#/w/i/abc',
      passcode: 'x6mh',
      password: 'unzip-secret',
    }))),
    res,
  )
  assert.equal(res.statusCode, 200, JSON.stringify(bodyOf(res)))
  assert.equal(resolvedWith?.passcode, 'x6mh', '提取码透传给 139 解析')
  // 旧调用兼容：只传 password 时它同时充当提取码
  const res2 = fakeResShim()
  await routes.get('/we-sync/launcher/install')!.handler(
    fakeBodyReq('/we-sync/launcher/install', Buffer.from(JSON.stringify({
      url: 'https://yun.139.com/shareweb/#/w/i/abc',
      password: 'x6mh',
    }))),
    res2,
  )
  assert.equal(res2.statusCode, 200)
  assert.equal(resolvedWith?.passcode, 'x6mh', '未传 passcode 时回落 password')
})

test('routes/install：139 适配器报错 → 422 透传 code 与 API 原文', async () => {
  const root = mkdtempSync(join(tmpdir(), 'wesync-launcher-139err-'))
  const installer = new LauncherInstaller({ root, fetchFn: async () => { throw new Error('不应发起下载') } })
  const routes = new Map(createLauncherRoutes({
    installer,
    yun139: { async resolve() { throw new Yun139Error('share_api_error', '139 API /token 业务错误 code=9999: 分享已过期') } },
  }).map((r) => [r.path, r]))
  const res = fakeResShim()
  await routes.get('/we-sync/launcher/install')!.handler(
    fakeBodyReq('/we-sync/launcher/install', Buffer.from(JSON.stringify({ url: 'https://yun.139.com/shareweb/#/w/i/dead' }))),
    res,
  )
  assert.equal(res.statusCode, 422)
  assert.equal(bodyOf(res).code, 'share_api_error')
  assert.match(bodyOf(res).error as string, /分享已过期/)
})

test('routes/139-helper：油猴助手脚本可下载（Tampermonkey 识别头）', async () => {
  const root = mkdtempSync(join(tmpdir(), 'wesync-launcher-helper-'))
  const installer = new LauncherInstaller({ root })
  const routes = new Map(createLauncherRoutes({ installer }).map((r) => [r.path, r]))
  const res = fakeResShim()
  await routes.get('/we-sync/139-helper.user.js')!.handler({ url: '/we-sync/139-helper.user.js', method: 'GET', headers: {} }, res)
  assert.equal(res.statusCode, 200)
  const text = String(res.body)
  assert.match(text, /^\/\/ ==UserScript==/)
  assert.match(text, /@match\s+https:\/\/yun\.139\.com\/\*/)
  assert.match(text, /139auth/)
})

test('routes/139auth：垃圾登录态（如 Kaspersky 同名 cookie）拒收；有效值可存', async () => {  const root = mkdtempSync(join(tmpdir(), 'wesync-launcher-auth139-'))
  const store = new Map<string, string>()
  const installer = new LauncherInstaller({ root })
  const routes = new Map(createLauncherRoutes({
    installer,
    cred139: { read: () => store.get('a') ?? '', write: (v) => { store.set('a', v) } },
  }).map((r) => [r.path, r]))
  const post = async (value: string): Promise<FakeRes> => {
    const res = fakeResShim()
    await routes.get('/we-sync/launcher/139auth')!.handler(
      fakeBodyReq('/we-sync/launcher/139auth', Buffer.from(JSON.stringify({ authorization: value }))),
      res,
    )
    return res
  }
  // Kaspersky URL 垃圾 → 422 且不落存储
  const bad = await post('https://gc.kis.v2.scr.kaspersky-labs.com/cc4a1d1c-cfc7-4d6f/')
  assert.equal(bad.statusCode, 422)
  assert.match(String(bad.body), /不是有效的 139 登录态/)
  assert.equal(store.size, 0)
  // 有效 b64 三元组 → 200 落存储
  const good = await post(Buffer.from('basic:13800138000:tok').toString('base64'))
  assert.equal(good.statusCode, 200)
  assert.equal(store.get('a'), Buffer.from('basic:13800138000:tok').toString('base64'))
  // 空串 = 清除，始终放行
  const clear = await post('')
  assert.equal(clear.statusCode, 200)
  assert.equal(store.get('a'), '')
})

test('routes/install：复合文件（视频+zip 内含嵌套 zip）靠尾部 EOCD 识别并逐层解包', async () => {
  const root = mkdtempSync(join(tmpdir(), 'wesync-launcher-poly-'))
  // 三层：MP4 垫底 + zip(内含 inner.zip) + inner.zip(内含 Tool/game.exe)
  const innermost = buildZip([{ name: 'Tool/game.exe', data: enc('MZ-poly') }])
  const midZip = buildZip([{ name: 'inner.zip', data: innermost }])
  const polyZip = buildPolyglotZip([{ name: 'inner.zip', data: midZip }])
  const installer = new LauncherInstaller({ root, fetchFn: async () => fakeRes(polyZip, { fileName: 'movie.mp4' }) })
  const routes = new Map(createLauncherRoutes({ installer }).map((r) => [r.path, r]))
  const res = fakeResShim()
  await routes.get('/we-sync/launcher/install')!.handler(
    fakeBodyReq('/we-sync/launcher/install', Buffer.from(JSON.stringify({
      url: 'https://cdn.example.com/movie.mp4', // 直链（测解包逻辑本身；139 复合包同路径）
      title: 'Poly Tool',
    }))),
    res,
  )
  assert.equal(res.statusCode, 200, JSON.stringify(bodyOf(res)))
  const rec = bodyOf(res).record as { id: string; file: string }
  assert.equal(rec.id, 'poly-tool')
  assert.equal(rec.file, 'game.exe')
  assert.ok(existsSync(join(root, 'poly-tool', 'game.exe')), '内层 exe 应经两次嵌套解包落盘（顶层目录扁平化）')
  assert.ok(!existsSync(join(root, 'poly-tool', 'inner.zip')), '内层包体应在解开后删除')
})

test('installer/download：CDN 非法 Content-Length（HTTP 解析错误）→ 自动带 Range 头重试成功', async () => {
  const root = mkdtempSync(join(tmpdir(), 'wesync-download-retry-'))
  const zip = buildZip([{ name: 'a.txt', data: enc('retry') }])
  let calls = 0
  let retryHadRange = false
  const installer = new LauncherInstaller({
    root,
    fetchFn: async (_url, init) => {
      calls++
      if (calls === 1) {
        const e = new Error('fetch failed')
        ;(e as { cause?: unknown }).cause = new Error('Parse Error: Invalid content-length')
        throw e
      }
      retryHadRange = init?.headers?.Range === 'bytes=0-'
      return fakeRes(zip)
    },
  })
  const dl = await installer.download('https://cdn.example.com/a.zip')
  assert.equal(calls, 2)
  assert.equal(retryHadRange, true)
  assert.equal(dl.bytes.length, zip.length)
})

test('routes/install：安装失败时错误完整落日志（无密码/凭据），面板可读到详细消息', async () => {
  const root = mkdtempSync(join(tmpdir(), 'wesync-install-log-'))
  const installer = new LauncherInstaller({ root, fetchFn: async () => { throw new Error('boom for log test') } })
  const routes = new Map(createLauncherRoutes({ installer }).map((r) => [r.path, r]))
  const res = fakeResShim()
  await routes.get('/we-sync/launcher/install')!.handler(
    fakeBodyReq('/we-sync/launcher/install', Buffer.from(JSON.stringify({ url: 'https://x/pkg.zip', password: 'SECRET-pw', passcode: 'SECRET-code' }))),
    res,
  )
  assert.equal(res.statusCode, 400)
  assert.match(String(res.body), /下载请求失败.*boom for log test/)
  // 日志落在安装根的上一级（storages 目录），含错误详情但不含密码
  const logPath = join(root, '..', 'we-sync-install-errors.log')
  assert.ok(existsSync(logPath), '日志文件应存在')
  const logText = readFileSync(logPath, 'utf8')
  assert.match(logText, /boom for log test/)
  assert.match(logText, /https:\/\/x\/pkg\.zip/)
  assert.ok(!logText.includes('SECRET-pw'), '解压密码不得进日志')
  assert.ok(!logText.includes('SECRET-code'), '提取码不得进日志')
})

test('installer/find7zStart：「视频垫底+7z 追加」复合文件定位 7z 段起点', () => {
  const inst = new LauncherInstaller({ root: tmpdir() })
  const sig = Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])
  // 头部魔数 → 0
  assert.equal(inst.find7zStart(Buffer.concat([sig, Buffer.alloc(100)])), 0)
  // 2MB 媒体垫底 + 7z 签名 → 偏移命中
  assert.equal(inst.find7zStart(Buffer.concat([Buffer.alloc(2 * 1024 * 1024, 0xab), sig, Buffer.alloc(64)])), 2 * 1024 * 1024)
  // 无签名小文件 / 大文件 → -1
  assert.equal(inst.find7zStart(Buffer.alloc(64, 0x00)), -1)
  assert.equal(inst.find7zStart(Buffer.alloc(2048, 0x00)), -1)
})

test('integrityOf：分块喂哈希（大文件 >2GiB 场景，chunkSize 注入验证与整体一致）', () => {
  const data = new Uint8Array(5 * 1024 * 1024)
  for (let i = 0; i < data.length; i++) data[i] = (i * 31 + 7) & 0xff
  const whole = integrityOf(data)
  const chunked = integrityOf(data, 1024 * 1024)
  assert.equal(chunked, whole)
  assert.match(chunked, /^sha512-[A-Za-z0-9+/=]+$/)
})

test('installer/writeBytesSafe：分块写入与读取回一致（>chunkSize 走多块路径）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wesync-write-'))
  const target = join(dir, 'big.bin')
  const data = new Uint8Array(5 * 1024 * 1024)
  for (let i = 0; i < data.length; i++) data[i] = (i * 7 + 13) & 0xff
  writeBytesSafe(target, data, 1024 * 1024) // 1MiB 块 → 5 块
  const back = readFileSync(target)
  assert.equal(back.length, data.length)
  assert.deepEqual([...back.subarray(0, 1024)], [...data.subarray(0, 1024)])
  assert.deepEqual([...back.subarray(-1024)], [...data.subarray(-1024)])
})

test('routes/root：GET 当前根；POST 换根（相对路径 400，绝对路径生效并回调持久化）', async () => {
  const rootA = mkdtempSync(join(tmpdir(), 'wesync-root-a-'))
  const rootB = mkdtempSync(join(tmpdir(), 'wesync-root-b-'))
  const installer = new LauncherInstaller({ root: rootA })
  let persisted = ''
  const routes = new Map(createLauncherRoutes({ installer, onRootChanged: (r) => { persisted = r } }).map((r) => [r.path, r]))
  const res1 = fakeResShim()
  await routes.get('/we-sync/launcher/root')!.handler({ url: '/we-sync/launcher/root', method: 'GET' } as unknown as Req, res1)
  assert.equal(res1.statusCode, 200)
  assert.match(String(res1.body), /root/)

  // 相对路径 → 400（必须是绝对路径）
  const res2 = fakeResShim()
  await routes.get('/we-sync/launcher/root')!.handler(
    fakeBodyReq('/we-sync/launcher/root', Buffer.from(JSON.stringify({ root: 'relative/path' }))),
    res2,
  )
  assert.equal(res2.statusCode, 400)

  // 合法绝对路径 → 生效 + 持久化回调
  const res3 = fakeResShim()
  await routes.get('/we-sync/launcher/root')!.handler(
    fakeBodyReq('/we-sync/launcher/root', Buffer.from(JSON.stringify({ root: rootB }))),
    res3,
  )
  assert.equal(res3.statusCode, 200)
  assert.equal(installer.root, rootB)
  assert.equal(persisted, rootB)
})

test('installer/moveToRoot：已装应用整目录搬入新根，记录随迁 installed.json', () => {
  const rootA = mkdtempSync(join(tmpdir(), 'wesync-move-a-'))
  const rootB = mkdtempSync(join(tmpdir(), 'wesync-move-b-'))
  const zip = buildZip([{ name: 'm.exe', data: Buffer.from([0x4d, 0x5a, 1, 2, 3]) }])
  const installer = new LauncherInstaller({ root: rootA })
  installer.unzipToDir(zip, join(rootA, 'm'), undefined)
  // 直接落索引文件（upsert 是私有 API；list() 从盘上读）
  writeFileSync(join(rootA, 'installed.json'), JSON.stringify([{
    id: 'm', title: 'M', slug: 'm', file: 'm.exe', preview: 'preview.png',
    sourceUrl: 'x', sourceName: 'x.zip', size: 1, sha512: 'sha512-x', installedAt: 't',
  }]), 'utf8')
  const r = installer.moveToRoot(rootB)
  assert.equal(r.moved, 1)
  assert.equal(r.failed.length, 0)
  assert.ok(existsSync(join(rootB, 'm', 'm.exe')))
  assert.ok(!existsSync(join(rootA, 'm')))
  const recs = JSON.parse(readFileSync(join(rootB, 'installed.json'), 'utf8')) as Array<{ id: string }>
  assert.ok(recs.some((x) => x.id === 'm'))
})

test('routes/install：「视频垫底+7z 追加」复合文件 → 走 7z 分支（段偏移），不再单文件直写', async () => {
  const root = mkdtempSync(join(tmpdir(), 'wesync-poly7z-'))
  const sig = Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])
  const poly = Buffer.concat([Buffer.alloc(2 * 1024 * 1024, 0xab), sig, Buffer.alloc(4096, 0xcd)])
  const installer = new LauncherInstaller({ root, fetchFn: async () => fakeRes(poly) })
  const routes = new Map(createLauncherRoutes({ installer }).map((r) => [r.path, r]))
  const res = fakeResShim()
  await routes.get('/we-sync/launcher/install')!.handler(
    fakeBodyReq('/we-sync/launcher/install', Buffer.from(JSON.stringify({ url: 'https://x/game.mp4' }))),
    res,
  )
  const bodyText = String(res.body)
  // 垃圾 7z 数据：本机有解压器 → 「7z 解压失败」；无解压器的机器 → 「未找到 7z」。
  // 两种结果都证明走了 7z 分支（而非单文件直写或误判 zip）
  assert.match(bodyText, /7z 解压失败|未找到 7z/)
  assert.ok(!bodyText.includes('RangeError'), '不得再出现 writeSync 越界')
  assert.ok(!bodyText.includes('包内未找到可执行入口'), '不应走单文件直写分支')
})

test('installer/extract7z：7-Zip 与 Bandizip 双解压器参数风格 + 密码错误判定', () => {
  // 参数风格（实测 bz.exe 7.40 语法）
  assert.deepEqual(buildArchiveArgs('7z', 'a.7z', 'D:/out', 'pw'), ['x', '-y', '-ppw', '-oD:/out', 'a.7z'])
  assert.deepEqual(buildArchiveArgs('bandizip', 'a.7z', 'D:/out', 'pw'), ['x', '-y', '-o:D:/out', '-p:pw', 'a.7z'])
  assert.deepEqual(buildArchiveArgs('bandizip', 'a.7z', 'D:/out'), ['x', '-y', '-o:D:/out', 'a.7z'])
  // 密码判定：7z 英文 / Bandizip 实测输出（ERROR: Password required / Invalid password）
  assert.equal(isPasswordErrorOutput('ERROR: Wrong password : a.7z', 'pw'), true)
  assert.equal(isPasswordErrorOutput('ERROR: Password required', undefined), true)
  assert.equal(isPasswordErrorOutput('ERROR: Invalid password', 'pw'), true)
  assert.equal(isPasswordErrorOutput('ERROR: 密码错误', 'pw'), true)
  assert.equal(isPasswordErrorOutput('ERROR: Password required', 'pw'), true) // 有密码但解压器仍要求 → 也按密码问题报
  assert.equal(isPasswordErrorOutput('ERROR: Cannot open the file', 'pw'), false)
})
