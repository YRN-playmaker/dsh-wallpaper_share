import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MarketClient, NeedsPurchaseError } from '../pull.ts';
import { integrityOf } from '../integrity.ts';
import type { CatalogEntry, FetchFn } from '../catalog.ts';

const pkgBytes = new TextEncoder().encode('DWP-PACKAGE-BYTES-v1');
const INTEG = integrityOf(pkgBytes);

const freeEntry = (over: Partial<CatalogEntry> = {}): CatalogEntry => ({
  id: 'yrn.demo', author: 'YRN', name: { zh: '演示', en: 'Demo' },
  license: { code: 'MIT', content: 'CC-BY-4.0', commercial: false },
  dwp: {
    spec: '0.4.1', thumbnail: 'https://x/p.png',
    package: { version: '1.0.0', url: 'https://github.com/o/r/releases/download/v/demo.dwp', integrity: INTEG, size: pkgBytes.length },
  },
  ...over,
} as CatalogEntry);

const paidEntry = (): CatalogEntry => freeEntry({
  id: 'studio.paid', license: { code: 'MIT', content: 'proprietary', commercial: true },
  dwp: { spec: '0.4.1', thumbnail: 'https://x/p.png', package: { version: '1.0.0', url: 'https://a.itch.io/x', integrity: INTEG, size: pkgBytes.length } },
  sales: { platform: 'itch', url: 'https://a.itch.io/x', entitlement: 'platform' },
} as Partial<CatalogEntry>);

/** 假 fetch：按 url 路由；可注入坏 integrity/短包/404。 */
function fakeFetch(overrides: { bytes?: Uint8Array; status?: number } = {}): FetchFn {
  return async (url) => {
    if (url.endsWith('.json')) {
      return { ok: true, status: 200, json: async () => ({ schemaVersion: 1, generatedAt: '', count: 0, entries: [] }), arrayBuffer: async () => new ArrayBuffer(0) };
    }
    const bytes = overrides.bytes ?? pkgBytes;
    const status = overrides.status ?? 200;
    return { ok: status === 200, status, json: async () => ({}), arrayBuffer: async () => bytes.slice().buffer };
  };
}

const tmp = () => mkdtempSync(join(tmpdir(), 'dwp-market-'));

test('install 免费包：下载→校验→写 packages/<id>.dwp→记 installed.json', async () => {
  const dir = tmp();
  const m = new MarketClient({ dir, fetchFn: fakeFetch(), now: () => '2026-08-29T00:00:00Z' });
  const rec = await m.install(freeEntry());
  assert.equal(rec.id, 'yrn.demo');
  assert.equal(rec.version, '1.0.0');
  assert.ok(existsSync(join(dir, 'packages', 'yrn.demo.dwp')));
  assert.deepEqual(new Uint8Array(readFileSync(join(dir, 'packages', 'yrn.demo.dwp'))), pkgBytes);
  assert.ok(m.isInstalled('yrn.demo'));
  assert.equal(m.installed().length, 1);
});

test('integrity 不匹配 → 拒绝安装，不落盘', async () => {
  const dir = tmp();
  const bad = freeEntry();
  bad.dwp.package.integrity = integrityOf(new TextEncoder().encode('WRONG'));
  const m = new MarketClient({ dir, fetchFn: fakeFetch() });
  await assert.rejects(() => m.install(bad), /完整性校验失败/);
  assert.ok(!existsSync(join(dir, 'packages', 'yrn.demo.dwp')));
  assert.equal(m.installed().length, 0);
});

test('size 不符 → 拒绝', async () => {
  const dir = tmp();
  const e = freeEntry();
  e.dwp.package.size = 999999;   // 声明尺寸与实际字节数不符
  const m = new MarketClient({ dir, fetchFn: fakeFetch() });
  await assert.rejects(() => m.install(e), /大小不符/);
});

test('HTTP 非 200 → 拒绝', async () => {
  const m = new MarketClient({ dir: tmp(), fetchFn: fakeFetch({ status: 404 }) });
  await assert.rejects(() => m.install(freeEntry()), /HTTP 404/);
});

test('付费包 → NeedsPurchaseError（携带销售页），不下载', async () => {
  let fetched = false;
  const spy: FetchFn = async (url) => { fetched = true; return fakeFetch()(url); };
  const m = new MarketClient({ dir: tmp(), fetchFn: spy });
  await assert.rejects(() => m.install(paidEntry()), NeedsPurchaseError);
  assert.equal(fetched, false, '付费包不应触发下载');
});

test('uninstall：删记录 + 删包文件', async () => {
  const dir = tmp();
  const m = new MarketClient({ dir, fetchFn: fakeFetch() });
  await m.install(freeEntry());
  m.uninstall('yrn.demo');
  assert.ok(!m.isInstalled('yrn.demo'));
  assert.ok(!existsSync(join(dir, 'packages', 'yrn.demo.dwp')));
});

test('install 幂等：同 id 覆盖不重复', async () => {
  const m = new MarketClient({ dir: tmp(), fetchFn: fakeFetch() });
  await m.install(freeEntry());
  await m.install(freeEntry());
  assert.equal(m.installed().length, 1);
});

test('updates：已装旧版 → catalog 新版列为可更新；未装/同版不列', async () => {
  const dir = tmp();
  const m = new MarketClient({ dir, fetchFn: fakeFetch() });
  await m.install(freeEntry());   // v1.0.0
  const newer = freeEntry(); newer.dwp.package.version = '1.1.0';
  const same = freeEntry();
  const cat = { schemaVersion: 1, generatedAt: '', count: 2, entries: [newer, same] };
  const ups = m.updates(cat as never);
  assert.deepEqual(ups.map((e) => e.dwp.package.version), ['1.1.0']);
});

test('catalog 拉取：假 fetch 返回合法 catalog', async () => {
  const m = new MarketClient({ dir: tmp(), fetchFn: fakeFetch() });
  const cat = await m.catalog('https://x/catalog.json');
  assert.equal(cat.schemaVersion, 1);
  assert.ok(Array.isArray(cat.entries));
});
