// 抓取各收录站的提交要求 + 校验 GitHub token 权限（token 从环境变量读，不打印）
const OUT = []
function log(s) { OUT.push(s) }

async function getText(url, token) {
  try {
    const r = await fetch(url, { headers: token ? { authorization: `Bearer ${token}`, 'user-agent': 'dsh-registry' } : { 'user-agent': 'dsh-registry' } })
    if (!r.ok) return { ok: false, status: r.status }
    return { ok: true, text: await r.text() }
  } catch (e) { return { ok: false, status: 'ERR ' + e.message } }
}

const token = process.env.GH_TOKEN

log('===== token 权限校验 =====')
if (token) {
  const u = await getText('https://api.github.com/user', token)
  if (u.ok) {
    const j = JSON.parse(u.text)
    log(`  login=${j.login} token 前缀=${token.slice(0, 4)}… 长度=${token.length}`)
  } else log('  /user: ' + u.status)
  const s = await getText('https://api.github.com/repos/YRN-playmaker/dsh-wallpaper_share', token)
  if (s.ok) {
    const j = JSON.parse(s.text)
    log(`  仓库 topics=[${(j.topics || []).join(', ')}] visibility=${j.visibility} stars=${j.stargazers_count}`)
  } else log('  repo: ' + s.status)
  const scopes = await fetch('https://api.github.com/user', { headers: { authorization: `token ${token}`, 'user-agent': 'x' } })
  log(`  响应头 x-oauth-scopes: ${scopes.headers.get('x-oauth-scopes') ?? '(无)'}`)
} else log('  无 GH_TOKEN')

log('\n===== awesome-dsh-plugin：提交要求 =====')
for (const p of ['CONTRIBUTING.md', '.github/CONTRIBUTING.md', 'how-submissions-work.md', 'docs/how-submissions-work.md', '.github/PULL_REQUEST_TEMPLATE.md']) {
  const r = await getText(`https://raw.githubusercontent.com/awesome-dsh-plugin/awesome-dsh-plugin/main/${p}`)
  if (r.ok) {
    log(`  --- ${p} ---`)
    log(r.text.split(/\r?\n/).slice(0, 45).map((l) => '    ' + l).join('\n'))
    break
  } else log(`  ${p}: ${r.status}`)
}

log('\n===== Ephemeral-AI-Lab/dsh-plugins：registry 条目格式 =====')
const reg = await getText('https://api.github.com/repos/Ephemeral-AI-Lab/dsh-plugins/contents/registry/community')
if (reg.ok) {
  const files = JSON.parse(reg.text)
  log('  现有 community 条目: ' + files.slice(0, 8).map((f) => f.name).join(', ') + (files.length > 8 ? ` …共${files.length}` : ''))
  if (files.length) {
    const one = await getText(files[0].download_url)
    if (one.ok) { log(`  --- 示例 ${files[0].name} ---`); log(one.text.split(/\r?\n/).slice(0, 40).map((l) => '    ' + l).join('\n')) }
  }
} else log('  contents API: ' + reg.status)
const sub = await getText('https://raw.githubusercontent.com/Ephemeral-AI-Lab/dsh-plugins/main/README.md')
if (sub.ok) {
  const t = sub.text
  const i = t.indexOf('Submitting a plugin')
  if (i >= 0) log('  --- README 提交段 ---\n' + t.slice(i, i + 1400).split(/\r?\n/).map((l) => '    ' + l).join('\n'))
}

log('\n===== AdamPlatin123/awesome-dsh-plugins：PR 登记清单 =====')
const pr = await getText('https://raw.githubusercontent.com/AdamPlatin123/awesome-dsh-plugins/main/.github/PULL_REQUEST_TEMPLATE.md')
if (pr.ok) log(pr.text.split(/\r?\n/).slice(0, 40).map((l) => '    ' + l).join('\n'))
else log('  PR 模板: ' + pr.status)

log('\n===== 2BingLing/dsh-market：提交入口 =====')
const mk = await getText('https://raw.githubusercontent.com/2BingLing/dsh-market/master/README.md')
if (mk.ok) {
  const t = mk.text
  const m = t.match(/提交插件\]\(([^)]+)\)/)
  if (m) log('  提交插件链接: ' + m[1])
  const i = t.indexOf('## 收录机制')
  if (i >= 0) log('  --- 收录机制 ---\n' + t.slice(i, i + 900).split(/\r?\n/).map((l) => '    ' + l).join('\n'))
}

console.log(OUT.join('\n'))
