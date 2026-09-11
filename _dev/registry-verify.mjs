// 核实各目录实际收录情况 + 取 PR 类收录站格式
async function get(url, token) {
  try {
    const r = await fetch(url, { headers: { 'user-agent': 'dsh-registry', ...(token ? { authorization: `Bearer ${token}` } : {}) } })
    if (!r.ok) return { ok: false, status: r.status }
    const ct = r.headers.get('content-type') || ''
    return { ok: true, text: await r.text(), ct }
  } catch (e) { return { ok: false, status: 'ERR ' + e.message } }
}
const MINE = /wallpaper_share|YRN-playmaker/i
const out = []
const log = (s) => out.push(s)

// 1) dsh-plugins-store 公开 API
log('===== ZASENJC/dsh-plugins-store 公开 API (api.dshmk.com) =====')
for (const p of ['/', '/api', '/api/plugins', '/plugins.json', '/api/catalog', '/catalog.json', '/api/stats']) {
  const r = await get('https://api.dshmk.com' + p)
  if (!r.ok) { log(`  ${p} → ${r.status}`); continue }
  const t = r.text
  log(`  ${p} → 200 (${t.length}B, ${r.ct})${MINE.test(t) ? '  ★ 含我方插件' : ''}`)
  if (MINE.test(t)) {
    const m = t.match(/.{0,200}YRN-playmaker.{0,200}/i)
    if (m) log('    ' + m[0].replace(/\s+/g, ' '))
  }
  if (p === '/api/plugins' && t.length > 200) log('    片段: ' + t.slice(0, 400).replace(/\s+/g, ' '))
}

// 2) dsh-market plugins.json
log('\n===== 2BingLing/dsh-market plugins.json =====')
for (const p of ['web/public/plugins.json', 'web/public/count.json', 'plugins.json']) {
  const r = await get(`https://raw.githubusercontent.com/2BingLing/dsh-market/master/${p}`)
  if (!r.ok) { log(`  ${p} → ${r.status}`); continue }
  log(`  ${p} → 200 (${r.text.length}B)${MINE.test(r.text) ? '  ★ 含我方插件' : '  (无我方)'}`)
  if (p.includes('count')) log('    ' + r.text.replace(/\s+/g, ' ').slice(0, 200))
}

// 3) awesome-dsh-plugins 快照/明细
log('\n===== AdamPlatin123/awesome-dsh-plugins 明细表 =====')
for (const p of ['PLUGINS-ALL.md', 'PLUGINS.md']) {
  const r = await get(`https://raw.githubusercontent.com/AdamPlatin123/awesome-dsh-plugins/main/${p}`)
  if (!r.ok) { log(`  ${p} → ${r.status}`); continue }
  const t = r.text
  log(`  ${p} → 200 (${t.length}B)${MINE.test(t) ? '  ★ 含我方插件' : '  (无我方)'}`)
  if (MINE.test(t)) { const m = t.match(/.{0,150}YRN-playmaker.{0,150}/i); if (m) log('    ' + m[0].replace(/\s+/g, ' ')) }
}

// 4) awesome-dsh-plugin（15k★）贡献段 + 是否含我方
log('\n===== awesome-dsh-plugin/awesome-dsh-plugin =====')
const big = await get('https://raw.githubusercontent.com/awesome-dsh-plugin/awesome-dsh-plugin/main/README.md')
if (big.ok) {
  const t = big.text
  log(`  README ${t.length}B ${MINE.test(t) ? '★ 含我方插件' : '(无我方)'}`)
  const i = t.search(/##\s*Contributing/i)
  if (i >= 0) log('  --- Contributing 段 ---\n' + t.slice(i, i + 1200).split(/\r?\n/).map((l) => '    ' + l).join('\n'))
  const j = t.search(/how submissions work|submission checklist|submissions/i)
  if (j >= 0) log('  --- 提交说明片段 ---\n' + t.slice(j - 200, j + 800).split(/\r?\n/).map((l) => '    ' + l).join('\n'))
}

// 5) Ephemeral-AI-Lab 模板 + 规范
log('\n===== Ephemeral-AI-Lab/dsh-plugins 模板 =====')
for (const p of ['registry/submission-template.json', 'docs/market.md']) {
  const r = await get(`https://raw.githubusercontent.com/Ephemeral-AI-Lab/dsh-plugins/main/${p}`)
  if (!r.ok) { log(`  ${p} → ${r.status}`); continue }
  log(`  --- ${p} ---`)
  log(r.text.split(/\r?\n/).slice(0, 70).map((l) => '    ' + l).join('\n'))
}

console.log(out.join('\n'))
