// Verify the actual tgz installed into an isolated Harness, with real host APIs.
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { mkdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DAYNIGHT_VERSION } from '../src/daynight/pack.ts'
const pluginVersion = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version
const url = process.argv[2] ?? 'http://127.0.0.1:4319'
const project = process.argv[3] ?? resolve('_dist/daynight-harness-project')
mkdirSync(project, { recursive: true })
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright')
const browser = await chromium.launch({ headless: true, channel: 'msedge' })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.addInitScript(() => {
    const NativeDate = window.Date
    window.Date = class extends NativeDate {
      constructor(...args) { if (args.length) super(...args); else super(2026, 9, 13, 12, 0, 0) }
    }
    let loader
    Object.defineProperty(window, '__ModuleLoader__', { configurable: true, get: () => loader, set(value) {
      loader = value
      const load = value.load
      value.load = function (definition) {
        const plugin = definition.id === 'dsh-wallpaper_share'
        if (plugin || definition.id === '@deepseek-ai/dsh-client-ui-workspace') {
          const factory = definition.factory
          definition.factory = require => {
            const exports = factory(require)
            if (plugin) window.packedPlugin = exports
            return { ...exports, apply(ctx, ...args) { if (plugin) window.pluginCtx = ctx; else window.workspaceCtx = ctx; return exports.apply(ctx, ...args) } }
          }
        }
        return load.call(this, definition)
      }
    } })
    const clear = CanvasRenderingContext2D.prototype.clearRect
    const draw = CanvasRenderingContext2D.prototype.drawImage
    CanvasRenderingContext2D.prototype.clearRect = function (...args) {
      if (this.canvas.dataset.daynightDive) window.topCaustic = null
      return clear.apply(this, args)
    }
    CanvasRenderingContext2D.prototype.drawImage = function (...args) {
      if (this.canvas.dataset.daynightDive && args[0] instanceof HTMLCanvasElement && args[0].width === 320 && args[0].height === 96) window.topCaustic = { y: this.getTransform().f + args[2], alpha: this.globalAlpha }
      return draw.apply(this, args)
    }
  })
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => window.packedPlugin && window.workspaceCtx)
  await page.waitForTimeout(2500)
  for (const text of ['继续', '稍后配置']) {
    const button = page.getByText(text, { exact: true })
    if (await button.count()) { await button.click(); await page.waitForTimeout(400) }
  }
  if (!await page.getByText('wallpaper_share', { exact: true }).count()) {
    await page.evaluate(async project => {
      const workspace = await window.workspaceCtx.workspaces.create({ path: project })
      window.workspaceCtx.workspaces.startSession(workspace.id)
    }, project)
    await page.locator('textarea').fill('壁纸安装验证（独立测试会话，无 API Key）')
    await page.getByRole('button', { name: '发送消息', exact: true }).click()
  }
  await page.getByText('wallpaper_share', { exact: true }).waitFor({ state: 'visible' })
  console.log('Installed plugin tab visible')
  assert.equal(await page.evaluate(() => window.packedPlugin.PLUGIN_VERSION), pluginVersion)
  const manifest = await page.evaluate(async () => (await fetch('/we-sync/dwp/manifest?id=yrn.deepseek-day-night')).json())
  assert.equal(manifest.version, DAYNIGHT_VERSION, 'real host serves the updated installed DWP')
  await page.evaluate(() => {
    const store = window.packedPlugin.store
    Object.assign(store.settings, { dwpMounted: 'yrn.deepseek-day-night', renderMode: 'enhanced', focus: false, blur: 0, panelAlpha: 0, shadow: 0 })
    store.actions.applyBackground(); store.notify()
  })
  await page.getByText('wallpaper_share', { exact: true }).click()
  await page.waitForFunction(() => { const mix = Number(getComputedStyle(document.body).getPropertyValue('--wesync-tab-ui-presence')); return mix > 0 && mix < 1 })
  await page.waitForFunction(() => window.topCaustic?.alpha > 0.2)
  console.log('Installed DWP entry rendered')
  assert.equal(await page.locator('[data-daynight-dive]').count(), 1)
  assert.equal(await page.evaluate(() => window.topCaustic.y), 0)
  const sidebar = await page.evaluate(() => {
    const col = document.querySelector('[class*="sidebarCol"]')
    const root = col.querySelector('[class*="_root"]:has(> [class*="logoRow"])')
    return { outer: getComputedStyle(col).backgroundColor, inner: getComputedStyle(root).backgroundColor, wash: getComputedStyle(col, '::before').backgroundImage, opacity: getComputedStyle(col, '::before').opacity, label: getComputedStyle(root).color }
  })
  assert.equal(sidebar.outer, 'rgba(0, 0, 0, 0)', 'sidebar outer fill does not stack over water')
  assert.equal(sidebar.inner, 'rgba(0, 0, 0, 0)', 'sidebar inner fill does not stack over water')
  assert.ok(sidebar.wash.includes('linear-gradient') && sidebar.wash.includes('rgba(3, 22, 51, 0) 100%'), 'sidebar wash feathers to transparent at the page edge')
  assert.equal(sidebar.opacity, '1')
  assert.equal(sidebar.label, 'rgb(238, 248, 255)', 'sidebar labels remain readable on water in light theme')
  await page.screenshot({ path: '_dist/dive-preview/installed-host-top.png' })
  assert.ok((await page.evaluate(() => getComputedStyle(document.body).getPropertyValue('--dsw-alias-bg-base'))).includes('0.035'), 'host inline theme does not obscure the wallpaper')
  await page.evaluate(() => window.pluginCtx.theme.setTheme('dark'))
  await page.waitForFunction(() => document.body.hasAttribute('data-ds-dark-theme'))
  await page.waitForTimeout(550)
  assert.ok((await page.evaluate(() => getComputedStyle(document.body).getPropertyValue('--dsw-alias-bg-base'))).includes('0.035'), 'dark theme keeps the same thin page wash')
  await page.screenshot({ path: '_dist/dive-preview/installed-host-dark.png' })
  await page.evaluate(() => window.pluginCtx.theme.setTheme('light'))
  // Both reported paths use the real host tab and mode buttons.
  await page.getByText('对话', { exact: true }).click()
  await page.waitForTimeout(120)
  assert.ok(await page.evaluate(() => {
    const col = document.querySelector('[class*="sidebarCol"]')
    const opacity = Number(getComputedStyle(col, '::before').opacity)
    const wash = getComputedStyle(document.body).getPropertyValue('--dsw-alias-bg-base')
    const alpha = Number(wash.match(/,\s*([\d.]+)\)$/)?.[1])
    return opacity > 0 && opacity < 1 && alpha > 0.035 && alpha < 0.4
  }), 'sidebar colors and feathered wash fade during water exit')
  await page.screenshot({ path: '_dist/dive-preview/installed-host-exit-transition.png' })
  await page.locator('[data-daynight-dive]').waitFor({ state: 'detached' })
  assert.equal(await page.locator('[data-daynight-transition]').count(), 0, 'exit removes all temporary transition styles')
  await page.evaluate(() => { window.topCaustic = null })
  await page.getByText('wallpaper_share', { exact: true }).click()
  await page.waitForFunction(() => window.topCaustic?.alpha > 0.2)
  assert.equal(await page.locator('[data-daynight-dive]').count(), 1, 'returning from conversation creates one scene')
  assert.equal(await page.evaluate(() => window.topCaustic.y), 0)
  await page.getByRole('button', { name: '预览', exact: true }).click()
  await page.waitForFunction(() => window.packedPlugin.store.settings.renderMode === 'eco' && window.topCaustic === null)
  assert.equal(await page.locator('[data-daynight-dive]').count(), 1, 'Preview keeps the same tab scene')
  await page.getByRole('button', { name: '完整', exact: true }).click()
  await page.waitForFunction(() => window.packedPlugin.store.settings.renderMode === 'enhanced' && window.topCaustic?.alpha > 0.2)
  assert.equal(await page.evaluate(() => window.topCaustic.y), 0, 'Complete restores surface light at the top')
  assert.ok((await page.evaluate(() => getComputedStyle(document.body).getPropertyValue('--dsw-alias-bg-base'))).includes('0.035'), 'mode switching preserves the page palette')
  console.log('Conversation return and Preview → Complete checks passed')
  await page.mouse.move(850, 500)
  for (let i = 0; i < 5; i++) { await page.mouse.wheel(0, 2000); await page.waitForTimeout(700) }
  await page.waitForTimeout(700)
  assert.equal(await page.evaluate(() => window.topCaustic), null, 'real panel scrolling fades surface caustics completely')
  await page.screenshot({ path: '_dist/dive-preview/installed-host-deep.png' })
  for (let i = 0; i < 5; i++) { await page.mouse.wheel(0, -2000); await page.waitForTimeout(700) }
  await page.waitForFunction(() => window.topCaustic?.alpha > 0.2)
  assert.equal(await page.evaluate(() => window.topCaustic.y), 0)
  await page.evaluate(() => {
    const store = window.packedPlugin.store
    store.settings.focus = true; store.actions.applyBackground(); store.notify()
  })
  await page.waitForFunction(() => document.querySelector('[data-daynight-dive]')?.getAnimations().some(a => a.animationName === 'wesync-dive-breathe'))
  await page.getByRole('button', { name: '预览', exact: true }).click()
  await page.waitForFunction(() => !document.querySelector('[data-daynight-dive]')?.getAnimations().some(a => a.animationName === 'wesync-dive-breathe') && window.topCaustic === null)
  await page.getByRole('button', { name: '完整', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('[data-daynight-dive]')?.getAnimations().some(a => a.animationName === 'wesync-dive-breathe') && window.topCaustic?.alpha > 0.2)
  await page.getByText('对话', { exact: true }).click()
  await page.locator('[data-daynight-dive]').waitFor({ state: 'detached' })
  assert.deepEqual(errors, [], 'actual installed plugin has no frontend load/render errors')
  console.log(`Actual installation checks passed: Harness 0.1.0-rc.6, plugin ${pluginVersion}, DWP ${DAYNIGHT_VERSION}; feathered sidebar, synchronized entry/exit theme transitions, light/dark themes, conversation return, Preview → Complete with/without Focus, scroll light fade/restore, focus breathing, exit; no page errors.`)
} finally { await browser.close() }
