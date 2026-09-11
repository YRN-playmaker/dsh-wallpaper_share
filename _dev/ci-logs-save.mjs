// 下载 PR 检查日志 zip 并落盘（随后用 Expand-Archive 解压查看失败步骤）
const H = { authorization: `Bearer ${process.env.GH_TOKEN}`, 'user-agent': 'dsh-ci3', accept: 'application/vnd.github+json' }
const REPO = 'awesome-dsh-plugin/awesome-dsh-plugin'
import { writeFileSync } from 'node:fs'
const pr = await (await fetch(`https://api.github.com/repos/${REPO}/pulls/4795`, { headers: H })).json()
const runs = await (await fetch(`https://api.github.com/repos/${REPO}/actions/runs?head_sha=${pr.head.sha}&per_page=5`, { headers: H })).json()
for (const wf of runs.workflow_runs || []) {
  console.log(`run ${wf.id} ${wf.name} → ${wf.conclusion}`)
  const lg = await fetch(`https://api.github.com/repos/${REPO}/actions/runs/${wf.id}/logs`, { headers: H, redirect: 'follow', signal: AbortSignal.timeout(90000) })
  if (!lg.ok) { console.log('  下载失败 ' + lg.status); continue }
  const buf = Buffer.from(await lg.arrayBuffer())
  const out = `_dev/pr4795-logs-${wf.id}.zip`
  writeFileSync(out, buf)
  console.log(`  已保存 ${out} (${buf.length}B)`)
}
