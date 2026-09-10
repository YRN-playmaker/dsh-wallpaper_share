/**
 * 「日夜」DWP 壁纸的组包（纯函数，Node 可测）：两档纹理 × 昼夜两层，共 4 个图层的淡入淡出。
 *
 * 为什么包里没有"时间逻辑"：DWP 是**无代码格式**（scene 只有 variables / animations / effects，
 * 没有条件分支，`$var` 也不做算术），所以昼夜与档位都由消费端喂变量实现——
 * 插件的 clock-vars 按本地时间与渲染模式推送：
 *   night_alpha  夜间混合 0..1（v1.0 兼容变量，线上已装的老包仍靠它工作）
 *   night_sd     低档夜层透明度（渲染模式「预览 / 捕获」）
 *   night_hd     高档夜层透明度（渲染模式「增强 / 完整」）
 *   hd_on        1 = 高档纹理档，用来让高档日层盖住低档日层
 *
 * 图层自下而上：day_sd（恒 1 打底）→ day_hd（$hd_on 盖住它）→ night_sd（$night_sd）→ night_hd（$night_hd）。
 * 低档时两个高档层 alpha 全 0、高档时低档夜层 alpha 0，所以任一档位下都只有两张图真正起作用；
 * 且过渡期间 night 层始终不透明覆盖 day 层，不会透出画布底色。
 *
 * `dsh.hdAssets`（scene 顶层扩展字段，core 编译时忽略未知键）：列出"只在高档位需要"的资源，
 * 消费端在低档位把它们换成占位图——于是预览/捕获档**根本不下载、不解码 8K 纹理**，这才叫省。
 */
import { buildZipStored, type ZipEntryIn } from '../workspace/zip.ts'
import type { Manifest, Scene } from '../../vendor/dwp/packages/dwp-core/src/index.ts'

export const DAYNIGHT_ID = 'yrn.deepseek-day-night'
export const DAYNIGHT_VERSION = '1.1.0'
export const DAYNIGHT_WIDTH = 1920
export const DAYNIGHT_HEIGHT = 1080

/** 高档位专用资源（相对包根的路径）；消费端据此决定是否用占位图顶替。 */
export const DAYNIGHT_HD_ASSETS = ['assets/day_hd.png', 'assets/night_hd.png']

/** 组装 scene.json：低档打底 + 高档覆盖，夜层由 $night_sd / $night_hd 分别控制。 */
export function buildDayNightScene(): Scene {
  const full = { anchor: [0.5, 0.5] as [number, number], offset: [0, 0] as [number, number], size: [DAYNIGHT_WIDTH, DAYNIGHT_HEIGHT] as [number, number] }
  const scene = {
    canvas: { width: DAYNIGHT_WIDTH, height: DAYNIGHT_HEIGHT, fit: 'cover' as const, background: '#0b0d12' },
    // 变量必须在这里声明（core 编译期做孤儿引用检测：$night_sd 等无声明会直接报错）
    variables: { night_alpha: 0, hd_on: 0, night_sd: 0, night_hd: 0 },
    layers: [
      { id: 'day_sd', type: 'image' as const, src: 'assets/day.png', ...full },
      { id: 'day_hd', type: 'image' as const, src: 'assets/day_hd.png', ...full },
      { id: 'night_sd', type: 'image' as const, src: 'assets/night.png', ...full },
      { id: 'night_hd', type: 'image' as const, src: 'assets/night_hd.png', ...full },
    ],
    effects: [
      { type: 'opacity' as const, target: 'day_hd', params: { value: '$hd_on' } },
      { type: 'opacity' as const, target: 'night_sd', params: { value: '$night_sd' } },
      { type: 'opacity' as const, target: 'night_hd', params: { value: '$night_hd' } },
    ],
  }
  // 消费端扩展（scene 里多出的键 core 会忽略）
  return { ...scene, dsh: { hdAssets: DAYNIGHT_HD_ASSETS } } as unknown as Scene
}

/** 组装 wallpaper.json（manifest）。 */
export function buildDayNightManifest(opts?: { version?: string; preview?: string; name?: Record<string, string> }): Manifest {
  return {
    format: 'dwp/1.0',
    id: DAYNIGHT_ID,
    version: opts?.version ?? DAYNIGHT_VERSION,
    name: opts?.name ?? { zh: 'DeepSeek 日夜', en: 'DeepSeek Day & Night' },
    author: { name: 'YRN-playmaker', github: 'YRN-playmaker' },
    license: 'CC-BY-4.0',
    rating: 'general',
    type: 'scene',
    entry: 'scene.json',
    preview: opts?.preview ?? 'assets/preview.png',
    resolution: [DAYNIGHT_WIDTH, DAYNIGHT_HEIGHT],
    tags: ['日夜', '时间', '深色'],
  }
}

export interface DayNightAssets {
  /** 低档白天图（06:00–18:00；渲染模式「预览 / 捕获」） */
  dayPng: Uint8Array
  /** 低档夜间图（18:00–06:00；渲染模式「预览 / 捕获」） */
  nightPng: Uint8Array
  /** 高档白天图（渲染模式「增强 / 完整」）；缺省回落低档图 */
  dayHdPng?: Uint8Array
  /** 高档夜间图（渲染模式「增强 / 完整」）；缺省回落低档图 */
  nightHdPng?: Uint8Array
  /** 预览图（库卡片缩略图）；缺省复用低档白天图 */
  previewPng?: Uint8Array
  version?: string
  name?: Record<string, string>
}

/** 组包：wallpaper.json + scene.json + 两档四张 PNG（+ 预览）→ .dwp 字节（确定性输出）。 */
export function buildDayNightPackage(assets: DayNightAssets): Uint8Array {
  const entries: ZipEntryIn[] = [
    { name: 'wallpaper.json', data: new TextEncoder().encode(JSON.stringify(buildDayNightManifest({ version: assets.version, name: assets.name }))) },
    { name: 'scene.json', data: new TextEncoder().encode(JSON.stringify(buildDayNightScene())) },
    { name: 'assets/day.png', data: assets.dayPng },
    { name: 'assets/night.png', data: assets.nightPng },
    { name: 'assets/day_hd.png', data: assets.dayHdPng ?? assets.dayPng },
    { name: 'assets/night_hd.png', data: assets.nightHdPng ?? assets.nightPng },
    { name: 'assets/preview.png', data: assets.previewPng ?? assets.dayPng },
  ]
  return buildZipStored(entries)
}
