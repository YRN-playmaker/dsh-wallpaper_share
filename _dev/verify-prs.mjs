// 核实已提交的 PR 状态与改动
const H = { authorization: `Bearer ${process.env.GH_TOKEN}`, 'user-agent': 'dsh-verify', accept: 'application/vnd.github+json' }
const PRS = [
  ['awesome-dsh-plugin/awesome-dsh-plugin', 4795],
  ['AdamPlatin123/dsh-plugin-radar', 756],
  ['Ephemeral-AI-Lab/dsh-plugins', 9],
]
for (const [repo, num] of PRS) {
  const r = await fetch(`https://api.github.com/repos/${repo}/pulls/${num}`, { headers: H, signal: AbortSignal.timeout(30000) })
  if (!r.ok) { console.log(`${repo}#${num}: ${r.status}`); continue }
  const j = await r.json()
  console.log(`\n=== ${repo}#${num} ===`)
  console.log(`  title      : ${j.title}`)
  console.log(`  state      : ${j.state} merged=${j.merged} draft=${j.draft}`)
  console.log(`  base←head  : ${j.base.ref} ← ${j.head.label}`)
  console.log(`  maintainer_can_modify: ${j.maintainer_can_modify}`)
  console.log(`  changed_files=${j.changed_files} additions=${j.additions} deletions=${j.deletions}`)
  console.log(`  mergeable  : ${j.mergeable} (${j.mergeable_state})`)
  console.log(`  url        : ${j.html_url}`)
  const f = await fetch(`https://api.github.com/repos/${repo}/pulls/${num}/files`, { headers: H, signal: AbortSignal.timeout(30000) })
  if (f.ok) {
    const files = await f.json()
    for (const x of files) console.log(`  file: ${x.filename} (+${x.additions}/-${x.deletions})`)
  }
  // 检查状态（CI）
  const c = await fetch(`https://api.github.com/repos/${repo}/commits/${j.head.sha}/check-runs`, { headers: H, signal: AbortSignal.timeout(30000) })
  if (c.ok) {
    const cj = await c.json()
    if (cj.total_count) {
      console.log('  CI:')
      for (const cr of cj.check_runs) console.log(`    ${cr.name}: ${cr.status}/${cr.conclusion ?? '-'}`)
    } else console.log('  CI: 无 check runs')
  }
  const cs = await fetch(`https://api.github.com/repos/${repo}/commits/${j.head.sha}/status`, { headers: H, signal: AbortSignal.timeout(30000) })
  if (cs.ok) {
    const sj = await cs.json()
    console.log(`  combined status: ${sj.state} (${sj.total_count} 项)`)
  }
}
// 我们仓库的授权 issue
const iss = await fetch('https://api.github.com/repos/YRN-playmaker/dsh-wallpaper_share/issues/3', { headers: H, signal: AbortSignal.timeout(30000) })
if (iss.ok) {
  const j = await iss.json()
  console.log(`\n=== 授权 issue #3 ===\n  ${j.title}\n  state=${j.state}\n  ${j.html_url}`)
}
