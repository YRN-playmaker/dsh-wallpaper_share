import fs from 'node:fs';
function edit(p,fn){let s=fs.readFileSync(p,'utf8').replace(/\r\n/g,'\n');s=fn(s);fs.writeFileSync(p,s,'utf8')}
edit('src/launcher/helper-sync.ts',s=>{
s=s.replaceAll('2.0.2','2.1.0');
s=s.replace("if (typeof GM_cookie !== 'function')", "if (typeof GM_cookie === 'undefined' || typeof GM_cookie.list !== 'function')");
s=s.replaceAll("if (typeof GM_cookie !== 'function')", "if (typeof GM_cookie === 'undefined' || typeof GM_cookie.list !== 'function')");
s=s.replace("GM_cookie('list', { name: 'authorization' },", "GM_cookie.list({ name: 'authorization' },");
s=s.replace("GM_cookie('list', {},", "GM_cookie.list({ url: 'https://pan.baidu.com/api/gettemplatevariable' },");
s=s.replace("Object.keys(gm).forEach(function (k) { merged[k] = gm[k] })\n      Object.keys(doc).forEach(function (k) { merged[k] = doc[k] })", "Object.keys(doc).forEach(function (k) { merged[k] = doc[k] })\n      Object.keys(gm).forEach(function (k) { merged[k] = gm[k] })");
s=s.replace(' // 主机可见值优先（作用域更准）', ' // 以目标网盘 API 的 Cookie 为准，包括 HttpOnly');
s=s.replace('timeout: 8000', 'timeout: 20000');
s=s.replace('onDone(res.status)', "onDone(res.status, res.responseText)");
s=s.replace("{ cookie: cookie }, function (st) {\n      var ok = st === 200", "{ cookie: cookie, validate: true }, function (st, text) {\n      var result = {}\n      try { result = JSON.parse(text || '{}') } catch (e) {}\n      var ok = st === 200 && result.validated === true");
s=s.replace("toast('✔ 已同步百度网盘登录态到 DSH', true)", "toast('✔ 百度网盘登录态已验证并同步，可以回到壁纸库安装', true)");
s=s.replace("'✘ 百度登录态被 DSH 拒绝（HTTP ' + st + '）'", "(result.error || '✘ 同步未通过验证，请更新助手并重新登录百度网盘')");
s=s.replace('  function pollBaidu() {', "  var lastBaidu = ''\n  var lastBaiduAt = 0\n  var baiduBusy = false\n  function pollBaidu() {\n    if (baiduBusy) return\n    baiduBusy = true");
s=s.replace("if (GM_getValue('baidu_last', '') !== jar) {\n          sendBaidu(jar, true, function (ok) { if (ok) GM_setValue('baidu_last', jar) })\n        }", "if (lastBaidu !== jar || Date.now() - lastBaiduAt > 60000) {\n          sendBaidu(jar, false, function (ok) {\n            baiduBusy = false\n            if (ok) { lastBaidu = jar; lastBaiduAt = Date.now() }\n          })\n        } else { baiduBusy = false }");
s=s.replace('      // 整包都凑不出 BDUSS', '      baiduBusy = false\n      // 整包都凑不出 BDUSS');
s=s.replace("if (ok) GM_setValue('baidu_last', c)", "if (ok) { lastBaidu = c; lastBaiduAt = Date.now() }");
return s;
});
edit('src/launcher/baiduyun.ts',s=>s.replace('  private baseHeaders(cookie: string)', `  /** 验证本次同步的 Cookie，不修改云盘内容。 */
  async validateAuth(raw: string): Promise<void> {
    const cookie = normalizeBaiduCookie(raw)
    const qs = new URLSearchParams({ clienttype: '0', app_id: '250528', web: '1', fields: '["bdstoken"]' })
    const j = await this.getJson('gettemplatevariable', HOST + '/api/gettemplatevariable?' + qs, cookie)
    const err = errnoToError(Number(j.errno ?? -1), 'gettemplatevariable')
    if (err !== null) throw err
    const result = j.result as Record<string, unknown> | undefined
    if (typeof result?.bdstoken !== 'string' || !result.bdstoken) {
      throw new BaiduError('share_auth_required', '请在百度网盘完成登录并进入“我的文件”，助手会自动重试同步')
    }
  }

  private baseHeaders(cookie: string)`));
edit('src/launcher/routes.ts',s=>{
s=s.replace('  credBaidu?: CredStore', '  credBaidu?: CredStore\n  validateBaiduAuth?: (cookie: string) => Promise<void>');
s=s.replace("  const onRootChanged =", "  const validateBaiduAuth = deps.validateBaiduAuth ?? ((cookie: string) => new BaiduClient({ fetchFn: async (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(12000) }) }).validateAuth(cookie))\n  let validatedBaiduCookie = ''\n  let baiduRevision = 0\n  const onRootChanged =");
s=s.replace("{ present: v !== '', account: mask }", "{ present: v !== '', account: mask, validated: v !== '' && v === validatedBaiduCookie, revision: baiduRevision }");
s=s.replace('const opts = body as { cookie?: unknown }', 'const opts = body as { cookie?: unknown; validate?: boolean }');
s=s.replace("    credBaidu.write(v)\n    json(res, 200, { ok: true, present: v !== '' })", `    let normalized = v
    if (v !== '') normalized = normalizeBaiduCookie(v)
    if (normalized !== '' && opts.validate === true) {
      try { await validateBaiduAuth(normalized) } catch (e) {
        return json(res, 422, { error: e instanceof BaiduError ? e.message : '暂时无法验证百度登录态，助手会自动重试', code: e instanceof BaiduError ? e.code : 'share_api_error' })
      }
    }
    credBaidu.write(normalized)
    validatedBaiduCookie = opts.validate === true ? normalized : ''
    baiduRevision++
    json(res, 200, { ok: true, present: normalized !== '', validated: normalized !== '' && normalized === validatedBaiduCookie, revision: baiduRevision })`);
return s;
});
edit('src/client/launcher-api.ts',s=>{
s=s.replace('Promise<{ present: boolean; account: string }> {\n  const res = await fetchFn(\'/we-sync/launcher/baiduauth\'', 'Promise<{ present: boolean; account: string; validated: boolean; revision: number }> {\n  const res = await fetchFn(\'/we-sync/launcher/baiduauth\'');
const start=s.indexOf('export async function getBaiduAuth');const end=s.indexOf('/** 安装位置',start);
let part=s.slice(start,end).replace('account?: string }','account?: string; validated?: boolean; revision?: number }').replace("account: typeof body.account === 'string' ? body.account : '' }", "account: typeof body.account === 'string' ? body.account : '', validated: body.validated === true, revision: body.revision ?? 0 }").replace('JSON.stringify({ cookie })','JSON.stringify({ cookie, validate: true })');
return s.slice(0,start)+part+s.slice(end);
});
edit('src/client/WallpaperSharePanel.tsx',s=>{
const start=s.indexOf('  const onOpenBaiduLogin');const end=s.indexOf('  /** canvas',start);let part=s.slice(start,end);
part=part.replace("window.open('https://pan.baidu.com/',", "window.open('https://pan.baidu.com/disk/main#/index?category=all',");
part=part.replace('    const started = Date.now()', "    const initial = await getBaiduAuth().catch(() => ({ revision: -1 }))\n    const started = Date.now()").replace('if (b.present)', 'if (b.present && b.validated && b.revision !== initial.revision)');
s=s.slice(0,start)+part+s.slice(end);
s=s.replace("launcherBaiduNeed: '百度网盘文件下载需要登录态（BDUSS），请在下方粘贴'", "launcherBaiduNeed: '百度网盘登录态不可用，请点击下方登录按钮，由同步助手自动更新'");
return s;
});