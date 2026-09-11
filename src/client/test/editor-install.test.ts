import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EditorInstaller } from '../../editor/installer.ts'
import { createEditorRoutes } from '../../editor/routes.ts'

const html = '<!doctype html><title>editor fixture</title>'
const source = { url: 'https://example.invalid/editor.html', sha256: createHash('sha256').update(html).digest('hex') }
async function fixture(t: test.TestContext, fetcher: typeof fetch) {
  const dir = await mkdtemp(join(tmpdir(), 'wallpaper-editor-test-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return { dir, installer: new EditorInstaller(dir, source, fetcher) }
}
test('first install persists, survives restart and avoids duplicate downloads', async t => {
  let count = 0
  const { dir, installer } = await fixture(t, async () => { count++; await new Promise(r => setTimeout(r, 20)); return new Response(html) })
  assert.equal((await installer.status()).installed, false)
  await Promise.all([installer.install(), installer.install(), installer.install()])
  assert.equal(count, 1)
  assert.equal((await installer.status()).installed, true)
  await installer.install(); assert.equal(count, 1)
  assert.equal((await new EditorInstaller(dir, source).content())?.toString(), html)
})
test('failed integrity leaves no executable and permits retry; tampering invalidates cache', async t => {
  let valid = false
  const { dir, installer } = await fixture(t, async () => new Response(valid ? html : 'damaged'))
  await assert.rejects(installer.install(), /校验失败/)
  assert.deepEqual(await readdir(dir), [])
  assert.equal((await installer.status()).installing, false)
  valid = true; await installer.install()
  await writeFile(join(dir, 'editor-0.2.0.html'), 'tampered')
  assert.equal(await installer.content(), null)
  await installer.install(); assert.equal((await installer.status()).installed, true)
})
test('network and oversized downloads do not become installed', async t => {
  const { installer } = await fixture(t, async () => new Response('unavailable', { status: 503 }))
  await assert.rejects(installer.install(), /503/)
  const big = await fixture(t, async () => new Response(new Uint8Array(8 * 1024 * 1024 + 1)))
  await assert.rejects(big.installer.install(), /大小限制/)
  assert.equal((await big.installer.status()).installed, false)
})
function response() { return { statusCode: 0, headers: {} as Record<string, string>, body: undefined as unknown, setHeader(k: string, v: string) { this.headers[k] = v }, end(b?: unknown) { this.body = b } } }
test('routes require an explicit same-origin POST; GET only reads', async t => {
  let downloads = 0
  const { installer } = await fixture(t, async () => { downloads++; return new Response(html) })
  const [state, app] = createEditorRoutes(installer)
  for (const headers of [{}, { origin: 'https://evil.invalid', host: 'localhost:4319', 'x-wallpaper-editor': 'install' }, { origin: 'http://localhost:4319', host: 'localhost:4319' }]) {
    const res = response(); await state.handler({ method: 'POST', headers }, res); assert.equal(res.statusCode, 403)
  }
  let res = response(); await state.handler({ method: 'GET' }, res); assert.equal(res.statusCode, 200); assert.equal(downloads, 0)
  res = response(); await app.handler({ method: 'GET' }, res); assert.equal(res.statusCode, 404)
  res = response(); await state.handler({ method: 'POST', headers: { origin: 'http://localhost:4319', host: 'localhost:4319', 'x-wallpaper-editor': 'install' } }, res)
  assert.equal(res.statusCode, 200); assert.equal(downloads, 1)
  res = response(); await app.handler({ method: 'GET' }, res); assert.equal(res.statusCode, 200); assert.equal(String(res.body), html)
  assert.match(res.headers['Content-Security-Policy'], /frame-ancestors 'self'/)
})
