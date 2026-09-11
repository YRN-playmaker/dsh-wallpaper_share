// DSH 插件收录站提交：plan = 打印将提交的内容；apply = 建 fork/分支/文件/PR
// 用法: node _dev/registry-submit.mjs plan|apply [target...]
const TOKEN = process.env.GH_TOKEN
if (!TOKEN) { console.error('缺少 GH_TOKEN'); process.exit(1) }
const MODE = process.argv[2] === 'apply' ? 'apply' : 'plan'
const ONLY = process.argv.slice(3)
const API = 'https://api.github.com'
const H = { authorization: `Bearer ${TOKEN}`, 'user-agent': 'dsh-plugin-submit', accept: 'application/vnd.github+json' }

const REPO = 'YRN-playmaker/dsh-wallpaper_share'
const REPO_URL = 'https://github.com/' + REPO
const NPM_URL = 'https://www.npmjs.com/package/dsh-wallpaper_share'
const PIN = process.env.PIN_SHA || '36ee1775be95445b5f2532902911e4b2fb33fea7'

const EN_DESC = 'Syncs the wallpaper currently applied in Wallpaper Engine to the DSH Web UI background through a local bridge: preview/capture/full render modes, monitor lock, a wallpaper library panel for local and market content, focus lens with eye tracking, immersive mode, and a Windows app launcher that installs software from direct links or a cloud-drive share link and starts it with one click.'
const ZH_DESC = '把 Wallpaper Engine 当前应用的壁纸经本地桥接同步为 DSH Web 界面背景：预览/捕获/完整三档渲染、显示器锁定、本地与市场壁纸库面板、专注透镜与眼动追踪、沉浸模式，以及支持直链与网盘分享链接安装、一键启动的 Windows 应用启动器。'
// Ephemeral manifest 有 300 字符上限（description / descriptionZh），单独用短版
const EN_DESC_SHORT = 'Syncs the wallpaper currently applied in Wallpaper Engine to the DSH Web UI background over a local bridge. Adds preview/capture/full render modes, monitor lock, a wallpaper library panel for local and market content, focus lens with eye tracking, immersive mode and a Windows app launcher.'
const ZH_DESC_SHORT = '把 Wallpaper Engine 当前应用的壁纸经本地桥接同步为 DSH Web 界面背景：三档渲染模式（预览/捕获/完整）、显示器锁定、本地与市场壁纸库面板、专注透镜与眼动追踪、沉浸模式，以及 Windows 应用启动器。'
if (EN_DESC_SHORT.length > 300 || ZH_DESC_SHORT.length > 300) {
  console.error(`短描述超限: en=${EN_DESC_SHORT.length} zh=${ZH_DESC_SHORT.length}`)
  process.exit(1)
}

// ---------- 目标 1: awesome-dsh-plugin（15141★，PR 提交 data/plugins/<owner>__<repo>.yml）----------
const T1 = {
  key: 'awesome-dsh-plugin',
  upstream: 'awesome-dsh-plugin/awesome-dsh-plugin',
  branch: 'add-wallpaper-share',
  title: 'Add YRN-playmaker/dsh-wallpaper_share',
  files: [{
    path: 'data/plugins/YRN-playmaker__dsh-wallpaper_share.yml',
    content: `url: ${REPO_URL}
name: ${REPO}
category: theme
description:
  en: '${EN_DESC}'
  zh: '${ZH_DESC}'
`,
  }],
  body: `Adds one entry file for **dsh-wallpaper_share**, a Wallpaper Engine → DSH Web background bridge.

\`\`\`yaml
url: ${REPO_URL}
name: ${REPO}
category: theme
description:
  en: '${EN_DESC}'
  zh: '${ZH_DESC}'
\`\`\`

Requirements from contributing.md:

- [x] \`package.json\` declares a \`dsh.bundle\` manifest (\`dsh.bundle.patch: ./cordis.patch.yml\`) alongside \`dsh.client\`
- [x] \`cordis.patch.yml\` ships in the repo and installs a row (\`id: we-sync\`, \`name: dsh-wallpaper_share\`)
- [x] Repo carries the \`dsh-plugin\` topic (also \`dsh\`, \`deepseek-harness\`)
- [x] Real, working code — published on npm as \`dsh-wallpaper_share\` (latest 26.9.10), GPL-3.0
- [x] Repo older than 1 day

Category \`theme\` — the plugin's headline effect is the Web UI background/wallpaper surface (it also powers the panel for library, render modes and the app launcher).

Single entry file added; no other files touched. Thanks!`,
}

// ---------- 目标 2: AdamPlatin123/awesome-dsh-plugins（1460★，PLUGINS.md 追加一行）----------
const ROW = `| dsh-wallpaper_share | [${REPO}](${REPO_URL}) | Wallpaper Engine 壁纸同步为 DSH Web 背景（本地桥接）：预览/捕获/完整三档渲染、显示器锁定、本地与市场壁纸库（标题搜索、分页）、专注透镜与眼动追踪、沉浸模式、DWP 挂载；Windows 应用启动器支持直链与 139 网盘分享、加密 zip/7z 解包与一键启动（每次弹确认） | 待测 |`
const T2 = {
  key: 'awesome-dsh-plugins',
  upstream: 'AdamPlatin123/awesome-dsh-plugins',
  branch: 'docs/register-dsh-wallpaper-share',
  title: 'docs: 登记 dsh-wallpaper_share',
  editFile: 'PLUGINS.md',
  rowAfterLineMatching: /^\| dsh-ticktick \|/,
  rowLine: ROW,
  body: `## 插件信息

| 项 | 值 |
|---|---|
| 插件名 | dsh-wallpaper_share |
| 仓库 | ${REPO_URL} |
| **分类** | 🎨 主题皮肤（关键词命中「壁纸 / 外观」；插件主线是把当前壁纸同步为 Web 界面背景） |
| 一句话说明 | 把 Wallpaper Engine 当前应用的壁纸经本地桥接同步为 DSH Web 界面背景，并提供壁纸库面板、专注透镜/眼动追踪、沉浸模式与 Windows 应用启动器。 |

## 自检清单（提交前逐项确认）

- [x] 未占用 \`@deepseek-ai/*\` 保留命名空间 —— 发布名为 npm 上的 \`dsh-wallpaper_share\`（未加 scope；已在 npm 稳定发布至 26.9.10）
- [x] 仓库已打 \`dsh-plugin\` topic（同时带 \`dsh\`、\`deepseek-harness\`）
- [x] 已勾选 **Allow edits from maintainers**（PR 创建时已开启 maintainer_can_modify）
- [x] 所有运行时依赖已声明 —— \`dependencies\` 为空：host 侧只用 node 内置模块（\`node:http\`/\`node:fs\`/\`node:crypto\`/\`node:child_process\`），client 侧依赖宿主提供的 \`@deepseek-ai/dsh-client-runtime\` 与 \`@deepseek-ai/dsh-client-ui-theme\`（写进 \`dsh.client.inject\`）
- [x] 自检结果：

\`\`\`text
$ dsh plugin --profile web ls
├── @deepseek-ai/dsh-root@link:../../../deepseek-harness/deepseek-harness
├── dsh-wallpaper_edit@link:D:/dsh/dsh-wallpaper_edit
└── dsh-wallpaper_share@link:D:/SteamLibrary/steamapps/common/wallpaper_engine/we-sync-github
3 packages

# 该 profile 中插件面板 wallpaper_share 正常工作（同步开关 / 三档渲染 / 壁纸库 / 启动器均可用）
$ pnpm test
tests 102 · pass 102 · fail 0
\`\`\`

## 改动内容

\`PLUGINS.md\` → \`## 🔌 单插件\` 表格末尾追加一行：

\`\`\`markdown
${ROW}
\`\`\`

（未改动其他文件。）`,
}

// ---------- 目标 3: Ephemeral-AI-Lab/dsh-plugins（48★，registry/community/<slug>.json）----------
const MANIFEST = {
  schemaVersion: 1,
  id: 'dsh-wallpaper-share',
  source: 'community',
  displayName: 'Wallpaper Share',
  description: EN_DESC_SHORT,
  descriptionZh: ZH_DESC_SHORT,
  author: { name: 'YRN-playmaker', url: 'https://github.com/YRN-playmaker' },
  links: { repo: REPO_URL, docs: REPO_URL + '/blob/main/README.md', npm: NPM_URL },
  license: 'GPL-3.0',
  category: 'ui',
  status: 'beta',
  surfaces: { server: {}, web: { clientModule: true } },
  install: {
    rows: [
      {
        id: 'we-sync',
        name: 'dsh-wallpaper_share',
        npm: { spec: 'dsh-wallpaper_share' },
        github: { repo: REPO, ref: PIN, subdir: '.' },
      },
    ],
  },
  capabilities: ['shell', 'process-spawn', 'network', 'fs-write', 'credentials'],
  verified: { at: '2026-09-10', packages: [{ name: 'dsh-wallpaper_share', version: '26.9.10' }] },
}
const T3 = {
  key: 'ephemeral-ai-lab',
  upstream: 'Ephemeral-AI-Lab/dsh-plugins',
  branch: 'community/dsh-wallpaper-share',
  title: 'Add community manifest: dsh-wallpaper-share',
  files: [{ path: 'registry/community/dsh-wallpaper-share.json', content: JSON.stringify(MANIFEST, null, 2) + '\n' }],
  body: `Adds a community manifest for **Wallpaper Share** per \`registry/community/README.md\`.

- \`dsh.bundle.patch\` → \`./cordis.patch.yml\` (self-activating bundle row \`id: we-sync\`, \`name: dsh-wallpaper_share\`)
- Published on npm as \`dsh-wallpaper_share\` (latest \`26.9.10\`); build output (\`lib/index.js\`, \`lib/client.js\`) is committed, so the GitHub source is also installable
- Surfaces: \`server\` (host half — polling + HTTP routes) and \`web\` (client module — the \`wallpaper_share\` tab)
- Capability disclosure for review: \`shell\` / \`process-spawn\` (the app launcher starts executables after an explicit confirmation dialog), \`network\` (Wallpaper Engine bridge + cloud-drive share links), \`fs-write\` (installs into \`~/.dsh/storages/we-sync-apps\`), \`credentials\` (optional 139 cloud-drive auth header, stored locally)
- No runtime dependencies (\`dependencies\` is empty); client half depends on host-provided \`@deepseek-ai/dsh-client-runtime\` / \`@deepseek-ai/dsh-client-ui-theme\`

Authorization: the listing is authorized from the plugin's own repository — see the issue opened at ${REPO_URL}/issues linking this PR.

Note on \`status\`: marked \`beta\` because the app-launcher surface is still evolving (we'd rather understate; happy to have it reviewed as \`stable\` if you prefer).`,
}

const TARGETS = [T1, T2, T3].filter((t) => ONLY.length === 0 || ONLY.includes(t.key))

const api = async (method, path, body) => {
  const r = await fetch(API + path, {
    method,
    headers: { ...H, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(45000),
  })
  const text = await r.text()
  let json = null
  try { json = JSON.parse(text) } catch {}
  return { ok: r.ok, status: r.status, json, text }
}
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64')

async function planOne(t) {
  const dir = '_dev/registry-payloads'
  const fs = await import('node:fs')
  fs.mkdirSync(dir, { recursive: true })
  console.log(`\n########## ${t.key} ##########`)
  console.log(`upstream : ${t.upstream}`)
  console.log(`branch   : ${t.branch}`)
  console.log(`PR title : ${t.title}`)
  if (t.files) {
    for (const f of t.files) {
      console.log(`--- file: ${f.path} ---`)
      console.log(f.content)
      fs.writeFileSync(`${dir}/${f.path.split('/').pop()}`, f.content)
    }
  }
  if (t.editFile) {
    console.log(`--- edit: ${t.editFile} (在匹配 ${t.rowAfterLineMatching} 的行后追加) ---`)
    console.log(t.rowLine)
    fs.writeFileSync(`${dir}/${t.editFile}`, t.rowLine + '\n')
  }
  console.log('--- PR body ---')
  console.log(t.body)
  fs.writeFileSync(`${dir}/${t.key}-pr-body.md`, t.body)
}

async function applyOne(t) {
  const [upOwner, upRepo] = t.upstream.split('/')
  console.log(`\n########## ${t.key} ##########`)
  // 1) fork
  let f = await api('POST', `/repos/${upOwner}/${upRepo}/forks`, { default_branch_only: false })
  if (!f.ok && f.status !== 202) {
    console.log(`  fork 请求 ${f.status}: ${(f.json?.message) || f.text.slice(0, 200)}`)
    if (f.status !== 422) return { key: t.key, ok: false, step: 'fork' }
  }
  const forkRepo = f.json?.full_name || `${'YRN-playmaker'}/${upRepo}`
  // 等 fork 就绪
  let ready = false
  for (let i = 0; i < 10; i++) {
    const g = await api('GET', `/repos/${forkRepo}`)
    if (g.ok) { ready = true; break }
    await new Promise((r) => setTimeout(r, 1500))
  }
  if (!ready) { console.log('  fork 未就绪'); return { key: t.key, ok: false, step: 'fork-ready' } }
  const meta = (await api('GET', `/repos/${forkRepo}`)).json
  const base = meta.default_branch
  console.log(`  fork = ${forkRepo} (default=${base})`)
  // 2) 分支
  const ref = await api('GET', `/repos/${forkRepo}/git/ref/heads/${base}`)
  if (!ref.ok) { console.log('  取 base ref 失败 ' + ref.status); return { key: t.key, ok: false, step: 'ref' } }
  const sha = ref.json.object.sha
  let br = await api('POST', `/repos/${forkRepo}/git/refs`, { ref: `refs/heads/${t.branch}`, sha })
  if (!br.ok && br.status !== 422) { console.log(`  建分支失败 ${br.status}`); return { key: t.key, ok: false, step: 'branch' } }
  console.log(`  分支 ${t.branch} @ ${sha.slice(0, 8)}`)
  // 3) 写文件
  for (const file of t.files || []) {
    const put = await api('PUT', `/repos/${forkRepo}/contents/${file.path}`, {
      message: `Add ${file.path.split('/').pop()}`,
      content: b64(file.content),
      branch: t.branch,
    })
    console.log(`  写 ${file.path} → ${put.status}`)
    if (!put.ok) return { key: t.key, ok: false, step: 'file', detail: put.json?.message }
  }
  // 3b) 编辑已有文件（PLUGINS.md）
  if (t.editFile) {
    const cur = await api('GET', `/repos/${forkRepo}/contents/${t.editFile}?ref=${t.branch}`)
    if (!cur.ok) { console.log('  取 ' + t.editFile + ' 失败 ' + cur.status); return { key: t.key, ok: false, step: 'get-edit' } }
    const content = Buffer.from(cur.json.content, 'base64').toString('utf8')
    const lines = content.split('\n')
    const idx = lines.findIndex((l) => t.rowAfterLineMatching.test(l))
    if (idx < 0) { console.log('  找不到插入锚点'); return { key: t.key, ok: false, step: 'anchor' } }
    lines.splice(idx + 1, 0, t.rowLine)
    const put = await api('PUT', `/repos/${forkRepo}/contents/${t.editFile}`, {
      message: `docs: 登记 dsh-wallpaper_share`,
      content: b64(lines.join('\n')),
      sha: cur.json.sha,
      branch: t.branch,
    })
    console.log(`  追加行到 ${t.editFile} → ${put.status}`)
    if (!put.ok) return { key: t.key, ok: false, step: 'edit', detail: put.json?.message }
  }
  // 4) PR
  const pr = await api('POST', `/repos/${upOwner}/${upRepo}/pulls`, {
    title: t.title,
    head: `YRN-playmaker:${t.branch}`,
    base,
    body: t.body,
    maintainer_can_modify: true,
  })
  if (!pr.ok) {
    console.log(`  PR 创建失败 ${pr.status}: ${pr.json?.message || ''} ${JSON.stringify(pr.json?.errors || '')}`)
    return { key: t.key, ok: false, step: 'pr', detail: pr.json }
  }
  console.log(`  ✅ PR #${pr.json.number} → ${pr.json.html_url}`)
  return { key: t.key, ok: true, pr: pr.json.html_url, number: pr.json.number, upstream: t.upstream }
}

if (MODE === 'plan') {
  for (const t of TARGETS) await planOne(t)
} else {
  const results = []
  for (const t of TARGETS) results.push(await applyOne(t))
  console.log('\n===== 结果 =====')
  for (const r of results) console.log(`  ${r.key}: ${r.ok ? 'PR ' + r.pr : '失败于 ' + r.step}`)
  const ok = results.filter((r) => r.ok)
  if (ok.length) {
    console.log('\n授权证据 issue 提交中（在插件仓库）…')
    const body = 'This plugin is submitted to community DSH plugin directories. Listing authorization for these submissions is granted by the maintainer of this repository.\n\n' +
      ok.map((r) => `- ${r.upstream} — PR: ${r.pr}`).join('\n') + '\n'
    const iss = await api('POST', `/repos/${REPO}/issues`, {
      title: 'Listing authorization: community plugin directories',
      body,
    })
    console.log(iss.ok ? `  ✅ issue #${iss.json.number} → ${iss.json.html_url}` : `  issue 创建失败 ${iss.status}: ${iss.json?.message || ''}`)
  }
}
