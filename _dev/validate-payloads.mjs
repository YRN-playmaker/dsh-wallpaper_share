// 校验提交 payload：YAML 可解析 + manifest 字段/长度/schema 约束
import { readFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)

// 取出 registry-submit.mjs 的 payload（复用其 plan 输出不方便，这里直接重建关键字符串）
const mod = await import('./registry-submit.mjs').catch(() => null)
// registry-submit 会因缺少 GH_TOKEN 退出，故改为直接在本地重建校验所需内容
const EN_SHORT = 'Syncs the wallpaper currently applied in Wallpaper Engine to the DSH Web UI background over a local bridge. Adds preview/capture/full render modes, monitor lock, a wallpaper library panel for local and market content, focus lens with eye tracking, immersive mode and a Windows app launcher.'
const ZH_SHORT = '把 Wallpaper Engine 当前应用的壁纸经本地桥接同步为 DSH Web 界面背景：三档渲染模式（预览/捕获/完整）、显示器锁定、本地与市场壁纸库面板、专注透镜与眼动追踪、沉浸模式，以及 Windows 应用启动器。'

console.log('=== 字数（schema 上限 300）===')
console.log(`  en=${EN_SHORT.length} ${EN_SHORT.length <= 300 ? '✓' : '✗ 超限'}`)
console.log(`  zh=${ZH_SHORT.length} ${ZH_SHORT.length <= 300 ? '✓' : '✗ 超限'}`)

// YAML 解析校验（找可用的 yaml 实现）
console.log('\n=== YAML 校验 ===')
let YAML = null
for (const name of ['yaml', 'js-yaml']) {
  try { YAML = { name, lib: require(name) }; break } catch {}
}
const yml = readFileSync('_dev/registry-payloads/YRN-playmaker__dsh-wallpaper_share.yml', 'utf8')
if (YAML) {
  const parsed = YAML.name === 'yaml' ? YAML.lib.parse(yml) : YAML.lib.load(yml)
  console.log('  解析器: ' + YAML.name)
  console.log('  ' + JSON.stringify(parsed, null, 2).split('\n').join('\n  '))
  const need = ['url', 'name', 'category', 'description']
  for (const k of need) console.log(`  ${k}: ${parsed[k] ? '✓' : '✗ 缺失'}`)
  console.log(`  description.en 结尾为句号: ${String(parsed.description.en).trim().endsWith('.') ? '✓' : '⚠'}`)
  const cats = ['agi','ui','usage','theme','model','identity','session','memory','tools','wsl','browser','vision','voice','docs','skill','workflow','git','notify','dev','security','remote','market','fun']
  console.log(`  category=${parsed.category} 在取值表内: ${cats.includes(parsed.category) ? '✓' : '✗'}`)
} else {
  console.log('  无 YAML 解析器可用（node_modules 无 yaml/js-yaml），仅做结构检查')
  for (const k of ['url:', 'name:', 'category:', 'description:', '  en:', '  zh:']) {
    console.log(`  含 "${k}": ${yml.includes(k) ? '✓' : '✗'}`)
  }
}

// manifest JSON 校验
console.log('\n=== manifest 校验 ===')
const m = JSON.parse(readFileSync('_dev/registry-payloads/dsh-wallpaper-share.json', 'utf8'))
const req = ['schemaVersion','id','source','displayName','description','descriptionZh','author','links','license','category','status','surfaces','install','verified']
for (const k of req) console.log(`  ${k}: ${m[k] !== undefined ? '✓' : '✗ 缺失'}`)
console.log(`  id 匹配 ^[a-z0-9][a-z0-9-]*$: ${/^[a-z0-9][a-z0-9-]*$/.test(m.id) ? '✓' : '✗'}`)
console.log(`  category ∈ enum: ${['tools','ui','provider','workflow','testing','integration'].includes(m.category) ? '✓' : '✗'}`)
console.log(`  status ∈ enum: ${['stable','beta','unstable','deprecated','removed'].includes(m.status) ? '✓' : '✗'}`)
console.log(`  surfaces minProperties≥1: ${Object.keys(m.surfaces).length >= 1 ? '✓' : '✗'}`)
console.log(`  install.rows: ${Array.isArray(m.install.rows) && m.install.rows.length ? '✓' : '✗'}`)
console.log(`  verified.packages: ${Array.isArray(m.verified.packages) && m.verified.packages.length ? '✓' : '✗'}`)
