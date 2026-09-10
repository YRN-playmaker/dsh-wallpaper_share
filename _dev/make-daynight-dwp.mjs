/**
 * 「DeepSeek 日夜」DWP 打包 + 本地安装（换图重跑即可）。
 *
 * 用法：
 *   node _dev/make-daynight-dwp.mjs                  # 打包（写 _dist/daynight/），并装进本地市场目录
 *   node _dev/make-daynight-dwp.mjs --no-install      # 只打包
 *   node _dev/make-daynight-dwp.mjs --day <白天图> --night <夜间图>
 *
 * 产物：_dist/daynight/yrn.deepseek-day-night-<version>.dwp
 * 安装：<市场目录>/packages/yrn.deepseek-day-night.dwp + installed.json 记账
 *       （市场目录默认 ~/.dsh-dwp-market，可用 DSH_DWP_MARKET_DIR 覆盖）
 * 输出末尾打印 sha512/size，直接填进 dwp-registry 的 entries/<id>.yml。
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildDayNightPackage, DAYNIGHT_ID, DAYNIGHT_VERSION } from '../src/daynight/pack.ts'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const argv = process.argv.slice(2)
const flag = (name) => argv.includes(name)
const value = (name, dflt) => {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : dflt
}

const dayPath = value('--day', join(homedir(), 'Downloads', 'deepseek212.png'))
const nightPath = value('--night', join(homedir(), 'Downloads', 'deepseek221.png'))
// 高档（8K）图：渲染模式「增强/完整」时使用；缺省文件是下载目录里的本机名（带空格与括号）
const dayHdPath = value('--day-hd', join(homedir(), 'Downloads', 'deepseek212 (1).png'))
const nightHdPath = value('--night-hd', join(homedir(), 'Downloads', 'deepseek221 (1).png'))
const install = !flag('--no-install')
const marketDir = process.env.DSH_DWP_MARKET_DIR ?? join(homedir(), '.dsh-dwp-market')

for (const p of [dayPath, nightPath]) {
  if (!existsSync(p)) { console.error('找不到图片（低档，必需）：' + p); process.exit(2) }
}
const optional = (p) => (existsSync(p) ? new Uint8Array(readFileSync(p)) : undefined)
const dayPng = new Uint8Array(readFileSync(dayPath))
const nightPng = new Uint8Array(readFileSync(nightPath))
const dayHdPng = optional(dayHdPath)
const nightHdPng = optional(nightHdPath)

const pkg = buildDayNightPackage({ dayPng, nightPng, dayHdPng, nightHdPng })
const integrity = 'sha512-' + createHash('sha512').update(pkg).digest('base64')
const outDir = join(ROOT, '_dist', 'daynight')
mkdirSync(outDir, { recursive: true })
const fileName = DAYNIGHT_ID + '-' + DAYNIGHT_VERSION + '.dwp'
const outPath = join(outDir, fileName)
writeFileSync(outPath, pkg)

console.log('低档白天 : ' + dayPath + '  (' + dayPng.length + ' B)')
console.log('低档夜间 : ' + nightPath + '  (' + nightPng.length + ' B)')
console.log('高档白天 : ' + (dayHdPng ? dayHdPath + '  (' + dayHdPng.length + ' B)' : '(缺省 → 回落低档图)'))
console.log('高档夜间 : ' + (nightHdPng ? nightHdPath + '  (' + nightHdPng.length + ' B)' : '(缺省 → 回落低档图)'))
console.log('包       : ' + outPath + '  (' + pkg.length + ' B)')
console.log('id       : ' + DAYNIGHT_ID + '@' + DAYNIGHT_VERSION)
console.log('integrity: ' + integrity)
console.log('size     : ' + pkg.length)

if (install) {
  const pkgsDir = join(marketDir, 'packages')
  mkdirSync(pkgsDir, { recursive: true })
  writeFileSync(join(pkgsDir, DAYNIGHT_ID + '.dwp'), pkg)
  const installedFile = join(marketDir, 'installed.json')
  let list = []
  try { const parsed = JSON.parse(readFileSync(installedFile, 'utf8')); if (Array.isArray(parsed)) list = parsed } catch { /* 首次安装 */ }
  const record = {
    id: DAYNIGHT_ID,
    version: DAYNIGHT_VERSION,
    integrity,
    sourceUrl: 'https://github.com/YRN-playmaker/dwp-releases/releases/download/deepseek-day-night-' + DAYNIGHT_VERSION + '/deepseek-day-night.dwp',
    path: 'packages/' + DAYNIGHT_ID + '.dwp',
    installedAt: new Date().toISOString(),
    commercial: false,
  }
  list = list.filter((r) => r.id !== DAYNIGHT_ID)
  list.push(record)
  writeFileSync(installedFile, JSON.stringify(list, null, 2) + '\n', 'utf8')
  console.log('已安装   : ' + join(pkgsDir, DAYNIGHT_ID + '.dwp'))
  console.log('记账     : ' + installedFile)
}
