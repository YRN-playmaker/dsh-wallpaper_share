import fs from 'node:fs';
fs.writeFileSync('src/launcher/test/helper-sync.test.ts',`import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runInNewContext } from 'node:vm'
import { HELPER_SYNC_SCRIPT } from '../helper-sync.ts'

async function runHelper(status: number, validated: boolean) {
  const sent: Array<{ data: string; onload: (r: unknown) => void }> = []
  const timers: Array<() => void> = []
  const details: unknown[] = []
  const context = {
    location: { hostname: 'pan.baidu.com' },
    document: { cookie: 'STOKEN=stale', createElement: () => ({ style: {}, remove() {} }), body: { appendChild() {} } },
    GM_cookie: { list(opts: unknown, cb: (c: unknown[]) => void) {
      details.push(opts)
      cb([{ name: 'BDUSS', value: 'A'.repeat(48), domain: '.baidu.com' }, { name: 'STOKEN', value: 'valid', domain: 'pan.baidu.com' }])
    } },
    GM_xmlhttpRequest(request: { data: string; onload: (r: unknown) => void }) {
      sent.push(request)
      request.onload({ status, responseText: JSON.stringify({ validated }) })
    },
    GM_registerMenuCommand() {}, GM_getValue() { return 'old' }, GM_setValue() { throw Error('Do not persist cookies in userscript storage') },
    setTimeout() {}, setInterval(fn: () => void) { timers.push(fn) },
  }
  runInNewContext(HELPER_SYNC_SCRIPT, context)
  await new Promise(resolve => setImmediate(resolve))
  return { sent, timers, details }
}

test('auto sync uses object Cookie API and trusts HttpOnly jar over document cookies', async () => {
  const r = await runHelper(200, true)
  assert.equal((r.details[0] as {url: string}).url, 'https://pan.baidu.com/api/gettemplatevariable')
  const payload = JSON.parse(r.sent[0]!.data)
  assert.equal(payload.validate, true)
  assert.ok(payload.cookie.includes('STOKEN=valid'))
  assert.ok(!payload.cookie.includes('stale'))
  r.timers[0]!()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(r.sent.length, 1)
})

test('rejected or old-server unvalidated sync retries instead of marking success', async () => {
  for (const status of [200, 422]) {
    const r = await runHelper(status, false)
    r.timers[0]!()
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(r.sent.length, 2)
  }
})
`,'utf8');
fs.appendFileSync('src/launcher/test/baidu.test.ts',`

test('validated sync rejects stale credentials without overwriting the saved account', async () => {
  let saved = 'BDUSS=' + 'A'.repeat(48)
  let fail = true
  const routes = routesOf({
    installer: new LauncherInstaller({ root: mkdtempSync(join(tmpdir(), 'wesync-baidu-validation-')) }),
    credBaidu: { read: () => saved, write: v => { saved = v } },
    validateBaiduAuth: async () => { if (fail) throw new BaiduError('share_auth_required', 'login expired') },
  })
  const auth = routes.get('/we-sync/launcher/baiduauth')!
  const candidate = 'BDUSS=' + 'B'.repeat(48)
  const post = async () => {
    const res = fakeResShim()
    await auth.handler(fakeBodyReq('/we-sync/launcher/baiduauth', Buffer.from(JSON.stringify({ cookie: candidate, validate: true }))), res)
    return res
  }
  assert.equal((await post()).statusCode, 422)
  assert.equal(saved, 'BDUSS=' + 'A'.repeat(48))
  fail = false
  assert.equal(bodyOf(await post()).validated, true)
  const get = fakeResShim()
  await auth.handler({ method: 'GET' }, get)
  assert.equal(bodyOf(get).validated, true)
  assert.equal(bodyOf(get).revision, 1)
})

test('validateAuth requires a real account token, not only a well-formed cookie', async () => {
  for (const body of [{ errno: -6 }, { errno: 0, result: {} }]) {
    const c = mkClient(stageFetch([jsonRes(200, body)]))
    await assert.rejects(c.validateAuth('BDUSS=' + 'A'.repeat(48)), BaiduError)
  }
  await mkClient(stageFetch([jsonRes(200, { errno: 0, result: { bdstoken: 'TOKEN' } })])).validateAuth('BDUSS=' + 'A'.repeat(48))
})
`,'utf8');