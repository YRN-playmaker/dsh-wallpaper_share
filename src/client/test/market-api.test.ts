import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCards, searchCards, collectTags, fetchCatalog, fetchInstalled, install, uninstall, type MarketEntry, type InstalledItem, type Fetch } from '../market-api.ts';

const free = (id: string, version = '1.0.0', tags: string[] = []): MarketEntry => ({
  id, name: { zh: id, en: id }, author: 'a', tags,
  license: { commercial: false, content: 'CC0' },
  dwp: { thumbnail: 'https://x/' + id + '.png', package: { version } },
});
const paid = (id: string): MarketEntry => ({
  id, name: { zh: id, en: id }, author: 'a',
  license: { commercial: true, content: 'proprietary' },
  dwp: { thumbnail: 'https://x', package: { version: '1.0.0' } },
  sales: { platform: 'itch', url: 'https://a.itch.io/x' },
});
const inst = (id: string, version: string): InstalledItem => ({ id, version, commercial: false, installedAt: '' });

test('buildCards：过滤付费 + 合并安装状态（absent/installed/update）', () => {
  const catalog = [free('a'), free('b', '2.0.0'), free('c'), paid('p')];
  const installed = [inst('a', '1.0.0'), inst('b', '1.0.0')];   // a 同版=installed，b 落后=update，c 未装=absent
  const cards = buildCards(catalog, installed);
  assert.equal(cards.length, 3, '付费 p 应被过滤');
  assert.equal(cards.find(c => c.entry.id === 'a')!.state, 'installed');
  assert.equal(cards.find(c => c.entry.id === 'b')!.state, 'update');
  assert.equal(cards.find(c => c.entry.id === 'b')!.installedVersion, '1.0.0');
  assert.equal(cards.find(c => c.entry.id === 'c')!.state, 'absent');
});

test('searchCards：关键词命中名称/作者/描述；标签精确匹配', () => {
  const cards = buildCards([free('rain', '1', ['weather']), free('snow', '1', ['weather']), free('cat', '1', ['pet'])], []);
  assert.deepEqual(searchCards(cards, 'rain').map(c => c.entry.id), ['rain']);
  assert.deepEqual(searchCards(cards, '', 'weather').map(c => c.entry.id).sort(), ['rain', 'snow']);
  assert.equal(searchCards(cards, 'zzz').length, 0);
});

test('collectTags：去重排序', () => {
  const cards = buildCards([free('a', '1', ['z', 'm']), free('b', '1', ['m', 'a'])], []);
  assert.deepEqual(collectTags(cards), ['a', 'm', 'z']);
});

test('fetchCatalog：解析 entries', async () => {
  const f: Fetch = async () => ({ ok: true, status: 200, json: async () => ({ entries: [free('a')] }) });
  const list = await fetchCatalog(f);
  assert.equal(list.length, 1);
  assert.equal(list[0]!.id, 'a');
});

test('fetchCatalog：非 200 抛错', async () => {
  const f: Fetch = async () => ({ ok: false, status: 502, json: async () => ({}) });
  await assert.rejects(() => fetchCatalog(f), /catalog 502/);
});

test('fetchInstalled：解析 installed 数组', async () => {
  const f: Fetch = async () => ({ ok: true, status: 200, json: async () => ({ installed: [inst('a', '1')] }) });
  assert.equal((await fetchInstalled(f)).length, 1);
});

test('install：200 → ok', async () => {
  const f: Fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) });
  assert.deepEqual(await install(f, 'a'), { ok: true });
});

test('install：402 → needsPurchase + salesUrl', async () => {
  const f: Fetch = async () => ({ ok: false, status: 402, json: async () => ({ error: 'needs-purchase', salesUrl: 'https://a.itch.io/x' }) });
  const r = await install(f, 'a');
  assert.equal(r.needsPurchase, true);
  assert.equal(r.salesUrl, 'https://a.itch.io/x');
});

test('install：500 → error 透传', async () => {
  const f: Fetch = async () => ({ ok: false, status: 500, json: async () => ({ error: '完整性校验失败' }) });
  const r = await install(f, 'a');
  assert.equal(r.ok, false);
  assert.match(r.error!, /完整性/);
});

test('uninstall：200 → ok；非 200 → error', async () => {
  assert.deepEqual(await uninstall(async () => ({ ok: true, status: 200, json: async () => ({}) }), 'a'), { ok: true });
  const bad = await uninstall(async () => ({ ok: false, status: 400, json: async () => ({ error: '缺 id' }) }), '');
  assert.equal(bad.error, '缺 id');
});
