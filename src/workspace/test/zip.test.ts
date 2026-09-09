import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildZipStored, type ZipEntryIn } from '../zip.ts';
import { readZipMap } from '../../market/unzip.ts';

test('buildZipStored → readZipMap 往返', () => {
  const entries: ZipEntryIn[] = [
    { name: 'wallpaper.json', data: new TextEncoder().encode('{"format":"dwp/1.0"}') },
    { name: 'scene.json', data: new TextEncoder().encode('{"canvas":{"width":1920,"height":1080}}') },
    { name: 'assets/bubble.png', data: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]) },
    { name: 'assets/empty.bin', data: new Uint8Array(0) },
  ];
  const zip = buildZipStored(entries);
  const map = readZipMap(zip);
  assert.equal(map.size, entries.length);
  for (const e of entries) {
    const got = map.get(e.name);
    assert.ok(got !== undefined, 'missing ' + e.name);
    assert.deepEqual(Buffer.from(got).equals(Buffer.from(e.data)), true, 'mismatch ' + e.name);
  }
});

test('确定性输出（同输入同字节 → integrity 稳定）', () => {
  const entries: ZipEntryIn[] = [{ name: 'a.txt', data: new TextEncoder().encode('hello') }];
  const a = buildZipStored(entries);
  const b = buildZipStored(entries);
  assert.deepEqual(Buffer.from(a).equals(Buffer.from(b)), true);
});

test('重打包多次（多文件偏移正确）', () => {
  const entries: ZipEntryIn[] = Array.from({ length: 40 }, (_, i) => ({
    name: 'dir' + (i % 3) + '/file' + i + '.txt',
    data: new TextEncoder().encode('content-' + i),
  }));
  const map = readZipMap(buildZipStored(entries));
  assert.equal(map.size, 40);
  assert.equal(new TextDecoder().decode(map.get('dir2/file14.txt')), 'content-14');
});
