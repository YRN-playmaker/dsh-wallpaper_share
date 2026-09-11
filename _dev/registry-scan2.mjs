// 补查其余收录站：是否已收录我们 + 提交方式
const H = { authorization: `Bearer ${process.env.GH_TOKEN}`, 'user-agent': 'dsh-scan2', accept: 'application/vnd.github+json' }
const MINE = /wallpaper_share|YRN-playmaker/i
async function txt(url) {
  try {
    const r = await fetch(url, { headers: H, signal: AbortSignal.timeout(25000) })
    return r.ok ? { ok: true, text: await r.text() } : { ok: false, status: r.status }
  } catch (e) { return { ok: false, status: 'ERR' } }
}
async function js(url) {
  try {
    const r = await fetch(url, { headers: H, signal: AbortSignal.timeout(25000) })
    return r.ok ? { ok: true, json: await r.json() } : { ok: false, status: r.status }
  } catch (e) { return { ok: false, status: 'ERR' } }
}

const SITES = [
  { name: 'dsh-market/dsh-market', repo: 'dsh-market/dsh-market' },
  { name: 'Ericwong5021/deepseek-plugin-store', repo: 'Ericwong5021/deepseek-plugin-store' },
  { name: 'dsh-subscribe (registry)', repo: null },
]
for (const s of SITES) {
  console.log(`\n===== ${s.name} =====`)
  if (s.repo) {
    const meta = await js(`https://api.github.com/repos/${s.repo}`)
    if (meta.ok) console.log(`  stars=${meta.json.stargazers_count} topics=[${(meta.json.topics||[]).join(', ')}] pushed=${meta.json.pushed_at} default=${meta.json.default_branch}`)
    else console.log('  repo: ' + meta.status)
    const rm = await txt(`https://raw.githubusercontent.com/${s.repo}/${meta.json?.default_branch || 'main'}/README.md`)
    if (rm.ok) {
      console.log(`  README ${rm.text.length}B，含我方: ${MINE.test(rm.text)}`)
      const lines = rm.text.split(/\r?\n/).filter((l) => /提交|收录|submission|submit|registry|community/i.test(l)).slice(0, 6)
      for (const l of lines) console.log('    ' + l.replace(/\s+/g, ' ').trim().slice(0, 170))
    }
  }
}

// dsh-subscribe：从官方 discussions 提到的仓库找注册表
console.log('\n===== dsh-subscribe 搜索 =====')
const q = await js('https://api.github.com/search/repositories?q=dsh-subscribe+in:name&per_page=5')
if (q.ok) for (const it of q.json.items || []) console.log(`  ${it.full_name} ★${it.stargazers_count} — ${(it.description || '').slice(0, 100)}`)

// 官方 discussions #1828 是否提到插件收录方式
console.log('\n===== 官方仓库 discussions 分类 =====')
const d = await js('https://api.github.com/repos/deepseek-ai/deepseek-harness/discussions?per_page=5')
if (d.ok && Array.isArray(d.json)) for (const x of d.json.slice(0, 5)) console.log(`  ${x.number} ${String(x.title).slice(0, 80)}`)
else console.log('  (需 GraphQL，跳过)')
