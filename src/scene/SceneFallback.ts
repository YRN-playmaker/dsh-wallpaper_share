/**
 * Scene fallback 链决策（纯函数，node 半用于 /we-sync/diag 与日志）。
 *
 * 完整链：
 *   Real Scene Renderer  → 失败/不可用
 *   Extracted Scene Texture（scanPkgImage） → 失败
 *   Preview Image（preview.jpg/png） → 失败
 *   Existing generic fallback（纯色阴影）
 */
import type { SceneRenderStatus } from './SceneProtocol.ts'

export type SceneFallbackLevel = 'renderer' | 'texture' | 'preview' | 'generic'

export interface SceneFallbackResult {
  level: SceneFallbackLevel
  reason: string
}

export function resolveSceneFallback(opts: {
  kind: string
  rendererRunning: boolean
  rendererAvailable: boolean
  hasTexture: boolean
  hasPreview: boolean
  renderMode: 'preview' | 'source'
}): SceneFallbackResult {
  const { kind, rendererRunning, rendererAvailable, hasTexture, hasPreview, renderMode } = opts
  if (kind !== 'scene') {
    return { level: 'generic', reason: 'not a scene wallpaper (' + kind + ')' }
  }
  if (renderMode !== 'source') {
    // 性能模式：scene 一律走预览，不用 renderer
    return hasPreview
      ? { level: 'preview', reason: 'render mode is preview (static preview image)' }
      : { level: 'generic', reason: 'no preview and render mode is preview' }
  }
  if (rendererRunning) {
    return { level: 'renderer', reason: 'live scene renderer streaming frames' }
  }
  if (hasTexture) {
    return {
      level: 'texture',
      reason: rendererAvailable
        ? 'renderer not running (crashed/unavailable) → extracted scene texture'
        : 'renderer not found → extracted scene texture',
    }
  }
  if (hasPreview) {
    return { level: 'preview', reason: 'no renderer and no extractable texture → preview image' }
  }
  return { level: 'generic', reason: 'no renderer, no texture, no preview → generic background' }
}

/** 把状态收敛成一句话日志（供 diag 与 stderr） */
export function describeSceneStatus(status: SceneRenderStatus | null, fallback: SceneFallbackResult): string {
  if (status === null) return 'renderer unavailable → ' + fallback.level
  return status.state + (status.fps !== undefined ? ' @' + status.fps.toFixed(1) + 'fps' : '') + ' → ' + fallback.level
}
