import { mixTabScenePalette, parseTabScene, type TabScene } from '../daynight/tab-scene.ts'
import { clockVars } from './clock-vars.ts'

const load = async (url: string): Promise<HTMLImageElement> => {
  const image = new Image()
  image.src = url
  await image.decode()
  return image
}
const clamp = (x: number): number => Math.max(0, Math.min(1, x))
const smooth = (x: number): number => { const p = clamp(x); return p * p * (3 - 2 * p) }
/** Decelerating entry: high initial velocity, then water resistance settles it. */
export function entryProgress(t: number, entry: TabScene['entry']): number {
  const progress = clamp((t - entry.start) / entry.duration)
  return entry.easing === 'cubic-out' ? 1 - (1 - progress) ** 3 : smooth(progress)
}

/** The figure pushes the leading edge deepest; the shoulders then catch up. */
export function entryWaterEdge(x: number, progress: number, center: number, curve: NonNullable<TabScene['entryCurve']>): number {
  const r = clamp(progress)
  const delay = curve.shoulderDelay ?? 0
  const shoulder = curve.shoulderDelay === undefined ? r * r : smooth((r - delay) / (1 - delay))
  const tip = 1 - (1 - r) ** (curve.tipPower ?? 2)
  const spreadStart = curve.spreadStart ?? 0
  const spread = curve.spreadStart === undefined ? r : smooth((r - spreadStart) / (1 - spreadStart))
  const width = curve.width + (curve.spread - curve.width) * spread
  const distance = (x - center) / width
  return shoulder + (tip - shoulder) * (curve.depthScale ?? 1) * Math.exp(-distance * distance)
}

// The reference settles into underwater motion around 0.8s. Keep the supplied
// ten drawings as discrete cels, with exposure lengths on a 24fps timeline.
let finishPendingExit: (() => void) | undefined
let pendingThemePresence = 0
let pendingThemeBaseline: ThemePalette | undefined

const themeTokens = ['--dsw-alias-bg-base', '--dsw-alias-bg-layer-1', '--dsw-alias-bg-layer-2', '--dsw-specific-sidebar-fill', '--dsw-alias-label-primary', '--dsw-alias-label-secondary', '--dsw-alias-label-tertiary', '--dsw-alias-label-dimmed', '--dsw-alias-button-elevated-fill', '--dsw-alias-button-floating-fill', '--dsw-alias-button-floating-hover', '--dsw-alias-border-l1', '--dsw-alias-border-l2', '--wesync-sidebar-hover-fill', '--wesync-sidebar-selected-fill'] as const
type ThemePalette = Record<string, string>

/** Interpolate the actual tokens so newly mounted page containers also inherit
 * the in-between palette, instead of painting their final wash immediately. */
function blendColor(from: string, to: string, presence: number): string {
  if (presence >= 1) return to
  if (presence <= 0) return from || 'transparent'
  const channels = (color: string): number[] | undefined => {
    if (!color || color === 'transparent') return [0, 0, 0, 0]
    const hex = color.match(/^#([\da-f]{3,8})$/i)?.[1]
    if (hex) {
      const full = hex.length <= 4 ? [...hex].map(c => c + c).join('') : hex
      return [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16)).concat(full.length === 8 ? parseInt(full.slice(6), 16) / 255 : 1)
    }
    const rgb = color.match(/^rgba?\(([^)]+)\)$/)?.[1].split(/[,\s/]+/).filter(Boolean).map(Number)
    return rgb?.length === 3 ? [...rgb, 1] : rgb?.length === 4 ? rgb : undefined
  }
  const a = channels(from.trim()), b = channels(to.trim())
  if (!a || !b || ![...a, ...b].every(Number.isFinite)) return to
  const values = a.map((v, i) => v + (b[i] - v) * presence)
  return `rgba(${values.slice(0, 3).map(Math.round).join(',')},${values[3].toFixed(3)})`
}

/** Shared with the host background settings and the standalone preview. */
export function dayNightVisualCss(blurPx: number, scale: number, breathing?: TabScene['focus']): string {
  const normal = 'canvas[data-daynight-dive="1"] { filter: ' + (blurPx > 0 ? 'blur(' + blurPx + 'px)' : 'none') + '; transform: scale(' + scale.toFixed(3) + '); }'
  if (!breathing) return normal
  return normal + `
    @keyframes wesync-dive-breathe { 0%, 100% { filter: blur(${breathing.minBlur}px); } 50% { filter: blur(${breathing.maxBlur}px); } }
    canvas[data-daynight-dive="1"] { transform: scale(${breathing.scale}); animation: wesync-dive-breathe ${breathing.duration}s ease-in-out infinite; }
    body:has(canvas[data-daynight-dive="1"]) [data-wesync-focus-lens="1"] { display: none; }
    @media (prefers-reduced-motion: reduce) {
      canvas[data-daynight-dive="1"] { animation: none; filter: blur(${(breathing.minBlur + breathing.maxBlur) / 2}px); }
    }
  `
}

/** Keep page-wide washes thin, and preserve contrast on local reading surfaces. */
export function tabSceneThemeCss(ui: TabScene['ui'], panelAlpha: number, sidebarInk = '#031633', presence = 1, baseline: ThemePalette = {}): string {
  if (!ui) return ''
  const amount = clamp(panelAlpha / 100)
  const alpha = (base: number, influence = ui.sliderInfluence): string => Math.min(0.96, base + amount * influence).toFixed(3)
  const scope = 'body:has(canvas[data-daynight-dive="1"])'
  const color = (key: string, target: string): string => blendColor(baseline[key] ?? '', target, presence)
  const accent = (key: string, target: string | undefined): string => blendColor(baseline[key] || '#2563eb', target ?? '#2563eb', presence)
  const sidebarFill = blendColor(baseline['--dsw-specific-sidebar-fill'] ?? '', 'transparent', presence)
  const theme = (dark: boolean): string => {
    const s = scope + (dark ? '[data-ds-dark-theme]' : ':not([data-ds-dark-theme])')
    const page = dark ? '15,16,20' : '246,247,250'
    const layer = dark ? '24,26,32' : '255,255,255'
    const sidebar = [1, 3, 5].map(i => parseInt(sidebarInk.slice(i, i + 2), 16)).join(',')
    const cardAlpha = dark ? ui.darkCardAlpha : ui.lightCardAlpha
    return `${s} {
      --wesync-tab-ui-presence: ${presence.toFixed(3)};
      --wesync-sidebar-hover-fill: ${accent('--wesync-sidebar-hover-fill', ui.hoverColor)};
      --wesync-sidebar-selected-fill: ${accent('--wesync-sidebar-selected-fill', ui.selectedColor)};
      --dsw-alias-bg-base: ${color('--dsw-alias-bg-base', `rgba(${page},${alpha(ui.pageAlpha)})`)} !important;
      --dsw-alias-bg-layer-1: ${color('--dsw-alias-bg-layer-1', `rgba(${layer},${alpha(ui.layerAlpha)})`)} !important;
      --dsw-alias-bg-layer-2: ${color('--dsw-alias-bg-layer-2', `rgba(${layer},${alpha(ui.layerAlpha)})`)} !important;
      --dsw-specific-sidebar-fill: ${color('--dsw-specific-sidebar-fill', `rgba(${sidebar},${alpha(dark ? ui.darkSidebarAlpha : ui.lightSidebarAlpha)})`)} !important;
    }
    ${s} [class*="sidebarCol"] {
      --dsw-alias-label-primary: ${color('--dsw-alias-label-primary', '#eef8ff')};
      --dsw-alias-label-secondary: ${color('--dsw-alias-label-secondary', '#c4dbea')};
      --dsw-alias-label-tertiary: ${color('--dsw-alias-label-tertiary', '#a4c0d3')};
      --dsw-alias-label-dimmed: ${color('--dsw-alias-label-dimmed', '#829eaf')};
      --dsw-alias-button-elevated-fill: ${color('--dsw-alias-button-elevated-fill', 'rgba(231,246,255,0.12)')};
      --dsw-alias-button-floating-fill: ${color('--dsw-alias-button-floating-fill', 'rgba(231,246,255,0.14)')};
      --dsw-alias-button-floating-hover: ${color('--dsw-alias-button-floating-hover', 'rgba(231,246,255,0.22)')};
      --dsw-alias-border-l2: ${color('--dsw-alias-border-l2', 'rgba(177,224,255,0.18)')};
      background-color: ${sidebarFill} !important;
      border-right-color: ${color('--dsw-alias-border-l1', 'rgba(177,224,255,0.08)')};
    }
    ${s} :is([class*="sidebarCol"] > [class*="_root"], [class*="sidebarCol"] [class*="_root"]:has(> [class*="logoRow"])) { background-color: ${sidebarFill} !important; }
    ${s} .wesync-card {
      --dsw-alias-bg-base: rgba(${layer},${alpha(cardAlpha)});
      --dsw-alias-bg-layer-1: rgba(${layer},${alpha(cardAlpha)});
      --dsw-alias-bg-layer-2: rgba(${layer},${alpha(cardAlpha + 0.06)});
      background-color: var(--dsw-alias-bg-layer-1);
      backdrop-filter: blur(${ui.cardBlur}px);
      -webkit-backdrop-filter: blur(${ui.cardBlur}px);
    }
    ${s} [data-conversation-scroll] { background-color: transparent; }`
  }
  return theme(true) + theme(false)
}

/** Keep transitions alive while the outgoing canvas reveals the next page.
 * The sidebar has one feathered wash, rather than two stacked solid fills.
 */
export function tabSceneTransitionCss(ui: TabScene['ui'], panelAlpha: number, sidebarInk: string): string {
  if (!ui) return ''
  const scope = 'body:has(canvas[data-daynight-dive="1"])'
  const rgb = [1, 3, 5].map(i => parseInt(sidebarInk.slice(i, i + 2), 16)).join(',')
  const gradient = (alpha: number): string => `linear-gradient(90deg, rgba(${rgb},${alpha}) 0%, rgba(${rgb},${alpha * 0.8}) 42%, rgba(${rgb},0) 100%)`
  const amount = clamp(panelAlpha / 100) * ui.sliderInfluence
  return `${scope} [class*="sidebarCol"] { position: relative; }
  ${scope} :is([class*="sidebarCol"] > [class*="_root"], [class*="sidebarCol"] [class*="_root"]:has(> [class*="logoRow"])) { position: relative; z-index: 1; }
  ${scope} [class*="sidebarCol"]::before {
    content: ''; position: absolute; inset: 0; pointer-events: none;
    background: ${gradient(Math.min(0.96, ui.lightSidebarAlpha + amount))};
    opacity: var(--wesync-tab-ui-presence, 0);
  }
  ${scope}[data-ds-dark-theme] [class*="sidebarCol"]::before { background: ${gradient(Math.min(0.96, ui.darkSidebarAlpha + amount))}; }
  `
}
export function splashAt(t: number, profile: TabScene): { frame: number; alpha: number; progress: number } | null {
  const cel = Math.floor((t - profile.splash.start) * profile.splash.fps)
  if (cel < 0 || cel >= profile.splash.exposures.length) return null
  return { frame: profile.splash.exposures[cel], alpha: 1 - smooth((t - profile.splash.fadeStart) / profile.splash.fadeDuration), progress: cel / (profile.splash.exposures.length - 1) }
}

/** One cel-sized buffer, reused for repeated exposures and freed after entry.
 * Native color filters retain the artwork's luminance detail and alpha edges.
 */
export class SplashFrameCache {
  private canvas: HTMLCanvasElement | undefined
  private source: HTMLImageElement | undefined
  private signature = ''

  get(source: HTMLImageElement, tone?: TabScene['splash']['tone']): CanvasImageSource {
    if (!tone) return source
    const signature = `${tone.sepia}:${tone.saturation}:${tone.hueRotate}:${tone.brightness}`
    if (this.source === source && this.signature === signature && this.canvas) return this.canvas
    const canvas = this.canvas ??= document.createElement('canvas')
    canvas.dataset.daynightSplash = '1'
    if (canvas.width !== source.naturalWidth) canvas.width = source.naturalWidth
    if (canvas.height !== source.naturalHeight) canvas.height = source.naturalHeight
    const ink = canvas.getContext('2d')!
    ink.clearRect(0, 0, canvas.width, canvas.height)
    // Reduce source exposure before sepia, so bright cyan keeps tonal detail
    // instead of clipping to the same yellow across the artwork's highlights.
    ink.filter = `brightness(${tone.brightness}) sepia(${tone.sepia}) saturate(${tone.saturation}) hue-rotate(${tone.hueRotate}deg)`
    ink.drawImage(source, 0, 0)
    ink.filter = 'none'
    this.source = source; this.signature = signature
    return canvas
  }

  clear(): void {
    if (this.canvas) { this.canvas.width = 0; this.canvas.height = 0 }
    this.canvas = undefined; this.source = undefined; this.signature = ''
  }
}

/** Clustered soft caustics, with uneven sizes and slow independent drift. */
function drawSurface(ctx: CanvasRenderingContext2D, w: number, h: number, time: number, surface: TabScene['water']['surface'], appear = 1): void {
  if (!surface || appear <= 0) return
  ctx.save()
  const glow = ctx.createLinearGradient(0, 0, 0, h * surface.depth)
  glow.addColorStop(0, surface.glow); glow.addColorStop(1, surface.glow + '00')
  ctx.globalAlpha = surface.opacity * appear; ctx.fillStyle = glow; ctx.fillRect(0, 0, w, h * surface.depth)
  const seed = (i: number): number => { const n = Math.sin(i * 127.1 + 311.7) * 43758.5453; return n - Math.floor(n) }
  for (let i = 0; i < surface.count; i++) {
    const cluster = surface.clusters[i % surface.clusters.length]
    const depth = seed(i + 17)
    const phase = time * surface.speed + i * 1.7
    const x = w * (cluster[0] + (seed(i) - 0.5) * 0.23 + Math.sin(phase) * 0.013)
    const y = h * (cluster[1] + depth * depth * surface.depth * 0.5 + Math.cos(phase * 0.7) * 0.008)
    const rx = w * (0.018 + seed(i + 7) * 0.065)
    const ry = h * (0.005 + seed(i + 29) * 0.014)
    ctx.save(); ctx.translate(x, y); ctx.rotate((seed(i + 41) - 0.5) * 0.35); ctx.scale(rx, ry)
    const patch = ctx.createRadialGradient(0, 0, 0, 0, 0, 1)
    patch.addColorStop(0, surface.color); patch.addColorStop(0.35, surface.color + '80'); patch.addColorStop(1, surface.color + '00')
    ctx.globalAlpha = surface.opacity * appear * (1 - depth * 0.65) * (0.7 + Math.sin(phase * 0.6) * 0.3)
    ctx.fillStyle = patch; ctx.fillRect(-1, -1, 2, 2); ctx.restore()
  }
  ctx.restore()
}

type SurfaceLight = NonNullable<TabScene['surfaceLight']>
type CausticField = { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; image: ImageData; density: Float32Array; waveX: { kx: number; ky: number; amplitude: number; omega: number; sin: Float32Array; cos: Float32Array }[]; domainX: number; domainY: number; lastTime: number; lastColor?: string }
const causticFields = new WeakMap<SurfaceLight, CausticField>()

/** Wave slopes bend a regular photon grid; concentrated rays form bright folds.
 * A bounded texture, cached at 24fps, keeps the full-size scene inexpensive.
 * Physical principle: NVIDIA GPU Gems, Chapter 2, Rendering Water Caustics.
 */
function causticTexture(light: SurfaceLight, aspect: number, time: number): HTMLCanvasElement {
  const tw = 320, th = 96, columns = tw * 2, rows = th * 2, margin = 0.7
  const domainX = Math.max(4, Math.min(18, aspect * 2.4)), domainY = 3.5
  let field = causticFields.get(light)
  if (!field || Math.abs(field.domainX - domainX) > 0.01) {
    const canvas = document.createElement('canvas'); canvas.width = tw; canvas.height = th
    const ctx = canvas.getContext('2d')!
    const waves = [[1.6, 1.2, 0.15, 0.65], [-1.1, 2.3, 0.10, -0.48], [2.7, 0.7, 0.067, 0.93], [-0.9, -3.1, 0.052, 0.74], [3.8, -2.1, 0.033, -1.07]]
    const waveX = Array.from({ length: Math.min(light.count, 8) }, (_, i) => {
      const [kx, ky, amplitude, omega] = waves[i % waves.length]
      const sin = new Float32Array(columns), cos = new Float32Array(columns)
      for (let x = 0; x < columns; x++) {
        const phase = ((x + 0.5) / columns * (domainX + 2 * margin) - margin) * kx + i * 1.37
        sin[x] = Math.sin(phase); cos[x] = Math.cos(phase)
      }
      return { kx, ky, amplitude, omega, sin, cos }
    })
    field = { canvas, ctx, image: ctx.createImageData(tw, th), density: new Float32Array(tw * th), waveX, domainX, domainY, lastTime: -Infinity }
    causticFields.set(light, field)
  }
  if (Math.abs(time - field.lastTime) < 1 / 24) {
    if (field.lastColor !== light.color) {
      // Static/reduced-motion waves still follow the clock without resampling
      // their photon field or replacing the cached canvas.
      const rgb = [1, 3, 5].map(i => parseInt(light.color.slice(i, i + 2), 16))
      for (let i = 0; i < field.image.data.length; i += 4) field.image.data.set(rgb, i)
      field.ctx.putImageData(field.image, 0, 0); field.lastColor = light.color
    }
    return field.canvas
  }
  field.lastTime = time; field.density.fill(0)
  const strength = light.refraction ?? 1.25
  const sinY = new Float32Array(field.waveX.length), cosY = new Float32Array(field.waveX.length)
  for (let y = 0; y < rows; y++) {
    const py = (y + 0.5) / rows * (domainY + 2 * margin) - margin
    for (let i = 0; i < field.waveX.length; i++) {
      const wave = field.waveX[i], phase = py * wave.ky + time * light.speed * wave.omega
      sinY[i] = Math.sin(phase); cosY[i] = Math.cos(phase)
    }
    for (let x = 0; x < columns; x++) {
      const px = (x + 0.5) / columns * (domainX + 2 * margin) - margin
      let slopeX = 0, slopeY = 0
      for (let i = 0; i < field.waveX.length; i++) {
        const wave = field.waveX[i]
        const slope = wave.amplitude * (wave.cos[x] * cosY[i] - wave.sin[x] * sinY[i])
        slopeX += slope * wave.kx; slopeY += slope * wave.ky
      }
      const fx = (px - slopeX * strength) / domainX * tw
      const fy = (py - slopeY * strength) / domainY * th
      const ix = Math.floor(fx), iy = Math.floor(fy)
      if (ix < 0 || iy < 0 || ix >= tw - 1 || iy >= th - 1) continue
      const dx = fx - ix, dy = fy - iy, cell = iy * tw + ix
      field.density[cell] += (1 - dx) * (1 - dy)
      field.density[cell + 1] += dx * (1 - dy)
      field.density[cell + tw] += (1 - dx) * dy
      field.density[cell + tw + 1] += dx * dy
    }
  }
  const expected = columns / tw * domainX / (domainX + 2 * margin) * rows / th * domainY / (domainY + 2 * margin)
  const red = parseInt(light.color.slice(1, 3), 16), green = parseInt(light.color.slice(3, 5), 16), blue = parseInt(light.color.slice(5, 7), 16)
  for (let y = 0; y < th; y++) {
    const fade = (1 - smooth(y / (th - 1))) ** 1.5
    for (let x = 0; x < tw; x++) {
      const cell = y * tw + x, index = cell * 4
      const intensity = clamp((field.density[cell] / expected - 1.05) / 3.2) ** (light.sharpness ?? 1.35)
      field.image.data[index] = red; field.image.data[index + 1] = green; field.image.data[index + 2] = blue
      field.image.data[index + 3] = Math.round(intensity * fade * 255)
    }
  }
  field.ctx.putImageData(field.image, 0, 0); field.lastColor = light.color
  return field.canvas
}

/** Refracted caustics for current packages; retain older shaft profiles. */
export function drawSurfaceLight(ctx: CanvasRenderingContext2D, w: number, h: number, time: number, light: NonNullable<TabScene['surfaceLight']>, appear = 1): void {
  if (appear <= 0) return
  if (light.style === 'refracted-caustics') {
    ctx.save(); ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = light.opacity * appear
    ctx.drawImage(causticTexture(light, w / (h * light.depth), time), 0, 0, w, h * light.depth)
    ctx.restore(); return
  }
  ctx.save(); ctx.beginPath(); ctx.rect(0, 0, w, h * light.depth); ctx.clip()
  for (let i = 0; i < light.count; i++) {
    const phase = time * light.speed + i * 1.91
    const x = w * ((i + 0.5) / light.count + Math.sin(phase) * light.sway)
    const rx = w * (0.035 + (i % 3) * 0.014) * (0.9 + Math.cos(phase * 0.7) * 0.1)
    const ry = h * light.depth
    ctx.save(); ctx.translate(x, -h * 0.035); ctx.rotate(Math.sin(phase * 0.85) * 0.14); ctx.scale(rx, ry)
    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, 1)
    glow.addColorStop(0, light.color); glow.addColorStop(0.3, light.color + '80'); glow.addColorStop(1, light.color + '00')
    ctx.globalAlpha = light.opacity * appear * (0.72 + Math.sin(phase * 0.8) * 0.28)
    ctx.fillStyle = glow; ctx.fillRect(-1, -1, 2, 2); ctx.restore()
  }
  ctx.restore()
}

/** Bottom-anchored rows and columns emerge only near the end of the scroll. */
function drawBottomDots(ctx: CanvasRenderingContext2D, w: number, h: number, scroll: number, dots: TabScene['bottomDots'], mode?: string): void {
  if (!dots) return
  const appear = smooth((scroll - dots.scrollStart) / (1 - dots.scrollStart))
  if (appear <= 0) return
  const depth = h * dots.depth
  const columns = Math.ceil(w / dots.spacing)
  const left = (w - (columns - 1) * dots.spacing) / 2
  ctx.save(); ctx.fillStyle = mode === 'enhanced' ? dots.completeColor ?? dots.color : dots.color
  for (let row = 0; row < Math.ceil(depth / dots.spacing); row++) {
    const y = h - dots.spacing * (row + 0.5)
    const strength = smooth(1 - (h - y) / depth)
    const radius = dots.minRadius + (dots.maxRadius - dots.minRadius) * strength
    ctx.globalAlpha = dots.opacity * appear * strength
    ctx.beginPath()
    for (let column = 0; column < columns; column++) {
      const x = left + column * dots.spacing
      ctx.moveTo(x + radius, y); ctx.arc(x, y, radius, 0, Math.PI * 2)
    }
    ctx.fill()
  }
  ctx.restore()
}

type BubblePose = { a: number; b: number; angle: number; aspect: number; weber: number }
type RisingBubble = { slot: number; x: number; y: number; radius: number; lightAmount?: number; wakePhase?: number; wakeOmega?: number; flowAngle?: number; pose?: BubblePose }

function bubbleSizeWeight(radius: number, physics: NonNullable<NonNullable<TabScene['bubbleShape']>['physics']>): number {
  return smooth((radius - 3) / (physics.referenceRadius - 3))
}

/** Small-deformation Moore aspect ratio plus a forced, damped quadrupole.
 * Physical millimetres and slowed visual time are explicit DWP mappings,
 * not a pixel-to-metre fluid simulation. a²b = R³ preserves proxy volume.
 */
export function bubbleShapePose(bubble: RisingBubble, time: number, shape: NonNullable<TabScene['bubbleShape']>): BubblePose {
  const f = shape.physics!
  const weight = bubbleSizeWeight(bubble.radius, f)
  const diameter = (f.minDiameterMm + weight * (f.maxDiameterMm - f.minDiameterMm)) / 1000
  const velocity = f.riseSpeed * (0.65 + 0.35 * weight)
  const weber = f.density * velocity * velocity * diameter / f.surfaceTension
  const omega2 = Math.sqrt(12 * f.surfaceTension / (f.density * (diameter / 2) ** 3)) * f.timeScale
  const wakeOmega = bubble.wakeOmega ?? shape.speed
  const phase = bubble.wakePhase ?? time * wakeOmega + bubble.slot * 2.15
  const ratio = 2 * wakeOmega / omega2
  const damping = 2 * f.damping * ratio
  const gain = 1 / Math.hypot(1 - ratio * ratio, damping)
  const lag = Math.atan2(damping, 1 - ratio * ratio)
  const q = (shape.squash ?? 0) * weight * gain * Math.cos(2 * phase - lag)
  const aspect = Math.max(1, (1 + 9 / 64 * weber) * Math.exp(q))
  const angleLimit = shape.tilt ?? 0
  const angle = Math.max(-angleLimit, Math.min(angleLimit,
    bubble.flowAngle ?? Math.cos(phase) * angleLimit * weight))
  const a = bubble.radius * Math.cbrt(aspect)
  return { a, b: bubble.radius / Math.cbrt(aspect * aspect), angle, aspect, weber }
}

/** Screen-relative, so scrolling and resizing cannot move the lighting boundary. */
export function bubbleLightProgress(y: number, height: number, light?: TabScene['bubbleLight']): number {
  if (!light) return 0
  if (!light.heightFade) return 1
  const { start, end } = light.heightFade
  return smooth((start - y / height) / (start - end))
}

/** Bake the soft upper halo once per tab entry. Runtime drawing only scales
 * this small transparent texture; no per-bubble blur or full-screen copy.
 */
function createBubbleGlow(light: NonNullable<TabScene['bubbleLight']>): HTMLCanvasElement {
  const sprite = document.createElement('canvas')
  sprite.width = sprite.height = 128
  const ctx = sprite.getContext('2d')!
  const unit = 128 / 2.7
  ctx.filter = `blur(${unit * (light.hazeBlur ?? 0) / 2}px)`
  ctx.translate(64, 64); ctx.scale(unit, unit * 0.64)
  const haze = ctx.createRadialGradient(0, 0, 0, 0, 0, 1)
  haze.addColorStop(0, light.color + '00'); haze.addColorStop(0.3, light.color + '00')
  haze.addColorStop(0.62, light.color + 'b0'); haze.addColorStop(0.78, light.color + 'cc')
  haze.addColorStop(1, light.color + '00')
  ctx.fillStyle = haze; ctx.beginPath(); ctx.arc(0, 0, 1, 0, Math.PI * 2); ctx.fill()
  // Incoming light stays above the bubble. Fade the lower tail in the baked
  // texture, rather than clipping it at a visible horizontal edge.
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.filter = 'none'
  ctx.globalCompositeOperation = 'destination-in'
  const tail = ctx.createLinearGradient(0, 64 - unit * 0.25, 0, 64 + unit * 0.5)
  tail.addColorStop(0, '#ffffff'); tail.addColorStop(0.55, '#ffffff60'); tail.addColorStop(1, '#ffffff00')
  ctx.fillStyle = tail; ctx.fillRect(0, 0, 128, 128)
  return sprite
}
/** The top stays nearly round while the broader lower half breathes gently. */
export function traceBubble(ctx: CanvasRenderingContext2D, bubble: RisingBubble, time: number, shape?: TabScene['bubbleShape']): void {
  const { radius: r } = bubble
  if (!shape) { ctx.arc(bubble.x, bubble.y, r, 0, Math.PI * 2); return }
  if (shape.style === 'ellipsoid-2d') {
    const pose = bubble.pose ?? bubbleShapePose(bubble, time, shape)
    ctx.ellipse(bubble.x, bubble.y, pose.a, pose.b, pose.angle, 0, Math.PI * 2)
    ctx.closePath(); return
  }
  const phase = time * shape.speed + bubble.slot * 2.15
  // Lean with the lateral current, then let the lower contour lag behind it.
  // Width and height trade off instead of inflating the entire bubble.
  const shapeWeight = shape.style === 'flat-2d' ? Math.min(1, r / 18) : 1
  const stretch = 1 + (shape.squash ?? 0) * shapeWeight * Math.sin(phase * 1.35 + 0.65)
  ctx.save(); ctx.translate(bubble.x, bubble.y)
  ctx.rotate(Math.cos(phase) * (shape.tilt ?? 0) * shapeWeight); ctx.scale(stretch, 1 / stretch)
  const x = 0, y = 0
  if (shape.style === 'flat-2d') {
    // A drawn dome and a gently indented skirt: larger bubbles carry more
    // contour motion, while the small ones keep a simpler rounded shape.
    const weight = Math.min(1, r / 18)
    const lower = shape.lowerWidth + shape.lowerWobble * weight * Math.sin(phase - 0.65)
    const skirt = shape.lowerWobble * weight * Math.sin(phase - 1.1)
    const top = 0.9 - 0.06 * weight * Math.sin(phase * 0.9)
    const cap = 0.97 + shape.upperWobble * Math.sin(phase * 0.45)
    ctx.moveTo(0, -r * top)
    ctx.bezierCurveTo(r * cap * 0.6, -r * top, r * cap, -r * 0.5, r * cap, 0)
    ctx.bezierCurveTo(r * lower * 1.08, r * 0.35, r * lower * 0.88, r * 0.86, r * lower * 0.56, r * 0.85)
    ctx.bezierCurveTo(r * 0.27, r * 0.88, r * (skirt + 0.2), r * (0.82 - 0.13 * weight), r * skirt, r * (0.84 - 0.13 * weight))
    ctx.bezierCurveTo(r * (skirt - 0.25), r * (0.81 - 0.13 * weight), -r * lower * 0.34, r * 0.89, -r * lower * 0.6, r * 0.82)
    ctx.bezierCurveTo(-r * lower * 0.96, r * 0.73, -r * lower * 1.04, r * 0.27, -r * cap, 0)
    ctx.bezierCurveTo(-r * cap, -r * 0.5, -r * cap * 0.6, -r * top, 0, -r * top)
    ctx.closePath(); ctx.restore(); return
  }
  const upper = 0.97 + shape.upperWobble * Math.sin(time * shape.speed * 0.45 + bubble.slot * 1.7)
  const lowerMotion = Math.sin(phase - 0.65)
  const lower = shape.lowerWidth + shape.lowerWobble * lowerMotion
  const tip = r * shape.lowerWobble * 1.4 * Math.sin(phase - 1.1)
  ctx.moveTo(x, y - r)
  ctx.bezierCurveTo(x + r * upper * 0.58, y - r, x + r * upper, y - r * 0.54, x + r * upper, y)
  ctx.bezierCurveTo(x + r * lower * 1.02, y + r * 0.38, x + r * lower * 0.82, y + r * 0.94, x + tip, y + r * (0.96 + lowerMotion * 0.012))
  ctx.bezierCurveTo(x - r * lower * 0.75, y + r * 1.01, x - r * lower * 1.04, y + r * 0.54, x - r * lower, y + r * 0.16)
  ctx.bezierCurveTo(x - r * upper, y - r * 0.48, x - r * upper * 0.58, y - r, x, y - r)
  ctx.closePath(); ctx.restore()
}
/** One position list drives the bubble outlines, water glow, and portrait mask. */
export function risingBubbles(w: number, h: number, time: number, scroll: number, offset: number, reduced: boolean, field?: TabScene['bubbleField'], shape?: TabScene['bubbleShape'], lens?: TabScene['bubbleLens']): RisingBubble[] {
  if (time < 0.75) return []
  if (field) {
    // Stateless seeded samples stay stable across frames, resizing and mode
    // changes. Each new lifetime changes its lane and size offscreen.
    const random = (slot: number, cycle: number, channel: number): number => {
      let hash = field.seed ^ Math.imul(slot + 1, 0x9e3779b9) ^ Math.imul(cycle + 11, 0x85ebca6b) ^ Math.imul(channel + 1, 0xc2b2ae35)
      hash = Math.imul(hash ^ hash >>> 16, 0x7feb352d)
      hash = Math.imul(hash ^ hash >>> 15, 0x846ca68b)
      return ((hash ^ hash >>> 16) >>> 0) / 0x100000000
    }
    const age = (reduced ? 3 : time) - 0.75
    const bubbles: RisingBubble[] = []
    for (let i = 0; i < field.count; i++) {
      const speed = field.minSpeed + random(i, 0, 0) * (field.maxSpeed - field.minSpeed)
      const lifetime = 1.2 / speed
      // A few bubbles already inhabit the water. The rest enter gradually
      // from below, rather than the whole field appearing in one frame.
      const firstBirth = i % 3 === 0 ? -lifetime * random(i, 0, 1) * 0.9 : random(i, 0, 1) * field.startSpread
      if (age < firstBirth) continue
      const cycle = Math.floor((age - firstBirth) / lifetime)
      const phase = (age - firstBirth) / lifetime - cycle
      const lane = 0.05 + random(i, cycle, 2) * 0.9
      const radius = field.minRadius + random(i, cycle, 4) * (field.maxRadius - field.minRadius)
      if (shape?.style === 'ellipsoid-2d' && shape.physics) {
        const scale = lens ? i % 4 === 1 ? lens.radiusScale : 1 + (lens.radiusScale - 1) * 0.4 : 1
        const screenRadius = lens ? Math.min(lens.maxRadius, radius * scale) : radius
        const weight = bubbleSizeWeight(screenRadius, shape.physics)
        const diameter = shape.physics.minDiameterMm + weight * (shape.physics.maxDiameterMm - shape.physics.minDiameterMm)
        // Small bubbles rise almost straight; stronger zigzag motion develops
        // above the visual proxy's ~1.5 mm transition. No skirt flapping.
        const pathWeight = 0.12 + 0.88 * smooth((diameter - 1.3) / 1.5)
        const omega = (field.swaySpeed ?? shape.speed) * (1.15 - weight * 0.3)
        const wakePhase = (reduced ? 0 : time) * omega + i * 2.15
        const envelope = Math.sin(phase * Math.PI)
        const amplitude = field.drift * pathWeight
        const drift = amplitude * Math.sin(wakePhase) * envelope
        const vx = reduced ? 0 : w * amplitude * (omega * Math.cos(wakePhase) * envelope + Math.sin(wakePhase) * Math.cos(phase * Math.PI) * Math.PI / lifetime)
        bubbles.push({ slot: i, x: w * (lane + drift), y: h * (1.08 - phase * 1.2 + scroll * offset), radius,
          wakePhase, wakeOmega: omega, flowAngle: Math.atan2(vx, h * speed) })
        continue
      }
      const drift = (field.swaySpeed
        ? Math.sin((reduced ? 0 : time) * field.swaySpeed + i * 2.15) + 0.22 * Math.sin((reduced ? 0 : time) * field.swaySpeed * 0.47 + i)
        : Math.sin(phase * Math.PI * 2 + random(i, cycle, 3) * Math.PI * 2)) * field.drift * Math.sin(phase * Math.PI)
      bubbles.push({ slot: i, x: w * (lane + drift), y: h * (1.08 - phase * 1.2 + scroll * offset), radius })
    }
    return bubbles
  }
  return Array.from({ length: 20 }, (_, i) => {
    const phase = reduced ? i / 20 : ((time * (0.025 + (i % 3) * 0.006) + i * 0.173) % 1)
    return { slot: i, x: w * (0.08 + ((i * 0.137) % 0.84)), y: h * (1.1 - phase * 1.2) + h * scroll * offset, radius: 2 + i % 5 }
  })
}

type BubbleTiles = { canvas: HTMLCanvasElement; cell: number; dpr: number }

/** Snapshot only the small areas sampled by lenses, before drawing any lens.
 * This avoids feedback between overlapping bubbles and a full-screen copy.
 */
function captureBubbleTiles(source: HTMLCanvasElement, bubbles: RisingBubble[], target: BubbleTiles, w: number, h: number, dpr: number): void {
  // Leave room for the rotating, flattened contour and its feathered mask.
  target.cell = Math.ceil(Math.max(...bubbles.map(b => b.radius)) * 3.2 + 4)
  target.dpr = dpr
  const cellPx = Math.ceil(target.cell * dpr)
  const width = cellPx * 5, height = cellPx * Math.ceil(bubbles.length / 5)
  if (target.canvas.width !== width || target.canvas.height !== height) {
    target.canvas.width = width; target.canvas.height = height
  }
  const ctx = target.canvas.getContext('2d')!
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, width, height)
  for (const [i, b] of bubbles.entries()) {
    const left = b.x - target.cell / 2, top = b.y - target.cell / 2
    const sx = Math.max(0, left), sy = Math.max(0, top)
    const sw = Math.min(w, left + target.cell) - sx, sh = Math.min(h, top + target.cell) - sy
    if (sw <= 0 || sh <= 0) continue
    ctx.drawImage(source, sx * dpr, sy * dpr, sw * dpr, sh * dpr,
      (i % 5) * cellPx + (sx - left) * dpr, Math.floor(i / 5) * cellPx + (sy - top) * dpr, sw * dpr, sh * dpr)
  }
}

/** Enlarge the current frame inside each bubble, then feather its perimeter
 * back into the unmodified scene. A small moving offset suggests refraction
 * without horizontal sampling bands or feedback from an earlier frame.
 */
function drawBubbleLenses(ctx: CanvasRenderingContext2D, bubbles: RisingBubble[], scene: BubbleTiles, detail: BubbleTiles, output: HTMLCanvasElement, lens: NonNullable<TabScene['bubbleLens']>, time: number, fade: number, height: number, light?: TabScene['bubbleLight'], shape?: TabScene['bubbleShape']): void {
  const cellPx = Math.ceil(scene.cell * scene.dpr)
  if (output.width !== scene.canvas.width || output.height !== scene.canvas.height) {
    output.width = scene.canvas.width; output.height = scene.canvas.height
  }
  const tileCtx = output.getContext('2d')!
  tileCtx.setTransform(1, 0, 0, 1, 0, 0); tileCtx.clearRect(0, 0, output.width, output.height)
  tileCtx.setTransform(scene.dpr, 0, 0, scene.dpr, 0, 0)
  for (const [i, bubble] of bubbles.entries()) {
    const { x, y, radius } = bubble
    const sx = i % 5 * cellPx, sy = Math.floor(i / 5) * cellPx
    const tx = sx / scene.dpr, ty = sy / scene.dpr
    const cx = tx + scene.cell / 2, cy = ty + scene.cell / 2
    const wobble = Math.sin(time * 1.1 + bubble.slot * 2.4) * lens.distortion
    const attenuation = 1 - clamp(y / height) * 0.25
    const shiftY = Math.cos(time * 0.9 + bubble.slot) * lens.distortion * radius * 0.4
    const extent = shape?.squash ? radius * 1.5 : shape ? radius * 1.1 : radius
    const sourceX = sx + (scene.cell / 2 - extent / lens.magnification + wobble * radius) * scene.dpr
    const sourceY = sy + (scene.cell / 2 - extent / lens.magnification + shiftY) * scene.dpr
    const sourceSize = extent * 2 / lens.magnification * scene.dpr
    if (light?.style === 'top-haze' && !shape?.style) {
      // Incident surface light restores detail only on the upper side of the
      // lens; revealing the whole sampled portrait would brighten its bottom.
      const detailCtx = detail.canvas.getContext('2d')!
      detailCtx.save(); detailCtx.setTransform(scene.dpr, 0, 0, scene.dpr, 0, 0)
      detailCtx.beginPath(); detailCtx.rect(tx, ty, cellPx / scene.dpr, cellPx / scene.dpr); detailCtx.clip()
      detailCtx.globalCompositeOperation = 'destination-in'
      const incident = detailCtx.createLinearGradient(0, cy - radius, 0, cy + radius)
      incident.addColorStop(0, '#ffffff'); incident.addColorStop(0.25, '#ffffff')
      // In the illustrated style the bubble is a moving window into the
      // character, so the center must retain detail, not just a shiny cap.
      incident.addColorStop(0.5, shape?.squash ? '#ffffffdc' : '#ffffff20')
      incident.addColorStop(0.8, shape?.squash ? '#ffffff50' : '#ffffff00'); incident.addColorStop(1, '#ffffff00')
      detailCtx.fillStyle = incident; detailCtx.fillRect(tx, ty, cellPx / scene.dpr, cellPx / scene.dpr)
      detailCtx.restore()
    }
    tileCtx.save(); tileCtx.beginPath(); tileCtx.rect(tx, ty, cellPx / scene.dpr, cellPx / scene.dpr); tileCtx.clip()
    tileCtx.beginPath(); traceBubble(tileCtx, { ...bubble, x: cx, y: cy }, time, shape); tileCtx.clip()
    tileCtx.drawImage(scene.canvas, sourceX, sourceY, sourceSize, sourceSize, cx - extent, cy - extent, extent * 2, extent * 2)
    // Tinted detail stays confined to the magnified portrait's alpha contour.
    tileCtx.globalAlpha = lens.detailOpacity * attenuation
    tileCtx.drawImage(detail.canvas, sourceX, sourceY, sourceSize, sourceSize, cx - extent, cy - extent, extent * 2, extent * 2)
    if (!shape?.style) {
      tileCtx.globalAlpha = 1; tileCtx.globalCompositeOperation = 'destination-in'
      const edge = tileCtx.createRadialGradient(cx, cy, 0, cx, cy, extent)
      edge.addColorStop(0, '#ffffff'); edge.addColorStop(0.62, '#ffffff')
      edge.addColorStop(0.83, '#ffffffb0'); edge.addColorStop(1, '#ffffff00')
      tileCtx.fillStyle = edge; tileCtx.fillRect(tx, ty, cellPx / scene.dpr, cellPx / scene.dpr)
    }
    tileCtx.restore()
    ctx.save(); ctx.globalAlpha = fade
    ctx.drawImage(output, sx, sy, cellPx, cellPx, x - scene.cell / 2, y - scene.cell / 2, cellPx / scene.dpr, cellPx / scene.dpr)
    ctx.restore()
  }
}

/** Flat paint is confined to the same contour as the portrait window. */
function drawBubblePaint(ctx: CanvasRenderingContext2D, bubbles: RisingBubble[], paint: NonNullable<TabScene['bubblePaint']>, time: number, fade: number, shape?: TabScene['bubbleShape']): void {
  ctx.save(); ctx.fillStyle = paint.color
  for (const bubble of bubbles) {
    ctx.globalAlpha = paint.opacity * fade * (1 - (bubble.lightAmount ?? 0))
    if (ctx.globalAlpha <= 0) continue
    ctx.beginPath(); traceBubble(ctx, bubble, time, shape); ctx.fill()
  }
  ctx.restore()
}

/** Air bubbles redirect incident light. A small tapered arc reveals nearby
 * details, without treating the bubble as an omnidirectional lamp. Older DWP
 * profiles retain their original radial style. Water and portrait use the
 * same geometry so their highlights cannot drift apart.
 */
function drawBubbleLights(ctx: CanvasRenderingContext2D, bubbles: RisingBubble[], radius: number, color: string, opacity: number, style?: NonNullable<TabScene['bubbleLight']>['style'], time = 0, height = 1, hazeBlur = 0, sprite?: HTMLCanvasElement): void {
  if (opacity <= 0) return
  ctx.save(); ctx.globalAlpha = opacity
  for (const bubble of bubbles) {
    const amount = bubble.lightAmount ?? 1
    if (amount <= 0) continue
    if (style === 'top-haze') {
      const reach = Math.min(radius, bubble.radius * 2)
      const attenuation = 1 - clamp(bubble.y / height) * 0.45
      if (sprite) {
        const extent = reach * 1.35
        ctx.globalAlpha = opacity * attenuation * amount
        ctx.drawImage(sprite, bubble.x - extent, bubble.y - bubble.radius * 0.48 - extent,
          extent * 2, extent * 2)
        continue
      }
      ctx.save()
      // A vertically flattened radial falloff reaches just below the center;
      // its soft tail removes the straight edge left by the old half-plane clip.
      ctx.filter = `blur(${bubble.radius * hazeBlur}px)`
      ctx.translate(bubble.x, bubble.y - bubble.radius * 0.48); ctx.scale(reach, reach * 0.64)
      const haze = ctx.createRadialGradient(0, 0, 0, 0, 0, 1)
      haze.addColorStop(0, color + '00'); haze.addColorStop(0.3, color + '00')
      haze.addColorStop(0.62, color + 'b0'); haze.addColorStop(0.78, color + 'cc')
      haze.addColorStop(1, color + '00')
      ctx.globalAlpha = opacity * attenuation * amount
      ctx.fillStyle = haze; ctx.beginPath(); ctx.arc(0, 0, 1, 0, Math.PI * 2); ctx.fill()
      ctx.restore()
      continue
    }
    if (style === 'refracted-rim') {
      // Radius is a viewport cap, not the light's physical size. Tiny bubbles
      // cannot cast the same large patch as a bigger bubble on a large screen.
      const reach = Math.min(radius, bubble.radius * 2.6)
      const sway = Math.sin(time * 0.8 + bubble.slot * 2.4)
      const stretch = 0.64 + Math.sin(time * 0.65 + bubble.slot) * 0.06
      const attenuation = 1 - clamp(bubble.y / height) * 0.45
      ctx.save()
      ctx.translate(bubble.x + sway * bubble.radius * 0.15, bubble.y + bubble.radius * 0.45)
      ctx.scale(reach, reach * stretch)
      const light = ctx.createRadialGradient(0, 0, 0, 0, 0, 1)
      light.addColorStop(0, color + '00'); light.addColorStop(0.42, color + '00')
      light.addColorStop(0.68, color); light.addColorStop(0.82, color + '65')
      light.addColorStop(1, color + '00')
      ctx.fillStyle = light
      // Fade both ends of the short lower arc and vary it slowly with the
      // incident surface light. The center stays dark, with no filled disk.
      const segments = 12, startAngle = 0.38 + sway * 0.12, span = 2.36
      for (let i = 0; i < segments; i++) {
        const a = startAngle + span * i / segments
        ctx.globalAlpha = opacity * attenuation * amount * (0.8 + sway * 0.12) * Math.sin(Math.PI * (i + 0.5) / segments) ** 2
        ctx.beginPath(); ctx.moveTo(0, 0)
        ctx.arc(0, 0, 1, a, a + span / segments)
        ctx.closePath(); ctx.fill()
      }
      ctx.restore()
      continue
    }
    const reach = radius * (0.65 + bubble.radius * 0.1)
    ctx.globalAlpha = opacity * amount
    const light = ctx.createRadialGradient(bubble.x, bubble.y, 0, bubble.x, bubble.y, reach)
    light.addColorStop(0, color); light.addColorStop(0.3, color + '80'); light.addColorStop(1, color + '00')
    ctx.fillStyle = light; ctx.fillRect(bubble.x - reach, bubble.y - reach, reach * 2, reach * 2)
  }
  ctx.restore()
}

/** The lower hemisphere receives no direct surface light. Keep its shadow
 * inside the bubble and fade at the perimeter instead of painting a halo.
 */
function drawBubbleShadows(ctx: CanvasRenderingContext2D, bubbles: RisingBubble[], light: NonNullable<TabScene['bubbleLight']>, fade: number, fallbackColor: string, time: number, shape?: TabScene['bubbleShape']): void {
  if (light.style !== 'top-haze' || !light.shadowOpacity) return
  const color = light.shadowColor ?? fallbackColor
  ctx.save(); ctx.globalCompositeOperation = 'multiply'
  for (const bubble of bubbles) {
    const amount = bubble.lightAmount ?? 1
    if (amount <= 0) continue
    ctx.globalAlpha = light.shadowOpacity * fade * amount
    const { x, y, radius } = bubble
    ctx.save(); ctx.beginPath(); traceBubble(ctx, bubble, time, shape); ctx.clip()
    const shadow = ctx.createLinearGradient(0, y, 0, y + radius)
    shadow.addColorStop(0, color + '00'); shadow.addColorStop(0.2, color + '00')
    shadow.addColorStop(0.72, color); shadow.addColorStop(1, color + '00')
    ctx.fillStyle = shadow; ctx.fillRect(x - radius * 1.5, y, radius * 3, radius * 1.5)
    ctx.restore()
  }
  ctx.restore()
}

/** A tab-owned background; cleanup also cancels pending decodes and animation frames. */
export function startDayNightDive(opts: { profile: TabScene; assetUrl: (path: string) => string; scrollProgress?: () => number; visualState?: () => { focus: boolean; mode: string; panelAlpha?: number }; clock?: () => Date }): () => void {
  const source = opts.profile
  // Use the same local clock and ten-minute dawn/dusk fade as the base DWP.
  const readNightAlpha = (): number => clockVars(opts.clock?.() ?? new Date()).night_alpha
  let nightAlpha = readNightAlpha(), nextClockPoll = 0
  let paletteSignature = nightAlpha + ':' + opts.visualState?.().mode
  // Stable group identities preserve the caustic texture cache across fades.
  const p = structuredClone(mixTabScenePalette(source, nightAlpha, opts.visualState?.().mode))
  const originalBody = getComputedStyle(document.body)
  const fallbackPalette = pendingThemeBaseline ?? Object.fromEntries(themeTokens.map(key => [key, originalBody.getPropertyValue(key).trim()]))
  const entryPresence = finishPendingExit ? pendingThemePresence : 0
  // A quick return to the tab replaces the outgoing background immediately.
  const canvas = document.createElement('canvas')
  canvas.dataset.daynightDive = '1'
  canvas.setAttribute('aria-hidden', 'true')
  Object.assign(canvas.style, { position: 'fixed', inset: '0', width: '100%', height: '100%', zIndex: '-2', pointerEvents: 'none' })
  const ctx = canvas.getContext('2d')
  if (!ctx) return () => {}
  document.body.appendChild(canvas)
  const transitionStyle = document.createElement('style')
  transitionStyle.dataset.daynightTransition = '1'
  document.head.appendChild(transitionStyle)
  const visualStyle = document.createElement('style')
  document.head.appendChild(visualStyle)
  let visualSignature = ''
  const motion = matchMedia('(prefers-reduced-motion: reduce)')
  let disposed = false, raf = 0, start = 0, last = -Infinity, visualPoll = 0
  let themeRaf = 0, themePresence = entryPresence, transitionSignature = ''
  const visualKey = (): string => {
    const state = opts.visualState?.()
    return String(state?.focus === true && state.mode === p.focus.mode) + ':' + (state?.panelAlpha ?? 0) + ':' + (state?.mode ?? '') + ':' + document.body.hasAttribute('data-ds-dark-theme') + ':' + p.figure.ink + ':' + paletteSignature
  }
  const updateUi = (presence: number): void => {
    presence = Number(clamp(presence).toFixed(3))
    themePresence = presence
    const signature = visualKey() + ':' + presence.toFixed(3)
    if (signature === visualSignature) return
    visualSignature = signature
    const state = opts.visualState?.()
    const panelAlpha = state?.panelAlpha ?? 0
    const baseline = Object.fromEntries(themeTokens.map(key => [key, document.body.style.getPropertyValue(key).trim() || fallbackPalette[key]]))
    const transitionKey = panelAlpha + ':' + p.figure.ink
    if (transitionKey !== transitionSignature) {
      transitionSignature = transitionKey
      transitionStyle.textContent = tabSceneTransitionCss(p.ui, panelAlpha, p.figure.ink)
    }
    visualStyle.textContent = tabSceneThemeCss(p.ui, panelAlpha, p.figure.ink, presence, baseline)
      + (state?.focus === true && state.mode === p.focus.mode ? dayNightVisualCss(0, 1, p.focus) : '')
  }
  // Install the incoming palette before removing a pending exit, keeping the
  // currently visible mix continuous during quick returns.
  updateUi(entryPresence)
  finishPendingExit?.()
  let scrollTarget = 0, scrollPosition = 0, previousFrame = 0
  let silhouette: HTMLCanvasElement | undefined
  let portrait: HTMLImageElement | undefined
  const colorLayer = document.createElement('canvas')
  const colorCtx = colorLayer.getContext('2d')!
  const detailMask = document.createElement('canvas')
  const maskCtx = detailMask.getContext('2d')!
  const lensScene: BubbleTiles = { canvas: document.createElement('canvas'), cell: 0, dpr: 1 }
  const lensDetail: BubbleTiles = { canvas: document.createElement('canvas'), cell: 0, dpr: 1 }
  const lensOutput = document.createElement('canvas')
  let bubbleGlow: HTMLCanvasElement | undefined
  let silhouetteInk = p.figure.ink, glowColor = ''
  let foam: HTMLImageElement[] = []
  const splashCache = new SplashFrameCache()
  let width = 0, height = 0
  const recolor = (image: HTMLCanvasElement, color: string): void => {
    const ink = image.getContext('2d')!
    ink.save(); ink.setTransform(1, 0, 0, 1, 0, 0)
    ink.globalCompositeOperation = 'source-in'; ink.globalAlpha = 1
    ink.fillStyle = color; ink.fillRect(0, 0, image.width, image.height); ink.restore()
  }
  const syncPalette = (now: number): void => {
    if (now >= nextClockPoll) { nightAlpha = readNightAlpha(); nextClockPoll = now + 250 }
    const mode = opts.visualState?.().mode
    const signature = nightAlpha + ':' + mode
    if (signature === paletteSignature) return
    paletteSignature = signature
    const mixed = mixTabScenePalette(source, nightAlpha, mode)
    Object.assign(p.water, mixed.water); Object.assign(p.figure, mixed.figure)
    p.splash = { ...mixed.splash }
    p.ui = mixed.ui ? { ...mixed.ui } : undefined
    for (const key of ['bottomDots', 'bubblePaint', 'bubbleLight', 'surfaceLight'] as const) {
      if (p[key] && mixed[key]) Object.assign(p[key]!, mixed[key])
    }
    // Reuse the portrait's alpha and the small pre-blurred glow texture. Only
    // recolor when the clock palette changes, never reblur or allocate per frame.
    if (silhouette && silhouetteInk !== p.figure.ink) { recolor(silhouette, p.figure.ink); silhouetteInk = p.figure.ink }
    if (bubbleGlow && p.bubbleLight && glowColor !== p.bubbleLight.color) { recolor(bubbleGlow, p.bubbleLight.color); glowColor = p.bubbleLight.color }
  }
  const render = (now: number): void => {
    if (disposed || !silhouette || !portrait) return
    syncPalette(now)
    const reduced = motion.matches
    const state = opts.visualState?.()
    updateUi(reduced ? 1 : entryPresence + (1 - entryPresence) * smooth((now - start) / p.exit.duration))
    if (opts.scrollProgress) scrollTarget = clamp(opts.scrollProgress())
    const elapsed = previousFrame === 0 ? 0 : Math.min(100, now - previousFrame)
    previousFrame = now
    scrollPosition = reduced ? 0 : scrollPosition + (scrollTarget - scrollPosition) * (1 - Math.exp(-elapsed / p.scroll.smoothing))
    const t = reduced ? 3 : (now - start) / 1000
    const w = window.innerWidth, h = window.innerHeight
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    if (width !== w * dpr || height !== h * dpr) {
      width = w * dpr; height = h * dpr
      canvas.width = width; canvas.height = height
      colorLayer.width = width; colorLayer.height = height
      detailMask.width = width; detailMask.height = height
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    const reveal = smooth((t - p.water.revealStart) / p.water.revealDuration)
    ctx.save()
    // A U-shaped front descends beneath the figure, then expands to fill the screen.
    const edgeAmplitude = Math.sin(reveal * Math.PI) * h * 0.032
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(w, 0)
    for (let sx = w; sx >= 0; sx -= w / 64) {
      const wave = Math.sin(sx / w * 19 + t * 11) * 0.65 + Math.sin(sx / w * 37 - t * 8) * 0.35
      const edge = p.entryCurve ? h * entryWaterEdge(sx / w, reveal, p.figure.x + (p.entryCurve.centerOffset ?? 0), p.entryCurve) : h * reveal + wave * edgeAmplitude
      ctx.lineTo(sx, edge)
    }
    ctx.closePath(); ctx.clip()
    const waterOffset = h * scrollPosition * p.water.scrollOffset
    const water = ctx.createLinearGradient(0, waterOffset, 0, h + waterOffset)
    for (const [offset, color] of p.water.stops) water.addColorStop(offset, color)
    ctx.fillStyle = water; ctx.fillRect(0, 0, w, h)
    // Surface reflections remain at the surface, fading as the viewer dives.
    // Only the water gradient participates in the downward parallax.
    const surfaceVisibility = 1 - smooth(scrollPosition / (p.surfaceLight?.scrollFadeEnd ?? 0.65))
    const surfaceAppear = surfaceVisibility * smooth((t - 0.4) / 0.65)
    drawSurface(ctx, w, h, reduced ? 0 : t, p.water.surface, surfaceVisibility)
    if (p.surfaceLight && p.surfaceLight.mode === state?.mode && p.surfaceLight.style !== 'refracted-caustics') {
      drawSurfaceLight(ctx, w, h, reduced ? 0 : t, p.surfaceLight, surfaceAppear)
    }
    // The same smoothed scroll position drives depth and background parallax.
    ctx.fillStyle = p.water.scrollTint; ctx.globalAlpha = scrollPosition * p.water.scrollDarkness
    ctx.fillRect(0, 0, w, h)
    drawBottomDots(ctx, w, h, scrollPosition, p.bottomDots, state?.mode)
    if (p.water.clipFigure) ctx.globalAlpha = 1
    else ctx.restore()
    // Keep the front's clip active through both portrait layers, so the figure
    // cannot descend into an area of background that has not opened yet.
    // The portrait moves independently of the centered, viewport-sized foam.
    const bob = reduced ? 0 : Math.sin((t - 2) * 0.8) * h * p.figure.bob
    const silhouetteHeight = Math.min(h * p.figure.height, w * p.figure.maxWidthHeight)
    const silhouetteWidth = silhouetteHeight * silhouette.width / silhouette.height
    const x = w * p.figure.x
    const lens = p.bubbleLens?.mode === state?.mode ? p.bubbleLens : undefined
    const bubbleShape = p.bubbleShape?.mode === state?.mode ? p.bubbleShape : undefined
    const bubblePaint = p.bubblePaint?.mode === state?.mode ? p.bubblePaint : undefined
    const field = p.bubbleField?.mode === state?.mode ? p.bubbleField : undefined
    const bubbles = risingBubbles(w, h, t, scrollPosition, p.scroll.bubbleOffset, reduced, field, bubbleShape, lens)
    if (lens) for (const bubble of bubbles) {
      // Keep most bubbles small; every fourth bubble carries a larger lens.
      const scale = bubble.slot % 4 === 1 ? lens.radiusScale : 1 + (lens.radiusScale - 1) * 0.4
      bubble.radius = Math.min(lens.maxRadius, bubble.radius * scale)
    }
    if (bubbleShape?.style === 'ellipsoid-2d') for (const bubble of bubbles) {
      // Reuse one pose for fill, lens clipping, shadow and both outline passes.
      bubble.pose = bubbleShapePose(bubble, reduced ? 0 : t, bubbleShape)
    }
    const bubbleLight = p.bubbleLight && (!p.bubbleLight.mode || p.bubbleLight.mode === state?.mode) ? p.bubbleLight : undefined
    for (const bubble of bubbles) bubble.lightAmount = bubbleLightProgress(bubble.y, h, bubbleLight)
    if (bubbleLight?.style === 'top-haze' && !bubbleGlow) { bubbleGlow = createBubbleGlow(bubbleLight); glowColor = bubbleLight.color }
    const lightFade = smooth((t - 0.75) / 0.5)
    const lightRadius = bubbleLight ? Math.min(w, h) * bubbleLight.radius : 0
    // Enter from above, easing into the same destination used by scroll motion.
    // Keep opacity separate so the downward movement and fade overlap.
    const arrival = reduced ? 1 : entryProgress(t, p.entry)
    const y = h * (p.figure.y + scrollPosition * p.scroll.figureOffset - (1 - arrival) * p.entry.distance) + bob
    const angle = Math.PI + (reduced ? 0 : Math.sin(t * 0.5) * p.figure.rotation)
    // Reveal the final figure under the clearing foam, without an empty beat.
    if (t > p.entry.start) {
      const appear = smooth((t - p.entry.start) / p.entry.fadeDuration)
      ctx.save(); ctx.globalAlpha = appear * p.figure.opacity
      ctx.translate(x, y); ctx.rotate(angle)
      ctx.drawImage(silhouette, -silhouetteWidth / 2, -silhouetteHeight / 2, silhouetteWidth, silhouetteHeight)
      ctx.restore()
      // Both layers share the exact alpha contour and transform. The color
      // fade is applied afterward in viewport coordinates, so deeper parts
      // become silhouettes even as the inverted figure moves with scrolling.
      colorCtx.setTransform(dpr, 0, 0, dpr, 0, 0)
      colorCtx.clearRect(0, 0, w, h)
      colorCtx.save()
      colorCtx.translate(x, y); colorCtx.rotate(angle)
      colorCtx.drawImage(portrait, -silhouetteWidth / 2, -silhouetteHeight / 2, silhouetteWidth, silhouetteHeight)
      colorCtx.restore()
      colorCtx.save()
      colorCtx.globalCompositeOperation = 'source-atop'
      colorCtx.fillStyle = p.figure.tint; colorCtx.fillRect(0, 0, w, h)
      // Surface light stays in screen coordinates and is clipped to the
      // portrait alpha; the inverted lower body is nearest the top of screen.
      const surfaceTint = p.figure.surfaceTint
      if (surfaceTint) {
        const light = colorCtx.createLinearGradient(0, 0, 0, h * surfaceTint.depth)
        light.addColorStop(0, surfaceTint.color)
        light.addColorStop(1, surfaceTint.color + '00')
        colorCtx.globalAlpha = surfaceTint.maxAlpha
        colorCtx.fillStyle = light; colorCtx.fillRect(0, 0, w, h)
        colorCtx.globalAlpha = 1
      }
      if (lens && bubbles.length) captureBubbleTiles(colorLayer, bubbles, lensDetail, w, h, dpr)
      // Expand the deep-water silhouette upward as the panel scrolls down,
      // so the torso also loses its color at the bottom of the scroll range.
      const depth = colorCtx.createLinearGradient(0, 0, 0, h * (p.depth.range - scrollPosition * p.depth.scrollRange))
      for (const [offset, color] of p.depth.stops) depth.addColorStop(offset, color)
      colorCtx.globalCompositeOperation = 'destination-in'
      if (bubbleLight && bubbleLight.detailOpacity > 0 && bubbles.length) {
        // Restore color locally by adding soft alpha to the depth mask. The
        // portrait's own alpha contour still clips every restored detail.
        maskCtx.setTransform(dpr, 0, 0, dpr, 0, 0)
        maskCtx.clearRect(0, 0, w, h)
        maskCtx.fillStyle = depth; maskCtx.fillRect(0, 0, w, h)
        drawBubbleLights(maskCtx, bubbles, lightRadius, '#ffffff', bubbleLight.detailOpacity * lightFade, bubbleLight.style, reduced ? 0 : t, h, bubbleLight.hazeBlur)
        colorCtx.drawImage(detailMask, 0, 0, w, h)
      } else {
        colorCtx.fillStyle = depth; colorCtx.fillRect(0, 0, w, h)
      }
      colorCtx.restore()
      ctx.save(); ctx.globalAlpha = appear * p.figure.colorOpacity
      ctx.drawImage(colorLayer, 0, 0, w, h); ctx.restore()
    }
    if (p.surfaceLight && p.surfaceLight.mode === state?.mode && p.surfaceLight.style === 'refracted-caustics') {
      drawSurfaceLight(ctx, w, h, reduced ? 0 : t, p.surfaceLight, surfaceAppear)
    }
    if (lens && bubbles.length) {
      captureBubbleTiles(canvas, bubbles, lensScene, w, h, dpr)
      drawBubbleLenses(ctx, bubbles, lensScene, lensDetail, lensOutput, lens, reduced ? 0 : t, lightFade, h, bubbleLight, bubbleShape)
    }
    if (bubbleLight && bubbles.length) {
      drawBubbleShadows(ctx, bubbles, bubbleLight, lightFade, p.figure.ink, reduced ? 0 : t, bubbleShape)
      ctx.save(); ctx.globalCompositeOperation = 'screen'
      drawBubbleLights(ctx, bubbles, lightRadius, bubbleLight.color, bubbleLight.glowOpacity * lightFade, bubbleLight.style, reduced ? 0 : t, h, bubbleLight.hazeBlur, bubbleGlow)
      ctx.restore()
    }
    if (bubblePaint && bubbles.length) drawBubblePaint(ctx, bubbles, bubblePaint, reduced ? 0 : t, lightFade, bubbleShape)
    if (p.water.clipFigure) ctx.restore()
    const splash = reduced ? null : splashAt(t, p)
    if (splash !== null) {
      const frame = foam[splash.frame]
      if (frame) {
        // Cover the viewport with the original centered composition. Moving
        // this crop with the character exposes its unfinished foam edges.
        const aspect = (frame.naturalWidth - 4) / (frame.naturalHeight - 4)
        const fh = Math.max(h, w / aspect)
        const fw = fh * aspect
        ctx.save(); ctx.globalAlpha = splash.alpha
        // The supplied crops contain a one-pixel seam along some image edges.
        ctx.drawImage(splashCache.get(frame, p.splash.tone), 2, 2, frame.naturalWidth - 4, frame.naturalHeight - 4,
          (w - fw) / 2, (h - fh) / 2, fw, fh); ctx.restore()
      }
    } else splashCache.clear()
    // Detached splash bubbles continue upward while the main foam clears.
    if (!reduced && t >= 0.5 && t < 1.45) {
      const age = t - 0.5
      ctx.save(); ctx.fillStyle = p.splash.particleColor ?? '#89ecff'; ctx.globalAlpha = (1 - smooth(age / 0.95)) * 0.55
      for (let i = 0; i < 24; i++) {
        const bx = w * 0.5 + Math.sin(i * 2.4) * w * 0.35 + Math.sin(age * 3 + i) * w * 0.008
        const by = h * ((i % 8) * 0.095) - age * h * (0.18 + (i % 3) * 0.06)
        ctx.beginPath(); ctx.ellipse(bx, by, 2 + i % 6, 4 + i % 8, 0.15, 0, Math.PI * 2); ctx.fill()
      }
      ctx.restore()
    }
    if (bubbles.length) {
      ctx.save(); ctx.strokeStyle = bubblePaint?.outlineColor ?? '#a5e9ff'; ctx.lineWidth = 1.3; ctx.globalAlpha = bubblePaint?.outlineOpacity ?? 0.22
      for (const bubble of bubbles) {
        const amount = bubble.lightAmount ?? 0
        ctx.strokeStyle = bubblePaint?.outlineColor ?? '#a5e9ff'
        ctx.globalAlpha = (bubblePaint?.outlineOpacity ?? 0.22) * (1 - (bubbleLight?.style === 'top-haze' ? amount : 0))
        ctx.beginPath(); traceBubble(ctx, bubble, reduced ? 0 : t, bubbleShape); ctx.stroke()
        if (bubbleLight?.style === 'top-haze') {
          if (amount <= 0) continue
          const rim = ctx.createLinearGradient(0, bubble.y - bubble.radius, 0, bubble.y + bubble.radius)
          rim.addColorStop(0, bubbleLight.color); rim.addColorStop(0.5, bubbleLight.color + '60')
          rim.addColorStop(1, bubbleShape?.squash ? bubbleLight.color + '00' : bubbleLight.shadowColor ?? p.figure.ink)
          ctx.strokeStyle = rim
          ctx.globalAlpha = lightFade * amount * (lens?.rimOpacity ?? (bubbleShape?.squash ? 0.32 : 0.22))
          ctx.beginPath(); traceBubble(ctx, bubble, reduced ? 0 : t, bubbleShape); ctx.stroke()
        }
      }
      if (bubbleLight?.style === 'refracted-rim') {
        ctx.strokeStyle = '#e3fbff'; ctx.lineWidth = 0.75
        for (const bubble of bubbles) {
          ctx.globalAlpha = lightFade * ((lens?.rimOpacity ?? 0.32) - clamp(bubble.y / h) * 0.15)
          ctx.beginPath(); ctx.arc(bubble.x, bubble.y, bubble.radius * 0.82, Math.PI * 1.05, Math.PI * 1.56); ctx.stroke()
        }
      }
      if (bubbleLight?.style === 'top-haze' && !bubbleShape?.squash) {
        ctx.strokeStyle = bubbleLight.color; ctx.lineWidth = 0.75
        for (const bubble of bubbles) {
          ctx.globalAlpha = lightFade * ((lens?.rimOpacity ?? 0.32) - clamp(bubble.y / h) * 0.15)
          // Separate painted glints read like the foam artwork, rather than a
          // continuous glass rim around the whole upper hemisphere.
          ctx.beginPath(); ctx.arc(bubble.x, bubble.y, bubble.radius * 0.84, Math.PI * 1.16, Math.PI * 1.49); ctx.stroke()
          ctx.globalAlpha *= 0.55
          ctx.beginPath(); ctx.arc(bubble.x, bubble.y, bubble.radius * 0.84, Math.PI * 1.72, Math.PI * 1.82); ctx.stroke()
        }
      }
      ctx.restore()
    }
  }
  const tick = (now: number): void => {
    if (disposed) return
    if (!document.hidden && now - last >= 1000 / 60 - 1) { render(now); last = now }
    if (!motion.matches) raf = requestAnimationFrame(tick)
  }
  const redraw = (): void => {
    cancelAnimationFrame(raf)
    render(performance.now())
    if (!motion.matches && portrait) raf = requestAnimationFrame(tick)
  }
  window.addEventListener('resize', redraw)
  motion.addEventListener('change', redraw)
  // Standalone preview has no panel scroll engine. This listener only observes
  // wheel events; the panel supplies its real virtual scroll position instead.
  const onWheel = (event: WheelEvent): void => {
    if (motion.matches || event.ctrlKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return
    const target = event.target
    if (target instanceof Element && target.closest('textarea, input, select, [contenteditable="true"]')) return
    const units = event.deltaMode === 1 ? 40 : event.deltaMode === 2 ? window.innerHeight : 1
    scrollTarget = clamp(scrollTarget + event.deltaY * units / Math.max(window.innerHeight, 1) * p.scroll.wheelScale)
  }
  if (!opts.scrollProgress) document.addEventListener('wheel', onWheel, { passive: true, capture: true })
  void Promise.all([load(opts.assetUrl(p.portrait)), ...p.foam.map(path => load(opts.assetUrl(path)))])
    .then(([portraitImage, ...frames]) => {
      if (disposed) return
      portrait = portraitImage
      silhouette = document.createElement('canvas')
      silhouette.width = portraitImage.naturalWidth; silhouette.height = portraitImage.naturalHeight
      const ink = silhouette.getContext('2d')!
      ink.drawImage(portraitImage, 0, 0)
      ink.globalCompositeOperation = 'source-in'; ink.fillStyle = p.figure.ink
      ink.fillRect(0, 0, silhouette.width, silhouette.height)
      foam = frames; start = performance.now(); redraw()
      // Reduced motion has no animation loop; still react to display settings.
      visualPoll = window.setInterval(() => {
        if (!disposed && motion.matches) {
          syncPalette(performance.now())
          if (visualKey() + ':1.000' !== visualSignature) redraw()
        }
      }, 250)
    }).catch((error: unknown) => { if (!disposed) { canvas.remove(); visualStyle.remove(); transitionStyle.remove(); console.warn('[daynight] 入水素材加载失败', error) } })
  return () => {
    if (disposed) return
    disposed = true; cancelAnimationFrame(raf); clearInterval(visualPoll)
    splashCache.clear()
    window.removeEventListener('resize', redraw); motion.removeEventListener('change', redraw)
    document.removeEventListener('wheel', onWheel, { capture: true })
    if (!portrait || motion.matches || document.hidden) { canvas.remove(); visualStyle.remove(); transitionStyle.remove(); return }
    // Interpolate tokens throughout exit, including newly mounted containers.
    const exitStart = performance.now(), fromPresence = themePresence
    pendingThemeBaseline = fallbackPalette; pendingThemePresence = fromPresence
    const fadeTheme = (now: number): void => {
      pendingThemePresence = fromPresence * (1 - smooth((now - exitStart) / p.exit.duration))
      updateUi(pendingThemePresence)
      if (pendingThemePresence > 0) themeRaf = requestAnimationFrame(fadeTheme)
    }
    themeRaf = requestAnimationFrame(fadeTheme)
    // Freeze the last rendered frame, lift it toward the surface and withdraw
    // the water from bottom to top while fading into the next tab's background.
    const scaleTransform = getComputedStyle(canvas).transform
    const baseTransform = scaleTransform === 'none' ? '' : ' ' + scaleTransform
    const exit = canvas.animate([
      { opacity: 1, transform: 'translateY(0)' + baseTransform, clipPath: 'inset(0 0 0 0)' },
      { opacity: p.exit.middleOpacity, transform: `translateY(${p.exit.middleLift}vh)` + baseTransform, clipPath: `inset(0 0 ${p.exit.middleClip}% 0)`, offset: 0.45 },
      { opacity: 0, transform: `translateY(${p.exit.lift}vh)` + baseTransform, clipPath: 'inset(0 0 100% 0)' },
    ], { duration: p.exit.duration, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', fill: 'forwards' })
    const finish = (): void => {
      clearTimeout(fallback)
      cancelAnimationFrame(themeRaf)
      updateUi(0)
      exit.cancel(); canvas.remove(); visualStyle.remove(); transitionStyle.remove()
      if (finishPendingExit === finish) { finishPendingExit = undefined; pendingThemeBaseline = undefined; pendingThemePresence = 0 }
    }
    const fallback = window.setTimeout(finish, p.exit.duration + 150)
    finishPendingExit = finish
    void exit.finished.then(finish, finish)
  }
}

/** Load tab behavior and assets from the mounted DWP, never from the plugin bundle. */
export function startPackageTabScene(id: string, opts: {
  scrollProgress?: () => number
  visualState?: () => { focus: boolean; mode: string; panelAlpha?: number }
  clock?: () => Date
  base?: string
} = {}): () => void {
  const abort = new AbortController()
  let stop: (() => void) | undefined
  const base = opts.base ?? '/we-sync/dwp'
  void fetch(base + '/scene?id=' + encodeURIComponent(id), { cache: 'no-store', signal: abort.signal })
    .then(async response => {
      if (!response.ok) throw new Error('Tab scene fetch failed: ' + response.status)
      const scene = await response.json()
      const profile = parseTabScene(scene.dsh?.tabScene)
      if (abort.signal.aborted || !profile) return
      const urls = new Map<string, string>()
      try {
        const fetched = await Promise.allSettled([profile.portrait, ...profile.foam].map(async name => {
          const response = await fetch(base + '/file?id=' + encodeURIComponent(id) + '&name=' + encodeURIComponent(name), { cache: 'no-store', signal: abort.signal })
          if (!response.ok) throw new Error('Tab asset fetch failed: ' + name)
          const blob = await response.blob()
          if (!abort.signal.aborted) urls.set(name, URL.createObjectURL(blob))
        }))
        const failed = fetched.find(result => result.status === 'rejected')
        if (failed?.status === 'rejected') throw failed.reason
        if (abort.signal.aborted) return
        const dispose = startDayNightDive({ ...opts, profile, assetUrl: name => urls.get(name)! })
        stop = () => { dispose(); for (const url of urls.values()) URL.revokeObjectURL(url) }
      } finally {
        if (!stop) for (const url of urls.values()) URL.revokeObjectURL(url)
      }
    }).catch(error => { if (!abort.signal.aborted) console.warn('[dwp] Tab scene unavailable', error) })
  return () => { abort.abort(); stop?.() }
}
