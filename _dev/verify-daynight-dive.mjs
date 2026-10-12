// Run after preview-daynight-dive.mjs. Point PLAYWRIGHT_MODULE to playwright's index.mjs.
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { readZipMap } from '../src/market/unzip.ts'
import { DAYNIGHT_ID, DAYNIGHT_VERSION } from '../src/daynight/pack.ts'
const packageFiles = readZipMap(new Uint8Array(readFileSync(resolve('_dist/daynight', DAYNIGHT_ID + '-' + DAYNIGHT_VERSION + '.dwp'))))
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright')
const browser = await chromium.launch({ headless: true, channel: 'msedge' })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.addInitScript(() => {
    // Keep legacy blue-palette checks deterministic at any real local time.
    const NativeDate = window.Date
    window.Date = class extends NativeDate {
      constructor(...args) { if (args.length) super(...args); else super(2026, 9, 12, 12, 0, 0) }
    }
    const draw = CanvasRenderingContext2D.prototype.drawImage
    const clear = CanvasRenderingContext2D.prototype.clearRect
    const arc = CanvasRenderingContext2D.prototype.arc
    const stroke = CanvasRenderingContext2D.prototype.stroke
    const radial = CanvasRenderingContext2D.prototype.createRadialGradient
    window.glowBakes = 0; window.runtimeBubbleBlurs = 0; window.causticCaches = new Set()
    const filter = Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, 'filter')
    Object.defineProperty(CanvasRenderingContext2D.prototype, 'filter', {
      ...filter, set(value) {
        if (value.startsWith('blur(') && this.canvas.width !== 128) window.runtimeBubbleBlurs++
        filter.set.call(this, value)
      },
    })
    CanvasRenderingContext2D.prototype.createRadialGradient = function (...args) {
      if (this.canvas.dataset.daynightDive) window.sceneRadials++
      else if (this.canvas.width === 1440 && this.canvas.height === 900) window.portraitLightRadials++
      else if (this.canvas.width === 128 && this.canvas.height === 128) window.glowBakes++
      return radial.apply(this, args)
    }
    const savedClips = new WeakMap(), activeClips = new WeakMap()
    for (const name of ['save', 'restore', 'clip']) {
      const original = CanvasRenderingContext2D.prototype[name]
      CanvasRenderingContext2D.prototype[name] = function (...args) {
        if (this.canvas.dataset.daynightDive) {
          const stack = savedClips.get(this) ?? []
          savedClips.set(this, stack)
          if (name === 'save') stack.push(activeClips.get(this) === true)
          if (name === 'restore') activeClips.set(this, stack.pop() === true)
          if (name === 'clip') activeClips.set(this, true)
        }
        return original.apply(this, args)
      }
    }
    CanvasRenderingContext2D.prototype.clearRect = function (...args) {
      if (this.canvas.dataset.daynightDive) {
        window.diveStart ??= performance.now()
        window.diveFrameTime = performance.now()
        window.bottomDots = []
        window.sceneRadials = 0; window.portraitLightRadials = 0; window.bubbleOutlines = 0; window.causticDraws = 0
        window.bubbleGlowDraws = []
        window.causticPlacement = null
      }
      return clear.apply(this, args)
    }
    window.entryDraws = []
    window.foamDraws = []
    CanvasRenderingContext2D.prototype.arc = function (...args) {
      if (this.canvas.dataset.daynightDive && ['#94caff', '#031633'].includes(this.fillStyle)) window.bottomDots.push({ x: args[0], y: args[1], radius: args[2], alpha: this.globalAlpha, color: this.fillStyle })
      return arc.apply(this, args)
    }
    CanvasRenderingContext2D.prototype.stroke = function (...args) {
      if (this.canvas.dataset.daynightDive && Math.abs(this.lineWidth - 1.3) < 0.01) window.bubbleOutlines++
      return stroke.apply(this, args)
    }
    CanvasRenderingContext2D.prototype.drawImage = function (...args) {
      const image = args[0]
      if (this.canvas.dataset.daynightDive && image instanceof HTMLCanvasElement && image.width === 128 && image.height === 128) {
        window.bubbleGlowDraws.push({ centerY: args[2] + args[4] / 2 + args[3] / 2.7 / 2 * 0.48, alpha: this.globalAlpha })
      }
      if (this.canvas.dataset.daynightDive && image instanceof HTMLCanvasElement && image.width === 320 && image.height === 96) {
        window.causticCaches.add(image)
        window.causticDraws++
        window.causticPlacement = { y: this.getTransform().f + args[2], alpha: this.globalAlpha }
      }
      if (this.canvas.dataset.daynightDive && image instanceof HTMLCanvasElement && image.height === this.canvas.height && image.width === this.canvas.width) window.portraitColorLayer = image
      if (this.canvas.dataset.daynightDive && image instanceof HTMLCanvasElement && image.height === this.canvas.height && image.width === this.canvas.width) window.portraitColorAlpha = this.globalAlpha
      if (this.canvas.dataset.daynightDive && image instanceof HTMLCanvasElement && image.height > this.canvas.height) {
        window.silhouetteLayer = image
        window.entryDraws.push({ y: this.getTransform().f, alpha: this.globalAlpha, time: window.diveFrameTime, clipped: activeClips.get(this) === true })
        if (window.entryDraws.length > 500) window.entryDraws.shift()
      }
      if (this.canvas.dataset.daynightDive && image instanceof HTMLImageElement) {
        window.foamDraws.push({ time: performance.now(), x: args[5], y: args[6], width: args[7], height: args[8] })
      }
      return draw.apply(this, args)
    }
  })
  await page.route('http://127.0.0.1:4318/**', route => {
    const url = new URL(route.request().url())
    if (url.pathname.startsWith('/we-sync/dwp/')) {
      const name = url.pathname.endsWith('/scene') ? 'scene.json' : url.pathname.endsWith('/manifest') ? 'wallpaper.json' : url.searchParams.get('name')
      const data = packageFiles.get(name)
      return route.fulfill({ status: data ? 200 : 404, contentType: name?.endsWith('.json') ? 'application/json' : 'image/png', body: data ? Buffer.from(data) : '' })
    }
    const script = ['daynight-dive.js', 'daynight-sidebar.js'].find(name => route.request().url().endsWith('/' + name))
    return route.fulfill({ contentType: script ? 'text/javascript' : 'text/html', body: readFileSync(resolve('_dist/dive-preview', script ?? 'index.html')) })
  })
  await page.goto('http://127.0.0.1:4318')
  // Let entry reach its first figure frame before synchronous caustic-analysis
  // work occupies the page thread; that analysis must not inflate entry timing.
  await page.waitForFunction(() => window.entryDraws.length > 0)
  const front = await page.evaluate(async () => {
    const { entryWaterEdge } = await import('/daynight-dive.js')
    const p = (await (await fetch('/we-sync/dwp/scene?id=yrn.deepseek-day-night')).json()).dsh.tabScene
    const center = p.figure.x + (p.entryCurve.centerOffset ?? 0)
    return {
      center, figureX: p.figure.x,
      middle: [center - 0.2, center, center + 0.2].map(x => entryWaterEdge(x, 0.5, center, p.entryCurve)),
      start: [0, center, 1].map(x => entryWaterEdge(x, 0, center, p.entryCurve)),
      end: [0, center, 1].map(x => entryWaterEdge(x, 1, center, p.entryCurve)),
      samples: [0, 0.4, center, 1].map(x => [0, 0.25, 0.5, 0.75, 1].map(r => entryWaterEdge(x, r, center, p.entryCurve)))
    }
  })
  assert.ok(front.middle[1] > front.middle[0] && front.middle[1] > front.middle[2], 'water front is deepest at the figure')
  assert.ok(front.center < front.figureX, 'entry trough is shifted left toward the space beside the hand')
  assert.ok(front.middle[1] - front.middle[0] > 0.18 && front.middle[1] - front.middle[0] < 0.3, 'entry curve is visible but broad and shallow')
  assert.ok(Math.abs(front.middle[0] - front.middle[2]) < 1e-8, 'U curve is symmetric about the figure')
  assert.deepEqual(front.start, [0, 0, 0]); assert.deepEqual(front.end, [1, 1, 1])
  assert.ok(front.samples.every(row => row.every((y, i) => i === 0 || y >= row[i - 1])), 'front expands continuously without retracting')
  const surfaceLight = await page.evaluate(async () => {
    const { drawSurfaceLight } = await import('/daynight-dive.js')
    const p = (await (await fetch('/we-sync/dwp/scene?id=yrn.deepseek-day-night')).json()).dsh.tabScene
    const c = document.createElement('canvas'); c.width = 640; c.height = 400
    const ctx = c.getContext('2d')
    drawSurfaceLight(ctx, c.width, c.height, 0, p.surfaceLight)
    const first = ctx.getImageData(0, 0, c.width, c.height).data
    ctx.clearRect(0, 0, c.width, c.height)
    drawSurfaceLight(ctx, c.width, c.height, 3, p.surfaceLight)
    const second = ctx.getImageData(0, 0, c.width, c.height).data
    let changed = 0, maxAlpha = 0, below = 0, sum = 0
    for (let i = 3; i < first.length; i += 4) {
      if (first[i] !== second[i]) changed++
      maxAlpha = Math.max(maxAlpha, first[i], second[i]); sum += second[i]
      if (Math.floor(i / 4 / c.width) >= c.height * p.surfaceLight.depth && second[i] !== 0) below++
    }
    return { changed, maxAlpha, below, average: sum / (c.width * c.height) }
  })
  assert.ok(surfaceLight.changed > 1000, 'surface light slowly moves and changes shape')
  assert.ok(surfaceLight.maxAlpha > 20 && surfaceLight.maxAlpha <= 85 && surfaceLight.average < 4, 'bright caustic folds remain visible without a page-wide wash')
  assert.equal(surfaceLight.below, 0, 'surface lighting stays confined to the top')
  await page.waitForFunction(() => {
    const c = document.querySelector('[data-daynight-dive]')
    return c?.width > 0 && c.getContext('2d').getImageData(10, 10, 1, 1).data[3] === 255
  })
  await page.waitForTimeout(450)
  await page.screenshot({ path: resolve('_dist/dive-preview/entry-early.png') })
  await page.waitForTimeout(400)
  await page.screenshot({ path: resolve('_dist/dive-preview/entry-late.png') })
  const entry = await page.evaluate(() => window.entryDraws)
  const foam = await page.evaluate(() => window.foamDraws)
  const entryTime = entry[0].time - await page.evaluate(() => window.diveStart)
  // Measure from the animation clock: drawing the first large foam texture
  // can delay its drawImage call during browser startup.
  assert.ok(entryTime >= 25 && entryTime < 200, `figure enters on the first splash frame (${entryTime.toFixed(1)}ms observed)`)
  assert.ok(entry.every(frame => frame.clipped), 'the entering silhouette stays inside the water front')
  for (const frame of foam) {
    assert.ok(frame.x <= 1 && frame.x + frame.width >= 1439 && frame.y <= 1 && frame.y + frame.height >= 899, 'foam crop edges stay outside the viewport')
    assert.ok(Math.abs(frame.x + frame.width / 2 - 720) < 1, 'foam stays centered')
  }
  assert.ok(entry.at(-1).y > entry[0].y + 100, 'figure descends toward its destination')
  assert.ok(entry.at(-1).alpha > entry[0].alpha + 0.2, 'entry retains its fade-in')
  const motionProgress = await page.evaluate(async () => {
    const { entryProgress } = await import('/daynight-dive.js')
    const p = (await (await fetch('/we-sync/dwp/scene?id=yrn.deepseek-day-night')).json()).dsh.tabScene
    return [0, 0.25, 0.5, 0.75, 1].map(fraction => entryProgress(p.entry.start + fraction * p.entry.duration, p.entry))
  })
  assert.equal(motionProgress[0], 0)
  assert.equal(motionProgress[4], 1)
  const travel = motionProgress.slice(1).map((position, i) => position - motionProgress[i])
  assert.ok(travel.every((distance, i) => i === 0 || distance < travel[i - 1]), 'equal time intervals travel progressively less distance under water resistance')
  await page.waitForTimeout(1550)
  assert.equal(await page.locator('[data-daynight-dive]').count(), 1)
  await page.screenshot({ path: resolve('_dist/dive-preview/underwater.png') })
  const themeState = () => page.evaluate(() => {
    const body = getComputedStyle(document.body)
    return { page: body.getPropertyValue('--dsw-alias-bg-base').trim(), sidebar: body.getPropertyValue('--dsw-specific-sidebar-fill').trim(), card: getComputedStyle(document.querySelector('.panel')).backgroundColor }
  })
  await page.evaluate(() => {
    document.querySelector('.panel').classList.add('wesync-card')
    document.body.setAttribute('data-ds-dark-theme', '')
    const wash = document.createElement('div'); wash.id = 'theme-wash'
    wash.style.cssText = 'position:fixed;inset:0;z-index:-1;pointer-events:none;background:var(--dsw-alias-bg-base)'
    document.body.appendChild(wash)
  })
  await page.waitForTimeout(500)
  assert.deepEqual(await themeState(), { page: 'rgba(15,16,20,0.035)', sidebar: 'rgba(3,22,51,0.160)', card: 'rgba(24, 26, 32, 0.62)' })
  await page.screenshot({ path: resolve('_dist/dive-preview/theme-dark.png') })
  await page.evaluate(() => { document.body.removeAttribute('data-ds-dark-theme'); document.body.style.color = '#193052' })
  await page.waitForTimeout(500)
  assert.deepEqual(await themeState(), { page: 'rgba(246,247,250,0.035)', sidebar: 'rgba(3,22,51,0.120)', card: 'rgba(255, 255, 255, 0.76)' })
  await page.screenshot({ path: resolve('_dist/dive-preview/theme-light.png') })
  await page.evaluate(() => { document.querySelector('#theme-wash').remove(); document.body.style.removeProperty('color') })
  await page.evaluate(async () => {
    const { dayNightVisualCss } = await import('/daynight-dive.js')
    const style = document.createElement('style'); style.id = 'visual-test'
    style.textContent = dayNightVisualCss(18, 1.045); document.head.appendChild(style)
  })
  const visualCanvas = page.locator('[data-daynight-dive]')
  assert.equal(await visualCanvas.evaluate(c => getComputedStyle(c).filter), 'blur(18px)', 'manual blur applies to the dive background')
  assert.equal(await visualCanvas.evaluate(c => getComputedStyle(c).zIndex), '-2', 'dive background stays below the focus lens and dimming layer')
  await page.screenshot({ path: resolve('_dist/dive-preview/blurred.png') })
  await page.evaluate(async () => {
    const { dayNightVisualCss } = await import('/daynight-dive.js')
    document.querySelector('#visual-test').textContent = dayNightVisualCss(0, 1)
    const lens = document.createElement('div'); lens.id = 'test-focus-lens'
    lens.dataset.wesyncFocusLens = '1'
    lens.style.cssText = 'position:fixed;inset:0;z-index:-1;pointer-events:none;backdrop-filter:blur(15px);mask-image:radial-gradient(circle 180px at 80% 25%,transparent 50%,black 100%)'
    document.body.appendChild(lens)
  })
  assert.equal(await visualCanvas.evaluate(c => getComputedStyle(c).filter), 'none', 'focus lens controls blur while the underlying scene stays clear')
  await page.screenshot({ path: resolve('_dist/dive-preview/focus.png') })
  const breathing = await page.evaluate(async () => {
    const { dayNightVisualCss } = await import('/daynight-dive.js')
    const profile = (await (await fetch('/we-sync/dwp/scene?id=yrn.deepseek-day-night')).json()).dsh.tabScene
    document.querySelector('#visual-test').textContent = dayNightVisualCss(0, 1, profile.focus)
    const c = document.querySelector('[data-daynight-dive]')
    const animation = c.getAnimations().find(a => a.animationName === 'wesync-dive-breathe')
    animation.pause()
    animation.currentTime = 0; const low = getComputedStyle(c).filter
    animation.currentTime = 2500; const high = getComputedStyle(c).filter
    animation.currentTime = 5000; const returned = getComputedStyle(c).filter
    return { low, high, returned, lens: getComputedStyle(document.querySelector('#test-focus-lens')).display }
  })
  assert.deepEqual(breathing, { low: 'blur(1px)', high: 'blur(4px)', returned: 'blur(1px)', lens: 'none' }, 'breathing replaces focus lens only inside the dive page')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  assert.equal(await visualCanvas.evaluate(c => getComputedStyle(c).filter), 'blur(2.5px)')
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.evaluate(() => { document.querySelector('#visual-test').remove(); document.querySelector('#test-focus-lens').remove() })
  // Track placement independently of the expanding depth-color mask.
  const silhouetteY = () => page.evaluate(() => window.entryDraws.at(-1).y)
  const initialY = await silhouetteY()
  const backgroundBrightness = () => page.evaluate(() => {
    const c = document.querySelector('[data-daynight-dive]')
    const data = c.getContext('2d').getImageData(20, Math.floor(c.height * 0.6), 80, 80).data
    let sum = 0
    for (let i = 0; i < data.length; i += 4) sum += data[i] + data[i + 1] + data[i + 2]
    return sum / (data.length / 4)
  })
  const initialBrightness = await backgroundBrightness()
  assert.equal(await page.evaluate(() => window.bottomDots.length), 0, 'bottom dot grid stays hidden at the top')
  assert.ok(Number.isFinite(initialY), 'upper-body silhouette is visible')
  const topCaustic = await page.evaluate(() => window.causticPlacement)
  const inlineTheme = await page.evaluate(() => {
    document.body.style.setProperty('--dsw-alias-bg-base', '#ffffff')
    const value = getComputedStyle(document.body).getPropertyValue('--dsw-alias-bg-base')
    document.body.style.removeProperty('--dsw-alias-bg-base')
    return value
  })
  assert.ok(inlineTheme.includes('0.035'), 'tab palette overrides host inline theme tokens while active')
  assert.ok(topCaustic?.alpha > 0.2 && topCaustic.y === 0, 'surface caustics are visible at the top')
  await page.mouse.move(1100, 500)
  await page.mouse.wheel(0, 900)
  await page.waitForTimeout(700)
  const midCaustic = await page.evaluate(() => window.causticPlacement)
  assert.ok(midCaustic?.alpha > 0 && midCaustic.alpha < topCaustic.alpha * 0.7, 'surface caustics fade while diving: ' + JSON.stringify({ topCaustic, midCaustic }))
  assert.equal(midCaustic.y, 0, 'surface caustics remain anchored instead of moving with the background')
  await page.mouse.wheel(0, 3000)
  await page.waitForTimeout(700)
  const scrolledY = await silhouetteY()
  assert.ok(await backgroundBrightness() < initialBrightness - 20, 'water background darkens as scrolling reaches the bottom')
  assert.ok(scrolledY > initialY + 15, 'scroll down moves the close-up downward')
  assert.equal(await page.evaluate(() => window.causticDraws), 0, 'surface caustics disappear at depth')
  const depthLighting = await page.evaluate(() => ({ lights: window.sceneRadials, bubbles: window.bubbleOutlines }))
  assert.ok(depthLighting.bubbles > 0 && depthLighting.bubbles <= 24, 'twelve bounded bubbles use at most two outline passes')
  assert.equal(depthLighting.lights, 0, 'bubble haze reuses a sprite instead of per-frame scene gradients')
  const cachedLights = await page.evaluate(() => ({ bakes: window.glowBakes, blurs: window.runtimeBubbleBlurs, draws: window.bubbleGlowDraws }))
  assert.ok(cachedLights.draws.length > 0 && cachedLights.draws.length <= 12)
  assert.ok(cachedLights.draws.every(b => b.centerY < 450 && b.alpha > 0), 'only bubbles above the screen midpoint receive haze')
  await page.waitForTimeout(200)
  assert.equal(await page.evaluate(() => window.glowBakes), cachedLights.bakes, 'the haze texture is not regenerated between frames')
  assert.equal(cachedLights.blurs, 0, 'runtime bubble rendering uses no blur filters')
  const bottomDots = await page.evaluate(() => window.bottomDots)
  assert.ok(bottomDots.length > 300, 'regular dot rows and columns appear at the scroll bottom')
  assert.ok(bottomDots.every(d => d.color === '#031633'), 'Complete-mode dot grid uses the portrait silhouette ink')
  assert.ok(bottomDots.every(d => d.y >= 900 * 0.76), 'dots are confined to the bottom portion of the screen')
  assert.ok(bottomDots[0].radius > bottomDots.at(-1).radius && bottomDots[0].alpha > bottomDots.at(-1).alpha, 'dots grow and strengthen toward the bottom')
  await page.screenshot({ path: resolve('_dist/dive-preview/scrolled.png') })
  await page.mouse.wheel(0, -3000)
  await page.waitForTimeout(700)
  assert.ok(await silhouetteY() < scrolledY - 15, 'scroll up moves the close-up back')
  assert.ok(await backgroundBrightness() > initialBrightness - 10, 'water brightens again when scrolling back to the top')
  assert.equal(await page.evaluate(() => window.bottomDots.length), 0, 'dot grid fades out when scrolling away from the bottom')
  const returnedCaustic = await page.evaluate(() => window.causticPlacement)
  assert.ok(returnedCaustic?.alpha > 0.2 && returnedCaustic.y === 0, 'surface light returns when scrolling to the surface')
  await page.click('#leave')
  assert.equal(await page.locator('[data-daynight-dive]').count(), 1, 'outgoing background remains for the exit animation')
  await page.waitForTimeout(150)
  assert.ok(await page.locator('[data-daynight-dive]').evaluate(c => Number(getComputedStyle(c).opacity) < 1), 'exit fades the background')
  await page.screenshot({ path: resolve('_dist/dive-preview/exit.png') })
  await page.locator('[data-daynight-dive]').waitFor({ state: 'detached' })
  assert.equal(await page.locator('[data-daynight-dive]').count(), 0)
  assert.equal((await themeState()).page, '', 'page theme override is removed after exit')
  await page.click('#enter')
  await page.waitForTimeout(250)
  await page.screenshot({ path: resolve('_dist/dive-preview/splash.png') })
  const exposures = await page.evaluate(async () => {
    const { splashAt } = await import('/daynight-dive.js')
    const profile = (await (await fetch('/we-sync/dwp/scene?id=yrn.deepseek-day-night')).json()).dsh.tabScene
    return { before: splashAt(0, profile), after: splashAt(0.8, profile), cells: Array.from({ length: 18 }, (_, i) => splashAt((i + 1.5) / 24, profile)?.frame) }
  })
  assert.equal(exposures.before, null)
  assert.equal(exposures.after, null)
  assert.deepEqual(exposures.cells, [0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9])
  await page.waitForTimeout(1000)
  const waterSample = () => page.evaluate(() => {
    const c = document.querySelector('[data-daynight-dive]')
    const data = c.getContext('2d').getImageData(0, 0, c.width, Math.floor(c.height * 0.2)).data
    let hash = 2166136261
    for (let i = 0; i < data.length; i += 16) hash = Math.imul(hash ^ data[i], 16777619)
    return hash
  })
  const waterBefore = await waterSample()
  await page.waitForTimeout(150)
  assert.notDeepEqual(await waterSample(), waterBefore, 'surface reflections must move after the splash')
  // Repeated tab entries must never leave duplicate canvases or stale decodes.
  for (let i = 0; i < 4; i++) {
    await page.evaluate(() => { window.previousCanvas = document.querySelector('[data-daynight-dive]') })
    await page.click('#leave'); await page.click('#enter')
  }
  await page.locator('[data-daynight-dive]').waitFor({ state: 'attached' })
  await page.waitForFunction(() => {
    const c = document.querySelector('[data-daynight-dive]')
    return c && c !== window.previousCanvas && c.width === window.innerWidth * Math.min(devicePixelRatio || 1, 2)
  })
  assert.equal(await page.locator('[data-daynight-dive]').count(), 1)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.waitForTimeout(200)
  const sample = () => page.evaluate(() => document.querySelector('[data-daynight-dive]').toDataURL())
  const still = await sample()
  await page.evaluate(() => { const c = document.querySelector('[data-daynight-dive]'); window.reducedPixels = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; window.reducedCount = window.entryDraws.length })
  await page.waitForTimeout(200)
  const secondStill = await sample()
  if (secondStill !== still) console.log('Reduced-motion pixel differences:', await page.evaluate(() => {
    const c = document.querySelector('[data-daynight-dive]'), data = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
    let changed = 0, peak = 0
    for (let i = 0; i < data.length; i++) { const delta = Math.abs(data[i] - window.reducedPixels[i]); if (delta) changed++; peak = Math.max(peak, delta) }
    return { changed, peak, draws: window.entryDraws.length - window.reducedCount, motion: matchMedia('(prefers-reduced-motion: reduce)').matches, canvases: document.querySelectorAll('[data-daynight-dive]').length }
  }))
  assert.ok(secondStill === still, 'reduced motion must stay static after assets finish loading')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(100)
  assert.equal(await page.locator('[data-daynight-dive]').evaluate(c => c.width), 390)
  await page.screenshot({ path: resolve('_dist/dive-preview/mobile.png') })
  await page.click('#leave')
  assert.equal(await page.locator('[data-daynight-dive]').count(), 0)
  // Freeze motion so the light-on/off comparison uses identical portrait and
  // bubble coordinates. Inspect the portrait layer, rather than the water glow.
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.evaluate(async () => {
    const { startDayNightDive } = await import('/daynight-dive.js')
    const profile = (await (await fetch('/we-sync/dwp/scene?id=yrn.deepseek-day-night')).json()).dsh.tabScene
    // Place the portrait across a frozen bubble's path so a small physical
    // highlight actually intersects it; broad halos did not need an overlap.
    profile.figure.x = 0.63
    profile.figure.y = 0.38
    // Test portrait lighting and lens geometry independently of spawn timing.
    delete profile.bubbleField
    window.lightTestProfile = profile
    const baseline = structuredClone(profile); baseline.bubbleLens.detailOpacity = 0
    // Keep lens sizes identical for the portrait-light comparison below.
    window.lightTestMode = 'enhanced'
    window.lightTestStop = startDayNightDive({ profile: baseline, visualState: () => ({ focus: false, mode: window.lightTestMode }), assetUrl: name => '/we-sync/dwp/file?id=yrn.deepseek-day-night&name=' + encodeURIComponent(name) })
  })
  await page.waitForFunction(() => document.querySelector('[data-daynight-dive]')?.width === 1440)
  await page.mouse.move(1300, 800)
  await page.evaluate(() => {
    const layer = document.querySelector('[data-daynight-dive]')
    window.unlitPortrait = layer.getContext('2d').getImageData(0, 0, layer.width, layer.height).data
    const scene = document.querySelector('[data-daynight-dive]')
    window.unlitScene = scene.getContext('2d').getImageData(0, 0, scene.width, scene.height).data
    window.lightTestStop()
  })
  await page.evaluate(async () => {
    const { startDayNightDive } = await import('/daynight-dive.js')
    window.lightTestMode = 'enhanced'
    window.lightTestStop = startDayNightDive({ profile: window.lightTestProfile, visualState: () => ({ focus: false, mode: window.lightTestMode }), assetUrl: name => '/we-sync/dwp/file?id=yrn.deepseek-day-night&name=' + encodeURIComponent(name) })
  })
  await page.waitForFunction(() => document.querySelector('[data-daynight-dive]')?.width === 1440)
  const restored = await page.evaluate(() => {
    const layer = document.querySelector('[data-daynight-dive]')
    const lit = layer.getContext('2d').getImageData(0, 0, layer.width, layer.height).data
    const baseline = window.unlitPortrait
    let increased = 0, strongest = 0, outside = 0, far = 0
    for (let y = 450; y < 900; y++) for (let x = 0; x < 1440; x++) {
      const i = (y * 1440 + x) * 4
      const difference = lit[i] + lit[i + 1] + lit[i + 2] - baseline[i] - baseline[i + 1] - baseline[i + 2]
      if (difference > 4) {
        increased++
        const nearBubble = Array.from({ length: 20 }, (_, j) => ({
          x: 1440 * (0.08 + ((j * 0.137) % 0.84)),
          y: 900 * (1.1 - j / 20 * 1.2),
          radius: Math.min(window.lightTestProfile.bubbleLens.maxRadius, (2 + j % 5) * (j % 4 === 1 ? window.lightTestProfile.bubbleLens.radiusScale : 1 + (window.lightTestProfile.bubbleLens.radiusScale - 1) * 0.4)),
        })).some(b => Math.hypot(x - b.x, y - b.y) <= b.radius * 3.5 + 2)
        if (!nearBubble) far++
      }
      strongest = Math.max(strongest, difference)
      if (x < 500 && difference > 4) outside++
    }
    return { increased, strongest, outside, far }
  })
  console.log('Local portrait refraction:', restored)
  await page.screenshot({ path: resolve('_dist/dive-preview/bubble-light.png') })
  assert.ok(restored.increased >= 10 && restored.strongest > 8, 'bubble refraction reveals actual portrait details')
  assert.ok(restored.increased < 3000, 'bubble refraction remains local instead of washing a broad portrait region')
  assert.equal(restored.far, 0, 'portrait detail is revealed only beside bubbles, without a distant halo')
  assert.equal(restored.outside, 0, 'restored portrait details stay inside the character contour')
  await page.screenshot({ path: resolve('_dist/dive-preview/bubble-light.png') })
  assert.equal(await page.evaluate(() => window.portraitLightRadials), 0, 'portrait detail is a shaped window with no surrounding haze')
  assert.equal(await page.evaluate(() => window.sceneRadials), 24, 'only surface reflections use radial lighting')
  assert.equal(await page.evaluate(() => window.causticDraws), 1, 'complete mode enables refracted surface caustics')
  for (const mode of ['eco', 'perf']) {
    await page.evaluate(mode => { window.lightTestMode = mode }, mode)
    await page.waitForTimeout(350)
    const lighting = await page.evaluate(() => ({ detail: window.portraitLightRadials, scene: window.sceneRadials, caustics: window.causticDraws, bubbles: window.bubbleOutlines, surface: window.lightTestProfile.water.surface.count }))
    assert.equal(lighting.detail, 0, `${mode} mode disables local portrait reveal`)
    assert.equal(lighting.scene, lighting.surface, `${mode} mode disables bubble glow`)
    assert.equal(lighting.bubbles, 20, `${mode} mode keeps ordinary bubbles`)
    assert.equal(lighting.caustics, 0, `${mode} mode disables surface caustics`)
  }
  await page.evaluate(() => window.lightTestStop())
  assert.equal(await page.locator('[data-daynight-dive]').count(), 0)
  // A known narrow stripe proves actual enlargement, rather than a bright
  // overlay that only looks like a lens. Freeze motion and remove lighting.
  const stripe = await page.evaluate(async () => {
    const { startDayNightDive } = await import('/daynight-dive.js')
    const profile = structuredClone(window.lightTestProfile)
    const image = document.createElement('canvas'); image.width = 1440; image.height = 900
    const source = image.getContext('2d')
    source.fillStyle = '#202020'; source.fillRect(0, 0, 1440, 900)
    // This stripe is centered inside the ninth frozen bubble after inversion.
    const center = 1440 * (0.08 + ((9 * 0.137) % 0.84))
    source.fillStyle = '#e0e0e0'; source.fillRect(1440 - center - 3, 0, 6, 900)
    const url = image.toDataURL()
    Object.assign(profile.figure, { x: 0.5, y: 0.5, height: 1, maxWidthHeight: 2, opacity: 0, colorOpacity: 1, tint: '#00000000', rotation: 0, bob: 0 })
    delete profile.figure.surfaceTint; delete profile.bubbleLight; delete profile.surfaceLight; delete profile.water.surface
    profile.depth.stops = [[0, '#ffffff'], [1, '#ffffff']]
    profile.bubbleLens.detailOpacity = 0; profile.bubbleLens.distortion = 0
    const render = async (mode, magnification) => {
      profile.bubbleLens.magnification = magnification
      const stop = startDayNightDive({ profile, assetUrl: () => url, visualState: () => ({ focus: false, mode }) })
      const ready = document.querySelector('[data-daynight-dive]')
      while (ready.width !== 1440) await new Promise(resolve => requestAnimationFrame(resolve))
      const canvas = ready.getContext('2d')
      const data = canvas.getImageData(0, 0, 1440, 900).data
      const width = Array.from({ length: 20 }, (_, i) => data[(504 * 1440 + Math.round(center) - 10 + i) * 4]).filter(value => value > 128).length
      const outside = [...canvas.getImageData(650, 502, 5, 5).data]
      stop()
      return { width, outside }
    }
    return { base: await render('enhanced', 1), lens: await render('enhanced', 1.35), preview: await render('eco', 1.35), capture: await render('perf', 1.35) }
  })
  console.log('Bubble lens stripe widths:', Object.fromEntries(Object.entries(stripe).map(([mode, result]) => [mode, result.width])))
  assert.ok(stripe.lens.width >= stripe.base.width * 1.2 && stripe.lens.width <= stripe.base.width * 1.5, 'the image inside a bubble uses the reduced magnification')
  assert.deepEqual(stripe.lens.outside, stripe.base.outside, 'lens sampling leaves pixels outside the bubble untouched')
  assert.equal(stripe.preview.width, stripe.base.width, 'preview mode does not magnify the image')
  assert.equal(stripe.capture.width, stripe.base.width, 'capture mode does not magnify the image')
  // Actual scene pixels prove the flat fill is white at 10%, uniform inside
  // the moving shape, with no brighter cap or glow outside its contour.
  const paint = await page.evaluate(async () => {
    const { startDayNightDive } = await import('/daynight-dive.js')
    const profile = structuredClone(window.lightTestProfile)
    const transparent = document.createElement('canvas').toDataURL()
    profile.figure.opacity = 0; profile.figure.colorOpacity = 0; profile.bubbleLens.detailOpacity = 0
    delete profile.surfaceLight; delete profile.water.surface; delete profile.bottomDots
    profile.water.stops = [[0, '#205080'], [1, '#205080']]
    const render = async (mode, painted) => {
      const variant = structuredClone(profile)
      if (!painted) delete variant.bubblePaint
      const stop = startDayNightDive({ profile: variant, assetUrl: () => transparent, visualState: () => ({ focus: false, mode }) })
      const canvas = document.querySelector('[data-daynight-dive]')
      while (canvas.width !== 1440) await new Promise(resolve => requestAnimationFrame(resolve))
      const ctx = canvas.getContext('2d'), x = Math.round(1440 * (0.08 + ((9 * 0.137) % 0.84))), y = 504
      const points = [[x, y], [x - 3, y - 3], [x + 3, y + 3], [x, y - 5], [x, y + 5], [x + 35, y]]
      const pixels = points.map(([px, py]) => [...ctx.getImageData(px, py, 1, 1).data].slice(0, 3))
      stop(); return pixels
    }
    return { base: await render('enhanced', false), filled: await render('enhanced', true), preview: await render('eco', true), capture: await render('perf', true) }
  })
  for (let i = 0; i < 5; i++) for (let channel = 0; channel < 3; channel++) {
    const expected = paint.base[i][channel] * 0.9 + 255 * 0.1
    assert.ok(Math.abs(paint.filled[i][channel] - expected) <= 2, 'white fill is exactly 10% throughout the bubble interior')
  }
  assert.deepEqual(paint.filled[5], paint.base[5], 'flat paint has no halo outside its contour')
  assert.deepEqual(paint.preview[0], paint.base[0], 'preview mode has no white fill')
  assert.deepEqual(paint.capture[0], paint.base[0], 'capture mode has no white fill')
  console.log('Flat bubble paint:', paint.filled[0], 'over', paint.base[0])
  // Real scene pixels verify the same crossfade removes paint while adding
  // directional shading, with no mode leakage or sudden middle-screen switch.
  const heightFade = await page.evaluate(async () => {
    const { startDayNightDive, bubbleLightProgress } = await import('/daynight-dive.js')
    const profile = structuredClone(window.lightTestProfile)
    const transparent = document.createElement('canvas').toDataURL()
    profile.figure.opacity = 0; profile.figure.colorOpacity = 0; profile.bubbleLens.detailOpacity = 0
    delete profile.surfaceLight; delete profile.water.surface; delete profile.bottomDots
    profile.water.stops = [[0, '#205080'], [1, '#205080']]
    const slots = [9, 12, 17]
    const render = async (mode, lit, painted) => {
      const variant = structuredClone(profile)
      if (!lit) delete variant.bubbleLight
      if (!painted) variant.bubblePaint.opacity = 0
      const stop = startDayNightDive({ profile: variant, assetUrl: () => transparent, visualState: () => ({ focus: false, mode }) })
      const canvas = document.querySelector('[data-daynight-dive]')
      while (canvas.width !== 1440) await new Promise(resolve => requestAnimationFrame(resolve))
      const ctx = canvas.getContext('2d')
      const pixels = slots.map(slot => {
        const x = Math.round(1440 * (0.08 + ((slot * 0.137) % 0.84)))
        const y = Math.round(900 * (1.1 - slot / 20 * 1.2))
        return [...ctx.getImageData(x, y, 1, 1).data].slice(0, 3)
      })
      const slot = 17, x = Math.round(1440 * (0.08 + ((slot * 0.137) % 0.84))), y = 72
      const top = [...ctx.getImageData(x, y - 8, 1, 1).data].slice(0, 3)
      const bottom = [...ctx.getImageData(x, y + 6, 1, 1).data].slice(0, 3)
      stop(); return { pixels, top, bottom }
    }
    return {
      base: await render('enhanced', false, false), flat: await render('enhanced', false, true),
      lit: await render('enhanced', true, true), bare: await render('enhanced', true, false),
      preview: await render('eco', true, true), capture: await render('perf', true, true),
      weights: [0.51, 0.5, 0.499, 0.375, 0.25, 0.1].map(y => bubbleLightProgress(y * 900, 900, profile.bubbleLight)),
    }
  })
  assert.deepEqual(heightFade.lit.pixels[0], heightFade.flat.pixels[0], 'below the midpoint the bubble keeps its flat 10% white fill')
  assert.deepEqual(heightFade.lit.pixels[2], heightFade.bare.pixels[2], 'above the transition the white fill is fully removed')
  assert.ok(heightFade.lit.pixels[1][0] > heightFade.bare.pixels[1][0] && heightFade.lit.pixels[1][0] - heightFade.bare.pixels[1][0] < heightFade.flat.pixels[1][0] - heightFade.base.pixels[1][0], 'the middle band retains only a partial white fill')
  assert.ok(heightFade.lit.top[0] > heightFade.base.top[0] && heightFade.lit.bottom[0] < heightFade.base.bottom[0], 'upper light and lower shadow follow incoming surface light')
  assert.equal(heightFade.weights[0], 0); assert.equal(heightFade.weights[1], 0)
  assert.ok(heightFade.weights[2] > 0 && heightFade.weights[2] < 0.001)
  assert.equal(heightFade.weights[3], 0.5); assert.equal(heightFade.weights[4], 1); assert.equal(heightFade.weights[5], 1)
  assert.deepEqual(heightFade.preview.pixels[1], heightFade.base.pixels[1]); assert.deepEqual(heightFade.capture.pixels[1], heightFade.base.pixels[1])
  console.log('Bubble height crossfade:', heightFade)
  const field = await page.evaluate(async () => {
    const { risingBubbles } = await import('/daynight-dive.js')
    const profile = (await (await fetch('/we-sync/dwp/scene?id=yrn.deepseek-day-night')).json()).dsh.tabScene
    const sample = (time, settings = profile.bubbleField) => risingBubbles(1440, 900, time, 0, 0, false, settings, profile.bubbleShape, profile.bubbleLens)
    return { initial: sample(1), settled: sample(10), repeated: sample(10), next: sample(10.1), later: sample(100), otherSeed: sample(10, { ...profile.bubbleField, seed: profile.bubbleField.seed + 1 }), limit: profile.bubbleField.count }
  })
  assert.deepEqual(field.settled, field.repeated, 'seeded bubbles are reproducible and do not flicker between frames')
  assert.notDeepEqual(field.settled, field.otherSeed, 'different seeds distribute bubbles differently')
  assert.ok(field.initial.length > 0 && field.initial.length < field.limit, 'bubbles appear gradually after entry')
  assert.equal(field.settled.length, field.limit, 'the staggered field reaches its bounded population')
  for (const bubble of field.settled) {
    const next = field.next.find(b => b.slot === bubble.slot)
    assert.ok(next.y < bubble.y && Math.abs(next.x - bubble.x) < 2, 'an existing bubble continues smoothly when other bubbles spawn')
    assert.ok(Math.abs(next.radius - bubble.radius) < 0.0001, 'existing bubble sizes do not jump')
  }
  assert.ok(field.settled.some((b, i) => Math.abs(b.x - field.later[i].x) > 40), 'bubbles choose new lanes on subsequent lifetimes')
  const flow = await page.evaluate(async () => {
    const { traceBubble, risingBubbles, bubbleShapePose } = await import('/daynight-dive.js')
    const p = (await (await fetch('/we-sync/dwp/scene?id=yrn.deepseek-day-night')).json()).dsh.tabScene
    const c = document.createElement('canvas'); c.width = c.height = 120
    const ctx = c.getContext('2d'), frames = []
    for (let t = 0; t <= 3; t += 0.25) {
      ctx.clearRect(0, 0, 120, 120); ctx.beginPath()
      const bubble = { slot: 5, x: 60, y: 60, radius: 30 }
      const pose = bubbleShapePose(bubble, t, p.bubbleShape)
      traceBubble(ctx, bubble, t, p.bubbleShape)
      const lowerFilled = ctx.isPointInPath(60 - Math.sin(pose.angle) * pose.b * 0.9, 60 + Math.cos(pose.angle) * pose.b * 0.9)
      ctx.fill(); const data = ctx.getImageData(0, 0, 120, 120).data
      let area = 0, left = 120, right = 0, top = 120, bottom = 0
      for (let y = 0; y < 120; y++) for (let x = 0; x < 120; x++) if (data[(y * 120 + x) * 4 + 3] > 128) {
        area++; left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y)
      }
      frames.push({ area, ratio: (right - left) / (bottom - top), volume: pose.a * pose.a * pose.b / 30 ** 3, lowerFilled })
    }
    const sample = t => risingBubbles(1440, 900, t, 0, 0, false, p.bubbleField, p.bubbleShape, p.bubbleLens)
    const screenRadius = b => Math.min(p.bubbleLens.maxRadius, b.radius * (b.slot % 4 === 1 ? p.bubbleLens.radiusScale : 1 + (p.bubbleLens.radiusScale - 1) * 0.4))
    const slot = sample(10).filter(b => b.y > 150 && b.y < 900).sort((a, b) => screenRadius(b) - screenRadius(a))[0].slot
    const positions = Array.from({ length: 17 }, (_, i) => sample(10 + i * 0.25).find(b => b.slot === slot).x)
    const tangentErrors = []
    for (let t = 10; t <= 14; t += 0.25) {
      const b = sample(t).find(b => b.slot === slot), next = sample(t + 0.001).find(b => b.slot === slot)
      const tangent = Math.atan2(next.x - b.x, b.y - next.y)
      tangentErrors.push(Math.abs(tangent - b.flowAngle))
    }
    return { frames, positions, tangentErrors }
  })
  const ratios = flow.frames.map(f => f.ratio), areas = flow.frames.map(f => f.area)
  assert.ok(Math.max(...ratios) - Math.min(...ratios) > 0.025 && Math.max(...ratios) < 1.6, 'the bubble deforms modestly as a smooth ellipsoid')
  assert.ok(Math.max(...areas) / Math.min(...areas) < 1.12, 'the projected bubble area varies only slightly')
  assert.ok(flow.frames.every(f => f.lowerFilled && Math.abs(f.volume - 1) < 1e-9), 'the bubble has a closed round bottom and preserves proxy volume')
  assert.ok(Math.max(...flow.tangentErrors) < 0.002, 'body inclination comes from the actual path tangent')
  const travelX = flow.positions.slice(1).map((x, i) => x - flow.positions[i])
  assert.ok(Math.max(...flow.positions) - Math.min(...flow.positions) > 2 && travelX.some(v => v > 0) && travelX.some(v => v < 0), 'larger bubbles gently zigzag both ways during a short rise')
  console.log('Flow motion:', { contourRatioRange: [Math.min(...ratios), Math.max(...ratios)], swayPixels: Math.max(...flow.positions) - Math.min(...flow.positions) })
  // Actual mounted rendering must react to the clock while remaining alive.
  // Reduced motion also exercises its display/clock polling path.
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.evaluate(async () => {
    const { startDayNightDive } = await import('/daynight-dive.js')
    const profile = (await (await fetch('/we-sync/dwp/scene?id=yrn.deepseek-day-night')).json()).dsh.tabScene
    window.paletteMinutes = 720; window.paletteMode = 'enhanced'
    window.paletteStop = startDayNightDive({ profile, clock: () => new Date(2026, 9, 12, 0, window.paletteMinutes), visualState: () => ({ focus: false, mode: window.paletteMode }), assetUrl: name => '/we-sync/dwp/file?id=yrn.deepseek-day-night&name=' + encodeURIComponent(name) })
  })
  await page.waitForFunction(() => document.querySelector('[data-daynight-dive]')?.width === 1440)
  const palettePixel = () => page.evaluate(() => {
    const canvas = document.querySelector('[data-daynight-dive]'), ctx = canvas.getContext('2d')
    const layer = window.silhouetteLayer, ink = layer.getContext('2d').getImageData(0, 0, layer.width, layer.height).data
    let opaque = 0; while (ink[opaque + 3] < 250 && opaque < ink.length - 4) opaque += 4
    return { water: Array.from(ctx.getImageData(10, 890, 1, 1).data).slice(0, 3), ink: Array.from(ink.slice(opaque, opaque + 3)), colorAlpha: window.portraitColorAlpha, bakes: window.glowBakes, caches: window.causticCaches.size, sidebar: getComputedStyle(document.body).getPropertyValue('--dsw-specific-sidebar-fill'), selected: getComputedStyle(document.querySelector('#sidebar-selected')).backgroundColor }
  })
  const daytime = await palettePixel()
  await page.evaluate(() => { window.paletteMinutes = 1085 }) // Halfway through the original dusk fade.
  await page.waitForTimeout(550)
  const dusk = await palettePixel()
  await page.evaluate(() => { window.paletteMinutes = 1260 })
  await page.waitForTimeout(550)
  const nighttime = await palettePixel()
  assert.deepEqual(daytime.ink, [3, 22, 51])
  assert.deepEqual(nighttime.ink, [50, 15, 32])
  assert.ok(daytime.water[2] > daytime.water[0] * 5 && nighttime.water[0] > nighttime.water[2] * 2, 'the real canvas changes from blue water to muted warm red at night')
  assert.equal(daytime.colorAlpha, 0.9)
  assert.equal(dusk.colorAlpha, 0.45, 'global portrait colors fade progressively with dusk')
  assert.equal(nighttime.colorAlpha, 0, 'the night portrait is a full silhouette at every water depth')
  assert.ok(dusk.water[0] > daytime.water[0] && dusk.water[0] < nighttime.water[0], 'dusk uses a gradual clock crossfade')
  assert.ok(nighttime.sidebar.includes('50,15,32'), 'sidebar tint follows the changing silhouette ink')
  assert.equal(daytime.selected, 'rgb(37, 99, 235)')
  assert.equal(dusk.selected, 'rgb(135, 85, 158)', 'sidebar accents follow dusk rather than jumping to red')
  assert.equal(nighttime.selected, 'rgb(233, 70, 80)', 'Complete night selection is bright coral red')
  await page.locator('#sidebar-hover').hover()
  assert.equal(await page.locator('#sidebar-hover').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(241, 91, 99)', 'night hover is brighter red')
  await page.locator('#sidebar-selected').hover()
  assert.equal(await page.locator('#sidebar-selected').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(241, 91, 99)', 'hover also brightens the selected item')
  await page.mouse.move(1300, 800)
  assert.equal(nighttime.bakes, daytime.bakes, 'night changes recolor the cached haze without blurring again')
  assert.equal(nighttime.caches, daytime.caches, 'night changes preserve the existing caustic texture cache')
  await page.screenshot({ path: resolve('_dist/dive-preview/night-underwater.png') })
  for (const mode of ['eco', 'perf']) {
    await page.evaluate(mode => { window.paletteMode = mode }, mode)
    await page.waitForTimeout(450)
    const other = await palettePixel()
    assert.deepEqual(other.water, daytime.water, `${mode} keeps daytime water while the clock is at night`)
    assert.deepEqual(other.ink, daytime.ink, `${mode} keeps the original silhouette ink`)
    assert.equal(other.colorAlpha, daytime.colorAlpha, `${mode} keeps the original portrait visibility`)
    assert.equal(other.selected, daytime.selected, `${mode} restores blue interaction accents even at night`)
  }
  await page.evaluate(() => { window.paletteMode = 'enhanced'; window.paletteMinutes = 1260 })
  await page.waitForTimeout(450)
  assert.deepEqual((await palettePixel()).water, nighttime.water, 'returning to Complete restores the current night palette')
  await page.evaluate(() => { window.paletteMinutes = 360 })
  await page.waitForTimeout(450)
  assert.deepEqual((await palettePixel()).water, daytime.water, 'dawn restores blue without restarting the scene')
  assert.equal((await palettePixel()).selected, daytime.selected, 'dawn restores blue sidebar selection')
  await page.evaluate(() => window.paletteStop())
  assert.equal(await page.locator('[data-daynight-dive]').count(), 0)
  assert.equal(await page.locator('#sidebar-selected').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(37, 99, 235)', 'teardown restores the host sidebar blue')
  console.log('Clock palette checks:', { daytime: daytime.water, dusk: dusk.water, nighttime: nighttime.water })
  const nightDetails = await page.evaluate(async () => {
    const { startDayNightDive, risingBubbles } = await import('/daynight-dive.js')
    const profile = structuredClone(window.lightTestProfile)
    const render = async detailOpacity => {
      const p = structuredClone(profile); p.bubbleLens.detailOpacity = detailOpacity
      const stop = startDayNightDive({ profile: p, clock: () => new Date(2026, 9, 12, 21), visualState: () => ({ focus: false, mode: 'enhanced' }), assetUrl: name => '/we-sync/dwp/file?id=yrn.deepseek-day-night&name=' + encodeURIComponent(name) })
      for (let i = 0; i < 200 && document.querySelector('[data-daynight-dive]')?.width !== 1440; i++) await new Promise(r => setTimeout(r, 20))
      const canvas = document.querySelector('[data-daynight-dive]')
      const pixels = canvas.getContext('2d').getImageData(0, 0, 1440, 900).data
      stop(); return pixels
    }
    const base = await render(0), detail = await render(profile.bubbleLens.detailOpacity)
    const bubbles = risingBubbles(1440, 900, 3, 0, profile.scroll.bubbleOffset, true).map(b => ({ ...b, radius: Math.min(profile.bubbleLens.maxRadius, b.radius * (b.slot % 4 === 1 ? profile.bubbleLens.radiusScale : 1 + (profile.bubbleLens.radiusScale - 1) * 0.4)) }))
    let changed = 0, far = 0, peak = 0
    for (let y = 0; y < 900; y++) for (let x = 0; x < 1440; x++) {
      const i = (y * 1440 + x) * 4
      const diff = Math.abs(detail[i] - base[i]) + Math.abs(detail[i + 1] - base[i + 1]) + Math.abs(detail[i + 2] - base[i + 2])
      if (diff > 8) { changed++; if (!bubbles.some(b => Math.hypot(x - b.x, y - b.y) <= b.radius * 3.5 + 2)) far++ }
      peak = Math.max(peak, diff)
    }
    return { changed, far, peak }
  })
  console.log('Full night silhouette detail windows:', nightDetails)
  assert.ok(nightDetails.changed > 10 && nightDetails.peak > 8, 'bubble windows still reveal portrait details inside the full night silhouette')
  assert.equal(nightDetails.far, 0, 'the global night silhouette stays flat outside bubble windows')
  assert.deepEqual(errors, [])
  console.log('Browser checks passed: play, replay, cleanup, reduced motion, resize; no page errors.')
} finally { await browser.close() }
