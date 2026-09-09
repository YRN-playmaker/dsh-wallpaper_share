// 独立构建配置（不依赖 DSH checkout）
// 产物：lib/index.js（node 半，ESM）+ lib/client.js（浏览器半，CJS + 模块加载器）
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, resolve } from 'node:path'

const ROOT = fileURLToPath(new URL('.', import.meta.url))

// @dwp 参考运行时（MIT）内联：client 半用 dwp-web 的 mount() 渲染 DWP。
// 源码快照随仓库分发（vendor/dwp，见其 README），保证干净 clone 也能复现构建；
// 旧的"目录缺失即把 alias 置空"会静默产出带未解析 require('dwp-web') 的坏包，
// 这里改为**缺入口即报错终止**。联调实时克隆用 DSH_WESYNC_DWP_DIR 显式指定。
const DWP_PACKAGES = ['dwp-core', 'dwp-gl', 'dwp-web'] as const
const dwpEntry = (root: string, pkg: string): string => join(root, 'packages', pkg, 'src/index.ts')

function resolveDwpRoot(): string {
  const override = (process.env.DSH_WESYNC_DWP_DIR ?? '').trim()
  const candidates = override === '' ? [join(ROOT, 'vendor/dwp')] : [resolve(ROOT, override)]
  const problems: string[] = []
  for (const root of candidates) {
    const missing = DWP_PACKAGES.filter((pkg) => !existsSync(dwpEntry(root, pkg)))
    if (missing.length === 0) return root
    problems.push('  ' + root + ' → 缺少 packages/{' + missing.join(',') + '}/src/index.ts')
  }
  throw new Error(
    'DWP 运行时源码缺失，构建已终止（不会产出坏包）：\n' + problems.join('\n') + '\n'
    + '修复：干净 clone 应自带 vendor/dwp/packages/{dwp-core,dwp-gl,dwp-web}/src/index.ts；\n'
    + '      联调实时克隆时设置 DSH_WESYNC_DWP_DIR=<dwp-runtime-web 路径>。详见 vendor/dwp/README.md。',
  )
}

const DWP_ROOT = resolveDwpRoot()
const DWP_ALIAS: Record<string, string> = Object.fromEntries(
  DWP_PACKAGES.map((pkg) => [pkg, dwpEntry(DWP_ROOT, pkg)]),
)
// 联调提示：本机存在独立克隆但没显式指定时，构建用的是快照，避免"改了源码没生效"的困惑
if (process.env.DSH_WESYNC_DWP_DIR === undefined && existsSync(join(ROOT, 'dwp-runtime-web/packages/dwp-web/src/index.ts'))) {
  console.log('[dsh-wallpaper_share] DWP 运行时使用快照 vendor/dwp；联调实时克隆请设 DSH_WESYNC_DWP_DIR=dwp-runtime-web')
}

// 插件版本：构建期从 package.json 读一次，define 进 client 半（浏览器里没有 process）。
const PKG_VERSION: string = (JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version?: string }).version ?? 'dev'

const PLATFORM_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
]

export default [
  {
    name: 'dsh-wallpaper_share',
    entry: { index: 'src/index.ts' },
    outDir: 'lib',
    format: 'esm',
    platform: 'node',
    target: 'es2022',
    dts: false,
    clean: false,
    sourcemap: false,
    deps: { neverBundle: [...PLATFORM_EXTERNALS] },
    outputOptions: {
      entryFileNames: 'index.js',
    },
  },
  {
    name: 'dsh-wallpaper_share/client',
    entry: { client: 'src/client/index.ts' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    dts: false,
    clean: false,
    sourcemap: true,
    // 注意：这里必须用 tsdown 的**顶层** alias（它才转发给 rolldown）。
    // 旧配置把它写在 resolve.alias 下，tsdown 0.22 只从 Vite 配置里读该项，
    // 于是那段 alias 一直没生效 —— 实际解析靠的是 tsconfig.json 的 paths。
    // 现在两条路径都指向 vendor/dwp 快照，且都经 resolveDwpRoot() 校验。
    alias: DWP_ALIAS,
    deps: { neverBundle: [...PLATFORM_EXTERNALS] },
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'process.env.DSH_WESYNC_VERSION': JSON.stringify(PKG_VERSION),
      'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
    },
    outputOptions: {
      entryFileNames: 'client.js',
      banner: 'window.__ModuleLoader__.load({ id: "dsh-wallpaper_share", factory: (require) => {',
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
]
