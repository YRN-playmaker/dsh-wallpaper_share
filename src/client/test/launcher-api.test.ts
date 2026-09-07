import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  fetchInstalled, installApp, uninstallApp, launchApp, setEntry, get139Auth, set139Auth,
  isValidHttpUrl, humanSize,
  type Fetch, type InstalledApp,
} from '../launcher-api.ts'

const app: InstalledApp = {
  id: 'cooltool', title: 'CoolTool', slug: 'cooltool', file: 'game.exe', preview: 'preview.png',
  sourceUrl: 'https://x/CoolTool.zip', sourceName: 'CoolTool.zip', size: 1024,
  sha512: 'sha512-abc', installedAt: '2026-01-01T00:00:00Z',
}

function fetchJson(status: number, body: unknown): Fetch {
  return async () => ({ ok: status < 400, status, json: async () => body })
}

const recordCalls = (status: number, body: unknown): { fetchFn: Fetch; calls: Array<{ url: string; init?: { method?: string; body?: string } }> } => {
  const calls: Array<{ url: string; init?: { method?: string; body?: string } }> = []
  const fetchFn: Fetch = async (url, init) => { calls.push({ url, init }); return { ok: status < 400, status, json: async () => body } }
  return { fetchFn, calls }
}

test('fetchInstalled：正常解析 / 非 200 返回空数组', async () => {
  const a = await fetchInstalled(fetchJson(200, { installed: [app] }))
  assert.equal(a.length, 1)
  assert.equal(a[0]!.id, 'cooltool')
  const b = await fetchInstalled(fetchJson(500, { error: 'x' }))
  assert.deepEqual(b, [])
})

test('installApp：POST 体包含 url/title/previewDataUrl；成功带回 record+candidates', async () => {
  const { fetchFn, calls } = recordCalls(200, { ok: true, record: app, candidates: ['game.exe'] })
  const out = await installApp({ url: 'https://x/a.zip', title: 'A', previewDataUrl: 'data:image/png;base64,QQ==' }, fetchFn)
  assert.equal(out.ok, true)
  assert.equal(out.record?.id, 'cooltool')
  assert.deepEqual(out.candidates, ['game.exe'])
  assert.equal(calls[0]!.url, '/we-sync/launcher/install')
  assert.equal(calls[0]!.init?.method, 'POST')
  const sent = JSON.parse(calls[0]!.init?.body ?? '{}') as Record<string, string>
  assert.equal(sent.url, 'https://x/a.zip')
  assert.equal(sent.title, 'A')
  assert.equal(sent.previewDataUrl, 'data:image/png;base64,QQ==')
})

test('installApp：422 无入口 → ok=false + files 样本', async () => {
  const out = await installApp({ url: 'https://x/docs.zip' }, fetchJson(422, { error: '包内未找到可执行入口（.exe/.bat/.cmd）', files: ['readme.txt'] }))
  assert.equal(out.ok, false)
  assert.match(out.error ?? '', /可执行入口/)
  assert.deepEqual(out.files, ['readme.txt'])
})

test('installApp：password 随请求体透传', async () => {
  const { fetchFn, calls } = recordCalls(200, { ok: true, record: app })
  const out = await installApp({ url: 'https://x/s.zip', password: 'pw-测试' }, fetchFn)
  assert.equal(out.ok, true)
  const sent = JSON.parse(calls[0]!.init?.body ?? '{}') as Record<string, string>
  assert.equal(sent.password, 'pw-测试')
})

test('installApp：422 密码语义错误 → code 回传（password_required / wrong_password）', async () => {
  const need = await installApp({ url: 'https://x/e.zip' }, fetchJson(422, { error: '压缩包已加密，需要解压密码', code: 'password_required' }))
  assert.equal(need.ok, false)
  assert.equal(need.code, 'password_required')
  const wrong = await installApp({ url: 'https://x/e.zip', password: 'bad' }, fetchJson(422, { error: '密码错误', code: 'wrong_password' }))
  assert.equal(wrong.ok, false)
  assert.equal(wrong.code, 'wrong_password')
})

test('uninstallApp / launchApp：错误体透传', async () => {
  const un = await uninstallApp('nope', fetchJson(404, { error: '未安装: nope' }))
  assert.equal(un.ok, false)
  assert.match(un.error ?? '', /未安装/)
  const la = await launchApp('nope', fetchJson(400, { error: '该壁纸没有可启动的可执行文件' }))
  assert.equal(la.ok, false)
  const ok = await launchApp('x', fetchJson(200, { launched: true }))
  assert.equal(ok.ok, true)
})

test('setEntry：POST JSON{id,file}', async () => {
  const { fetchFn, calls } = recordCalls(200, { ok: true, record: { ...app, file: 'setup.exe' } })
  const out = await setEntry('cooltool', 'setup.exe', fetchFn)
  assert.equal(out.ok, true)
  const sent = JSON.parse(calls[0]!.init?.body ?? '{}') as Record<string, string>
  assert.deepEqual(sent, { id: 'cooltool', file: 'setup.exe' })
})

test('isValidHttpUrl：http(s) 通过，其它拒绝', () => {
  assert.equal(isValidHttpUrl('https://example.com/a.zip'), true)
  assert.equal(isValidHttpUrl('http://127.0.0.1:3080/a.zip'), true)
  assert.equal(isValidHttpUrl('ftp://example.com/a.zip'), false)
  assert.equal(isValidHttpUrl('not a url'), false)
  assert.equal(isValidHttpUrl('javascript:alert(1)'), false)
})

test('humanSize：分级可读', () => {
  assert.equal(humanSize(0), '0 B')
  assert.equal(humanSize(512), '512 B')
  assert.equal(humanSize(2048), '2.0 KiB')
  assert.equal(humanSize(5 * 1024 * 1024), '5.0 MiB')
  assert.equal(humanSize(3 * 1024 * 1024 * 1024), '3.0 GiB')
})

test('get139Auth / set139Auth：查询掩码与保存', async () => {
  const calls: Array<{ url: string; init?: { method?: string; body?: string } }> = []
  const fetchFn: Fetch = async (url, init) => {
    calls.push({ url, init })
    if (init?.method === 'POST') return { ok: true, status: 200, json: async () => ({ ok: true, present: true }) }
    return { ok: true, status: 200, json: async () => ({ present: true, account: '138****00' }) }
  }
  const a = await get139Auth(fetchFn)
  assert.equal(a.present, true)
  assert.equal(a.account, '138****00')
  assert.equal(calls[0]!.url, '/we-sync/launcher/139auth')
  const s = await set139Auth('Basic abc', fetchFn)
  assert.equal(s.ok, true)
  assert.equal(JSON.parse(calls[1]!.init?.body ?? '{}').authorization, 'Basic abc')
})
