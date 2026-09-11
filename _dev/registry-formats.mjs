// 带重试地取 PR 格式（raw 失败时回落 API contents 的 base64）
const T = 15000
async function getRaw(url, tries = 2) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': 'dsh-registry' }, signal: AbortSignal.timeout(T) })
      if (r.ok) return { ok: true, text: await r.text() }
      if (r.status === 404) return { ok: false, status: 404 }
    } catch (e) { /* retry */ }
    await new Promise((res) => setTimeout(res, 700 * (i + 1)))
  }
  return { ok: false, status: 'fail' }
}
async function getApi(repo, path, tries = 2) {
  const url = `https://api.github.com/repos/${repo}/contents/${path}`
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': 'dsh-registry' }, signal: AbortSignal.timeout(T) })
      if (r.ok) {
        const j = await r.json()
        if (Array.isArray(j)) return { ok: true, json: j }
        if (j.content) return { ok: true, text: Buffer.from(j.content, 'base64').toString('utf8') }
        return { ok: false, status: 'no content' }
      }
      if (r.status === 404) return { ok: false, status: 404 }
    } catch (e) { /* retry */ }
    await new Promise((res) => setTimeout(res, 700 * (i + 1)))
  }
  return { ok: false, status: 'fail' }
}
const out = []
const log = (s) => out.push(s)

log('===== awesome-dsh-plugin: contributing.md =====')
let r = await getRaw('https://raw.githubusercontent.com/awesome-dsh-plugin/awesome-dsh-plugin/main/contributing.md')
if (!r.ok) r = await getApi('awesome-dsh-plugin/awesome-dsh-plugin', 'contributing.md')
log(r.ok ? r.text.split(/\r?\n/).slice(0, 90).map((l) => '  ' + l).join('\n') : '  取不到: ' + r.status)

log('\n===== awesome-dsh-plugin: data/plugins 样例（挑 ui 类）=====')
const dir = await getApi('awesome-dsh-plugin/awesome-dsh-plugin', 'data/plugins')
if (dir.ok) {
  const names = dir.json.map((f) => f.name)
  log(`  条目数=${names.length}；含我方: ${names.some((n) => /YRN-playmaker/i.test(n))}`)
  const samples = dir.json.slice(0, 2)
  for (const f of samples) {
    const y = await getRaw(f.download_url)
    log(`  --- ${f.name} ---`)
    log(y.ok ? y.text.split(/\r?\n/).map((l) => '    ' + l).join('\n') : '    取不到')
  }
} else log('  ' + dir.status)

log('\n===== AdamPlatin123: PLUGINS.md 表格格式 =====')
let p = await getRaw('https://raw.githubusercontent.com/AdamPlatin123/awesome-dsh-plugins/main/PLUGINS.md')
if (!p.ok) p = await getApi('AdamPlatin123/awesome-dsh-plugins', 'PLUGINS.md')
log(p.ok ? p.text.split(/\r?\n/).slice(0, 26).map((l) => '  ' + l).join('\n') : '  取不到: ' + p.status)

log('\n===== AdamPlatin123: CATALOGING.md 分类 =====')
let c = await getRaw('https://raw.githubusercontent.com/AdamPlatin123/awesome-dsh-plugins/main/docs/CATALOGING.md')
if (!c.ok) c = await getApi('AdamPlatin123/awesome-dsh-plugins', 'docs/CATALOGING.md')
log(c.ok ? c.text.split(/\r?\n/).slice(0, 70).map((l) => '  ' + l).join('\n') : '  取不到: ' + c.status)

console.log(out.join('\n'))
