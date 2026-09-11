// A) 查 dsh-subscribe registry.json 是否含我方 + 提交方式
// B) 给 Ericwong5021/deepseek-plugin-store 提交收录 issue（模板字段）
const H = { authorization: `Bearer ${process.env.GH_TOKEN}`, 'user-agent': 'dsh-scan4', accept: 'application/vnd.github+json' }
const MINE = /wallpaper_share|YRN-playmaker/i
const MODE = process.argv[2] === 'apply' ? 'apply' : 'plan'

async function txt(url) {
  const r = await fetch(url, { headers: H, signal: AbortSignal.timeout(30000) })
  return r.ok ? await r.text() : null
}

console.log('===== zoahdev/dsh-subscribe: registry.json =====')
const reg = await txt('https://raw.githubusercontent.com/zoahdev/dsh-subscribe/main/registry.json')
if (reg) {
  console.log(`  体积=${reg.length}B 含我方=${MINE.test(reg)}`)
  try {
    const j = JSON.parse(reg)
    const arr = Array.isArray(j) ? j : (j.plugins || j.entries || [])
    console.log(`  条目数=${Array.isArray(arr) ? arr.length : '?'}`)
    if (Array.isArray(arr) && arr.length) console.log('  样例键: ' + Object.keys(arr[0]).join(', '))
    if (Array.isArray(arr)) {
      const hit = arr.find((p) => JSON.stringify(p).match(MINE))
      console.log('  我方条目: ' + (hit ? JSON.stringify(hit).slice(0, 300) : '未收录'))
    }
  } catch (e) { console.log('  解析失败: ' + e.message) }
} else console.log('  取不到')
const subReadme = await txt('https://raw.githubusercontent.com/zoahdev/dsh-subscribe/main/README.md')
if (subReadme) {
  const i = subReadme.search(/contribut|添加|提交|submit/i)
  if (i >= 0) console.log('  提交相关片段:\n' + subReadme.slice(i - 200, i + 900).split(/\r?\n/).map((l) => '    ' + l).join('\n'))
}

// B) deepseek-plugin-store issue
const ISSUE_TITLE = '[Add Plugin] dsh-wallpaper_share'
const ISSUE_BODY = `### Plugin name

YRN-playmaker/dsh-wallpaper_share

### Repository URL

https://github.com/YRN-playmaker/dsh-wallpaper_share

### Install identifier

github:YRN-playmaker/dsh-wallpaper_share

Also published on npm as \`dsh-wallpaper_share\` (latest \`26.9.10\`) — \`dsh plugin --profile web add dsh-wallpaper_share\`.

### Category

Interface & Experience / Themes & Layout

### dsh.bundle evidence (root package.json)

\`\`\`json
"dsh": {
  "bundle": { "patch": "./cordis.patch.yml" },
  "client": {
    "inject": ["@deepseek-ai/dsh-client-runtime", "@deepseek-ai/dsh-client-ui-theme"],
    "platform": "web"
  }
}
\`\`\`

\`cordis.patch.yml\` (repo root) installs the row:

\`\`\`yaml
- insert:
    - id: we-sync
      name: dsh-wallpaper_share
\`\`\`

### What it does

Syncs the wallpaper currently applied in Wallpaper Engine to the DSH Web UI background through a local bridge: preview/capture/full render modes, monitor lock, a wallpaper library panel for local and market content, focus lens with eye tracking, immersive mode, and a Windows app launcher that installs software from direct links or a cloud-drive share link and starts it with one click.

### Other metadata

- License: GPL-3.0 · Topics: \`dsh-plugin\`, \`dsh\`, \`deepseek-harness\`
- Runtime dependencies: none (\`dependencies\` is empty); client half uses host-provided \`@deepseek-ai/dsh-client-runtime\` / \`@deepseek-ai/dsh-client-ui-theme\`
- Build output (\`lib/index.js\`, \`lib/client.js\`) is committed, so a GitHub install works without a build step
- Already listed in the dsh-plugin topic catalogs; listing here is not exclusive
`

console.log('\n===== deepseek-plugin-store issue =====')
console.log('  title: ' + ISSUE_TITLE)
console.log('  body 长度: ' + ISSUE_BODY.length)
if (MODE === 'plan') {
  console.log(ISSUE_BODY.split('\n').map((l) => '    ' + l).join('\n'))
  console.log('\n(plan 模式，未提交)')
} else {
  const r = await fetch('https://api.github.com/repos/Ericwong5021/deepseek-plugin-store/issues', {
    method: 'POST',
    headers: { ...H, 'content-type': 'application/json' },
    body: JSON.stringify({ title: ISSUE_TITLE, body: ISSUE_BODY }),
    signal: AbortSignal.timeout(45000),
  })
  const t = await r.text()
  let j = null
  try { j = JSON.parse(t) } catch {}
  console.log(r.ok ? `  ✅ issue #${j.number} → ${j.html_url}` : `  失败 ${r.status}: ${j?.message || t.slice(0, 200)}`)
}
