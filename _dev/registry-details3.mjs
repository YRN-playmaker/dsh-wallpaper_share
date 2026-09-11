// 取 dsh-market / deepseek-plugin-store / dsh-subscribe 的提交细节
const H = { authorization: `Bearer ${process.env.GH_TOKEN}`, 'user-agent': 'dsh-scan3', accept: 'application/vnd.github+json' }
async function txt(url) {
  const r = await fetch(url, { headers: H, signal: AbortSignal.timeout(25000) })
  return r.ok ? await r.text() : null
}
function section(text, headingRe, chars = 1600) {
  const lines = text.split(/\r?\n/)
  const i = lines.findIndex((l) => headingRe.test(l))
  if (i < 0) return '(未找到该段)'
  return lines.slice(i, i + 60).join('\n').slice(0, chars)
}

console.log('===== dsh-market/dsh-market: Submit your plugin =====')
const mk = await txt('https://raw.githubusercontent.com/dsh-market/dsh-market/main/README.md')
if (mk) console.log(section(mk, /Submit your plugin/i, 1800))

console.log('\n\n===== deepseek-plugin-store: Get listed =====')
const st = await txt('https://raw.githubusercontent.com/Ericwong5021/deepseek-plugin-store/main/README.md')
if (st) console.log(section(st, /Get listed/i, 1800))

console.log('\n\n===== deepseek-plugin-store: issue 模板 =====')
const tpl = await txt('https://raw.githubusercontent.com/Ericwong5021/deepseek-plugin-store/main/.github/ISSUE_TEMPLATE/plugin-submission.yml')
if (tpl) console.log(tpl.slice(0, 2200))

console.log('\n\n===== 现有 registry 条目示例（结构参考）=====')
const dir = await fetch('https://api.github.com/repos/Ericwong5021/deepseek-plugin-store/contents/registry/plugins', { headers: H, signal: AbortSignal.timeout(25000) })
if (dir.ok) {
  const files = await dir.json()
  console.log('  条目数=' + files.length + '；含我方: ' + files.some((f) => /YRN-playmaker|wallpaper_share/i.test(f.name)))
  const one = files.find((f) => /dsh-wallpaper/i.test(f.name)) || files[0]
  const c = await txt(one.download_url)
  console.log(`  --- ${one.name} ---`)
  if (c) console.log(c.slice(0, 1500))
} else console.log('  ' + dir.status)

console.log('\n\n===== zoahdev/dsh-subscribe: 提交方式 =====')
const sub = await txt('https://raw.githubusercontent.com/zoahdev/dsh-subscribe/main/README.md')
if (sub) {
  const lines = sub.split(/\r?\n/)
  console.log(lines.filter((l) => /submit|提交|收录|registry|add your/i.test(l)).slice(0, 8).map((l) => '  ' + l.trim().slice(0, 170)).join('\n') || '  (无相关行)')
} else console.log('  README 取不到')
