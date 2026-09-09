/**
 * 工作区脉搏 DWP 的包资产：气泡/徽章/预览 PNG 纹理（复用 launcher 的零依赖 PNG 编码器）、
 * scene.json / wallpaper.json 组装、stored-zip 打包。纯函数 + 一个组包入口，Node 可测。
 * 变量名与 src/client/pulse-vars.ts 一一对应（PULSE_SLOTS=3）。
 *
 * 布局约定：全部层 anchor [0,0]（设计坐标自左上角起算，1920×1080 设计画布）。
 * 槽位（左下角横排，气泡中心 C）：b1(220,880) b2(500,880) b3(780,880)，间距 280 ≥ 176×1.25（pulse_scale 上限）。
 * 徽章 = 彩色 solid 圆盘（$bN_badge）贴在气泡右上缘 45°（C+(62,−62)），符号文本居中叠上。
 */
import { encodePngRgba } from '../launcher/png.ts'
import { buildZipStored, type ZipEntryIn } from './zip.ts'
import type { Manifest, Scene } from '../../vendor/dwp/packages/dwp-core/src/index.ts'

export const PULSE_ID = 'workspace-pulse'
export const PULSE_VERSION = '1.0.0'

const SLOT_X = [220, 500, 780]
const SLOT_Y = 880
const BUBBLE = 176            // 气泡直径（设计px）
const BADGE = 34              // 徽章直径
const BADGE_DX = 62           // 徽章中心相对气泡中心（45° 右上，≈0.7R）
const BADGE_DY = -62

// ---------- 纹理生成（RGBA 像素 → PNG） ----------

/** 有符号距离圆（r 为半径，1.5px 抗锯齿边缘）。 */
function circleAlpha(dx: number, dy: number, r: number): number {
  const d = Math.sqrt(dx * dx + dy * dy)
  return Math.min(1, Math.max(0, r - d + 1.5))
}

function putPx(rgba: Uint8Array, w: number, x: number, y: number, r: number, g: number, b: number, a: number): void {
  const i = (y * w + x) * 4
  rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b; rgba[i + 3] = Math.round(a * 255)
}

/** 主气泡：径向渐变玻璃感圆（中心 #49526b → 边缘 #171a21）+ 上缘高光 + 下缘压暗。 */
export function renderBubblePng(size = 192): Uint8Array {
  const rgba = new Uint8Array(size * size * 4)
  const c = size / 2, R = size / 2 - 2
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - c, dy = y + 0.5 - c
      const a = circleAlpha(dx, dy, R)
      if (a <= 0) continue
      const d = Math.min(1, Math.sqrt(dx * dx + dy * dy) / Math.max(R, 1))
      const t = 1 - d
      let r = Math.round(23 + 26 * t), g = Math.round(26 + 31 * t), b = Math.round(33 + 39 * t)
      // 下缘压暗（d>0.6 线性到 35%）
      const shade = 1 - 0.35 * Math.max(0, d - 0.6) / 0.4
      r = Math.round(r * shade); g = Math.round(g * shade); b = Math.round(b * shade)
      // 上缘高光：以 (0, 0.45R) 为心的高斯样亮斑
      const hl = Math.max(0, 1 - Math.sqrt(dx * dx + (dy + R * 0.45) ** 2) / (R * 0.75))
      const lift = hl * hl * (1 - d) ** 2
      r = Math.min(255, r + Math.round(70 * lift))
      g = Math.min(255, g + Math.round(80 * lift))
      b = Math.min(255, b + Math.round(95 * lift))
      putPx(rgba, size, x, y, r, g, b, a)
    }
  }
  return encodePngRgba(size, size, rgba)
}

/** 预览卡：深底 + 3 个示例气泡 + 绿/红徽章 + 文案占位条。 */
export function renderPreviewPng(w = 640, h = 360): Uint8Array {
  const rgba = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++) {
    const t = y / (h - 1)
    const r = Math.round(18 - 7 * t), g = Math.round(20 - 7 * t), b = Math.round(26 - 8 * t)
    for (let x = 0; x < w; x++) putPx(rgba, w, x, y, r, g, b, 1)
  }
  const demo = [
    { cx: 0.28, cy: 0.55, R: 58, badge: [63, 185, 80] as const },
    { cx: 0.47, cy: 0.44, R: 48, badge: [248, 81, 73] as const },
    { cx: 0.64, cy: 0.60, R: 42, badge: [63, 185, 80] as const },
  ]
  for (const d of demo) {
    const cX = d.cx * w, cY = d.cy * h
    for (let y = Math.max(0, Math.floor(cY - d.R - 2)); y < Math.min(h, Math.ceil(cY + d.R + 2)); y++) {
      for (let x = Math.max(0, Math.floor(cX - d.R - 2)); x < Math.min(w, Math.ceil(cX + d.R + 2)); x++) {
        const dx = x + 0.5 - cX, dy = y + 0.5 - cY
        const a = circleAlpha(dx, dy, d.R)
        if (a <= 0) continue
        const t = 1 - Math.min(1, Math.sqrt(dx * dx + dy * dy) / d.R)
        const i = (y * w + x) * 4
        rgba[i] = Math.round(23 + 26 * t); rgba[i + 1] = Math.round(26 + 31 * t); rgba[i + 2] = Math.round(33 + 39 * t); rgba[i + 3] = Math.round(a * 255)
      }
    }
    const bx = cX + d.R * 0.72, by = cY - d.R * 0.72, bR = d.R * 0.36
    for (let y = Math.max(0, Math.floor(by - bR - 2)); y < Math.min(h, Math.ceil(by + bR + 2)); y++) {
      for (let x = Math.max(0, Math.floor(bx - bR - 2)); x < Math.min(w, Math.ceil(bx + bR + 2)); x++) {
        const dx = x + 0.5 - bx, dy = y + 0.5 - by
        const a = circleAlpha(dx, dy, bR)
        if (a <= 0) continue
        const i = (y * w + x) * 4
        rgba[i] = d.badge[0]; rgba[i + 1] = d.badge[1]; rgba[i + 2] = d.badge[2]; rgba[i + 3] = Math.round(a * 255)
      }
    }
  }
  return encodePngRgba(w, h, rgba)
}

// ---------- scene / manifest ----------

const FONT = "600 22px 'Segoe UI', 'Microsoft YaHei', sans-serif"
const FONT_SMALL = "500 18px 'Segoe UI', 'Microsoft YaHei', sans-serif"
const FONT_GLYPH = "700 24px 'Segoe UI', sans-serif"

/** 单槽位浮动动画（错相：每槽 1/3 周期相位差，呼吸不齐更像气泡）。 */
function bob(i: number): Scene['layers'][number]['animation'] {
  return { kind: 'oscillate', property: 'offset.y', amplitude: 7, period: 6.5, phase: i * 2.09 }
}

/** 组装 scene.json：3 个气泡槽位（bubble 图 + 名称 + 尺寸徽标 + 徽章盘 + 符号）+ 计数行 + 空闲提示。 */
export function buildPulseScene(): Scene {
  const layers: Scene['layers'] = []
  const vars: Record<string, number | string | boolean> = { ws_count: 0, idle_on: 1, pulse_scale: 1 }
  const fx: Scene['effects'] = []
  const slotOpacity = (id: string, i: number): void => {
    fx.push({ type: 'opacity', target: id, params: { value: `$b${i}_on` } })
  }
  for (let i = 1; i <= 3; i++) {
    const b = `b${i}`
    vars[`${b}_on`] = 0
    vars[`${b}_name`] = ''
    vars[`${b}_glyph`] = ''
    vars[`${b}_badge`] = '#3fb950'
    vars[`${b}_size`] = ''
    const x = SLOT_X[i - 1]!, y = SLOT_Y
    const bobI = bob(i)
    layers.push(
      {
        id: `${b}_bubble`, type: 'image', src: 'assets/bubble.png',
        anchor: [0, 0], offset: [x, y], size: [BUBBLE, BUBBLE],
        scale: '$pulse_scale', animation: bobI,
      },
      {
        id: `${b}_name`, type: 'text', value: `$${b}_name`, font: FONT, color: '#e8ecf4',
        anchor: [0, 0], offset: [x, y + 30],
        scale: '$pulse_scale', animation: bobI,
      },
      {
        id: `${b}_size`, type: 'text', value: `$${b}_size`, font: FONT_SMALL, color: '#9aa4b2',
        anchor: [0, 0], offset: [x, y + 58],
        scale: '$pulse_scale', animation: bobI,
      },
      {
        id: `${b}_badge`, type: 'solid', color: `$${b}_badge`,
        anchor: [0, 0], offset: [x + BADGE_DX, y + BADGE_DY], size: [BADGE, BADGE],
        scale: '$pulse_scale', animation: bobI,
      },
      {
        id: `${b}_glyph`, type: 'text', value: `$${b}_glyph`, font: FONT_GLYPH, color: '#0b0d12',
        anchor: [0, 0], offset: [x + BADGE_DX, y + BADGE_DY + 1],
        scale: '$pulse_scale', animation: bobI,
      },
    )
    for (const id of [`${b}_bubble`, `${b}_name`, `${b}_size`, `${b}_badge`, `${b}_glyph`]) slotOpacity(id, i)
  }
  layers.push(
    {
      id: 'counter', type: 'text', value: '近期改动 ● $ws_count', font: FONT_SMALL, color: '#8b94a3',
      anchor: [0.5, 1], offset: [0, -24],
    },
    {
      id: 'idle', type: 'text', value: '工作区安静中…', font: FONT, color: '#5c6470',
      anchor: [0.5, 0.5], offset: [0, -40],
      animation: { kind: 'oscillate', property: 'alpha', amplitude: 0.12, period: 4.2 },
    },
  )
  fx.push({ type: 'opacity', target: 'idle', params: { value: '$idle_on' } })
  return {
    canvas: { width: 1920, height: 1080, fit: 'cover', background: '#0b0d12' },
    variables: vars,
    layers,
    effects: fx,
  }
}

/** 组装 wallpaper.json（manifest）。 */
export function buildPulseManifest(): Manifest {
  return {
    format: 'dwp/1.0',
    id: PULSE_ID,
    version: PULSE_VERSION,
    name: { zh: '工作区脉搏', en: 'Workspace Pulse' },
    author: { name: 'dsh-wallpaper_share' },
    license: 'MIT',
    rating: 'general',
    type: 'scene',
    entry: 'scene.json',
    preview: 'assets/preview.png',
    resolution: [1920, 1080],
    tags: ['工具', '信息', '工作区'],
    params: [
      {
        key: 'pulse_scale', kind: 'slider',
        label: { zh: '气泡缩放', en: 'Bubble scale' },
        default: 1, min: 0.8, max: 1.25, step: 0.05,
      },
    ],
  }
}

/** 组包：wallpaper.json + scene.json + 2 张 PNG → .dwp 字节（确定性输出）。 */
export function buildPulsePackage(opts?: { bubblePng?: Uint8Array; previewPng?: Uint8Array }): Uint8Array {
  const entries: ZipEntryIn[] = [
    { name: 'wallpaper.json', data: new TextEncoder().encode(JSON.stringify(buildPulseManifest())) },
    { name: 'scene.json', data: new TextEncoder().encode(JSON.stringify(buildPulseScene())) },
    { name: 'assets/bubble.png', data: opts?.bubblePng ?? renderBubblePng() },
    { name: 'assets/preview.png', data: opts?.previewPng ?? renderPreviewPng() },
  ]
  return buildZipStored(entries)
}
