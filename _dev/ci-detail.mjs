// 取 PR #4795 的 CI 失败详情（check run + annotations + 日志尾部）
const H = { authorization: `Bearer ${process.env.GH_TOKEN}`, 'user-agent': 'dsh-ci', accept: 'application/vnd.github+json' }
const REPO = 'awesome-dsh-plugin/awesome-dsh-plugin'
async function js(url) {
  const r = await fetch(url, { headers: H, signal: AbortSignal.timeout(30000) })
  return r.ok ? await r.json() : { __err: r.status, __url: url }
}
const pr = await js(`https://api.github.com/repos/${REPO}/pulls/4795`)
const SHA = process.env.SHA || pr.head?.sha
console.log('head sha = ' + SHA)
const runs = await js(`https://api.github.com/repos/${REPO}/commits/${SHA}/check-runs`)
if (runs.__err) { console.log('check-runs 取不到 ' + runs.__err); process.exit(0) }
for (const cr of runs.check_runs || []) {
  console.log(`=== check: ${cr.name} ===`)
  console.log(`  status=${cr.status} conclusion=${cr.conclusion}`)
  console.log(`  output.title=${cr.output?.title}`)
  console.log(`  output.summary=${cr.output?.summary}`)
  if (cr.output?.text) console.log('  output.text:\n' + cr.output.text.split('\n').slice(0, 40).map((l) => '    ' + l).join('\n'))
  const ann = await js(`https://api.github.com/repos/${REPO}/check-runs/${cr.id}/annotations`)
  if (Array.isArray(ann) && ann.length) {
    console.log('  annotations:')
    for (const a of ann) console.log(`    [${a.annotation_level}] ${a.path}:${a.start_line} ${a.message}`)
  }
  // job 日志（Actions）
  const jobs = await js(`https://api.github.com/repos/${REPO}/actions/runs?head_sha=${SHA}&per_page=5`)
  if (jobs.workflow_runs) {
    for (const wf of jobs.workflow_runs) {
      console.log(`  workflow: ${wf.name} #${wf.run_number} ${wf.conclusion}`)
      const wjobs = await js(`https://api.github.com/repos/${REPO}/actions/runs/${wf.id}/jobs`)
      for (const jb of wjobs.jobs || []) {
        console.log(`    job: ${jb.name} → ${jb.conclusion}`)
        for (const st of jb.steps || []) {
          if (st.conclusion && st.conclusion !== 'success' && st.conclusion !== 'skipped') console.log(`      step FAIL: ${st.name}`)
        }
      }
      const logs = await fetch(`https://api.github.com/repos/${REPO}/actions/runs/${wf.id}/logs`, { headers: H, redirect: 'follow', signal: AbortSignal.timeout(60000) })
      if (logs.ok) {
        const buf = Buffer.from(await logs.arrayBuffer())
        // 只打印含 error/fail 的行
        const text = buf.toString('utf8', 0, Math.min(buf.length, 400000))
        const hits = text.split('\n').filter((l) => /error|Error|FAIL|fail|✗|✘|not |missing|invalid/i.test(l)).slice(0, 40)
        console.log('    --- 日志关键行 ---')
        for (const h of hits) console.log('      ' + h.replace(/\u001b\[[0-9;]*m/g, '').slice(0, 200))
      } else console.log('    日志下载失败 ' + logs.status)
    }
  }
}
