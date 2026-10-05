// 方向探针：ShakeGL / WaterwavesGL / NitroGL 在「零参数直通」下是否输出上下翻转
export const SHAKETEST_PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>shaketest</title></head><body>
<script type="module">
import { ShakeGL } from './shaketest.mjs'
import { WaterwavesGL } from './waterwaves.mjs'
import { NitroGL } from './nitro.mjs'
function marker() {
  const c = document.createElement('canvas'); c.width = 8; c.height = 8
  const g = c.getContext('2d')
  g.fillStyle = 'rgb(255,0,0)'; g.fillRect(0, 0, 4, 4)
  g.fillStyle = 'rgb(0,255,0)'; g.fillRect(4, 0, 4, 4)
  g.fillStyle = 'rgb(0,0,255)'; g.fillRect(0, 4, 4, 4)
  g.fillStyle = 'rgb(255,255,0)'; g.fillRect(4, 4, 4, 4)
  return c
}
function flat(v) {
  const c = document.createElement('canvas'); c.width = 8; c.height = 8
  const g = c.getContext('2d'); g.fillStyle = 'rgb(' + v + ',' + v + ',' + v + ')'; g.fillRect(0, 0, 8, 8)
  return c
}
function read(canvas) {
  const c2 = document.createElement('canvas'); c2.width = canvas.width; c2.height = canvas.height
  const g = c2.getContext('2d', { willReadFrequently: true })
  g.drawImage(canvas, 0, 0)
  const px = g.getImageData(0, 0, c2.width, c2.height).data
  const at = (x, y) => { const o = (y * c2.width + x) * 4; return px[o] + ',' + px[o + 1] + ',' + px[o + 2] }
  return 'TL(' + at(1, 1) + ') TR(' + at(6, 1) + ') BL(' + at(1, 6) + ') BR(' + at(6, 6) + ')'
}
try {
  const src = marker()
  const fl = flat(127)
  const bmp = await createImageBitmap(src)
  const out = []
  out.push('REF ' + read(src))
  // 同时测 canvas 源与 ImageBitmap 源（FLIP_Y 对两者的行为可能不同）
  const glShake = new ShakeGL()
  const s1 = glShake.render(src, 8, 8, fl, false, null, false, { offset: 0, strength: 0 }, 'a')
  out.push('SHAKE(canvas) ' + (s1 === null ? 'null' : read(s1)))
  const s2 = glShake.render(bmp, 8, 8, fl, false, null, false, { offset: 0, strength: 0 }, 'b')
  out.push('SHAKE(bitmap) ' + (s2 === null ? 'null' : read(s2)))
  const ww = new WaterwavesGL()
  const wave = [{ direction: 0, speed: 0, scale: 0, strength: 0, exponent: 1 }]
  const w1 = ww.render(src, 8, 8, null, false, wave, 0, 'a')
  out.push('WATER(canvas) ' + (w1 === null ? 'null' : read(w1)))
  const w2 = ww.render(bmp, 8, 8, null, false, wave, 0, 'b')
  out.push('WATER(bitmap) ' + (w2 === null ? 'null' : read(w2)))
  const nt = new NitroGL()
  const np = [{ colorStart: [0, 0, 0], colorEnd: [0, 0, 0], multiply: 0, ranges: [1, 1], scales: [1, 1], speeds: [0, 0, 0, 0], smoothness: 0, useMask: false }]
  const n1 = nt.render(bmp, 8, 8, null, [], np, 0, 'b')
  out.push('NITRO(bitmap) ' + (n1 === null ? 'null' : read(n1)))
  const msg = out.join(' | ')
  document.title = msg
  await fetch('/__log?tag=shaketest', { method: 'POST', body: msg })
} catch (e) {
  document.title = 'ST_ERR ' + e.message
  await fetch('/__log?tag=shaketest', { method: 'POST', body: 'ST_ERR ' + e.message })
}
</script></body></html>`
