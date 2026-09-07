import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { parse139ShareUrl, normalize139Authorization, Yun139Client, Yun139Error } from '../yun139.ts'

// ── URL 解析 ───────────────────────────────────────────────────────────

test('parse139ShareUrl：标准分享页 / 带查询串 / 非分享链接', () => {
  assert.equal(parse139ShareUrl('https://yun.139.com/shareweb/#/w/i/2xop5jp4Q3v5s'), '2xop5jp4Q3v5s')
  assert.equal(parse139ShareUrl('  https://yun.139.com/shareweb/#/w/i/abcDEF123?from=qq  '), 'abcDEF123')
  assert.equal(parse139ShareUrl('https://example.com/file.zip'), null)
  assert.equal(parse139ShareUrl('https://yun.139.com/shareweb/#/w/f/folderID'), null) // 文件夹路由不匹配
})

// ── 登录态规范化 ───────────────────────────────────────────────────────

test('normalize139Authorization：三种输入形态 → 统一 Basic 头 + 手机号', () => {
  const inner = 'basic:13800138000:tok123'
  const b64 = Buffer.from(inner).toString('base64')
  const a = normalize139Authorization('Basic ' + b64)
  assert.equal(a.account, '13800138000')
  assert.equal(a.header, 'Basic ' + b64)
  const b = normalize139Authorization(b64) // 裸 b64
  assert.equal(b.account, '13800138000')
  const c = normalize139Authorization(inner) // 明文三元组
  assert.equal(c.account, '13800138000')
})

test('normalize139Authorization：垃圾输入 → share_auth_required', () => {
  assert.throws(() => normalize139Authorization('hello'), (e: unknown) => e instanceof Yun139Error && e.code === 'share_auth_required')
  assert.throws(() => normalize139Authorization(''), (e: unknown) => e instanceof Yun139Error && e.code === 'share_auth_required')
})

// ── API 流程（假 fetch 脚本化，AES 信封真实加解密）────────────────────

const KEY = Buffer.from('PVGDwmcvfs1uV3d1', 'utf-8')
function envEnc(obj: unknown): string {
  const data = Buffer.from(JSON.stringify(obj), 'utf-8')
  const pad = 16 - (data.length % 16)
  const padded = Buffer.concat([data, Buffer.alloc(pad, pad)])
  const iv = randomBytes(16)
  const cipher = createCipheriv('aes-128-cbc', KEY, iv)
  return Buffer.concat([iv, cipher.update(padded), cipher.final()]).toString('base64')
}
function envDec(b64: string): string {
  const raw = Buffer.from(String(b64).replace(/\s+/g, ''), 'base64')
  const decipher = createDecipheriv('aes-128-cbc', KEY, raw.subarray(0, 16))
  let out = Buffer.concat([decipher.update(raw.subarray(16)), decipher.final()])
  const pad = out[out.length - 1]!
  if (pad >= 1 && pad <= 16 && pad < out.length) {
    let valid = true
    for (let i = out.length - pad; i < out.length; i++) { if (out[i] !== pad) { valid = false; break } }
    if (valid) out = out.subarray(0, out.length - pad)
  }
  return out.toString('utf-8')
}
interface ScriptedCall { url: string; bodyPlain: unknown; auth?: string }
function scriptClient(steps: Array<{ match: string; reply: (call: ScriptedCall) => { status?: number; body: unknown } }>, auth = ''): { client: Yun139Client; calls: ScriptedCall[] } {
  const calls: ScriptedCall[] = []
  const client = new Yun139Client({
    getAuth: () => auth,
    fetchFn: async (url, init) => {
      const bodyPlain = JSON.parse(envDec(init?.body ?? '')) as unknown
      const a = init?.headers.Authorization
      calls.push({ url, bodyPlain, auth: a })
      const step = steps.find((s) => url.includes(s.match))
      if (step === undefined) return { ok: false, status: 404, text: async () => 'no step for ' + url }
      const r = step.reply({ url, bodyPlain, auth: a })
      return { ok: (r.status ?? 200) < 400, status: r.status ?? 200, text: async () => envEnc(r.body) }
    },
  })
  return { client, calls }
}

const SHARE = 'https://yun.139.com/shareweb/#/w/i/2xop5jp4Q3v5s'
const ok = (data: unknown) => ({ resultCode: '0', desc: '', data })

test('resolve：匿名 + passwd 提取码 → 元数据 → 登录态拿直链（请求体信封契约）', async () => {
  const authB64 = Buffer.from('basic:13800138000:tk').toString('base64')
  const { client, calls } = scriptClient([
    {
      match: 'getOutLinkInfoV6',
      reply: (call) => {
        const req = (call.bodyPlain as Record<string, Record<string, unknown>>).getOutLinkInfoReq
        if (req.passwd !== 'x6mh') return { body: { resultCode: '9188', desc: '提取码非法', data: null } }
        return { body: ok({ caLst: null, coLst: [{ coID: 'cid-9', coName: 'movie.mp4', coType: 3, coSize: 1024 }] }) }
      },
    },
    {
      match: 'dlFromOutLinkV3',
      reply: (call) => {
        const req = (call.bodyPlain as Record<string, Record<string, unknown>>).dlFromOutLinkReqV3
        if (req.account !== '13800138000') return { body: { resultCode: '200000401', desc: '用户账号鉴权失败', data: null } }
        return { body: ok({ downloadURL: 'https://download-jy.yun.139.com/file?sig=x', extInfo: {} }) }
      },
    },
  ], authB64)
  const meta = await client.resolve(SHARE, 'x6mh')
  assert.equal(meta.downloadUrl, 'https://download-jy.yun.139.com/file?sig=x')
  assert.equal(meta.fileName, 'movie.mp4')
  assert.equal(meta.size, 1024)
  // 列表请求不带 Authorization（匿名）；下载请求带 Basic 头 + account 三元组解出手机号
  assert.equal(calls[0]!.auth, undefined)
  assert.equal(calls[1]!.auth, 'Basic ' + authB64)
  const dlReq = (calls[1]!.bodyPlain as Record<string, Record<string, unknown>>).dlFromOutLinkReqV3
  assert.equal(dlReq.linkID, '2xop5jp4Q3v5s')
  assert.deepEqual(dlReq.coIDLst, { item: ['cid-9'] })
})

test('resolve：无提取码报 9188 → 映射 share_passcode_required；错误提取码 → share_passcode_wrong', async () => {
  const { client } = scriptClient([
    { match: 'getOutLinkInfoV6', reply: () => ({ body: { resultCode: '9188', desc: '提取码非法', data: null } }) },
  ])
  await assert.rejects(() => client.resolve(SHARE), (e: unknown) => e instanceof Yun139Error && e.code === 'share_passcode_required')
  const { client: c2 } = scriptClient([
    { match: 'getOutLinkInfoV6', reply: () => ({ body: { resultCode: '9188', desc: '提取码非法', data: null } }) },
  ])
  await assert.rejects(() => c2.resolve(SHARE, 'bad'), (e: unknown) => e instanceof Yun139Error && e.code === 'share_passcode_wrong')
})

test('resolve：无登录态调下载 → share_auth_required（含操作指引）', async () => {
  const { client } = scriptClient([
    { match: 'getOutLinkInfoV6', reply: () => ({ body: ok({ caLst: null, coLst: [{ coID: 'c1', coName: 'a.zip', coSize: 1 }] }) }) },
  ])
  await assert.rejects(() => client.resolve(SHARE, 'x6mh'), (e: unknown) => e instanceof Yun139Error && e.code === 'share_auth_required' && /Authorization/.test(e.message))
})

test('resolve：200000401 → share_auth_required；多文件 → share_not_file', async () => {
  const authB64 = Buffer.from('basic:13800138000:tk').toString('base64')
  const { client } = scriptClient([
    { match: 'getOutLinkInfoV6', reply: () => ({ body: ok({ caLst: null, coLst: [{ coID: 'c1', coName: 'a.zip', coSize: 1 }] }) }) },
    { match: 'dlFromOutLinkV3', reply: () => ({ body: { resultCode: '200000401', desc: 'IP鉴权失败、用户账号鉴权失败', data: null } }) },
  ], authB64)
  await assert.rejects(() => client.resolve(SHARE, 'x6mh'), (e: unknown) => e instanceof Yun139Error && e.code === 'share_auth_required')
  const { client: c2 } = scriptClient([
    { match: 'getOutLinkInfoV6', reply: () => ({ body: ok({ caLst: null, coLst: [{ coID: 'a', coName: 'one.zip', coSize: 1 }, { coID: 'b', coName: 'two.zip', coSize: 2 }] }) }) },
  ])
  await assert.rejects(() => c2.resolve(SHARE, 'x6mh'), (e: unknown) => e instanceof Yun139Error && e.code === 'share_not_file' && /two\.zip/.test(e.message))
})

test('listOutLink：响应密文解不开 → share_api_error 带原文片段', async () => {
  const bad = new Yun139Client({
    fetchFn: async () => ({ ok: true, status: 200, text: async () => 'not-an-envelope' }),
  })
  await assert.rejects(() => bad.listOutLink('x'), (e: unknown) => e instanceof Yun139Error && /解密失败/.test(e.message))
})
