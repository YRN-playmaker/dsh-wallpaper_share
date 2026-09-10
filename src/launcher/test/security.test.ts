/**
 * launcher 安全回归（2026-09-10 复核 P1-1 / P1-2 / P1-3 / P1-4 的守门测试）。
 * 每个用例都对应一条**曾经真实可穿透**的路径：
 *   · slugify('.') / slugify('..') → 拼出安装根本身或上一级，配合"重装先删旧目录"删掉别人的数据；
 *   · installed.json 被手改出的脏 slug（`../victim`）→ rmSync 越界；
 *   · "启动"路由用字符串前缀比较判断包含性 → `../x.exe` 轻松通过；
 *   · 重装先删旧目录再解压 → 新包坏了，旧应用连存档一起消失，索引却还留着记录；
 *   · moveToRoot 把"同一目录的另一种写法"当成目标已存在 → 先删目标（其实是源）→ 应用当场消失。
 * 断言都落在**盘上真实状态**上（目录还在不在、文件还在不在），而不是只看返回值。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import {
  LauncherInstaller, LauncherError, isLauncherInternalDir,
  assertSafeRelPath, assertInside, resolveEntryInside, samePath,
} from '../installer.ts'
import { createLauncherRoutes, type Req, type Res, type Route } from '../routes.ts'

// —— 最小 zip 写入器（stored），与 launcher.test.ts 独立同构 ——
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 } return t })()
function crc32(b: Uint8Array): number { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0 }
function buildZip(files: Array<{ name: string; data: Uint8Array }>): Uint8Array {
  const parts: Uint8Array[] = []; const cds: Uint8Array[] = []; let off = 0
  for (const f of files) {
    const nb = new TextEncoder().encode(f.name); const crc = crc32(f.data)
    const comp = f.data
    const lfh = new Uint8Array(30); const lv = new DataView(lfh.buffer)
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(8, 0, true)
    lv.setUint32(14, crc, true); lv.setUint32(18, comp.length, true); lv.setUint32(22, f.data.length, true); lv.setUint16(26, nb.length, true)
    parts.push(lfh, nb, comp)
    const cdh = new Uint8Array(46); const cv = new DataView(cdh.buffer)
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(10, 0, true)
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

function fakeRes(bytes: Uint8Array, fileName = 'pkg.zip') {
  return {
    ok: true, status: 200,
    headers: { get: (n: string) => (n.toLowerCase() === 'content-disposition' ? `attachment; filename="${fileName}"` : null) },
    arrayBuffer: async () => bytes.slice().buffer,
  }
}

function tmpRoot(tag: string): string { return mkdtempSync(join(tmpdir(), `wesync-sec-${tag}-`)) }
function mkInstaller(tag: string): { root: string; installer: LauncherInstaller } {
  const root = tmpRoot(tag)
  return { root, installer: new LauncherInstaller({ root, now: () => '2026-01-01T00:00:00Z' }) }
}

interface FakeRes extends Res { headers: Record<string, string>; body: unknown }
function fakeResShim(): FakeRes {
  return { statusCode: 0, headers: {}, body: undefined, setHeader(k, v) { this.headers[k] = v }, end(b) { this.body = b } }
}
interface BodyShim extends Req { on(event: string, cb: (c?: Buffer | unknown) => void): unknown }
function fakeBodyReq(url: string, body: unknown): BodyShim {
  const handlers = new Map<string, Array<(c?: Buffer | unknown) => void>>()
  const req: BodyShim = {
    url, method: 'POST',
    on(event, cb) { (handlers.get(event) ?? handlers.set(event, []).get(event)!).push(cb); return req },
  }
  queueMicrotask(() => {
    for (const cb of handlers.get('data') ?? []) cb(Buffer.from(JSON.stringify(body)))
    for (const cb of handlers.get('end') ?? []) cb()
  })
  return req
}
function routesOf(installer: LauncherInstaller): Map<string, Route> {
  return new Map(createLauncherRoutes({ installer }).map((r) => [r.path, r]))
}
const stagingLeft = (root: string): string[] => readdirSync(root).filter((n) => n.startsWith('.staging-'))
const backupsLeft = (root: string): string[] => readdirSync(root).filter((n) => n.includes('.backup-'))

// ── slugify / appDir：目录名不可逃逸 ───────────────────────────────────

test('slugify：`.` / `..` / 纯点号 → 不再拼出安装根或上一级', () => {
  const { installer } = mkInstaller('slug')
  assert.equal(installer.slugify('.'), 'app')
  assert.equal(installer.slugify('..'), 'app')
  assert.equal(installer.slugify('...'), 'app')
  assert.equal(installer.slugify('  '), 'app')
  assert.equal(installer.slugify(''), 'app')
  assert.equal(installer.slugify('a/../..'), 'a')
})

test('slugify：Windows 保留名与结尾点/空格被改写', () => {
  const { installer } = mkInstaller('slug2')
  assert.equal(installer.slugify('CON'), 'con-app')
  assert.equal(installer.slugify('nul'), 'nul-app')
  assert.equal(installer.slugify('COM1'), 'com1-app')
  assert.equal(installer.slugify('lpt9'), 'lpt9-app')
  assert.equal(installer.slugify('Game. '), 'game')
  assert.equal(installer.slugify('My  Game??'), 'my-game')
})

test('appDir：拒绝 `..` / 绝对路径 / 盘符，以及指向安装根自身的写法', () => {
  const { root, installer } = mkInstaller('appdir')
  for (const bad of ['..', '../evil', 'a/../..', 'C:/Windows', '/etc', '\\evil']) {
    assert.throws(() => installer.appDir(bad), LauncherError, `应拒绝: ${bad}`)
  }
  // `.` 归一后就是安装根本身：assertSafeRelPath 拦不住（没有 `..` 段），必须靠 appDir 的 samePath 兜住
  assert.throws(() => installer.appDir('.'), LauncherError)
  assert.throws(() => installer.appDir(''), LauncherError)
  // 正常 slug 仍可用，且严格在根之下
  assert.equal(installer.appDir('cooltool'), join(root, 'cooltool'))
})

test('remove：installed.json 里的脏 slug 不会删到根外的目录', () => {
  const { root, installer } = mkInstaller('dirty')
  const victim = join(root, 'victim')
  mkdirSync(victim, { recursive: true })
  writeFileSync(join(victim, 'keep.txt'), 'KEEP')
  const dirty = [{ id: 'evil', title: 'Evil', slug: '../victim', file: 'x.exe', preview: 'preview.png' }]
  writeFileSync(join(root, 'installed.json'), JSON.stringify(dirty), 'utf8')
  installer.remove('evil')
  assert.ok(existsSync(join(victim, 'keep.txt')), '越界目录必须原样保留')
  assert.equal(installer.list().length, 0, '索引仍应清掉该记录')
  // 其它按 slug 拼路径的入口同样要拦住（而不是 500 之后再删错东西）
  writeFileSync(join(root, 'installed.json'), JSON.stringify(dirty), 'utf8')
  assert.throws(() => installer.setEntry('evil', 'x.exe'), LauncherError)
  assert.throws(() => installer.writePreview('evil', enc('x'), 'image/png'), LauncherError)
  assert.ok(existsSync(join(victim, 'keep.txt')))
})

test('assertSafeRelPath / assertInside：导出的是同一套判据', () => {
  assert.equal(assertSafeRelPath('./a/b.txt'), 'a/b.txt')
  assert.equal(assertSafeRelPath('a\\b.txt'), 'a/b.txt')
  assert.throws(() => assertSafeRelPath('../a'), LauncherError)
  assert.throws(() => assertSafeRelPath('a/../../b'), LauncherError)
  assert.throws(() => assertSafeRelPath('C:/x'), LauncherError)
  assert.throws(() => assertSafeRelPath('/x'), LauncherError)
  const base = join(tmpdir(), 'wesync-inside-base')
  assertInside(base, join(base, 'sub', 'f.txt'))
  assertInside(base, base)
  assert.throws(() => assertInside(base, join(base, '..', 'other')), LauncherError)
  assert.throws(() => assertInside(base, base + '-sibling' + sep + 'x'), LauncherError) // 前缀相同但非子目录
})

// ── resolveEntryInside：启动路由的包含性校验 ───────────────────────────

test('resolveEntryInside：`../x.exe` 之类一律拒绝，合法相对路径原样返回', () => {
  const dir = join(tmpRoot('entry'), 'app')
  mkdirSync(join(dir, 'bin'), { recursive: true })
  writeFileSync(join(dir, 'bin', 'game.exe'), 'MZ')
  const want = join(dir, 'bin', 'game.exe').replace(/\\/g, '/')
  assert.equal(resolveEntryInside(dir, 'bin/game.exe'), want)
  assert.equal(resolveEntryInside(dir, './bin/game.exe'), want)
  for (const bad of ['../x.exe', '..\\x.exe', 'bin/../../x.exe', 'C:/Windows/system32/calc.exe', '/x.exe', '\\x.exe', '', '.']) {
    assert.throws(() => resolveEntryInside(dir, bad), LauncherError, `应拒绝入口: ${JSON.stringify(bad)}`)
  }
})

test('resolveEntryInside：目录联接指向目录外时拒绝', (t) => {
  const base = tmpRoot('entry-link')
  const dir = join(base, 'app')
  const outside = join(base, 'outside')
  mkdirSync(dir, { recursive: true })
  mkdirSync(outside, { recursive: true })
  writeFileSync(join(outside, 'evil.exe'), 'MZ')
  try {
    symlinkSync(outside, join(dir, 'link'), 'junction')
  } catch {
    t.skip('本机不允许创建目录联接（需管理员或开发者模式）')
    return
  }
  assert.throws(() => resolveEntryInside(dir, 'link/evil.exe'), LauncherError)
})

test('samePath：同一位置的不同写法识别为同一路径', () => {
  const root = tmpRoot('same')
  mkdirSync(join(root, 'sub'), { recursive: true })
  assert.equal(samePath(root, root + sep), true)
  assert.equal(samePath(root, join(root, 'sub', '..')), true)
  assert.equal(samePath(join(root, 'sub'), join(root, 'sub')), true)
  assert.equal(samePath(join(root, 'sub'), join(root, 'other')), false)
})

test('moveToRoot：同一目录的不同写法 → 不删源、记录随迁', (t) => {
  if (process.platform !== 'win32') { t.skip('盘符大小写差异只在 Windows 上构成"同一目录"'); return }
  const root = tmpRoot('move')
  const installer = new LauncherInstaller({ root })
  const dir = join(root, 'app')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'game.exe'), 'MZ')
  installer.finalize({ url: 'https://x/a.zip', fileName: 'a.zip', slug: 'app', title: 'App', dir, entry: 'game.exe', size: 2, sha512: 'x' })
  // 盘符大小写**翻转**后的同目录写法（原来是小写就转大写，反之亦然）
  const alt = /^[a-z]:/.test(root)
    ? root.replace(/^([a-z]):/, (_m, d: string) => d.toUpperCase() + ':')
    : root.replace(/^([A-Z]):/, (_m, d: string) => d.toLowerCase() + ':')
  if (alt === root) { t.skip('临时目录路径没有可翻转的盘符'); return }
  const r = installer.moveToRoot(alt)
  assert.deepEqual(r.failed, [])
  assert.equal(r.moved, 1)
  assert.ok(existsSync(join(root, 'app', 'game.exe')), '应用目录必须还在（旧实现会先删"目标"即源）')
  assert.equal(installer.list().length, 1)
})

// ── 安装流程：失败必须"要么旧的、要么新的" ──────────────────────────────

test('routes/install：重装坏包 → 旧应用与存档完好、索引不变、无 .staging 残留', async () => {
  const root = tmpRoot('reinstall')
  let payload = buildZip([{ name: 'CoolTool/game.exe', data: enc('MZ-cool') }])
  const installer = new LauncherInstaller({ root, fetchFn: async () => fakeRes(payload, 'CoolTool.zip') })
  const install = routesOf(installer).get('/we-sync/launcher/install')!

  const ok = fakeResShim()
  await install.handler(fakeBodyReq('/we-sync/launcher/install', { url: 'https://x/CoolTool.zip' }), ok)
  assert.equal(ok.statusCode, 200)
  writeFileSync(join(root, 'cooltool', 'save.dat'), 'SAVE') // 模拟用户存档
  const before = readFileSync(join(root, 'cooltool', 'project.json'), 'utf8')

  // 新包损坏：解出来没有任何可执行入口
  payload = buildZip([{ name: 'CoolTool/docs/readme.txt', data: enc('no exe') }])
  const bad = fakeResShim()
  await install.handler(fakeBodyReq('/we-sync/launcher/install', { url: 'https://x/CoolTool.zip' }), bad)
  assert.equal(bad.statusCode, 422)
  assert.ok(existsSync(join(root, 'cooltool', 'game.exe')), '旧应用本体必须还在')
  assert.ok(existsSync(join(root, 'cooltool', 'save.dat')), '旧应用的存档必须还在')
  assert.equal(readFileSync(join(root, 'cooltool', 'project.json'), 'utf8'), before)
  assert.equal(installer.list().length, 1)
  assert.deepEqual(stagingLeft(root), [], '暂存目录必须清干净')
})

test('routes/install：缺少可执行入口的自定义标题不会波及同名兄弟目录', async () => {
  const root = tmpRoot('sibling')
  let payload = buildZip([{ name: 'Keep/game.exe', data: enc('MZ') }])
  const installer = new LauncherInstaller({ root, fetchFn: async () => fakeRes(payload, 'Keep.zip') })
  const install = routesOf(installer).get('/we-sync/launcher/install')!
  const r1 = fakeResShim()
  await install.handler(fakeBodyReq('/we-sync/launcher/install', { url: 'https://x/Keep.zip', title: 'Keep' }), r1)
  assert.equal(r1.statusCode, 200)
  assert.ok(existsSync(join(root, 'keep', 'game.exe')))

  payload = buildZip([{ name: 'junk/readme.txt', data: enc('no exe') }])
  const r2 = fakeResShim()
  await install.handler(fakeBodyReq('/we-sync/launcher/install', { url: 'https://x/Keep.zip', title: 'Keep' }), r2)
  assert.equal(r2.statusCode, 422)
  assert.ok(existsSync(join(root, 'keep', 'game.exe')), '兄弟目录不能因为失败的安装被删')
  assert.deepEqual(stagingLeft(root), [])
})

test('routes/install：成功安装后不留暂存目录，索引与盘上一致', async () => {
  const root = tmpRoot('commit')
  const installer = new LauncherInstaller({ root, fetchFn: async () => fakeRes(buildZip([{ name: 'game.exe', data: enc('MZ') }]), 'Cool.zip') })
  const res = fakeResShim()
  await routesOf(installer).get('/we-sync/launcher/install')!
    .handler(fakeBodyReq('/we-sync/launcher/install', { url: 'https://x/Cool.zip' }), res)
  assert.equal(res.statusCode, 200)
  assert.deepEqual(stagingLeft(root), [])
  assert.deepEqual(backupsLeft(root), [])
  const rec = installer.list()[0]!
  assert.ok(existsSync(join(installer.appDir(rec.slug), rec.file)))
  assert.ok(existsSync(join(installer.appDir(rec.slug), 'project.json')))
})

test('commitStaging：替换失败 → 回滚旧目录，不留备份', () => {
  const root = tmpRoot('rollback')
  const installer = new LauncherInstaller({ root })
  const dir = join(root, 'app')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'old.txt'), 'OLD')
  // 暂存目录不存在 → rename 必然失败
  assert.throws(() => installer.commitStaging(join(root, '.staging-missing'), dir))
  assert.ok(existsSync(join(dir, 'old.txt')), '旧目录必须被改回原名')
  assert.deepEqual(backupsLeft(root), [], '备份不应残留')
})

test('finalize：commitTo 替换失败 → 索引不写（避免"记录说装了、文件却没了"）', () => {
  const root = tmpRoot('finalize-fail')
  const installer = new LauncherInstaller({ root })
  const staging = installer.createStagingDir()
  const target = join(root, 'nope', 'app') // 父目录不存在 → rename 必失败
  assert.throws(() => installer.finalize({
    url: 'https://x/a.zip', fileName: 'a.zip', slug: 'app', title: 'App',
    dir: staging, commitTo: target, entry: 'a.exe', size: 1, sha512: 's',
  }))
  assert.equal(installer.get('app'), undefined)
  assert.ok(!existsSync(target))
})

test('isLauncherInternalDir：暂存/备份目录不得被当成壁纸目录列举', () => {
  assert.equal(isLauncherInternalDir('.staging-9f3a1c'), true)
  assert.equal(isLauncherInternalDir('.git'), true)
  assert.equal(isLauncherInternalDir('cooltool.backup-1a2b3c'), true)
  assert.equal(isLauncherInternalDir('cooltool'), false)
  assert.equal(isLauncherInternalDir('my.backup.folder'), false)
})

test('routes/uninstall：脏 slug 记录 → 只清索引，不碰根外目录', async () => {
  const root = tmpRoot('uninst')
  const victim = join(root, 'victim')
  mkdirSync(victim, { recursive: true })
  writeFileSync(join(victim, 'keep.txt'), 'KEEP')
  const installer = new LauncherInstaller({ root })
  writeFileSync(join(root, 'installed.json'), JSON.stringify([
    { id: 'evil', title: 'Evil', slug: '../victim', file: 'x.exe', preview: 'preview.png' },
  ]), 'utf8')
  const res = fakeResShim()
  await routesOf(installer).get('/we-sync/launcher/uninstall')!
    .handler({ url: '/we-sync/launcher/uninstall?id=evil', method: 'GET' }, res)
  assert.equal(res.statusCode, 200)
  assert.ok(existsSync(join(victim, 'keep.txt')))
})
