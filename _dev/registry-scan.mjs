// 扫描 DSH 社区收录站：提交机制 / 是否已收录 / 数据结构
const CANDIDATES = [
  'ZASENJC/dsh-plugins-store',
  'AdamPlatin123/awesome-dsh-plugins',
  'Liora2050348900/awesome-deepseek-harness',
  'awesome-dsh-plugin/awesome-dsh-plugin',
  '2BingLing/dsh-market',
  'Ephemeral-AI-Lab/dsh-plugins',
]
const MINE = /wallpaper_share|YRN-playmaker/i
const SUBMIT = /提交|收录|添加插件|投稿|contribut|pull request|issue template|PR\b|topic|keyword|submit/i

async function getText(url) {
  try {
    const r = await fetch(url, { redirect: 'follow' })
    if (!r.ok) return { ok: false, status: r.status }
    return { ok: true, text: await r.text() }
  } catch (e) { return { ok: false, status: 'ERR ' + e.message } }
}
async function getJson(url) {
  try {
    const r = await fetch(url, { headers: { 'user-agent': 'dsh-registry-scan' } })
    if (!r.ok) return { ok: false, status: r.status }
    return { ok: true, json: await r.json() }
  } catch (e) { return { ok: false, status: 'ERR ' + e.message } }
}

for (const repo of CANDIDATES) {
  console.log('\n===== ' + repo + ' =====')
  const meta = await getJson(`https://api.github.com/repos/${repo}`)
  if (meta.ok) {
    const j = meta.json
    console.log(`  stars=${j.stargazers_count} topics=[${(j.topics || []).join(', ')}] pushed=${j.pushed_at} default=${j.default_branch}`)
  } else {
    console.log('  repo API: ' + meta.status)
  }
  let readme = null, branch = null
  for (const br of ['main', 'master']) {
    const r = await getText(`https://raw.githubusercontent.com/${repo}/${br}/README.md`)
    if (r.ok) { readme = r.text; branch = br; break }
  }
  if (!readme) { console.log('  README: 取不到'); continue }
  console.log(`  README(${branch}) ${readme.length}B`)
  const lines = readme.split(/\r?\n/)
  console.log('  --- 提交/收录相关行:')
  const hits = lines.filter((l) => SUBMIT.test(l)).slice(0, 8)
  for (const h of hits) console.log('    ' + h.replace(/\s+/g, ' ').trim().slice(0, 180))
  const mine = lines.filter((l) => MINE.test(l))
  console.log('  --- 是否已收录我方: ' + (mine.length ? mine.slice(0, 3).map((l) => l.trim().slice(0, 160)).join(' | ') : '否'))
  // 找数据文件线索
  const dataHints = lines.filter((l) => /\.json|\.yml|\.yaml|data\/|plugins\./i.test(l)).slice(0, 5)
  if (dataHints.length) {
    console.log('  --- 数据文件线索:')
    for (const d of dataHints) console.log('    ' + d.replace(/\s+/g, ' ').trim().slice(0, 160))
  }
}

// 官方仓库里的收录途径
console.log('\n===== deepseek-ai/deepseek-harness =====')
const dh = await getJson('https://api.github.com/repos/deepseek-ai/deepseek-harness')
if (dh.ok) console.log(`  stars=${dh.json.stargazers_count} topics=[${(dh.json.topics || []).join(', ')}]`)

// npm 上现有版本
console.log('\n===== npm: dsh-wallpaper_share =====')
const npm = await getJson('https://registry.npmjs.org/dsh-wallpaper_share')
if (npm.ok) {
  const j = npm.json
  console.log(`  latest=${j['dist-tags']?.latest} versions=${Object.keys(j.versions || {}).slice(-5).join(', ')}`)
  const latest = j.versions?.[j['dist-tags']?.latest]
  console.log(`  keywords=[${(latest?.keywords || []).join(', ')}]`)
} else {
  console.log('  ' + npm.status)
}
