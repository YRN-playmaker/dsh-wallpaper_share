import { test } from 'node:test'
import assert from 'node:assert/strict'
import { captureDrawRect, estimateViewportInsets } from '../capture-viewport.ts'
import { parseCaptureScreen, type CaptureScreenRect } from '../../scene/SceneProtocol.ts'

const screen: CaptureScreenRect = { left: 0, top: 0, width: 1920, height: 1080, pixelRatio: 1 }

test('capture follows the window location without fitting the full wallpaper to it', () => {
  assert.deepEqual(captureDrawRect(screen, { left: 300, top: 180, width: 800, height: 600 }, 1920, 1080, 800, 600),
    { sx: 300, sy: 180, sw: 800, sh: 600, dx: 0, dy: 0, dw: 800, dh: 600 })
  assert.equal(captureDrawRect(screen, { left: 450, top: 180, width: 800, height: 600 }, 1920, 1080, 800, 600)!.sx, 450)
})

test('downsampled captures and negative monitor origins preserve desktop scale', () => {
  const monitor = { left: -1536, top: -100, width: 1536, height: 864, pixelRatio: 1.25 }
  assert.deepEqual(captureDrawRect(monitor, { left: -1236, top: 100, width: 640, height: 480 }, 960, 540, 800, 600),
    { sx: 187.5, sy: 125, sw: 400, sh: 300, dx: 0, dy: 0, dw: 800, dh: 600 })
})

test('partly off-screen windows clip both source and destination without stretching', () => {
  assert.deepEqual(captureDrawRect(screen, { left: -100, top: -50, width: 800, height: 600 }, 1920, 1080, 800, 600),
    { sx: 0, sy: 0, sw: 700, sh: 550, dx: 100, dy: 50, dw: 700, dh: 550 })
  assert.equal(captureDrawRect(screen, { left: 1920, top: 0, width: 100, height: 100 }, 1920, 1080, 100, 100), null)
})

test('fullscreen covers the monitor at desktop scale and browser chrome is excluded', () => {
  assert.deepEqual(captureDrawRect(screen, { left: 0, top: 0, width: 1920, height: 1080 }, 1280, 720, 1920, 1080),
    { sx: 0, sy: 0, sw: 1280, sh: 720, dx: 0, dy: 0, dw: 1920, dh: 1080 })
  assert.deepEqual(estimateViewportInsets(816, 696, 800, 600, 1, false), { x: 8, y: 88 })
  assert.deepEqual(estimateViewportInsets(816, 696, 640, 480, 1.25, false), { x: 8, y: 88 })
  assert.deepEqual(estimateViewportInsets(1920, 1080, 1920, 1080, 1, true), { x: 0, y: 0 })
})

test('only valid capture geometry enables desktop alignment', () => {
  assert.deepEqual(parseCaptureScreen(screen), screen)
  for (const invalid of [null, {}, { ...screen, width: 0 }, { ...screen, pixelRatio: Infinity }, { ...screen, left: '0' }]) {
    assert.equal(parseCaptureScreen(invalid), null)
  }
})
