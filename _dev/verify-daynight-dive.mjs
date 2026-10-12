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
    const draw = CanvasRenderingContext2D.prototype.drawImage
    const clear = CanvasRenderingContext2D.prototype.clearRect
    const arc = CanvasRenderingContext2D.prototype.arc
    const radial = CanvasRenderingContext2D.prototype.createRadialGradient
    CanvasRenderingContext2D.prototype.createRadialGradient = function (...args) {
      if (this.canvas.dataset.daynightDive) window.sceneRadials++
      else if (this.canvas.width === 1440 && this.canvas.height === 900) window.portraitLightRadials++
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
        window.causticPlacement = null
      }
      return clear.apply(this, args)
    }
    window.entryDraws = []
    window.foamDraws = []
    CanvasRenderingContext2D.prototype.arc = function (...args) {
      if (this.canvas.dataset.daynightDive && this.fillStyle === '#94caff') window.bottomDots.push({ x: args[0], y: args[1], radius: args[2], alpha: this.globalAlpha })
      if (this.canvas.dataset.daynightDive && this.strokeStyle === '#a5e9ff') window.bubbleOutlines++
      return arc.apply(this, args)
    }
    CanvasRenderingContext2D.prototype.drawImage = function (...args) {
      const image = args[0]
      if (this.canvas.dataset.daynightDive && image instanceof HTMLCanvasElement && image.width === 320 && image.height === 96) {
        window.causticDraws++
        window.causticPlacement = { y: this.getTransform().f + args[2], alpha: this.globalAlpha }
      }
      if (this.canvas.dataset.daynightDive && image instanceof HTMLCanvasElement && image.height === this.canvas.height && image.width === this.canvas.width) window.portraitColorLayer = image
      if (this.canvas.dataset.daynightDive && image instanceof HTMLCanvasElement && image.height > this.canvas.height) {
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
    const script = route.request().url().endsWith('/daynight-dive.js')
    return route.fulfill({ contentType: script ? 'text/javascript' : 'text/html', body: readFileSync(resolve('_dist/dive-preview', script ? 'daynight-dive.js' : 'index.html')) })
  })
  await page.goto('http://127.0.0.1:4318')
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
  assert.deepEqual(await themeState(), { page: 'rgba(15,16,20,0.035)', sidebar: 'rgba(13,14,17,0.580)', card: 'rgba(24, 26, 32, 0.62)' })
  await page.screenshot({ path: resolve('_dist/dive-preview/theme-dark.png') })
  await page.evaluate(() => { document.body.removeAttribute('data-ds-dark-theme'); document.body.style.color = '#193052' })
  assert.deepEqual(await themeState(), { page: 'rgba(246,247,250,0.035)', sidebar: 'rgba(238,240,244,0.800)', card: 'rgba(255, 255, 255, 0.76)' })
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
  assert.ok(topCaustic?.alpha > 0.2 && topCaustic.y === 0, 'surface caustics are visible at the top')
  await page.mouse.move(1100, 500)
  await page.mouse.wheel(0, 900)
  await page.waitForTimeout(700)
  const midCaustic = await page.evaluate(() => window.causticPlacement)
  assert.ok(midCaustic?.alpha > 0 && midCaustic.alpha < topCaustic.alpha * 0.7, 'surface caustics fade while diving')
  assert.equal(midCaustic.y, 0, 'surface caustics remain anchored instead of moving with the background')
  await page.mouse.wheel(0, 3000)
  await page.waitForTimeout(700)
  const scrolledY = await silhouetteY()
  assert.ok(await backgroundBrightness() < initialBrightness - 20, 'water background darkens as scrolling reaches the bottom')
  assert.ok(scrolledY > initialY + 15, 'scroll down moves the close-up downward')
  assert.equal(await page.evaluate(() => window.causticDraws), 0, 'surface caustics disappear at depth')
  assert.equal(await page.evaluate(() => window.sceneRadials), 20, 'ambient surface patches also disappear, leaving only bubble lights')
  const bottomDots = await page.evaluate(() => window.bottomDots)
  assert.ok(bottomDots.length > 300, 'regular dot rows and columns appear at the scroll bottom')
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
  for (let i = 0; i < 4; i++) { await page.click('#leave'); await page.click('#enter') }
  await page.locator('[data-daynight-dive]').waitFor({ state: 'attached' })
  await page.waitForFunction(() => document.querySelector('[data-daynight-dive]')?.width > 0)
  assert.equal(await page.locator('[data-daynight-dive]').count(), 1)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.waitForTimeout(200)
  const sample = () => page.evaluate(() => document.querySelector('[data-daynight-dive]').toDataURL())
  const still = await sample()
  await page.waitForTimeout(200)
  assert.equal(await sample(), still, 'reduced motion must stay static')
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
    window.lightTestProfile = profile
    const baseline = structuredClone(profile); delete baseline.bubbleLight
    window.lightTestStop = startDayNightDive({ profile: baseline, assetUrl: name => '/we-sync/dwp/file?id=yrn.deepseek-day-night&name=' + encodeURIComponent(name) })
  })
  await page.waitForFunction(() => document.querySelector('[data-daynight-dive]')?.width === 1440)
  await page.evaluate(() => {
    const layer = window.portraitColorLayer
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
    const layer = window.portraitColorLayer
    const lit = layer.getContext('2d').getImageData(0, 0, layer.width, layer.height).data
    const baseline = window.unlitPortrait
    let increased = 0, strongest = 0, outside = 0
    for (let y = 450; y < 900; y++) for (let x = 0; x < 1440; x++) {
      const i = (y * 1440 + x) * 4 + 3
      const difference = lit[i] - baseline[i]
      if (difference > 15) increased++
      strongest = Math.max(strongest, difference)
      if (x < 500 && lit[i] > 0) outside++
    }
    return { increased, strongest, outside }
  })
  assert.ok(restored.increased > 300 && restored.strongest > 30, 'bubble light restores actual portrait details in deep silhouette areas')
  assert.equal(restored.outside, 0, 'restored portrait details stay inside the character contour')
  await page.screenshot({ path: resolve('_dist/dive-preview/bubble-light.png') })
  assert.equal(await page.evaluate(() => window.portraitLightRadials), 20, 'complete mode restores portrait details around every bubble')
  assert.equal(await page.evaluate(() => window.sceneRadials), 24 + 20, 'complete mode enables bubble glow')
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
  assert.deepEqual(errors, [])
  console.log('Browser checks passed: play, replay, cleanup, reduced motion, resize; no page errors.')
} finally { await browser.close() }
