// Record the local, packaged scene so the motion can be reviewed directly.
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { readZipMap } from '../src/market/unzip.ts'
import { DAYNIGHT_ID, DAYNIGHT_VERSION } from '../src/daynight/pack.ts'
const packageFiles = readZipMap(new Uint8Array(readFileSync(resolve('_dist/daynight', DAYNIGHT_ID + '-' + DAYNIGHT_VERSION + '.dwp'))))
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href)
const browser = await chromium.launch({ headless: true, channel: 'msedge' })
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await context.newPage()
  await page.route('http://127.0.0.1:4318/**', route => {
    const url = new URL(route.request().url())
    if (url.pathname.startsWith('/we-sync/dwp/')) {
      const name = url.pathname.endsWith('/scene') ? 'scene.json' : url.pathname.endsWith('/manifest') ? 'wallpaper.json' : url.searchParams.get('name')
      const data = packageFiles.get(name)
      return route.fulfill({ status: data ? 200 : 404, contentType: name?.endsWith('.json') ? 'application/json' : 'image/png', body: data ? Buffer.from(data) : '' })
    }
    const script = url.pathname.endsWith('/daynight-dive.js')
    return route.fulfill({ contentType: script ? 'text/javascript' : 'text/html', body: readFileSync(resolve('_dist/dive-preview', script ? 'daynight-dive.js' : 'index.html')) })
  })
  await page.goto('http://127.0.0.1:4318/')
  await page.evaluate(() => { document.querySelector('nav').style.display = 'none'; document.querySelector('.panel').style.display = 'none' })
  await page.waitForFunction(() => document.querySelector('[data-daynight-dive]')?.width > 0)
  await page.waitForTimeout(1600)
  const cost = await page.evaluate(async () => {
    const { drawSurfaceLight } = await import('/daynight-dive.js')
    const p = (await (await fetch('/we-sync/dwp/scene?id=yrn.deepseek-day-night')).json()).dsh.tabScene
    const c = document.createElement('canvas'); c.width = 1280; c.height = 800
    const ctx = c.getContext('2d'); const samples = []
    for (let i = 0; i < 32; i++) {
      const start = performance.now(); drawSurfaceLight(ctx, 1280, 800, 100 + i / 20, p.surfaceLight)
      samples.push(performance.now() - start)
    }
    samples.sort((a, b) => a - b)
    return { medianMs: samples[16].toFixed(2), p90Ms: samples[28].toFixed(2) }
  })
  console.log('Bounded caustic texture render cost:', cost)
  const session = await context.newCDPSession(page)
  const framesDir = resolve('_dist/dive-preview/caustics-frames'); mkdirSync(framesDir, { recursive: true })
  const frames = [], acknowledgments = []
  session.on('Page.screencastFrame', frame => {
    const name = 'frame-' + String(frames.length).padStart(5, '0') + '.png'
    writeFileSync(resolve(framesDir, name), Buffer.from(frame.data, 'base64'))
    frames.push({ name, time: frame.metadata.timestamp })
    acknowledgments.push(session.send('Page.screencastFrameAck', { sessionId: frame.sessionId }))
  })
  await session.send('Page.startScreencast', { format: 'png', maxWidth: 1280, maxHeight: 800, everyNthFrame: 2 })
  await page.waitForTimeout(6500)
  await session.send('Page.stopScreencast'); await Promise.all(acknowledgments)
  await page.screenshot({ path: resolve('_dist/dive-preview/caustics-preview.png') })
  const playlist = 'ffconcat version 1.0\n' + frames.map((frame, i) => "file '" + frame.name + "'\nduration " + (i + 1 < frames.length ? Math.max(0.01, frames[i + 1].time - frame.time) : 0.04).toFixed(5) + '\n').join('')
  writeFileSync(resolve(framesDir, 'frames.txt'), playlist, 'utf8')
  execFileSync('D:/ffmpeg/bin/ffmpeg.exe', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', resolve(framesDir, 'frames.txt'), '-r', '30', '-c:v', 'libx264', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', resolve('_dist/dive-preview/caustics-preview.mp4')])
  console.log('Recorded frames:', frames.length)
  await context.close()
} finally { await browser.close() }
