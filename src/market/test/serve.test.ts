import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDwpServeRoutes, type Req, type Res, type Route } from '../serve.ts';
import { MarketClient } from '../pull.ts';
import { ApplyState } from '../apply.ts';
import { integrityOf } from '../integrity.ts';
import type { CatalogEntry, FetchFn } from '../catalog.ts';

// 最小 stored-zip 构造（测试专用）
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b: Uint8Array): number { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function storedZip(files: Array<{ name: string; data: Uint8Array }>): Uint8Array {
  const parts: Uint8Array[] = []; const cds: Uint8Array[] = []; let off = 0;
  for (const f of files) {
    const nb = new TextEncoder().encode(f.name); const crc = crc32(f.data);
    const lfh = new Uint8Array(30); const lv = new DataView(lfh.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint32(14, crc, true);
    lv.setUint32(18, f.data.length, true); lv.setUint32(22, f.data.length, true); lv.setUint16(26, nb.length, true);
    parts.push(lfh, nb, f.data);
    const cdh = new Uint8Array(46); const cv = new DataView(cdh.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
    cv.setUint32(16, crc, true); cv.setUint32(20, f.data.length, true); cv.setUint32(24, f.data.length, true);
    cv.setUint16(28, nb.length, true); cv.setUint32(42, off, true);
    cds.push(new Uint8Array(Buffer.concat([Buffer.from(cdh), Buffer.from(nb)])));
    off += 30 + nb.length + f.data.length;
  }
  const cd = new Uint8Array(Buffer.concat(cds));
  const eocd = new Uint8Array(22); const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true);
  ev.setUint32(12, cd.length, true); ev.setUint32(16, off, true);
  return new Uint8Array(Buffer.concat([...parts, cd, eocd]));
}

const scene = { canvas: { width: 1920, height: 1080 }, layers: [] };
const manifest = { format: 'dwp', entry: 'scene.json' };
const tex = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
const pkg = storedZip([
  { name: 'wallpaper.json', data: new TextEncoder().encode(JSON.stringify(manifest)) },
  { name: 'scene.json', data: new TextEncoder().encode(JSON.stringify(scene)) },
  { name: 'assets/tex.png', data: tex },
]);
const INTEG = integrityOf(pkg);
const entry: CatalogEntry = {
  id: 'yrn.demo', author: 'a', name: { zh: 'd', en: 'd' },
  license: { code: 'MIT', content: 'CC0', commercial: false },
  dwp: { spec: '0.4.1', thumbnail: 'https://x/p.png', package: { version: '1.0.0', url: 'https://github.com/o/r/releases/download/v/demo.dwp', integrity: INTEG, size: pkg.length } },
};

async function mk() {
  const dir = mkdtempSync(join(tmpdir(), 'dwp-serve-'));
  const fetchFn: FetchFn = async () => ({ ok: true, status: 200, json: async () => ({}), arrayBuffer: async () => pkg.slice().buffer });
  const market = new MarketClient({ dir, fetchFn });
  await market.install(entry);
  const apply = new ApplyState(dir);
  const routes = new Map(createDwpServeRoutes({ store: market.store, apply }).map(r => [r.path, r]));
  return { apply, routes };
}
interface FakeRes extends Res { headers: Record<string, string>; body: unknown }
async function call(route: Route, url: string): Promise<FakeRes> {
  const res: FakeRes = { statusCode: 0, headers: {}, body: undefined, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } };
  await route.handler({ url } as Req, res); return res;
}

test('GET /scene → 200 + 解析回原 scene.json', async () => {
  const { routes } = await mk();
  const res = await call(routes.get('/we-sync/dwp/scene')!, '/we-sync/dwp/scene?id=yrn.demo');
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body as string), scene);
});

test('GET /manifest → 200 + wallpaper.json', async () => {
  const { routes } = await mk();
  const res = await call(routes.get('/we-sync/dwp/manifest')!, '/we-sync/dwp/manifest?id=yrn.demo');
  assert.deepEqual(JSON.parse(res.body as string), manifest);
});

test('GET /file?name=assets/tex.png → 200 + 字节 + image/png', async () => {
  const { routes } = await mk();
  const res = await call(routes.get('/we-sync/dwp/file')!, '/we-sync/dwp/file?id=yrn.demo&name=' + encodeURIComponent('assets/tex.png'));
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Content-Type'], 'image/png');
  assert.deepEqual([...(res.body as Buffer)], [...tex]);
});

test('GET /file 缺文件 → 404；未装 id → 404', async () => {
  const { routes } = await mk();
  assert.equal((await call(routes.get('/we-sync/dwp/file')!, '/we-sync/dwp/file?id=yrn.demo&name=nope.bin')).statusCode, 404);
  assert.equal((await call(routes.get('/we-sync/dwp/scene')!, '/we-sync/dwp/scene?id=ghost')).statusCode, 404);
});

test('GET /files → 列出包内条目', async () => {
  const { routes } = await mk();
  const res = await call(routes.get('/we-sync/dwp/files')!, '/we-sync/dwp/files?id=yrn.demo');
  assert.deepEqual(JSON.parse(res.body as string).files.sort(), ['assets/tex.png', 'scene.json', 'wallpaper.json']);
});

test('apply → applied → unapply 全链', async () => {
  const { routes, apply } = await mk();
  assert.equal(apply.get(), null);
  const a = await call(routes.get('/we-sync/dwp/apply')!, '/we-sync/dwp/apply?id=yrn.demo');
  assert.equal(a.statusCode, 200);
  assert.equal(JSON.parse(a.body as string).applied.id, 'yrn.demo');
  assert.equal((await call(routes.get('/we-sync/dwp/applied')!, '/we-sync/dwp/applied')).body && JSON.parse((await call(routes.get('/we-sync/dwp/applied')!, '/we-sync/dwp/applied')).body as string).applied.id, 'yrn.demo');
  await call(routes.get('/we-sync/dwp/unapply')!, '/we-sync/dwp/unapply');
  assert.equal(apply.get(), null);
});

test('apply 未装 id → 404', async () => {
  const { routes } = await mk();
  assert.equal((await call(routes.get('/we-sync/dwp/apply')!, '/we-sync/dwp/apply?id=ghost')).statusCode, 404);
});
