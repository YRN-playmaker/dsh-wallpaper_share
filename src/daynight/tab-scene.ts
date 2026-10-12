/** Declarative DWP extension. Contains no executable package code. */
export interface SplashTone { sepia: number; saturation: number; hueRotate: number; brightness: number }

export interface TabScene {
  format: 'dsh/tab-scene/1'
  portrait: string
  foam: string[]
  splash: { fps: number; start: number; exposures: number[]; fadeStart: number; fadeDuration: number; tone?: SplashTone; particleColor?: string }
  entry: { start: number; duration: number; fadeDuration: number; distance: number; easing?: 'cubic-out' }
  figure: { x: number; y: number; height: number; maxWidthHeight: number; ink: string; opacity: number; colorOpacity: number; tint: string; bob: number; rotation: number; surfaceTint?: { color: string; maxAlpha: number; depth: number } }
  depth: { range: number; scrollRange: number; stops: [number, string][] }
  water: { revealStart: number; revealDuration: number; clipFigure?: boolean; stops: [number, string][]; scrollOffset: number; scrollTint: string; scrollDarkness: number; surface?: { count: number; clusters: [number, number][]; depth: number; opacity: number; speed: number; color: string; glow: string } }
  scroll: { figureOffset: number; bubbleOffset: number; smoothing: number; wheelScale: number }
  exit: { duration: number; middleLift: number; lift: number; middleClip: number; middleOpacity: number }
  focus: { mode: 'enhanced'; minBlur: number; maxBlur: number; duration: number; scale: number }
  ui?: { pageAlpha: number; layerAlpha: number; sliderInfluence: number; darkCardAlpha: number; lightCardAlpha: number; darkSidebarAlpha: number; lightSidebarAlpha: number; cardBlur: number; hoverColor?: string; selectedColor?: string }
  entryCurve?: { width: number; spread: number; shoulderDelay?: number; spreadStart?: number; tipPower?: number; centerOffset?: number; depthScale?: number }
  bottomDots?: { scrollStart: number; depth: number; spacing: number; minRadius: number; maxRadius: number; opacity: number; color: string; completeColor?: string }
  bubbleLight?: { mode?: 'enhanced'; style?: 'refracted-rim' | 'top-haze'; radius: number; detailOpacity: number; glowOpacity: number; color: string; hazeBlur?: number; shadowOpacity?: number; shadowColor?: string; heightFade?: { start: number; end: number } }
  bubblePaint?: { mode: 'enhanced'; color: string; opacity: number; outlineColor: string; outlineOpacity: number }
  bubbleLens?: { mode: 'enhanced'; radiusScale: number; maxRadius: number; magnification: number; distortion: number; detailOpacity: number; rimOpacity: number }
  bubbleShape?: { mode: 'enhanced'; style?: 'flat-2d' | 'ellipsoid-2d'; lowerWidth: number; lowerWobble: number; upperWobble: number; speed: number; tilt?: number; squash?: number; physics?: { density: number; surfaceTension: number; minDiameterMm: number; maxDiameterMm: number; referenceRadius: number; riseSpeed: number; timeScale: number; damping: number } }
  bubbleField?: { mode: 'enhanced'; seed: number; count: number; minRadius: number; maxRadius: number; minSpeed: number; maxSpeed: number; startSpread: number; drift: number; swaySpeed?: number }
  surfaceLight?: { mode: 'enhanced'; style?: 'refracted-caustics'; count: number; depth: number; opacity: number; speed: number; sway: number; color: string; refraction?: number; sharpness?: number; scrollFadeEnd?: number }
  nightPalette?: {
    mode: 'enhanced'
    water: { stops: [number, string][]; scrollTint: string; surface?: { color: string; glow: string } }
    figure: { ink: string; tint: string; surfaceTint?: string; colorOpacity?: number }
    bubblePaint?: { outlineColor: string }
    bubbleLight?: { color: string; shadowColor: string }
    surfaceLight?: { color: string }
    ui?: { hoverColor: string; selectedColor: string }
    splash?: { tone: SplashTone; particleColor: string }
  }
}

export const DAYNIGHT_TAB_SCENE: TabScene = {
  format: 'dsh/tab-scene/1',
  nightPalette: {
    mode: 'enhanced',
    water: { stops: [[0, '#cf8247'], [0.25, '#cd5d3d'], [0.65, '#bc443f'], [1, '#a73f3a']], scrollTint: '#570c24', surface: { color: '#dfbe97', glow: '#d7a573' } },
    figure: { ink: '#320f20', tint: '#c36b482b', surfaceTint: '#e4c59c', colorOpacity: 0 },
    bubblePaint: { outlineColor: '#ddbc9c' },
    bubbleLight: { color: '#e3caa8', shadowColor: '#320f20' },
    surfaceLight: { color: '#e3caa8' },
    ui: { hoverColor: '#f15b63', selectedColor: '#e94650' },
    splash: { tone: { sepia: 1, saturation: 1.7, hueRotate: -20, brightness: 0.78 }, particleColor: '#f2ca92' },
  },
  entryCurve: { width: 0.25, spread: 0.8, shoulderDelay: 0.35, spreadStart: 0.5, tipPower: 3, centerOffset: -0.06, depthScale: 0.65 },
  bottomDots: { scrollStart: 0.82, depth: 0.24, spacing: 22, minRadius: 0.7, maxRadius: 3.2, opacity: 0.36, color: '#94caff', completeColor: '#031633' },
  bubblePaint: { mode: 'enhanced', color: '#ffffff', opacity: 0.1, outlineColor: '#90d9f0', outlineOpacity: 0.24 },
  bubbleLight: { mode: 'enhanced', style: 'top-haze', radius: 0.035, detailOpacity: 0, glowOpacity: 0.18, color: '#d9f5ff', hazeBlur: 0.24, shadowOpacity: 0.24, shadowColor: '#031633', heightFade: { start: 0.5, end: 0.25 } },
  bubbleLens: { mode: 'enhanced', radiusScale: 2.6, maxRadius: 19.8, magnification: 1.35, distortion: 0, detailOpacity: 0.6, rimOpacity: 0.4 },
  bubbleShape: { mode: 'enhanced', style: 'ellipsoid-2d', lowerWidth: 1.01, lowerWobble: 0.04, upperWobble: 0.012, speed: 1.8, tilt: 0.28, squash: 0.055, physics: { density: 998, surfaceTension: 0.072, minDiameterMm: 0.8, maxDiameterMm: 2.8, referenceRadius: 19.8, riseSpeed: 0.23, timeScale: 0.006, damping: 0.5 } },
  bubbleField: { mode: 'enhanced', seed: 261012, count: 12, minRadius: 2, maxRadius: 6.75, minSpeed: 0.025, maxSpeed: 0.045, startSpread: 6, drift: 0.006, swaySpeed: 1.8 },
  surfaceLight: { mode: 'enhanced', style: 'refracted-caustics', count: 5, depth: 0.26, opacity: 0.26, speed: 0.65, sway: 0.014, color: '#d4ffff', refraction: 1.25, sharpness: 1.35, scrollFadeEnd: 0.65 },
  portrait: 'assets/dive/character-color.png',
  foam: Array.from({ length: 10 }, (_, i) => `assets/dive/foam-${i}.png`),
  splash: { fps: 24, start: 1 / 24, exposures: [0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9], fadeStart: 0.58, fadeDuration: 0.22 },
  entry: { start: 1 / 24, duration: 0.65, fadeDuration: 0.55, distance: 0.38, easing: 'cubic-out' },
  figure: { x: 0.8, y: 0.18, height: 1.35, maxWidthHeight: 2.4, ink: '#031633', opacity: 0.75, colorOpacity: 0.9, tint: '#168fd52b', bob: 0.012, rotation: 0.015, surfaceTint: { color: '#F7F4D4', maxAlpha: 0.3, depth: 0.4 } },
  depth: { range: 0.62, scrollRange: 0.37, stops: [[0, '#ffffff'], [0.16, '#ffffffe6'], [0.42, '#ffffff8c'], [0.7, '#ffffff2e'], [1, '#ffffff00']] },
  water: { revealStart: 0.01, revealDuration: 0.4, clipFigure: true, stops: [[0, '#08c9f3'], [0.25, '#087ee5'], [0.65, '#084bce'], [1, '#071a86']], scrollOffset: 0.035, scrollTint: '#020e45', scrollDarkness: 0.32, surface: { count: 24, clusters: [[0.12, 0.025], [0.48, 0.07], [0.84, 0.03]], depth: 0.27, opacity: 0.16, speed: 0.18, color: '#c0faff', glow: '#2eeaff' } },
  scroll: { figureOffset: 0.12, bubbleOffset: 0.025, smoothing: 180, wheelScale: 0.3 },
  exit: { duration: 450, middleLift: -3, lift: -8, middleClip: 18, middleOpacity: 0.75 },
  focus: { mode: 'enhanced', minBlur: 1, maxBlur: 4, duration: 5, scale: 1.015 },
  ui: { pageAlpha: 0.035, layerAlpha: 0.045, sliderInfluence: 0.12, darkCardAlpha: 0.62, lightCardAlpha: 0.76, darkSidebarAlpha: 0.16, lightSidebarAlpha: 0.12, cardBlur: 12, hoverColor: '#2563eb', selectedColor: '#2563eb' },
}

/** Reject missing or malformed profiles before fetching their resources. */
export function parseTabScene(value: unknown): TabScene | null {
  if (!value || typeof value !== 'object') return null
  const p = value as TabScene
  const safePath = (s: unknown): s is string => typeof s === 'string' && /^assets\/[\w./-]+$/.test(s) && !s.includes('..')
  if (p.format !== 'dsh/tab-scene/1' || !safePath(p.portrait) || !Array.isArray(p.foam) || p.foam.length !== 10 || !p.foam.every(safePath)) return null
  for (const key of ['splash', 'entry', 'figure', 'depth', 'water', 'scroll', 'exit', 'focus'] as const) {
    if (!p[key] || typeof p[key] !== 'object') return null
  }
  const numericKeys = {
    splash: ['fps', 'start', 'fadeStart', 'fadeDuration'], entry: ['start', 'duration', 'fadeDuration', 'distance'],
    figure: ['x', 'y', 'height', 'maxWidthHeight', 'opacity', 'colorOpacity', 'bob', 'rotation'],
    depth: ['range', 'scrollRange'], water: ['revealStart', 'revealDuration', 'scrollOffset', 'scrollDarkness'],
    scroll: ['figureOffset', 'bubbleOffset', 'smoothing', 'wheelScale'],
    exit: ['duration', 'middleLift', 'lift', 'middleClip', 'middleOpacity'], focus: ['minBlur', 'maxBlur', 'duration', 'scale'],
  }
  for (const [key, fields] of Object.entries(numericKeys)) {
    const group = (p as unknown as Record<string, Record<string, unknown>>)[key]
    if (!fields.every(field => typeof group[field] === 'number' && Number.isFinite(group[field]))) return null
  }
  if (!Array.isArray(p.splash.exposures) || !p.splash.exposures.length || !p.splash.exposures.every(i => Number.isInteger(i) && i >= 0 && i < p.foam.length)) return null
  const validSplashTone = (tone: SplashTone): boolean => !!tone && [tone.sepia, tone.saturation, tone.hueRotate, tone.brightness].every(Number.isFinite) && tone.sepia >= 0 && tone.sepia <= 1 && tone.saturation >= 0 && tone.saturation <= 4 && Math.abs(tone.hueRotate) <= 360 && tone.brightness > 0 && tone.brightness <= 2
  if (p.splash.tone !== undefined && !validSplashTone(p.splash.tone)) return null
  if (p.splash.particleColor !== undefined && (typeof p.splash.particleColor !== 'string' || !/^#[0-9a-f]{6}$/i.test(p.splash.particleColor))) return null
  if (!(p.splash.fps > 0 && p.entry.duration > 0 && p.entry.fadeDuration > 0 && p.splash.fadeDuration > 0 && p.scroll.smoothing > 0 && p.exit.duration > 0 && p.focus.duration > 0)) return null
  for (const group of Object.values(p)) if (group && typeof group === 'object' && !Array.isArray(group)) {
    for (const item of Object.values(group)) if (typeof item === 'number' && !Number.isFinite(item)) return null
  }
  for (const stops of [p.depth.stops, p.water.stops]) {
    if (!Array.isArray(stops) || !stops.length || !stops.every(s => Array.isArray(s) && s.length === 2 && Number.isFinite(s[0]) && s[0] >= 0 && s[0] <= 1 && typeof s[1] === 'string' && /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(s[1]))) return null
  }
  if (![p.figure.ink, p.figure.tint, p.water.scrollTint].every(c => typeof c === 'string' && /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(c))) return null
  if (p.focus.mode !== 'enhanced' || p.focus.minBlur < 0 || p.focus.maxBlur > 30 || p.focus.maxBlur < p.focus.minBlur) return null
  if (p.depth.range <= p.depth.scrollRange || p.depth.scrollRange < 0 || p.figure.opacity < 0 || p.figure.opacity > 1 || p.exit.duration > 5000) return null
  const surfaceTint = p.figure.surfaceTint
  if (surfaceTint && (typeof surfaceTint.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(surfaceTint.color) || !Number.isFinite(surfaceTint.maxAlpha) || surfaceTint.maxAlpha < 0 || surfaceTint.maxAlpha > 1 || !Number.isFinite(surfaceTint.depth) || surfaceTint.depth <= 0 || surfaceTint.depth > 1)) return null
  if (p.entry.easing !== undefined && p.entry.easing !== 'cubic-out') return null
  if (p.water.clipFigure !== undefined && typeof p.water.clipFigure !== 'boolean') return null
  const surface = p.water.surface
  if (surface) {
    if (!Number.isInteger(surface.count) || surface.count < 0 || surface.count > 100 || !Number.isFinite(surface.depth) || surface.depth <= 0 || surface.depth > 1 || !Number.isFinite(surface.opacity) || surface.opacity < 0 || surface.opacity > 1 || !Number.isFinite(surface.speed) || surface.speed < 0 || surface.speed > 2) return null
    if (!Array.isArray(surface.clusters) || !surface.clusters.length || !surface.clusters.every(c => Array.isArray(c) && c.length === 2 && c.every(v => Number.isFinite(v) && v >= 0 && v <= 1))) return null
    if (![surface.color, surface.glow].every(c => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c))) return null
  }
  if (p.ui) {
    for (const key of ['pageAlpha', 'layerAlpha', 'sliderInfluence', 'darkCardAlpha', 'lightCardAlpha', 'darkSidebarAlpha', 'lightSidebarAlpha'] as const) {
      if (!Number.isFinite(p.ui[key]) || p.ui[key] < 0 || p.ui[key] > 1) return null
    }
    if (!Number.isFinite(p.ui.cardBlur) || p.ui.cardBlur < 0 || p.ui.cardBlur > 30) return null
    for (const key of ['hoverColor', 'selectedColor'] as const) {
      if (p.ui[key] !== undefined && (typeof p.ui[key] !== 'string' || !/^#[0-9a-f]{6}$/i.test(p.ui[key]!))) return null
    }
  }
  if (p.entryCurve && (!Number.isFinite(p.entryCurve.width) || p.entryCurve.width <= 0 || p.entryCurve.width > 1 || !Number.isFinite(p.entryCurve.spread) || p.entryCurve.spread < p.entryCurve.width || p.entryCurve.spread > 2)) return null
  if (p.entryCurve) {
    for (const key of ['shoulderDelay', 'spreadStart'] as const) {
      const value = p.entryCurve[key]
      if (value !== undefined && (!Number.isFinite(value) || value < 0 || value >= 0.9)) return null
    }
    if (p.entryCurve.tipPower !== undefined && (!Number.isFinite(p.entryCurve.tipPower) || p.entryCurve.tipPower < 1 || p.entryCurve.tipPower > 6)) return null
    if (p.entryCurve.centerOffset !== undefined && (!Number.isFinite(p.entryCurve.centerOffset) || Math.abs(p.entryCurve.centerOffset) > 0.5)) return null
    if (p.entryCurve.depthScale !== undefined && (!Number.isFinite(p.entryCurve.depthScale) || p.entryCurve.depthScale < 0 || p.entryCurve.depthScale > 1)) return null
  }
  if (p.bottomDots) {
    const dots = p.bottomDots
    if (dots.completeColor !== undefined && (typeof dots.completeColor !== 'string' || !/^#[0-9a-f]{6}$/i.test(dots.completeColor))) return null
    if (![dots.scrollStart, dots.depth, dots.spacing, dots.minRadius, dots.maxRadius, dots.opacity].every(Number.isFinite)) return null
    if (dots.scrollStart < 0 || dots.scrollStart >= 1 || dots.depth <= 0 || dots.depth > 0.5 || dots.spacing < 12 || dots.spacing > 100 || dots.minRadius < 0 || dots.maxRadius <= dots.minRadius || dots.maxRadius > dots.spacing / 3 || dots.opacity < 0 || dots.opacity > 1 || !/^#[0-9a-f]{6}$/i.test(dots.color)) return null
  }
  if (p.bubblePaint) {
    const paint = p.bubblePaint
    if (paint.mode !== 'enhanced' || ![paint.opacity, paint.outlineOpacity].every(Number.isFinite) || paint.opacity < 0 || paint.opacity > 1 || paint.outlineOpacity < 0 || paint.outlineOpacity > 1) return null
    if (![paint.color, paint.outlineColor].every(c => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c))) return null
  }
  if (p.bubbleLight) {
    const light = p.bubbleLight
    if (light.style !== undefined && !['refracted-rim', 'top-haze'].includes(light.style)) return null
    if (light.mode !== undefined && light.mode !== 'enhanced') return null
    if (![light.radius, light.detailOpacity, light.glowOpacity].every(Number.isFinite) || light.radius <= 0 || light.radius > 0.2 || light.detailOpacity < 0 || light.detailOpacity > 1 || light.glowOpacity < 0 || light.glowOpacity > 1 || typeof light.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(light.color)) return null
    if (light.hazeBlur !== undefined && (!Number.isFinite(light.hazeBlur) || light.hazeBlur < 0 || light.hazeBlur > 1)) return null
    if (light.shadowOpacity !== undefined && (!Number.isFinite(light.shadowOpacity) || light.shadowOpacity < 0 || light.shadowOpacity > 0.6)) return null
    if (light.shadowColor !== undefined && (typeof light.shadowColor !== 'string' || !/^#[0-9a-f]{6}$/i.test(light.shadowColor))) return null
    if (light.heightFade && (![light.heightFade.start, light.heightFade.end].every(Number.isFinite) || light.heightFade.start <= 0 || light.heightFade.start > 1 || light.heightFade.end < 0 || light.heightFade.end >= light.heightFade.start)) return null
  }
  if (p.bubbleLens) {
    const lens = p.bubbleLens
    if (lens.mode !== 'enhanced' || ![lens.radiusScale, lens.maxRadius, lens.magnification, lens.distortion, lens.detailOpacity, lens.rimOpacity].every(Number.isFinite)) return null
    if (lens.radiusScale < 1 || lens.radiusScale > 4 || lens.maxRadius < 6 || lens.maxRadius > 32 || lens.magnification < 1 || lens.magnification > 2.5 || lens.distortion < 0 || lens.distortion > 0.25 || lens.detailOpacity < 0 || lens.detailOpacity > 0.7 || lens.rimOpacity < 0 || lens.rimOpacity > 0.8) return null
  }
  if (p.bubbleShape) {
    const shape = p.bubbleShape
    if (shape.style !== undefined && !['flat-2d', 'ellipsoid-2d'].includes(shape.style)) return null
    if (shape.mode !== 'enhanced' || ![shape.lowerWidth, shape.lowerWobble, shape.upperWobble, shape.speed].every(Number.isFinite)) return null
    if (shape.lowerWidth < 1 || shape.lowerWidth > 1.15 || shape.lowerWobble < 0 || shape.lowerWobble > 0.2 || shape.upperWobble < 0 || shape.upperWobble > 0.025 || shape.lowerWobble <= shape.upperWobble || shape.speed < 0.2 || shape.speed > 4) return null
    if (shape.tilt !== undefined && (!Number.isFinite(shape.tilt) || shape.tilt < 0 || shape.tilt > 0.35)) return null
    if (shape.squash !== undefined && (!Number.isFinite(shape.squash) || shape.squash < 0 || shape.squash > 0.2)) return null
    if (shape.style === 'ellipsoid-2d' && !shape.physics) return null
    if (shape.physics) {
      const f = shape.physics
      if (![f.density, f.surfaceTension, f.minDiameterMm, f.maxDiameterMm, f.referenceRadius, f.riseSpeed, f.timeScale, f.damping].every(Number.isFinite)) return null
      if (f.density < 500 || f.density > 2000 || f.surfaceTension < 0.01 || f.surfaceTension > 0.2 || f.minDiameterMm < 0.1 || f.maxDiameterMm < f.minDiameterMm || f.maxDiameterMm > 5 || f.referenceRadius < 6 || f.referenceRadius > 32 || f.riseSpeed <= 0 || f.riseSpeed > 0.4 || f.timeScale <= 0 || f.timeScale > 0.02 || f.damping < 0.2 || f.damping > 2) return null
    }
  }
  if (p.bubbleField) {
    const field = p.bubbleField
    if (field.swaySpeed !== undefined && (!Number.isFinite(field.swaySpeed) || field.swaySpeed < 0.2 || field.swaySpeed > 3)) return null
    if (field.mode !== 'enhanced' || !Number.isInteger(field.seed) || field.seed < 0 || field.seed > 0xffffffff || !Number.isInteger(field.count) || field.count < 1 || field.count > 40) return null
    if (![field.minRadius, field.maxRadius, field.minSpeed, field.maxSpeed, field.startSpread, field.drift].every(Number.isFinite)) return null
    if (field.minRadius < 1 || field.maxRadius < field.minRadius || field.maxRadius > 12 || field.minSpeed < 0.01 || field.maxSpeed < field.minSpeed || field.maxSpeed > 0.1 || field.startSpread < 0 || field.startSpread > 15 || field.drift < 0 || field.drift > 0.025) return null
  }
  if (p.surfaceLight) {
    const light = p.surfaceLight
    if (light.mode !== 'enhanced' || !Number.isInteger(light.count) || light.count < 1 || light.count > 16 || ![light.depth, light.opacity, light.speed, light.sway].every(Number.isFinite)) return null
    if (light.depth <= 0 || light.depth > 0.4 || light.opacity < 0 || light.opacity > (light.style === 'refracted-caustics' ? 0.35 : 0.2) || light.speed < 0 || light.speed > 1 || light.sway < 0 || light.sway > 0.05 || typeof light.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(light.color)) return null
    if (light.style !== undefined && light.style !== 'refracted-caustics') return null
    if (light.refraction !== undefined && (!Number.isFinite(light.refraction) || light.refraction <= 0 || light.refraction > 2)) return null
    if (light.sharpness !== undefined && (!Number.isFinite(light.sharpness) || light.sharpness < 1 || light.sharpness > 3)) return null
    if (light.scrollFadeEnd !== undefined && (!Number.isFinite(light.scrollFadeEnd) || light.scrollFadeEnd <= 0 || light.scrollFadeEnd > 1)) return null
  }
  if (p.nightPalette) {
    const night = p.nightPalette
    const color = (value: unknown, alpha = false): boolean => typeof value === 'string' && (alpha ? /^#[0-9a-f]{6}([0-9a-f]{2})?$/i : /^#[0-9a-f]{6}$/i).test(value)
    if (night.mode !== 'enhanced' || !night.water || !night.figure) return null
    // Matching offsets let colors crossfade without moving the depth bands.
    if (!Array.isArray(night.water.stops) || night.water.stops.length !== p.water.stops.length || !night.water.stops.every((stop, i) => Array.isArray(stop) && stop.length === 2 && stop[0] === p.water.stops[i][0] && color(stop[1]))) return null
    if (!color(night.water.scrollTint) || !color(night.figure.ink) || !color(night.figure.tint, true)) return null
    if (night.water.surface && (!p.water.surface || !color(night.water.surface.color) || !color(night.water.surface.glow))) return null
    if (night.figure.surfaceTint !== undefined && (!p.figure.surfaceTint || !color(night.figure.surfaceTint))) return null
    if (night.figure.colorOpacity !== undefined && (!Number.isFinite(night.figure.colorOpacity) || night.figure.colorOpacity < 0 || night.figure.colorOpacity > 1)) return null
    if (night.bubblePaint && (!p.bubblePaint || !color(night.bubblePaint.outlineColor))) return null
    if (night.bubbleLight && (!p.bubbleLight || !color(night.bubbleLight.color) || !color(night.bubbleLight.shadowColor))) return null
    if (night.surfaceLight && (!p.surfaceLight || !color(night.surfaceLight.color))) return null
    if (night.ui && (!p.ui || !color(night.ui.hoverColor) || !color(night.ui.selectedColor))) return null
    if (night.splash && (!validSplashTone(night.splash.tone) || !color(night.splash.particleColor))) return null
  }
  return p
}

/** Palette and portrait visibility: the DWP clock and Complete mode select it.
 * Missing extensions preserve older packages. Never mutate the source profile.
 */
export function mixTabScenePalette(profile: TabScene, nightAlpha: number, mode?: string): TabScene {
  const night = profile.nightPalette
  const amount = Number.isFinite(nightAlpha) ? Math.max(0, Math.min(1, nightAlpha)) : 0
  if (!night || mode !== night.mode || amount === 0) return profile
  const mix = (day: string, target: string): string => {
    if (amount === 1) return target
    const alpha = day.length === 9 || target.length === 9
    const full = (color: string): string => color.length === 7 ? color + 'ff' : color
    return '#' + [0, 2, 4, ...(alpha ? [6] : [])].map(i => {
      const a = parseInt(full(day).slice(i + 1, i + 3), 16), b = parseInt(full(target).slice(i + 1, i + 3), 16)
      return Math.round(a + (b - a) * amount).toString(16).padStart(2, '0')
    }).join('')
  }
  const ink = mix(profile.figure.ink, night.figure.ink)
  const tone = profile.splash.tone ?? { sepia: 0, saturation: 1, hueRotate: 0, brightness: 1 }
  const mixTone = (key: keyof SplashTone): number => tone[key] + ((night.splash?.tone[key] ?? tone[key]) - tone[key]) * amount
  return {
    ...profile,
    splash: night.splash ? { ...profile.splash, tone: { sepia: mixTone('sepia'), saturation: mixTone('saturation'), hueRotate: mixTone('hueRotate'), brightness: mixTone('brightness') }, particleColor: mix(profile.splash.particleColor ?? '#89ecff', night.splash.particleColor) } : profile.splash,
    water: { ...profile.water, stops: profile.water.stops.map(([offset, color], i) => [offset, mix(color, night.water.stops[i][1])]), scrollTint: mix(profile.water.scrollTint, night.water.scrollTint),
      surface: profile.water.surface && night.water.surface ? { ...profile.water.surface, color: mix(profile.water.surface.color, night.water.surface.color), glow: mix(profile.water.surface.glow, night.water.surface.glow) } : profile.water.surface },
    figure: { ...profile.figure, ink, tint: mix(profile.figure.tint, night.figure.tint), colorOpacity: profile.figure.colorOpacity + ((night.figure.colorOpacity ?? profile.figure.colorOpacity) - profile.figure.colorOpacity) * amount,
      surfaceTint: profile.figure.surfaceTint && night.figure.surfaceTint ? { ...profile.figure.surfaceTint, color: mix(profile.figure.surfaceTint.color, night.figure.surfaceTint) } : profile.figure.surfaceTint },
    bottomDots: profile.bottomDots ? { ...profile.bottomDots, completeColor: ink } : undefined,
    bubblePaint: profile.bubblePaint && night.bubblePaint ? { ...profile.bubblePaint, outlineColor: mix(profile.bubblePaint.outlineColor, night.bubblePaint.outlineColor) } : profile.bubblePaint,
    bubbleLight: profile.bubbleLight && night.bubbleLight ? { ...profile.bubbleLight, color: mix(profile.bubbleLight.color, night.bubbleLight.color), shadowColor: mix(profile.bubbleLight.shadowColor ?? profile.figure.ink, night.bubbleLight.shadowColor) } : profile.bubbleLight,
    surfaceLight: profile.surfaceLight && night.surfaceLight ? { ...profile.surfaceLight, color: mix(profile.surfaceLight.color, night.surfaceLight.color) } : profile.surfaceLight,
    ui: profile.ui && night.ui ? { ...profile.ui, hoverColor: mix(profile.ui.hoverColor ?? '#2563eb', night.ui.hoverColor), selectedColor: mix(profile.ui.selectedColor ?? '#2563eb', night.ui.selectedColor) } : profile.ui,
  }
}
