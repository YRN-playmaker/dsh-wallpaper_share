// 在 PR #4795 留言说明红叉与本条目无关（附证据）
const H = { authorization: `Bearer ${process.env.GH_TOKEN}`, 'user-agent': 'dsh-ci4', accept: 'application/vnd.github+json' }
const REPO = 'awesome-dsh-plugin/awesome-dsh-plugin'
const body = `Heads-up on the red X: the failing step is the repo-wide site build, not this entry.

\`\`\`text
Run node scripts/build-site.mjs
3432 entries parsed across 2 locales
no added-date derivable for: https://github.com/wwweljf/dsh-plugins/tree/master/plugins/dsh-ding-sound,
  .../plugins/dsh-wx-push, .../plugins/dsh-wx-remote
need full git history (fetch-depth: 0) and committed entries — refusing to build
\`\`\`

The same step fails on \`main\` (see PR check runs on \`main\`), and on other open PRs, so it looks unrelated to any single submission.

For this PR specifically:

- **Submission gate → success**: *"All 1 submitted entry passes: \`dsh.bundle\` declared, repo old enough, enough commits."*
- **READMEs match data/plugins → pass**: *"PR does not touch the generated READMEs — regenerating locally"* → regenerated 3432 entries, no mismatch.
- Diff is \`+1/-0\` on a single new file: \`data/plugins/YRN-playmaker__dsh-wallpaper_share.yml\`

Happy to rebase or adjust the entry (category, wording) if anything is off — just say the word.`

const r = await fetch(`https://api.github.com/repos/${REPO}/issues/4795/comments`, {
  method: 'POST',
  headers: { ...H, 'content-type': 'application/json' },
  body: JSON.stringify({ body }),
  signal: AbortSignal.timeout(45000),
})
const t = await r.text()
let j = null
try { j = JSON.parse(t) } catch {}
console.log(r.ok ? `✅ 已留言 → ${j.html_url}` : `失败 ${r.status}: ${j?.message || t.slice(0, 300)}`)
