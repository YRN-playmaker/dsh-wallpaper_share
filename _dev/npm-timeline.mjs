// npm 版本时间线 + 本地包元数据（供 manifest 使用）
async function j(url) {
  const r = await fetch(url, { headers: { 'user-agent': 'dsh' }, signal: AbortSignal.timeout(20000) })
  if (!r.ok) throw new Error(url + ' → ' + r.status)
  return r.json()
}
const m = await j('https://registry.npmjs.org/dsh-wallpaper_share')
console.log('=== npm 版本时间线 ===')
for (const [v, t] of Object.entries(m.time || {})) {
  if (v === 'created' || v === 'modified') continue
  if (/^26\.9/.test(v) || /^26\.10/.test(v) || /^26\.8/.test(v)) console.log(`  ${v.padEnd(12)} ${t}`)
}
console.log('  dist-tags: ' + JSON.stringify(m['dist-tags']))
const latest = m.versions[m['dist-tags'].latest]
console.log('\n=== npm latest 包内容 ===')
console.log('  version=' + latest.version + ' license=' + latest.license + ' engines=' + JSON.stringify(latest.engines))
console.log('  gitHead=' + latest.gitHead)
console.log('  dsh=' + JSON.stringify(latest.dsh))
console.log('  keywords=' + JSON.stringify(latest.keywords))
console.log('  dist.tarball=' + latest.dist.tarball)
console.log('  dist.integrity=' + latest.dist.integrity)

const r98 = m.versions['26.9.8']
if (r98) console.log('\n=== npm 26.9.8 ===\n  time=' + m.time['26.9.8'] + ' gitHead=' + r98.gitHead + ' integrity=' + r98.dist.integrity)
const r910 = m.versions['26.9.10']
if (r910) console.log('=== npm 26.9.10 ===\n  time=' + m.time['26.9.10'] + ' gitHead=' + r910.gitHead + ' integrity=' + r910.dist.integrity)

// 本地元数据
const fs = await import('node:fs')
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
console.log('\n=== 本地 package.json ===')
console.log('  version=' + pkg.version + ' license=' + pkg.license + ' engines=' + JSON.stringify(pkg.engines))
console.log('  dsh=' + JSON.stringify(pkg.dsh))
let yml = ''
try { yml = fs.readFileSync('cordis.patch.yml', 'utf8') } catch {}
console.log('=== cordis.patch.yml ===')
console.log(yml.split('\n').slice(0, 25).map((l) => '  ' + l).join('\n'))
