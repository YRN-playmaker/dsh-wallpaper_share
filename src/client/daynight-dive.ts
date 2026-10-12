import { parseTabScene, type TabScene } from '../daynight/tab-scene.ts'

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
export function tabSceneThemeCss(ui: TabScene['ui'], panelAlpha: number): string {
  if (!ui) return ''
  const amount = clamp(panelAlpha / 100)
  const alpha = (base: number, influence = ui.sliderInfluence): string => Math.min(0.96, base + amount * influence).toFixed(3)
  const scope = 'body:has(canvas[data-daynight-dive="1"])'
  const theme = (dark: boolean): string => {
    const s = scope + (dark ? '[data-ds-dark-theme]' : ':not([data-ds-dark-theme])')
    const page = dark ? '15,16,20' : '246,247,250'
    const layer = dark ? '24,26,32' : '255,255,255'
    const sidebar = dark ? '13,14,17' : '238,240,244'
    const cardAlpha = dark ? ui.darkCardAlpha : ui.lightCardAlpha
    return `${s} {
      --dsw-alias-bg-base: rgba(${page},${alpha(ui.pageAlpha)});
      --dsw-alias-bg-layer-1: rgba(${layer},${alpha(ui.layerAlpha)});
      --dsw-alias-bg-layer-2: rgba(${layer},${alpha(ui.layerAlpha)});
      --dsw-specific-sidebar-fill: rgba(${sidebar},${alpha(dark ? ui.darkSidebarAlpha : ui.lightSidebarAlpha)});
    }
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
export function splashAt(t: number, profile: TabScene): { frame: number; alpha: number; progress: number } | null {
  const cel = Math.floor((t - profile.splash.start) * profile.splash.fps)
  if (cel < 0 || cel >= profile.splash.exposures.length) return null
  return { frame: profile.splash.exposures[cel], alpha: 1 - smooth((t - profile.splash.fadeStart) / profile.splash.fadeDuration), progress: cel / (profile.splash.exposures.length - 1) }
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
type CausticField = { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; image: ImageData; density: Float32Array; waveX: { kx: number; ky: number; amplitude: number; omega: number; sin: Float32Array; cos: Float32Array }[]; domainX: number; domainY: number; lastTime: number }
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
  if (Math.abs(time - field.lastTime) < 1 / 24) return field.canvas
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
  field.ctx.putImageData(field.image, 0, 0)
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
function drawBottomDots(ctx: CanvasRenderingContext2D, w: number, h: number, scroll: number, dots: TabScene['bottomDots']): void {
  if (!dots) return
  const appear = smooth((scroll - dots.scrollStart) / (1 - dots.scrollStart))
  if (appear <= 0) return
  const depth = h * dots.depth
  const columns = Math.ceil(w / dots.spacing)
  const left = (w - (columns - 1) * dots.spacing) / 2
  ctx.save(); ctx.fillStyle = dots.color
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

type RisingBubble = { x: number; y: number; radius: number }
/** One position list drives the bubble outlines, water glow, and portrait mask. */
function risingBubbles(w: number, h: number, time: number, scroll: number, offset: number, reduced: boolean): RisingBubble[] {
  if (time < 0.75) return []
  return Array.from({ length: 20 }, (_, i) => {
    const phase = reduced ? i / 20 : ((time * (0.025 + (i % 3) * 0.006) + i * 0.173) % 1)
    return { x: w * (0.08 + ((i * 0.137) % 0.84)), y: h * (1.1 - phase * 1.2) + h * scroll * offset, radius: 2 + i % 5 }
  })
}

/** Radial falloff has no hard edge; several lights blend without a white disk. */
function drawBubbleLights(ctx: CanvasRenderingContext2D, bubbles: RisingBubble[], radius: number, color: string, opacity: number): void {
  if (opacity <= 0) return
  ctx.save(); ctx.globalAlpha = opacity
  for (const bubble of bubbles) {
    const reach = radius * (0.65 + bubble.radius * 0.1)
    const light = ctx.createRadialGradient(bubble.x, bubble.y, 0, bubble.x, bubble.y, reach)
    light.addColorStop(0, color); light.addColorStop(0.3, color + '80'); light.addColorStop(1, color + '00')
    ctx.fillStyle = light; ctx.fillRect(bubble.x - reach, bubble.y - reach, reach * 2, reach * 2)
  }
  ctx.restore()
}

/** A tab-owned background; cleanup also cancels pending decodes and animation frames. */
export function startDayNightDive(opts: { profile: TabScene; assetUrl: (path: string) => string; scrollProgress?: () => number; visualState?: () => { focus: boolean; mode: string; panelAlpha?: number } }): () => void {
  const p = opts.profile
  // A quick return to the tab replaces the outgoing background immediately.
  finishPendingExit?.()
  const canvas = document.createElement('canvas')
  canvas.dataset.daynightDive = '1'
  canvas.setAttribute('aria-hidden', 'true')
  Object.assign(canvas.style, { position: 'fixed', inset: '0', width: '100%', height: '100%', zIndex: '-2', pointerEvents: 'none' })
  const ctx = canvas.getContext('2d')
  if (!ctx) return () => {}
  document.body.appendChild(canvas)
  const visualStyle = document.createElement('style')
  document.head.appendChild(visualStyle)
  let visualSignature = ''
  const motion = matchMedia('(prefers-reduced-motion: reduce)')
  let disposed = false, raf = 0, start = 0, last = -Infinity, visualPoll = 0
  const visualKey = (): string => {
    const state = opts.visualState?.()
    return String(state?.focus === true && state.mode === p.focus.mode) + ':' + (state?.panelAlpha ?? 0) + ':' + (state?.mode ?? '')
  }
  let scrollTarget = 0, scrollPosition = 0, previousFrame = 0
  let silhouette: HTMLCanvasElement | undefined
  let portrait: HTMLImageElement | undefined
  const colorLayer = document.createElement('canvas')
  const colorCtx = colorLayer.getContext('2d')!
  const detailMask = document.createElement('canvas')
  const maskCtx = detailMask.getContext('2d')!
  let foam: HTMLImageElement[] = []
  let width = 0, height = 0
  const render = (now: number): void => {
    if (disposed || !silhouette || !portrait) return
    const reduced = motion.matches
    const state = opts.visualState?.()
    const breathe = state?.focus === true && state.mode === p.focus.mode
    const panelAlpha = state?.panelAlpha ?? 0
    const signature = String(breathe) + ':' + panelAlpha + ':' + (state?.mode ?? '')
    if (signature !== visualSignature) {
      visualSignature = signature
      visualStyle.textContent = tabSceneThemeCss(p.ui, panelAlpha) + (breathe ? dayNightVisualCss(0, 1, p.focus) : '')
    }
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
    drawBottomDots(ctx, w, h, scrollPosition, p.bottomDots)
    if (p.water.clipFigure) ctx.globalAlpha = 1
    else ctx.restore()
    // Keep the front's clip active through both portrait layers, so the figure
    // cannot descend into an area of background that has not opened yet.
    // The portrait moves independently of the centered, viewport-sized foam.
    const bob = reduced ? 0 : Math.sin((t - 2) * 0.8) * h * p.figure.bob
    const silhouetteHeight = Math.min(h * p.figure.height, w * p.figure.maxWidthHeight)
    const silhouetteWidth = silhouetteHeight * silhouette.width / silhouette.height
    const x = w * p.figure.x
    const bubbles = risingBubbles(w, h, t, scrollPosition, p.scroll.bubbleOffset, reduced)
    const bubbleLight = p.bubbleLight && (!p.bubbleLight.mode || p.bubbleLight.mode === state?.mode) ? p.bubbleLight : undefined
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
      // Expand the deep-water silhouette upward as the panel scrolls down,
      // so the torso also loses its color at the bottom of the scroll range.
      const depth = colorCtx.createLinearGradient(0, 0, 0, h * (p.depth.range - scrollPosition * p.depth.scrollRange))
      for (const [offset, color] of p.depth.stops) depth.addColorStop(offset, color)
      colorCtx.globalCompositeOperation = 'destination-in'
      if (bubbleLight && bubbles.length) {
        // Restore color locally by adding soft alpha to the depth mask. The
        // portrait's own alpha contour still clips every restored detail.
        maskCtx.setTransform(dpr, 0, 0, dpr, 0, 0)
        maskCtx.clearRect(0, 0, w, h)
        maskCtx.fillStyle = depth; maskCtx.fillRect(0, 0, w, h)
        drawBubbleLights(maskCtx, bubbles, lightRadius, '#ffffff', bubbleLight.detailOpacity * lightFade)
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
    if (bubbleLight && bubbles.length) {
      ctx.save(); ctx.globalCompositeOperation = 'screen'
      drawBubbleLights(ctx, bubbles, lightRadius, bubbleLight.color, bubbleLight.glowOpacity * lightFade)
      ctx.restore()
    }
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
        ctx.drawImage(frame, 2, 2, frame.naturalWidth - 4, frame.naturalHeight - 4,
          (w - fw) / 2, (h - fh) / 2, fw, fh); ctx.restore()
      }
    }
    // Detached splash bubbles continue upward while the main foam clears.
    if (!reduced && t >= 0.5 && t < 1.45) {
      const age = t - 0.5
      ctx.save(); ctx.fillStyle = '#89ecff'; ctx.globalAlpha = (1 - smooth(age / 0.95)) * 0.55
      for (let i = 0; i < 24; i++) {
        const bx = w * 0.5 + Math.sin(i * 2.4) * w * 0.35 + Math.sin(age * 3 + i) * w * 0.008
        const by = h * ((i % 8) * 0.095) - age * h * (0.18 + (i % 3) * 0.06)
        ctx.beginPath(); ctx.ellipse(bx, by, 2 + i % 6, 4 + i % 8, 0.15, 0, Math.PI * 2); ctx.fill()
      }
      ctx.restore()
    }
    if (bubbles.length) {
      ctx.save(); ctx.strokeStyle = '#a5e9ff'; ctx.lineWidth = 1.3; ctx.globalAlpha = 0.22
      for (const bubble of bubbles) {
        ctx.beginPath(); ctx.arc(bubble.x, bubble.y, bubble.radius, 0, Math.PI * 2); ctx.stroke()
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
        if (!disposed && motion.matches && visualKey() !== visualSignature) redraw()
      }, 250)
    }).catch((error: unknown) => { if (!disposed) { canvas.remove(); visualStyle.remove(); console.warn('[daynight] 入水素材加载失败', error) } })
  return () => {
    if (disposed) return
    disposed = true; cancelAnimationFrame(raf); clearInterval(visualPoll)
    window.removeEventListener('resize', redraw); motion.removeEventListener('change', redraw)
    document.removeEventListener('wheel', onWheel, { capture: true })
    if (!portrait || motion.matches || document.hidden) { canvas.remove(); visualStyle.remove(); return }
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
      exit.cancel(); canvas.remove(); visualStyle.remove()
      if (finishPendingExit === finish) finishPendingExit = undefined
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
  base?: string
} = {}): () => void {
  finishPendingExit?.()
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
