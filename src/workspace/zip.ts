/**
 * 最小 zip 写入器（stored 无压缩）：把一组 {name, data} 打成合法 .dwp（zip）。
 * 与 src/market/unzip.ts 的读取器配对（本地包用它解包）；纯函数，Node 可测。
 * 结构与 _dev/make-demo-dwp.mjs 的打包器同源，这里收进 src 供插件运行期内置包复用。
 */

// CRC32（zip 多项式 0xEDB88320）
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 }
  return t
})()

function crc32(buf: Uint8Array): number {
  let c = 0xFFFFFFFF
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]!) & 0xFF]! ^ (c >>> 8)
  return (c ^ 0xFFFFFFFF) >>> 0
}

export interface ZipEntryIn { name: string; data: Uint8Array }

/** 打包（stored）：LFH + 数据 + 中央目录 + EOCD；时间戳固定 1980（确定性输出 → integrity 稳定）。 */
export function buildZipStored(entries: ZipEntryIn[]): Uint8Array {
  const chunks: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  const DOS_TIME = 0, DOS_DATE = 0x21 // 1980-01-01
  for (const { name, data } of entries) {
    const nameBuf = new TextEncoder().encode(name)
    const crc = crc32(data)
    const lfh = new Uint8Array(30)
    const lv = new DataView(lfh.buffer)
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0, true); lv.setUint16(8, 0, true)
    lv.setUint16(10, DOS_TIME, true); lv.setUint16(12, DOS_DATE, true); lv.setUint32(14, crc, true)
    lv.setUint32(18, data.length, true); lv.setUint32(22, data.length, true); lv.setUint16(26, nameBuf.length, true); lv.setUint16(28, 0, true)
    chunks.push(lfh, nameBuf, data)
    const cdh = new Uint8Array(46)
    const cv = new DataView(cdh.buffer)
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0, true); cv.setUint16(10, 0, true)
    cv.setUint16(12, DOS_TIME, true); cv.setUint16(14, DOS_DATE, true); cv.setUint32(16, crc, true)
    cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true); cv.setUint16(28, nameBuf.length, true)
    cv.setUint16(30, 0, true); cv.setUint16(32, 0, true); cv.setUint16(34, 0, true); cv.setUint16(36, 0, true); cv.setUint32(38, 0, true)
    cv.setUint32(42, offset, true)
    central.push(new Uint8Array(Buffer.concat([Buffer.from(cdh), Buffer.from(nameBuf)])))
    offset += lfh.length + nameBuf.length + data.length
  }
  const cd = new Uint8Array(Buffer.concat(central))
  const eocd = new Uint8Array(22)
  const ev = new DataView(eocd.buffer)
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(4, 0, true); ev.setUint16(6, 0, true)
  ev.setUint16(8, entries.length, true); ev.setUint16(10, entries.length, true)
  ev.setUint32(12, cd.length, true); ev.setUint32(16, offset, true); ev.setUint16(20, 0, true)
  return new Uint8Array(Buffer.concat([...chunks, cd, eocd]))
}
