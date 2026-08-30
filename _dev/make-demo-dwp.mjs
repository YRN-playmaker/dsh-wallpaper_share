// 零依赖 stored-zip 打包器：把一组 {name, data} 打成一个合法 .dwp（zip，无压缩）。
// 仅用于生成 demo 包；正式打包工具随 R5 编辑器落地。
// 用法： node _dev/make-demo-dwp.mjs <out.dwp> <file1:arcname1> <file2:arcname2> ...
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

// CRC32（zip 多项式 0xEDB88320）
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }

function buildZip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;
  const DOS_TIME = 0, DOS_DATE = 0x21; // 1980-01-01
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0); lfh.writeUInt16LE(20, 4); lfh.writeUInt16LE(0, 6); lfh.writeUInt16LE(0, 8);
    lfh.writeUInt16LE(DOS_TIME, 10); lfh.writeUInt16LE(DOS_DATE, 12); lfh.writeUInt32LE(crc, 14);
    lfh.writeUInt32LE(data.length, 18); lfh.writeUInt32LE(data.length, 22); lfh.writeUInt16LE(nameBuf.length, 26); lfh.writeUInt16LE(0, 28);
    chunks.push(lfh, nameBuf, data);
    const cdh = Buffer.alloc(46);
    cdh.writeUInt32LE(0x02014b50, 0); cdh.writeUInt16LE(20, 4); cdh.writeUInt16LE(20, 6); cdh.writeUInt16LE(0, 8); cdh.writeUInt16LE(0, 10);
    cdh.writeUInt16LE(DOS_TIME, 12); cdh.writeUInt16LE(DOS_DATE, 14); cdh.writeUInt32LE(crc, 16);
    cdh.writeUInt32LE(data.length, 20); cdh.writeUInt32LE(data.length, 24); cdh.writeUInt16LE(nameBuf.length, 28);
    cdh.writeUInt16LE(0, 30); cdh.writeUInt16LE(0, 32); cdh.writeUInt16LE(0, 34); cdh.writeUInt16LE(0, 36); cdh.writeUInt32LE(0, 38);
    cdh.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([cdh, nameBuf]));
    offset += lfh.length + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(0, 4); eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16); eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...chunks, cd, eocd]);
}

const [, , out, ...maps] = process.argv;
const entries = maps.map((m) => { const [path, arc] = m.split(':'); return { name: arc || path, data: readFileSync(path) }; });
const zip = buildZip(entries);
writeFileSync(out, zip);
const integrity = 'sha512-' + createHash('sha512').update(zip).digest('base64');
console.log(JSON.stringify({ out, size: zip.length, integrity }));
