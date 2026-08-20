/**
 * SceneAdapter 协议定义 —— 由 node 半（SceneAdapter/SceneRendererProcess）、
 * 参考 renderer（tools/scene-renderer/scene-renderer.mjs）与浏览器半（SceneCanvas）
 * 三方共用。本文件必须是纯类型 + 常量，不得 import 任何 node 内置模块，
 * 否则浏览器 bundle 无法打包。
 *
 * 三层传输的帧格式：
 *   1. renderer stdout → Node：`[4B LE payloadLen][payload]`
 *   2. Node → 浏览器 WebSocket：`[1B format][4B LE width][4B LE height][payload]`
 *      （payload 为编码帧字节；format=2/3 时为原始 RGBA/BGRA 像素）
 *   3. 控制命令 Node → renderer stdin：换行分隔的 JSON
 */

/** 帧编码格式（renderer 输出 / 浏览器解码） */
export type SceneFrameFormat = 'jpeg' | 'webp' | 'rgba' | 'bgra'

/** 格式字节码：stdout 帧 payload[0] 与 WS 帧第 1 字节共用 */
export const FRAME_FORMAT_CODE: Readonly<Record<SceneFrameFormat, number>> = {
  jpeg: 0,
  webp: 1,
  rgba: 2,
  bgra: 3,
} as const

/** 反向映射（0..3 → 格式名；未知返回 undefined） */
export const FORMAT_CODE_NAME: Readonly<Record<number, SceneFrameFormat>> = {
  0: 'jpeg',
  1: 'webp',
  2: 'rgba',
  3: 'bgra',
} as const

/** WS 帧头：1B format + 4B width + 4B height = 9 字节，之后是编码/像素 payload */
export const WS_HEADER_BYTES = 9

/** renderer stdout 帧头之外的 payload 布局：1B format + 4B width + 4B height = 9 字节 */
export const STDOUT_PAYLOAD_HEADER_BYTES = 9

/** Node → renderer 的 load 命令 */
export interface SceneRenderRequest {
  cmd: 'load'
  /** 绝对 scene.pkg 路径 */
  scene: string
  /** Wallpaper Engine engine assets 目录（shaders/materials/models/particles/effects） */
  assets: string
  width: number
  height: number
  fps: number
  /** JPEG/WebP 质量（0..100），对 rgba/bgra 无意义 */
  quality?: number
}

/** Node → renderer 的运行时控制命令（换行分隔 JSON，每条一行） */
export type SceneControlCommand =
  | { cmd: 'pause' }
  | { cmd: 'resume' }
  | { cmd: 'resize'; width: number; height: number }
  | { cmd: 'stop' }
  | { cmd: 'ping' }

/** renderer 能力/检测结果 */
export interface SceneCapabilities {
  /** 是否存在可执行的 renderer（路径存在且可执行） */
  available: boolean
  /** renderer 自报版本（来自 stderr [VERSION] 行或已知常量） */
  version: string
  /** 展示用 renderer 路径（bin + args 拼接） */
  rendererPath: string
  /** 可执行文件路径（供 spawn，避免空格路径被拆分） */
  bin: string
  /** 启动参数（供 spawn） */
  args: string[]
  /** WE engine assets 目录（解析后的绝对路径） */
  assetsDir: string
  /** assets 目录是否存在 */
  assetsFound: boolean
  /** renderer 支持的帧格式 */
  formats: SceneFrameFormat[]
  /** available=false 时的原因 */
  reason?: string
}

/** renderer 运行时状态（进入 /we-sync/diag） */
export interface SceneRenderStatus {
  state: 'idle' | 'starting' | 'running' | 'paused' | 'crashed' | 'stopped'
  pid?: number
  /** 参考 renderer 每秒上报的平均 FPS；真实 renderer 可空 */
  fps?: number
  /** 累计帧序号（renderer 上报时使用） */
  frameIndex?: number
  /** 最近一帧编码/到达耗时（毫秒） */
  frameTimeMs?: number
  resolution?: { width: number; height: number }
  lastError?: string
  /** 已自动重启次数 */
  restarts: number
}

/** 一帧（Node 内表示，浏览器侧自行按 WS 头解析） */
export interface SceneFrame {
  format: SceneFrameFormat
  width: number
  height: number
  /** jpeg/webp = 编码字节；rgba/bgra = 原始像素 */
  data: Uint8Array
  /** 到达时间戳（毫秒） */
  ts: number
}
