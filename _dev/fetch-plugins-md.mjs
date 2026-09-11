// 取 AdamPlatin PLUGINS.md 的主题皮肤表格（定位插行位置）
const H = { 'user-agent': 'dsh-registry', ...(process.env.GH_TOKEN ? { authorization: `Bearer ${process.env.GH_TOKEN}` } : {}) }
const r = await fetch('https://raw.githubusercontent.com/AdamPlatin123/awesome-dsh-plugins/main/PLUGINS.md', { headers: H, signal: AbortSignal.timeout(20000) })
if (!r.ok) { console.log('取不到 ' + r.status); process.exit(1) }
const text = await r.text()
const lines = text.split(/\r?\n/)
console.log('总行数=' + lines.length)
console.log('--- 前 25 行 ---')
lines.slice(0, 25).forEach((l, i) => console.log(`${String(i + 1).padStart(4)} ${String(l).slice(0, 150)}`))
const start = lines.findIndex((l) => /壁纸|主题|皮肤/.test(l) && /^#{2,3}\s/.test(l))
console.log(`\n主题/壁纸相关标题行=${start + 1}: ${start >= 0 ? lines[start] : '(未找到)'}`)
if (start >= 0) {
  for (let i = start; i < Math.min(start + 30, lines.length); i++) {
    console.log(`${String(i + 1).padStart(4)} ${String(lines[i]).slice(0, 150)}`)
  }
}
console.log('\n--- 全部分类标题 ---')
lines.forEach((l, i) => { if (/^#{2,3}\s/.test(String(l))) console.log(`${String(i + 1).padStart(4)} ${String(l).slice(0, 90)}`) })
