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
import { DAYNIGHT_TAB_SCENE } from './tab-scene.ts'
import type { Manifest, Scene } from '../../vendor/dwp/packages/dwp-core/src/index.ts'

export const DAYNIGHT_ID = 'yrn.deepseek-day-night'
export const DAYNIGHT_VERSION = '1.3.2'
export const DAYNIGHT_TAB_CLIENT_VERSION = '26.10.13-D'
export const DAYNIGHT_WIDTH = 1920
export const DAYNIGHT_HEIGHT = 1080

/** 高档位专用资源（相对包根的路径）；消费端据此决定是否用占位图顶替。 */
export const DAYNIGHT_HD_ASSETS = ['assets/day_hd.png', 'assets/night_hd.png']

/** 组装 scene.json：低档打底 + 高档覆盖，夜层由 $night_sd / $night_hd 分别控制。 */
export function buildDayNightScene(withTabScene = false): Scene {
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
  return { ...scene, dsh: { hdAssets: DAYNIGHT_HD_ASSETS, ...(withTabScene ? { tabScene: DAYNIGHT_TAB_SCENE } : {}) } } as unknown as Scene
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
  /** Portrait and ten foam cels keyed by their package paths. */
  tabAssets?: Record<string, Uint8Array>
}

/** 组包：wallpaper.json + scene.json + 两档四张 PNG（+ 预览）→ .dwp 字节（确定性输出）。 */
export function buildDayNightPackage(assets: DayNightAssets): Uint8Array {
  const entries: ZipEntryIn[] = [
    { name: 'README.md', data: new TextEncoder().encode(
      '# DeepSeek Day & Night / DeepSeek 日夜\n\n'
      + `DWP ${assets.version ?? DAYNIGHT_VERSION} preserves the day/night crossfade and SD/HD textures.\n\n`
      + (assets.tabAssets ? `Underwater tab animation requires dsh-wallpaper_share ${DAYNIGHT_TAB_CLIENT_VERSION} or later. The portrait, ten splash cels and visual settings are included in this DWP. Open wallpaper_share to enter the water; scroll down to dive deeper and fade the surface reflections. Flat illustrated bubbles and moving caustics run only in Complete mode. Focus + Complete adds a 1–4px breathing blur.\n\n入水页面效果需要 dsh-wallpaper_share ${DAYNIGHT_TAB_CLIENT_VERSION} 或新版插件。人物、水花帧和视觉参数均在此 DWP 内；进入 wallpaper_share 播放入水，滚轮下滑加深水色并淡出水面光斑，离开页面播放退出。二维气泡和动态焦散仅在「完整」模式显示；专注 + 完整时启用 1–4px 呼吸模糊。普通 DWP 播放器仅显示日夜场景。\n\n` : '')
      + (assets.tabAssets ? 'Install dsh-wallpaper_share-26.10.13-D.tgz from the companion plugin release, restart Harness, and remount DWP 1.3.2. Preview keeps the daytime blue underwater page and cheaper effects regardless of local time; Complete enables the richer day/night effects.\n\n安装配套插件 dsh-wallpaper_share-26.10.13-D.tgz，重启 Harness 后重新挂载 DWP 1.3.2。预览页面固定白天蓝色与低开销效果，不随本地时间变化；完整模式启用丰富的日夜特效。\n\n' : '')
      + (assets.tabAssets ? 'Complete mode follows the existing day/night clock: 18:00–18:10 fades to a muted amber / terracotta / deep-red sea (#CF8247, #CD5D3D, #BC443F, #A73F3A), and 05:50–06:00 returns to blue. The base gradient has about 21% lower mean sRGB relative luminance than the initial orange-red palette, with lower Oklab chroma. The global portrait color layer fades completely out at night, leaving a deep burgundy #320f20 silhouette at the same 75% opacity. Independent bubble windows still reveal portrait details at 1.35x. Surface light and bubbles use softer warm accents; bottom dots and sidebar shading follow the silhouette color. Palette changes reuse cached textures and preserve scroll and motion. Colors and portrait visibility are stored in nightPalette; Preview/Capture retain their original palette.\n\n完整模式沿用原有昼夜时钟：18:00–18:10 渐变进入柔和的琥珀、砖红与深红水色（#CF8247、#CD5D3D、#BC443F、#A73F3A），05:50–06:00 渐变回蓝色。相对首版橙红配色，基础渐变的平均 sRGB 相对亮度降低约 21%，Oklab 色度也降低。人物全局彩色层在夜间完全淡出，成为深酒红 #320f20 的完整剪影，保持 75% 不透明度；气泡内独立的原图细节窗口和 1.35 倍放大保留。水面光纹与气泡使用柔和暖色，底部圆点和侧边栏同步剪影底色。配色过渡复用贴图缓存，保留滚动位置与运动。颜色与人物可见度参数保存在 nightPalette，预览与捕获保留原有配色。\n\n' : '')
      + (assets.tabAssets ? '1.3.2: In Complete mode, smooth ellipsoid bubbles tilt along their path and deform using a Weber-number aspect ratio and damped quadrupole response. Persistent bubbles are capped at 12; entry droplets are excluded. A uniform 10% white fill in the lower half crossfades to upper highlights, soft haze and inner lower shadows after crossing the screen midpoint, completing at one-quarter screen height. Haze uses a single cached 128x128 texture, without per-frame bubble blur. A closed convex ellipse replaces the indented skirt; a larger inner window reveals portrait detail and magnifies the current frame up to 1.35x. Seeded speeds and staggered births vary lanes and sizes each lifetime. Bottom dots share the silhouette color. Shape, physical mapping, lighting, paint, lens and motion parameters live in scene.json. Preview/Capture keep ordinary bubbles. Requires plugin 26.10.13-D or later; earlier published assets are preserved.\n\n1.3.2：完整模式下，二维气泡以封闭的扁椭球截面代替凹底和裙摆，使用 Weber 数和阻尼二阶模态映射形变，倾斜方向跟随轨迹切线。持续上浮气泡最多 12 个，入场小泡泡除外。下半屏保留不透明度 10% 的白色遮罩；上浮越过屏幕中线后，白色遮罩逐渐淡出，上方高光、柔和雾光与内部下侧阴影同步淡入，在上方四分之一处完成。雾光使用单张 128×128 缓存贴图，无需每帧模糊。移动气泡经过人物时，局部显露原图细节并将实时画面放大至 1.35 倍。出现间隔、位置、大小与速度使用伪随机，逐轮重新分布；底部圆点与剪影同色。形状、物理映射、光照、白色遮罩、透镜和运动参数保存在 scene.json，预览与捕获保留普通气泡。需要 26.10.13-D 或新版插件；旧版已发布资产保留。\n\n' : '')
      + (assets.tabAssets ? 'Complete-mode night entry colorizes the existing foam cels to warm orange/gold using the declarative nightPalette.splash.tone filter. Alpha edges, highlights, frame exposures and centered cropping are preserved. Detached entry bubbles use #F2CA92. One cel-sized cache is reused for repeated exposures and released after entry; day, Preview and Capture retain the blue artwork.\n\n完整模式夜间通过 nightPalette.splash.tone 将原有水花帧后处理为橙金色，保留透明边缘、亮暗层次、帧时序与居中裁切，入场临时小泡泡同步为 #F2CA92。重复曝光复用单帧尺寸缓存，入水结束释放；白天、预览和捕获保留原蓝色素材。\n\n' : '')
      + 'Sidebar fish silhouettes require dsh-wallpaper_share 26.10.9-D or later. '
      + 'Install/upgrade the plugin, restart Harness, then mount this wallpaper. '
      + 'Selected sidebar items show swimming dark fish; hover alone has no fish. Complete-mode nights use bright coral-red selection (#E94650) and a lighter hover (#F15B63), configured in nightPalette.ui; day and other modes stay blue. '
      + 'The DeepSeek brand button is excluded. Reduced-motion preferences stop swimming.\n\n'
      + '侧边栏鱼剪影需要 dsh-wallpaper_share 26.10.9-D 或新版插件；升级插件并重启 Harness 后挂载本壁纸。'
      + '选中项显示深色游鱼，普通悬停不显示游鱼；完整模式夜间选中为亮珊瑚红（#E94650），悬停更亮（#F15B63），参数位于 nightPalette.ui，白天及其他模式保持蓝色。品牌按钮除外。系统减少动态效果时游鱼静止。'
      + '仅更新 DWP 包不会给旧插件增加侧边栏效果。\n\n'
      + 'Plugin: https://github.com/YRN-playmaker/dsh-wallpaper_share\n'
    ) },
    { name: 'wallpaper.json', data: new TextEncoder().encode(JSON.stringify(buildDayNightManifest({ version: assets.version, name: assets.name }))) },
    { name: 'scene.json', data: new TextEncoder().encode(JSON.stringify(buildDayNightScene(assets.tabAssets !== undefined))) },
    { name: 'assets/day.png', data: assets.dayPng },
    { name: 'assets/night.png', data: assets.nightPng },
    { name: 'assets/day_hd.png', data: assets.dayHdPng ?? assets.dayPng },
    { name: 'assets/night_hd.png', data: assets.nightHdPng ?? assets.nightPng },
    { name: 'assets/preview.png', data: assets.previewPng ?? assets.dayPng },
  ]
  if (assets.tabAssets) {
    for (const name of [DAYNIGHT_TAB_SCENE.portrait, ...DAYNIGHT_TAB_SCENE.foam]) {
      const data = assets.tabAssets[name]
      if (!data?.length) throw new Error('Missing DWP tab asset: ' + name)
      entries.push({ name, data })
    }
    entries.push({ name: 'TAB-SCENE.md', data: new TextEncoder().encode(
      '# Tab scene extension\n\nThis package contains the portrait, ten foam cels and all entry/exit, scroll, silhouette gradient, Complete-only nightPalette and breathing blur settings in scene.json → dsh.tabScene.\n\n'
      + `This is declarative data, not executable package code. A host supporting dsh/tab-scene/1 must provide tab visibility, scroll progress, focus and quality state. Standard DWP 1.0 players still render the day/night scene but ignore this extension. Requires dsh-wallpaper_share ${DAYNIGHT_TAB_CLIENT_VERSION} or later. Surface light stays at the top and fades out by surfaceLight.scrollFadeEnd (0.65 of the scroll range).\n`
    ) })
  }
  return buildZipStored(entries)
}
