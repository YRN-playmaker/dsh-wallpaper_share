// 判断 awesome-dsh-plugin 的 Build 任务失败是否为仓库既有问题 + 取失败日志尾部
const H = { authorization: `Bearer ${process.env.GH_TOKEN}`, 'user-agent': 'dsh-ci2', accept: 'application/vnd.github+json' }
const REPO = 'awesome-dsh-plugin/awesome-dsh-plugin'
async function js(url) {
  const r = await fetch(url, { headers: H, signal: AbortSignal.timeout(30000) })
  return r.ok ? await r.json() : { __err: r.status }
}

console.log('=== main 分支最近的 workflow 结论 ===')
const mainRuns = await js(`https://api.github.com/repos/${REPO}/actions/runs?branch=main&per_page=8`)
for (const wf of mainRuns.workflow_runs || []) {
  console.log(`  ${wf.name} #${wf.run_number} → ${wf.conclusion ?? wf.status} (${wf.created_at}) ${wf.head_sha.slice(0, 7)}`)
}

console.log('\n=== 其他 PR 的 workflow 结论（看是否普遍失败）===')
const prRuns = await js(`https://api.github.com/repos/${REPO}/actions/runs?event=pull_request&per_page=8`)
for (const wf of prRuns.workflow_runs || []) {
  console.log(`  ${wf.name} #${wf.run_number} → ${wf.conclusion ?? wf.status} branch=${wf.head_branch} (${wf.created_at})`)
}

console.log('\n=== 我们 PR 的失败 job 日志尾部 ===')
const pr = await js(`https://api.github.com/repos/${REPO}/pulls/4795`)
const sha = pr.head.sha
const runs = await js(`https://api.github.com/repos/${REPO}/actions/runs?head_sha=${sha}&per_page=5`)
for (const wf of runs.workflow_runs || []) {
  console.log(`  workflow ${wf.name} #${wf.run_number} → ${wf.conclusion}`)
  const wjobs = await js(`https://api.github.com/repos/${REPO}/actions/runs/${wf.id}/jobs`)
  for (const jb of wjobs.jobs || []) {
    console.log(`    job ${jb.name} → ${jb.conclusion} (id=${jb.id})`)
  }
  const lg = await fetch(`https://api.github.com/repos/${REPO}/actions/runs/${wf.id}/logs`, { headers: H, redirect: 'follow', signal: AbortSignal.timeout(90000) })
  if (!lg.ok) { console.log('    日志下载失败 ' + lg.status); continue }
  const buf = Buffer.from(await lg.arrayBuffer())
  const text = buf.toString('utf8')
  const clean = text.replace(/\u001b\[[0-9;]*m/g, '').replace(/\r/g, '')
  const lines = clean.split('\n')
  const idx = lines.findIndex((l) => /check.*Build \(locale parity/.test(l))
  console.log('    --- Build 段尾部（最后 45 行）---')
  console.log(lines.slice(Math.max(0, lines.length - 45)).map((l) => '      ' + l.slice(0, 190)).join('\n'))
}
