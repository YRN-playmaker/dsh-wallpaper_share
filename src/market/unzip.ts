/**
 * 最小 zip 读取器（R4 渲染面）：解析 .dwp（zip）中央目录，抽出各条目字节。
 * 支持 stored(0) 与 deflate(8)（deflate 用 node:zlib inflateRawSync）。
 * 与 make-demo-dwp.mjs 的 stored 写入器配对；真实包多用 deflate，两者都覆盖。
 * 纯函数，Node 可测。
 */
import { inflateRawSync } from 'node:zlib';

export interface ZipEntry { name: string; data: Uint8Array }

const SIG_EOCD = 0x06054b50;
const SIG_CD = 0x02014b50;
const SIG_LFH = 0x04034b50;

/** 从 zip 字节读出全部条目（目录项以 / 结尾，跳过）。 */
export function readZip(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // 反向找 EOCD（尾部 22..65557 字节窗口）
  let eocd = -1;
  const min = Math.max(0, bytes.length - 65557);
  for (let i = bytes.length - 22; i >= min; i--) {
    if (view.getUint32(i, true) === SIG_EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('不是合法 zip：找不到 EOCD');
  const total = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true); // cd offset

  const entries: ZipEntry[] = [];
  for (let n = 0; n < total; n++) {
    if (view.getUint32(p, true) !== SIG_CD) throw new Error('中央目录签名错误 @' + p);
    const method = view.getUint16(p + 10, true);
    const compSize = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOff = view.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue; // 目录项

    // 定位本地头，数据偏移 = localOff + 30 + lfhNameLen + lfhExtraLen
    if (view.getUint32(localOff, true) !== SIG_LFH) throw new Error('本地头签名错误 @' + localOff);
    const lfhNameLen = view.getUint16(localOff + 26, true);
    const lfhExtraLen = view.getUint16(localOff + 28, true);
    const dataStart = localOff + 30 + lfhNameLen + lfhExtraLen;
    const raw = bytes.subarray(dataStart, dataStart + compSize);
    let data: Uint8Array;
    if (method === 0) data = raw.slice();
    else if (method === 8) data = new Uint8Array(inflateRawSync(Buffer.from(raw)));
    else throw new Error(`不支持的压缩方法 ${method}: ${name}`);
    entries.push({ name, data });
  }
  return entries;
}

/** 条目名 → 字节 的 Map（重名后者覆盖前者）。 */
export function readZipMap(bytes: Uint8Array): Map<string, Uint8Array> {
  const m = new Map<string, Uint8Array>();
  for (const e of readZip(bytes)) m.set(e.name, e.data);
  return m;
}
