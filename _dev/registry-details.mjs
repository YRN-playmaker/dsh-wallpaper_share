// 取：同类插件分类惯例 / Ephemeral schema+示例 / 校验清单
const T = 15000
async function jget(url) {
  const r = await fetch(url, { headers: { 'user-agent': 'dsh-registry' }, signal: AbortSignal.timeout(T) })
  if (!r.ok) throw new Error(url + ' → ' + r.status)
  return r.json()
}
async function tget(url) {
  const r = await fetch(url, { headers: { 'user-agent': 'dsh-registry' }, signal: AbortSignal.timeout(T) })
  if (!r.ok) return { ok: false, status: r.status }
  return { ok: true, text: await r.text() }
}
const out = []
const log = (s) => out.push(s)

log('===== awesome-dsh-plugin: 壁纸/背景类同类插件怎么分类 =====')
try {
  const dir = await jget('https://api.github.com/repos/awesome-dsh-plugin/awesome-dsh-plugin/contents/data/plugins')
  log(`  总条目 ${dir.length}`)
  const candidates = dir.filter((f) => /wallpaper|bg|background|theme|skin/i.test(f.name))
  log(`  相关文件名: ${candidates.map((f) => f.name).join(', ') || '(无)'}`)
  for (const f of candidates.slice(0, 4)) {
    const r = await tget(f.download_url)
    if (r.ok) { log(`  --- ${f.name} ---`); log(r.text.split(/\r?\n/).map((l) => '    ' + l).join('\n')) }
  }
} catch (e) { log('  ERR ' + e.message) }

log('\n===== awesome-dsh-plugin: 已收录我方? =====')
try {
  const dir = await jget('https://api.github.com/repos/awesome-dsh-plugin/awesome-dsh-plugin/contents/data/plugins')
  const mine = dir.filter((f) => /YRN-playmaker/i.test(f.name))
  log('  ' + (mine.length ? mine.map((f) => f.name).join(', ') : '未收录'))
} catch (e) { log('  ERR ' + e.message) }

log('\n===== Ephemeral-AI-Lab: manifest schema =====')
try {
  const s = await tget('https://raw.githubusercontent.com/Ephemeral-AI-Lab/dsh-plugins/main/registry/schema/plugin-manifest.v1.json')
  log(s.ok ? s.text.slice(0, 4000) : '  取不到 ' + s.status)
} catch (e) { log('  ERR ' + e.message) }

log('\n===== Ephemeral-AI-Lab: official 示例 manifest =====')
try {
  const dir = await jget('https://api.github.com/repos/Ephemeral-AI-Lab/dsh-plugins/contents/registry/official')
  log('  文件: ' + dir.map((f) => f.name).join(', '))
  const pick = dir.find((f) => /loop|codex|mayfly/i.test(f.name)) || dir[0]
  const r = await tget(pick.download_url)
  if (r.ok) { log(`  --- ${pick.name} ---`); log(r.text.split(/\r?\n/).slice(0, 60).map((l) => '    ' + l).join('\n')) }
} catch (e) { log('  ERR ' + e.message) }

console.log(out.join('\n'))
