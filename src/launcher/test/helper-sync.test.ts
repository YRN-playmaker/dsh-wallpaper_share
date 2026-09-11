import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runInNewContext } from 'node:vm'
import { HELPER_SYNC_SCRIPT } from '../helper-sync.ts'

// 139 助手：document.cookie 里的 authorization 命中 plausible139 校验后 POST /139auth；
// 同值去重；卡巴斯基 URL 等杂讯一律拒发。
async function run139(cookie: string) {
  const sent: Array<{ url: string; data: string; onload: (r: unknown) => void }> = []
  const timers: Array<() => void> = []
  const context = {
    location: { hostname: 'yun.139.com' },
    document: { cookie, createElement: () => ({ style: {}, remove() {} }), body: { appendChild() {} } },
    window: {},
    XMLHttpRequest: function () {},
    GM_cookie: { list() {} },
    GM_xmlhttpRequest(request: { url: string; data: string; onload: (r: unknown) => void }) {
      sent.push(request)
      request.onload({ status: 200, responseText: '{}' })
    },
    GM_registerMenuCommand() {}, GM_getValue() { return '' }, GM_setValue() {},
    setTimeout(fn: () => void) { timers.push(fn) }, setInterval() {},
  }
  runInNewContext(HELPER_SYNC_SCRIPT, context)
  return { sent, timers }
}

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
