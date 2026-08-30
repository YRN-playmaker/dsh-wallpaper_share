import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMarketRoutes, type Req, type Res, type Route } from '../routes.ts';
import { MarketClient } from '../pull.ts';
import { integrityOf } from '../integrity.ts';
import type { CatalogEntry, FetchFn } from '../catalog.ts';

const pkgBytes = new TextEncoder().encode('DWP-PKG');
const INTEG = integrityOf(pkgBytes);
const free: CatalogEntry = {
  id: 'yrn.demo', author: 'YRN', name: { zh: 'd', en: 'd' },
  license: { code: 'MIT', content: 'CC-BY-4.0', commercial: false },
  dwp: { spec: '0.4.1', thumbnail: 'https://x/p.png', package: { version: '1.0.0', url: 'https://github.com/o/r/releases/download/v/demo.dwp', integrity: INTEG, size: pkgBytes.length } },
};
const paid: CatalogEntry = {
  id: 'studio.paid', author: 'S', name: { zh: 'p', en: 'p' },
  license: { code: 'MIT', content: 'proprietary', commercial: true },
  dwp: { spec: '0.4.1', thumbnail: 'https://x/p.png', package: { version: '1.0.0', url: 'https://a.itch.io/x', integrity: INTEG, size: pkgBytes.length } },
  sales: { platform: 'itch', url: 'https://a.itch.io/x', entitlement: 'platform' },
};
const fetchFn: FetchFn = async (url) => {
  if (url.endsWith('.json')) return { ok: true, status: 200, json: async () => ({ schemaVersion: 1, generatedAt: '', count: 2, entries: [free, paid] }), arrayBuffer: async () => new ArrayBuffer(0) };
  return { ok: true, status: 200, json: async () => ({}), arrayBuffer: async () => pkgBytes.slice().buffer };
};

function mk() {
  const market = new MarketClient({ dir: mkdtempSync(join(tmpdir(), 'dwp-routes-')), fetchFn, now: () => '2026-08-29T00:00:00Z' });
  const routes = new Map(createMarketRoutes({ market, catalogUrl: 'https://reg/catalog.json' }).map(r => [r.path, r]));
  return { market, routes };
}
interface FakeRes extends Res { headers: Record<string, string>; body: unknown }
async function call(route: Route, url: string): Promise<FakeRes> {
  const res: FakeRes = {
    statusCode: 0, headers: {}, body: undefined,
    setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; },
  };
  await route.handler({ url, method: 'GET' } as Req, res);
  return res;
}
const bodyOf = (res: FakeRes) => JSON.parse(res.body as string);

test('GET /catalog → 200 + 2 条目', async () => {
  const { routes } = mk();
  const res = await call(routes.get('/we-sync/dwp/market/catalog')!, '/we-sync/dwp/market/catalog');
  assert.equal(res.statusCode, 200);
  assert.equal(bodyOf(res).entries.length, 2);
});

test('GET /install?id=free → 200 + record；随后 /installed 含它', async () => {
  const { routes, market } = mk();
  const res = await call(routes.get('/we-sync/dwp/market/install')!, '/we-sync/dwp/market/install?id=yrn.demo');
  assert.equal(res.statusCode, 200);
  assert.equal(bodyOf(res).record.id, 'yrn.demo');
  assert.equal(market.installed().length, 1);
});

test('GET /install?id=paid → 402 needs-purchase + 销售页', async () => {
  const { routes } = mk();
  const res = await call(routes.get('/we-sync/dwp/market/install')!, '/we-sync/dwp/market/install?id=studio.paid');
  assert.equal(res.statusCode, 402);
  assert.equal(bodyOf(res).error, 'needs-purchase');
  assert.equal(bodyOf(res).salesUrl, 'https://a.itch.io/x');
});

test('GET /install?id=missing → 404；无 id → 400', async () => {
  const { routes } = mk();
  const r404 = await call(routes.get('/we-sync/dwp/market/install')!, '/we-sync/dwp/market/install?id=nope');
  assert.equal(r404.statusCode, 404);
  const r400 = await call(routes.get('/we-sync/dwp/market/install')!, '/we-sync/dwp/market/install');
  assert.equal(r400.statusCode, 400);
});

test('GET /uninstall?id → 200 后已装清空', async () => {
  const { routes, market } = mk();
  await call(routes.get('/we-sync/dwp/market/install')!, '/we-sync/dwp/market/install?id=yrn.demo');
  const res = await call(routes.get('/we-sync/dwp/market/uninstall')!, '/we-sync/dwp/market/uninstall?id=yrn.demo');
  assert.equal(res.statusCode, 200);
  assert.equal(market.installed().length, 0);
});

test('GET /updates → 200 数组', async () => {
  const { routes } = mk();
  const res = await call(routes.get('/we-sync/dwp/market/updates')!, '/we-sync/dwp/market/updates');
  assert.equal(res.statusCode, 200);
  assert.ok(Array.isArray(bodyOf(res).updates));
});
