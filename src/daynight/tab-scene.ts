/** Declarative DWP extension. Contains no executable package code. */
export interface TabScene {
  format: 'dsh/tab-scene/1'
  portrait: string
  foam: string[]
  splash: { fps: number; start: number; exposures: number[]; fadeStart: number; fadeDuration: number }
  entry: { start: number; duration: number; fadeDuration: number; distance: number; easing?: 'cubic-out' }
  figure: { x: number; y: number; height: number; maxWidthHeight: number; ink: string; opacity: number; colorOpacity: number; tint: string; bob: number; rotation: number; surfaceTint?: { color: string; maxAlpha: number; depth: number } }
  depth: { range: number; scrollRange: number; stops: [number, string][] }
  water: { revealStart: number; revealDuration: number; clipFigure?: boolean; stops: [number, string][]; scrollOffset: number; scrollTint: string; scrollDarkness: number; surface?: { count: number; clusters: [number, number][]; depth: number; opacity: number; speed: number; color: string; glow: string } }
  scroll: { figureOffset: number; bubbleOffset: number; smoothing: number; wheelScale: number }
  exit: { duration: number; middleLift: number; lift: number; middleClip: number; middleOpacity: number }
  focus: { mode: 'enhanced'; minBlur: number; maxBlur: number; duration: number; scale: number }
  ui?: { pageAlpha: number; layerAlpha: number; sliderInfluence: number; darkCardAlpha: number; lightCardAlpha: number; darkSidebarAlpha: number; lightSidebarAlpha: number; cardBlur: number }
  entryCurve?: { width: number; spread: number; shoulderDelay?: number; spreadStart?: number; tipPower?: number; centerOffset?: number; depthScale?: number }
  bottomDots?: { scrollStart: number; depth: number; spacing: number; minRadius: number; maxRadius: number; opacity: number; color: string }
  bubbleLight?: { mode?: 'enhanced'; radius: number; detailOpacity: number; glowOpacity: number; color: string }
  surfaceLight?: { mode: 'enhanced'; style?: 'refracted-caustics'; count: number; depth: number; opacity: number; speed: number; sway: number; color: string; refraction?: number; sharpness?: number; scrollFadeEnd?: number }
}

export const DAYNIGHT_TAB_SCENE: TabScene = {
  format: 'dsh/tab-scene/1',
  entryCurve: { width: 0.25, spread: 0.8, shoulderDelay: 0.35, spreadStart: 0.5, tipPower: 3, centerOffset: -0.06, depthScale: 0.65 },
  bottomDots: { scrollStart: 0.82, depth: 0.24, spacing: 22, minRadius: 0.7, maxRadius: 3.2, opacity: 0.36, color: '#94caff' },
  bubbleLight: { mode: 'enhanced', radius: 0.065, detailOpacity: 0.3, glowOpacity: 0.065, color: '#93eaff' },
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
  ui: { pageAlpha: 0.035, layerAlpha: 0.045, sliderInfluence: 0.12, darkCardAlpha: 0.62, lightCardAlpha: 0.76, darkSidebarAlpha: 0.16, lightSidebarAlpha: 0.12, cardBlur: 12 },
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
    if (![dots.scrollStart, dots.depth, dots.spacing, dots.minRadius, dots.maxRadius, dots.opacity].every(Number.isFinite)) return null
    if (dots.scrollStart < 0 || dots.scrollStart >= 1 || dots.depth <= 0 || dots.depth > 0.5 || dots.spacing < 12 || dots.spacing > 100 || dots.minRadius < 0 || dots.maxRadius <= dots.minRadius || dots.maxRadius > dots.spacing / 3 || dots.opacity < 0 || dots.opacity > 1 || !/^#[0-9a-f]{6}$/i.test(dots.color)) return null
  }
  if (p.bubbleLight) {
    const light = p.bubbleLight
    if (light.mode !== undefined && light.mode !== 'enhanced') return null
    if (![light.radius, light.detailOpacity, light.glowOpacity].every(Number.isFinite) || light.radius <= 0 || light.radius > 0.2 || light.detailOpacity < 0 || light.detailOpacity > 1 || light.glowOpacity < 0 || light.glowOpacity > 1 || typeof light.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(light.color)) return null
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
  return p
}
