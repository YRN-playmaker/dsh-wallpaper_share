// 同类壁纸插件分类惯例 + 本机信息
const H = { 'user-agent': 'dsh-registry', ...(process.env.GH_TOKEN ? { authorization: `Bearer ${process.env.GH_TOKEN}` } : {}) }
async function tget(url) {
  const r = await fetch(url, { headers: H, signal: AbortSignal.timeout(20000) })
  return r.ok ? { ok: true, text: await r.text() } : { ok: false, status: r.status }
}
const names = [
  'Frog755__dsh-wallpaper.yml',
  'B-TQ__dsh-wallpaper.yml',
  'Ddamage__dsh-shunshun-wallpaper.yml',
  'HaoyueQin__deepseek-harness-background.yml',
  'AppliedYuu__dsh-WallpaperAndCost.yml',
]
console.log('=== awesome-dsh-plugin 同类条目（壁纸/背景）===')
for (const n of names) {
  const r = await tget(`https://raw.githubusercontent.com/awesome-dsh-plugin/awesome-dsh-plugin/main/data/plugins/${n}`)
  if (!r.ok) { console.log(`  ${n}: ${r.status}`); continue }
  const cat = (r.text.match(/^category:\s*(.+)$/m) || [])[1]
  const en = (r.text.match(/^\s*en:\s*(.+)$/m) || [])[1]
  const tb = /^tarball:/m.test(r.text)
  console.log(`  ${n}\n    category=${cat} tarball=${tb}\n    en=${(en || '').slice(0, 130)}`)
}
console.log('\n=== 本机信息 ===')
console.log('  日期: ' + new Date().toISOString())
