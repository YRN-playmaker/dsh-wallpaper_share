/** Harness 桌面页面使用 dsh-app://app，帧流地址由宿主单独提供。 */
type HarnessTransportGlobal = typeof globalThis & {
  __DSH_TRANSPORT__?: { streamBaseUrl?: string }
}

export function sceneStreamUrl(monitor: string, version: number,
  baseUrl = (globalThis as HarnessTransportGlobal).__DSH_TRANSPORT__?.streamBaseUrl ?? location.href): string {
  const url = new URL('/we-sync/scene/stream', baseUrl)
  if (url.protocol === 'https:' || url.protocol === 'wss:') url.protocol = 'wss:'
  else if (url.protocol === 'http:' || url.protocol === 'ws:') url.protocol = 'ws:'
  else throw new Error('Scene stream requires an HTTP or WebSocket base URL')
  if (monitor !== '') url.searchParams.set('monitor', monitor)
  url.searchParams.set('v', String(version))
  return url.href
}
