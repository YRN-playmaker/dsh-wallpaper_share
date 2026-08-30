import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { readZip, readZipMap } from '../unzip.ts';

// —— 测试用最小 zip 写入器（stored=0 / deflate=8），与 unzip.ts 独立实现以做交叉验证 ——
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b: Uint8Array): number { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function buildZip(files: Array<{ name: string; data: Uint8Array; deflate?: boolean }>): Uint8Array {
  const parts: Uint8Array[] = []; const cds: Uint8Array[] = []; let off = 0;
  for (const f of files) {
    const nb = new TextEncoder().encode(f.name); const crc = crc32(f.data);
    const comp = f.deflate ? new Uint8Array(deflateRawSync(Buffer.from(f.data))) : f.data;
    const method = f.deflate ? 8 : 0;
    const lfh = new Uint8Array(30); const lv = new DataView(lfh.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(8, method, true);
    lv.setUint32(14, crc, true); lv.setUint32(18, comp.length, true); lv.setUint32(22, f.data.length, true); lv.setUint16(26, nb.length, true);
    parts.push(lfh, nb, comp);
    const cdh = new Uint8Array(46); const cv = new DataView(cdh.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(10, method, true);
    cv.setUint32(16, crc, true); cv.setUint32(20, comp.length, true); cv.setUint32(24, f.data.length, true); cv.setUint16(28, nb.length, true); cv.setUint32(42, off, true);
    cds.push(new Uint8Array(Buffer.concat([Buffer.from(cdh), Buffer.from(nb)])));
    off += lfh.length + nb.length + comp.length;
  }
  const cd = new Uint8Array(Buffer.concat(cds.map(Buffer.from)));
  const eocd = new Uint8Array(22); const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true);
  ev.setUint32(12, cd.length, true); ev.setUint32(16, off, true);
  return new Uint8Array(Buffer.concat([...parts, cd, eocd].map(Buffer.from)));
}

test('stored zip：读出条目名 + 内容', () => {
  const zip = buildZip([
    { name: 'wallpaper.json', data: new TextEncoder().encode('{"format":"dwp"}') },
    { name: 'scene.json', data: new TextEncoder().encode('{"layers":[]}') },
  ]);
  const map = readZipMap(zip);
  assert.equal(map.get('wallpaper.json') && new TextDecoder().decode(map.get('wallpaper.json')), '{"format":"dwp"}');
  assert.deepEqual(JSON.parse(new TextDecoder().decode(map.get('scene.json')!)), { layers: [] });
});

test('deflate zip：inflateRaw 正确还原', () => {
  const big = new TextEncoder().encode('x'.repeat(5000)); // 可压缩
  const zip = buildZip([{ name: 'a.bin', data: big, deflate: true }]);
  const out = readZipMap(zip).get('a.bin')!;
  assert.equal(out.length, 5000);
  assert.deepEqual(out, big);
});

test('混合 stored + deflate + 目录项跳过', () => {
  const zip = buildZip([
    { name: 'dir/', data: new Uint8Array(0) },
    { name: 'dir/s.txt', data: new TextEncoder().encode('hello'), deflate: true },
    { name: 'raw.png', data: new Uint8Array([1, 2, 3, 4, 5]) },
  ]);
  const entries = readZip(zip);
  assert.deepEqual(entries.map(e => e.name).sort(), ['dir/s.txt', 'raw.png']);
  assert.equal(new TextDecoder().decode(entries.find(e => e.name === 'dir/s.txt')!.data), 'hello');
  assert.deepEqual([...entries.find(e => e.name === 'raw.png')!.data], [1, 2, 3, 4, 5]);
});

test('非 zip 字节 → 抛错', () => {
  assert.throws(() => readZip(new TextEncoder().encode('not a zip at all')), /EOCD|签名/);
});
