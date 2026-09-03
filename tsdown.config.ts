// 独立构建配置（不依赖 DSH checkout）
// 产物：lib/index.js（node 半，ESM）+ lib/client.js（浏览器半，CJS + 模块加载器）
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

// @dwp 运行时（dwp-runtime-web 仓，MIT）本地源码集成：client 半用 dwp-web 的 mount() 渲染 DWP。
// 本地开发用 alias 直引源码；正式发布应改为 npm 依赖（见 docs）。目录不存在时 alias 为空（不破坏无该目录的构建）。
const ROOT = fileURLToPath(new URL('.', import.meta.url))

// 插件版本：构建期从 package.json 读一次，define 进 client 半（浏览器里没有 process）。
const PKG_VERSION: string = (JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version?: string }).version ?? 'dev'
const dwpPkg = (n: string): string => join(ROOT, 'dwp-runtime-web/packages', n, 'src/index.ts')
const DWP_ALIAS = existsSync(dwpPkg('dwp-web'))
  ? { 'dwp-web': dwpPkg('dwp-web'), 'dwp-core': dwpPkg('dwp-core'), 'dwp-gl': dwpPkg('dwp-gl') }
  : {}

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
    resolve: { alias: DWP_ALIAS },
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
