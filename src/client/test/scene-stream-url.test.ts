import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sceneStreamUrl } from '../scene-stream-url.ts'

test('web capture preserves the page authority and uses secure WebSockets for HTTPS', () => {
  assert.equal(sceneStreamUrl('Monitor0', 11, 'http://127.0.0.1:3080/session?old=1'),
    'ws://127.0.0.1:3080/we-sync/scene/stream?monitor=Monitor0&v=11')
  const url = new URL(sceneStreamUrl('显示器 & 2', 12, 'https://harness.example:8443/session'))
  assert.equal(url.origin, 'wss://harness.example:8443')
  assert.equal(url.pathname, '/we-sync/scene/stream')
  assert.equal(url.searchParams.get('monitor'), '显示器 & 2')
  assert.equal(url.searchParams.get('v'), '12')
  assert.equal(sceneStreamUrl('', 13, 'wss://harness.example'),
    'wss://harness.example/we-sync/scene/stream?v=13')
})

test('desktop capture uses the injected host instead of the dsh-app page authority', (t) => {
  const page = Object.getOwnPropertyDescriptor(globalThis, 'location')
  const transport = Object.getOwnPropertyDescriptor(globalThis, '__DSH_TRANSPORT__')
  t.after(() => {
    for (const [key, descriptor] of [['location', page], ['__DSH_TRANSPORT__', transport]] as const) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  })
  Object.defineProperty(globalThis, 'location', { configurable: true, value: new URL('dsh-app://app/') })
  Object.defineProperty(globalThis, '__DSH_TRANSPORT__', {
    configurable: true, value: { streamBaseUrl: 'http://127.0.0.1:19387' },
  })
  assert.equal(sceneStreamUrl('Monitor0', 11),
    'ws://127.0.0.1:19387/we-sync/scene/stream?monitor=Monitor0&v=11')
  Object.defineProperty(globalThis, 'location', { configurable: true, value: new URL('https://harness.example/') })
  Reflect.deleteProperty(globalThis, '__DSH_TRANSPORT__')
  assert.equal(sceneStreamUrl('', 14), 'wss://harness.example/we-sync/scene/stream?v=14')
})

test('a desktop page without a host address cannot become ws://app', () => {
  assert.throws(() => sceneStreamUrl('', 1, 'dsh-app://app/'), /base URL/)
})
