// 带 token 取剩余细节
const T = 20000
const H = { 'user-agent': 'dsh-registry', ...(process.env.GH_TOKEN ? { authorization: `Bearer ${process.env.GH_TOKEN}` } : {}) }
async function jget(url) {
  const r = await fetch(url, { headers: H, signal: AbortSignal.timeout(T) })
  if (!r.ok) throw new Error(url.replace('https://api.github.com', '') + ' → ' + r.status + ' ' + (r.headers.get('x-ratelimit-remaining') ?? ''))
  return r.json()
}
async function tget(url) {
  const r = await fetch(url, { headers: H, signal: AbortSignal.timeout(T) })
  return r.ok ? { ok: true, text: await r.text() } : { ok: false, status: r.status }
}
const out = []
const log = (s) => out.push(s)

log('===== awesome-dsh-plugin: 壁纸/主题类同类条目 =====')
try {
  const dir = await jget('https://api.github.com/repos/awesome-dsh-plugin/awesome-dsh-plugin/contents/data/plugins')
  log(`  总条目 ${dir.length}；已收录我方: ${dir.some((f) => /YRN-playmaker/i.test(f.name))}`)
  const cands = dir.filter((f) => /wallpaper|background|theme|skin|anime|art/i.test(f.name)).map((f) => f.name)
  log('  相关: ' + cands.join(', '))
  for (const n of cands.slice(-4)) {
    const f = dir.find((x) => x.name === n)
    const r = await tget(f.download_url)
    if (r.ok) { log(`  --- ${n} ---`); log(r.text.split(/\r?\n/).map((l) => '    ' + l).join('\n')) }
  }
} catch (e) { log('  ERR ' + e.message) }

log('\n===== Ephemeral: schema install/verified 部分 =====')
try {
  const s = await tget('https://raw.githubusercontent.com/Ephemeral-AI-Lab/dsh-plugins/main/registry/schema/plugin-manifest.v1.json')
  if (s.ok) {
    const t = s.text
    const i = t.indexOf('"install"')
    log(t.slice(i, i + 3000))
  } else log('  取不到 ' + s.status)
} catch (e) { log('  ERR ' + e.message) }

log('\n===== Ephemeral: 官方目录现有 manifest =====')
try {
  const dir = await jget('https://api.github.com/repos/Ephemeral-AI-Lab/dsh-plugins/contents/registry/official')
  log('  文件: ' + dir.map((f) => f.name).join(', '))
  const pick = dir[0]
  const r = await tget(pick.download_url)
  if (r.ok) { log(`  --- ${pick.name} ---`); log(r.text) }
} catch (e) { log('  ERR ' + e.message) }

console.log(out.join('\n'))
