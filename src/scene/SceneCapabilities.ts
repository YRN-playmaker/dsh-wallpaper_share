/**
 * Scene renderer 能力探测。
 * 只负责回答"是否存在可用的 renderer"与"assets 是否齐备"，
 * 不做任何渲染。被 SceneAdapter 调用并缓存结果。
 */
import { existsSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { SceneCapabilities, SceneFrameFormat } from './SceneProtocol.ts'

/** SceneAdapter 的静态配置（与 src/index.ts 的 CONFIG 场景字段对应） */
export interface SceneRendererConfig {
  /** 显式指定的 renderer 可执行文件路径；留空则尝试内置参考 renderer */
  sceneRendererPath: string
  /** 显式指定的 WE engine assets 目录；留空则自动 <weDir>/assets */
  wallpaperEngineAssetsDir: string
}

/** 内置参考 renderer 的静态标识（真 renderer 通过 [VERSION] 行自报，不走到这里） */
const REFERENCE_VERSION = 'reference-0.1.0'

/** 内置参考 renderer 支持的格式（RGBA 动画测试画面） */
const REFERENCE_FORMATS: SceneFrameFormat[] = ['rgba']

/** 探测 renderer 二进制是否存在；存在则返回解析后的 {path, args, version} */
function probeRenderer(config: SceneRendererConfig, weDir: string): { path: string; args: string[]; version: string } | null {
  // 1. 用户显式指定的 renderer（最高优先级）
  if (config.sceneRendererPath.trim() !== '') {
    const path = config.sceneRendererPath.trim()
    if (existsSync(path)) return { path, args: [], version: probeVersion(path) }
    return null
  }
  // 2. 原生捕获器 we-capture.exe（随包 bin/ 或本地构建 target/release/）——真·原生渲染，优先于参考 renderer
  const cap = resolveBundledCapture()
  if (cap !== null) {
    return { path: cap, args: [], version: probeVersion(cap) }
  }
  // 3. 内置参考 renderer（用宿主 node 进程执行 .mjs，无需额外 exe）
  const ref = resolveReferenceRenderer()
  if (ref !== null && existsSync(ref)) {
    return { path: process.execPath, args: [ref], version: REFERENCE_VERSION }
  }
  return null
}

/** 定位原生捕获器 we-capture.exe：随包 bin/ 或本地构建 native/we-capture/target/release/ */
function resolveBundledCapture(): string | null {
  try {
    const here = fileURLToPath(import.meta.url)
    const pkgRoot = resolve(dirname(here), '..')
    const name = process.platform === 'win32' ? 'we-capture.exe' : 'we-capture'
    const cands = [
      resolve(pkgRoot, 'bin', name),
      resolve(pkgRoot, 'native', 'we-capture', 'target', 'release', name),
    ]
    for (const c of cands) if (existsSync(c)) return c
    return null
  } catch {
    return null
  }
}

/** 定位随包发布的内置参考 renderer（<包根>/tools/scene-renderer/scene-renderer.mjs，与 lib/ 同级） */
function resolveReferenceRenderer(): string | null {
  try {
    const here = fileURLToPath(import.meta.url) // <包根>/lib/index.js
    return resolve(dirname(here), '..', 'tools', 'scene-renderer', 'scene-renderer.mjs')
  } catch {
    // import.meta.url 不可用（罕见），回退 cwd 相对路径
    return resolve(process.cwd(), 'tools', 'scene-renderer', 'scene-renderer.mjs')
  }
}

/** 尝试读取 renderer 的 --version 输出；失败返回空串（真 renderer 可稍后经 [VERSION] 自报） */
function probeVersion(path: string): string {
  try {
    const out = execFileSync(path, ['--version'], { encoding: 'utf8', timeout: 3000, windowsHide: true })
    const first = out.split(/\r?\n/).find((l) => l.trim() !== '')
    return first !== undefined ? first.trim().slice(0, 64) : ''
  } catch {
    return ''
  }
}

/** 探测 WE engine assets 目录：显式 > 自动 <weDir>/assets */
export function resolveAssetsDir(config: SceneRendererConfig, weDir: string): string {
  if (config.wallpaperEngineAssetsDir.trim() !== '') return config.wallpaperEngineAssetsDir.trim()
  return weDir.replace(/[\\/]+$/, '') + '/assets'
}

/** 汇总 renderer 能力与 assets 齐备情况（结果被 SceneAdapter 缓存） */
export function detectSceneRenderer(config: SceneRendererConfig, weDir: string): SceneCapabilities {
  const assetsDir = resolveAssetsDir(config, weDir)
  const assetsFound = existsSync(assetsDir + '/shaders') || existsSync(assetsDir)
  const probe = probeRenderer(config, weDir)
  if (probe === null) {
    return {
      available: false,
      version: '',
      rendererPath: config.sceneRendererPath.trim(),
      bin: '',
      args: [],
      assetsDir,
      assetsFound,
      formats: [],
      reason: 'Scene renderer not found：请设置 CONFIG.sceneRendererPath，或安装内置参考 renderer',
    }
  }
  const isReference = probe.version === REFERENCE_VERSION
  return {
    available: true,
    version: probe.version !== '' ? probe.version : (isReference ? REFERENCE_VERSION : ''),
    rendererPath: probe.path + (probe.args.length > 0 ? ' ' + probe.args.join(' ') : ''),
    bin: probe.path,
    args: probe.args,
    assetsDir,
    assetsFound,
    formats: isReference ? REFERENCE_FORMATS : ['jpeg', 'webp', 'rgba', 'bgra'],
  }
}

/** 是否为真·原生 renderer（非内置参考 renderer）：参考 renderer 仅支持 rgba，原生捕获器支持 jpeg */
export function isNativeRenderer(cap: SceneCapabilities | null): boolean {
  return cap !== null && cap.available && cap.version !== REFERENCE_VERSION && cap.formats.includes('jpeg')
}

/** 计算 scene 指纹：绝对路径 + size + mtime，避免旧 scene 缓存串台 */
export function sceneFingerprint(pkgPath: string): string {
  try {
    const st = statSync(pkgPath)
    return pkgPath + '|' + st.size + '|' + Math.floor(st.mtimeMs)
  } catch {
    return pkgPath + '|unknown'
  }
}
