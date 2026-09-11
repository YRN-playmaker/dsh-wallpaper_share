// 打印 PLUGINS.md 单插件表末尾 + 是否已收录
const H = { 'user-agent': 'dsh-registry', ...(process.env.GH_TOKEN ? { authorization: `Bearer ${process.env.GH_TOKEN}` } : {}) }
const r = await fetch('https://raw.githubusercontent.com/AdamPlatin123/awesome-dsh-plugins/main/PLUGINS.md', { headers: H, signal: AbortSignal.timeout(20000) })
const text = await r.text()
const lines = text.split(/\r?\n/)
console.log('含我方: ' + /YRN-playmaker|wallpaper_share/i.test(text))
console.log('--- 163..178 ---')
for (let i = 162; i < Math.min(178, lines.length); i++) console.log(`${String(i + 1).padStart(4)} ${String(lines[i]).slice(0, 120)}`)
console.log('\n--- 单插件表行数统计 ---')
let rows = 0
for (let i = 12; i < 173; i++) if (/^\|/.test(String(lines[i]))) rows++
console.log('  行数(含表头分隔) = ' + rows)
