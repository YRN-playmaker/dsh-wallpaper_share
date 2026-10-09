import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runInNewContext } from 'node:vm'
import { HELPER_SYNC_SCRIPT } from '../helper-sync.ts'
import { readFileSync } from 'node:fs'

// 139 助手：document.cookie 里的 authorization 命中 plausible139 校验后 POST /139auth；
// 同值去重；卡巴斯基 URL 等杂讯一律拒发。
async function run139(cookie: string, status = 200, gmCookie = '') {
  const sent: Array<{ url: string; data: string; onload: (r: unknown) => void }> = []
  const timers: Array<() => void> = []
  const menus = new Map<string, () => void | Promise<void>>()
  const clipboard: string[] = []
  const context = {
    location: { hostname: 'yun.139.com' },
    document: { cookie, createElement: () => ({ style: {}, remove() {} }), body: { appendChild() {} } },
    window: {},
    XMLHttpRequest: function () {},
    GM_cookie: { list(_opts: unknown, cb: (items: { value: string }[], error: null) => void) { cb(gmCookie ? [{ value: gmCookie }] : [], null) } },
    GM_xmlhttpRequest(request: { url: string; data: string; onload: (r: unknown) => void }) {
      sent.push(request)
      request.onload({ status, responseText: '{}' })
    },
    GM_registerMenuCommand(name: string, fn: () => void | Promise<void>) { menus.set(name, fn) },
    GM_setClipboard(value: string, _type: string, cb: () => void) { clipboard.push(value); cb() },
    setTimeout(fn: () => void) { timers.push(fn) }, setInterval() {},
  }
  runInNewContext(HELPER_SYNC_SCRIPT, context)
  return { sent, timers, menus, clipboard }
}

test('桌面复制不依赖自动同步成功，也不会自动写入剪贴板；失败后可以重试', async () => {
  const { sent, timers, menus, clipboard } = await run139('authorization=R001:13800138000:test-only', 503)
  timers[0]!()
  assert.equal(clipboard.length, 0)
  await menus.get('复制 139 登录态（用于桌面端粘贴）')!()
  assert.deepEqual(clipboard, ['R001:13800138000:test-only'])
  timers[0]!()
  assert.equal(sent.length, 2)
})

test('复制拒绝无效登录态；被污染的 cookie 可回退有效 HttpOnly 登录态', async () => {
  const invalid = await run139('authorization=https://invalid.example')
  await invalid.menus.get('复制 139 登录态（用于桌面端粘贴）')!()
  assert.equal(invalid.clipboard.length, 0)
  const fallback = await run139('authorization=https://invalid.example', 200, 'R001:13800138000:test-only')
  await fallback.menus.get('复制 139 登录态（用于桌面端粘贴）')!()
  assert.deepEqual(fallback.clipboard, ['R001:13800138000:test-only'])
})

test('公开安装脚本与服务端脚本一致，不将登录态保存到油猴存储', () => {
  assert.equal(readFileSync(new URL('../../../tools/login-sync.user.js', import.meta.url), 'utf8'), HELPER_SYNC_SCRIPT)
  assert.doesNotMatch(HELPER_SYNC_SCRIPT, /GM_setValue|GM_getValue/)
  assert.match(HELPER_SYNC_SCRIPT, /@grant\s+GM_setClipboard/)
})

test('139 助手：合法 authorization 同步到 /139auth，同值去重', async () => {
  const { sent, timers } = await run139('authorization=R001:13800138000:tok123')
  timers[0]!() // setTimeout(pollFallback139, 2000)
  await new Promise((r) => setImmediate(r))
  assert.equal(sent.length, 1)
  assert.match(sent[0]!.url, /\/we-sync\/launcher\/139auth$/)
  assert.equal(JSON.parse(sent[0]!.data).authorization, 'R001:13800138000:tok123')
  timers[0]!() // 再触发一次：同值应被去重
  await new Promise((r) => setImmediate(r))
  assert.equal(sent.length, 1)
})

test('139 助手：卡巴斯基注入的同名 authorization（URL）被拒发', async () => {
  const { sent, timers } = await run139('authorization=http://gc.kis.v2.scr.kaspersky-labs.com/x')
  timers[0]!()
  await new Promise((r) => setImmediate(r))
  assert.equal(sent.length, 0)
})

test('助手脚本已不含百度分支（@match/端点/BDUSS 全清除）', () => {
  assert.equal(/pan\.baidu\.com/.test(HELPER_SYNC_SCRIPT), false)
  assert.equal(/baiduauth/.test(HELPER_SYNC_SCRIPT), false)
  assert.equal(/BDUSS/.test(HELPER_SYNC_SCRIPT), false)
  assert.match(HELPER_SYNC_SCRIPT, /@match\s+https:\/\/yun\.139\.com\/\*/)
})
