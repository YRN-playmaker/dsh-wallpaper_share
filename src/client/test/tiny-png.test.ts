import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { TINY_PNG_BASE64 } from '../tiny-png.ts';

const bytes = new Uint8Array(Buffer.from(TINY_PNG_BASE64, 'base64'));

// zip/PNG 共用多项式 0xEDB88320
const CRC_T = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) !== 0 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 }
  return t;
})();
const crc32 = (b: Uint8Array): number => {
  let c = 0xFFFFFFFF;
  for (const x of b) c = CRC_T[(c ^ x) & 0xFF]! ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
};

interface Chunk { type: string; data: Uint8Array; crcOk: boolean }
function chunksOf(b: Uint8Array): Chunk[] {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const out: Chunk[] = [];
  let off = 8;
  while (off + 12 <= b.length) {
    const len = dv.getUint32(off);
    const type = String.fromCharCode(b[off + 4]!, b[off + 5]!, b[off + 6]!, b[off + 7]!);
    const data = b.subarray(off + 8, off + 8 + len);
    const crc = dv.getUint32(off + 8 + len);
    out.push({ type, data, crcOk: crc === crc32(b.subarray(off + 4, off + 8 + len)) });
    if (type === 'IEND') break;
    off += 12 + len;
  }
  return out;
}

test('占位 PNG：签名 / 块序列 / CRC 全部合法', () => {
  assert.deepEqual([...bytes.subarray(0, 8)], [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A], 'PNG 签名');
  const chunks = chunksOf(bytes);
  assert.deepEqual(chunks.map((c) => c.type), ['IHDR', 'IDAT', 'IEND']);
  for (const c of chunks) assert.equal(c.crcOk, true, c.type + ' 的 CRC 必须正确');
});

test('占位 PNG：1×1 / 8bit / RGBA / 非交错', () => {
  const ihdr = chunksOf(bytes)[0]!.data;
  const dv = new DataView(ihdr.buffer, ihdr.byteOffset, ihdr.byteLength);
  assert.equal(dv.getUint32(0), 1, '宽');
  assert.equal(dv.getUint32(4), 1, '高');
  assert.equal(ihdr[8], 8, '位深');
  assert.equal(ihdr[9], 6, '颜色类型 = RGBA');
  assert.equal(ihdr[12], 0, '非交错');
});

test('占位 PNG：IDAT 能解压且是「filter 0 + 全透明 RGBA」', () => {
  const idat = chunksOf(bytes).find((c) => c.type === 'IDAT')!;
  const raw = new Uint8Array(inflateSync(idat.data));
  assert.equal(raw.length, 5, '1×1 RGBA 解压后 = 1 字节 filter + 4 字节像素');
  assert.equal(raw[0], 0, 'filter 类型 0');
  assert.deepEqual([...raw.subarray(1)], [0, 0, 0, 0], '完全透明');
});
