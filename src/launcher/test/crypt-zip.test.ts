import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createCipheriv, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto'
import { deflateRawSync } from 'node:zlib'
import { openZipMap, zipNeedsPassword, CryptZipError, hasZipTrailer } from '../crypt-zip.ts'

const enc = (s: string): Uint8Array => new TextEncoder().encode(s)

// ── CRC32（与 crypt-zip 内部实现独立同构，做交叉验证）────────────────────
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })()
function crc32(b: Uint8Array): number { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0 }

// ── ZipCrypto 加密侧（测试夹具）────────────────────────────────────────
function zipCryptoEncrypt(password: string, plain: Uint8Array, checkByte: number): Uint8Array {
  let key0 = 0x12345678, key1 = 0x23456789, key2 = 0x34567890
  const upd = (b: number): void => {
    key0 = CRC[(key0 ^ b) & 0xFF]! ^ (key0 >>> 8)
    key1 = (key1 + (key0 & 0xFF)) >>> 0
    key1 = (Math.imul(key1, 134775813) + 1) >>> 0
    key2 = CRC[(key2 ^ (key1 >>> 24)) & 0xFF]! ^ (key2 >>> 8)
  }
  const pw = Buffer.from(password, 'utf-8')
  for (let i = 0; i < pw.length; i++) upd(pw[i]!)
  // 12 字节头：11 随机 + 1 校验字节
  const header = new Uint8Array(12)
  randomBytes(11).forEach((b, i) => { header[i] = b })
  header[11] = checkByte
  const out = new Uint8Array(12 + plain.length)
  for (let i = 0; i < 12; i++) {
    const temp = (key2 | 2) >>> 0
    const ks = ((Math.imul(temp, temp ^ 1) >>> 8) & 0xFF)
    const c = header[i]! ^ ks
    out[i] = c
    upd(header[i]!)
  }
  for (let i = 0; i < plain.length; i++) {
    const temp = (key2 | 2) >>> 0
    const ks = ((Math.imul(temp, temp ^ 1) >>> 8) & 0xFF)
    const c = plain[i]! ^ ks
    out[12 + i] = c
    upd(plain[i]!)
  }
  return out
}

// ── WinZip AES 加密侧（AE-1/AE-2，测试夹具）────────────────────────────
function aesEncrypt(password: string, plain: Uint8Array, strength: 1 | 3): { stored: Uint8Array, extra: Uint8Array } {
  const keyLen = strength === 1 ? 16 : 32
  const saltLen = keyLen / 2
  const salt = new Uint8Array(randomBytes(saltLen))
  const derived = pbkdf2Sync(Buffer.from(password, 'utf-8'), Buffer.from(salt), 1000, keyLen * 2 + 2, 'sha1')
  const encKey = derived.subarray(0, keyLen)
  const authKey = derived.subarray(keyLen, keyLen * 2)
  const pv = derived.subarray(keyLen * 2)
  // AES-CTR keystream：计数器块 = 8 零字节 + LE64（从 1 起）；加密 = 明文 XOR keystream
  const cipher = createCipheriv(strength === 1 ? 'aes-128-ecb' : 'aes-256-ecb', encKey, null)
  cipher.setAutoPadding(false)
  const out = new Uint8Array(plain.length)
  const counter = Buffer.alloc(16)
  for (let off = 0; off < plain.length; off += 16) {
    const ctr = BigInt(Math.floor(off / 16) + 1)
    for (let i = 0; i < 8; i++) counter[8 + i] = Number((ctr >> BigInt(i * 8)) & 0xFFn)
    const ks = cipher.update(counter)
    for (let i = 0; off + i < plain.length && i < 16; i++) out[off + i] = plain[off + i]! ^ ks[i]!
  }
  const mac = createHmac('sha1', authKey).update(Buffer.from(out)).digest()
  const stored = new Uint8Array(saltLen + 2 + out.length + 10)
  stored.set(salt, 0)
  stored.set(pv, saltLen)
  stored.set(out, saltLen + 2)
  stored.set(mac.subarray(0, 10), saltLen + 2 + out.length)
  // 0x9901 extra 载荷（紧随 id+size）：version(2) vendor(2) strength(1) method(2)
  const extra = new Uint8Array(2 + 2 + 7)
  const ev = new DataView(extra.buffer)
  ev.setUint16(0, 0x9901, true)
  ev.setUint16(2, 7, true)
  ev.setUint16(4, strength === 1 ? 0x0001 : 0x0003, true) // AE-1 取 1
  extra[6] = 0x41; extra[7] = 0x45                         // vendor 'AE'
  extra[8] = strength === 1 ? 1 : 3                        // strength
  ev.setUint16(9, 8, true)                                 // 真实方法 deflate
  return { stored, extra }
}

interface RawEntry {
  name: string
  stored: Uint8Array      // 本地头之后的完整数据（已压缩/已加密）
  method: number
  crc: number
  uncompSize: number
  flags: number
  time?: number
  extra?: Uint8Array      // 中央目录 + 本地头都写入
}

function buildZipRaw(entries: RawEntry[]): Uint8Array {
  const parts: Uint8Array[] = []; const cds: Uint8Array[] = []; let off = 0
  for (const f of entries) {
    const nb = new TextEncoder().encode(f.name)
    const fextra = f.extra ?? new Uint8Array(0)
    const lfh = new Uint8Array(30); const lv = new DataView(lfh.buffer)
    // 本地头布局：sig0 ver4 flags6 method8 time10 date12 crc14 compSize18 uncompSize22 nameLen26 extraLen28
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, f.flags, true)
    lv.setUint16(8, f.method, true); lv.setUint16(10, f.time ?? 0x6000, true)
    lv.setUint32(14, f.crc, true); lv.setUint32(18, f.stored.length, true); lv.setUint32(22, f.uncompSize, true)
    lv.setUint16(26, nb.length, true); lv.setUint16(28, fextra.length, true)
    parts.push(lfh, nb, fextra, f.stored)
    const cdh = new Uint8Array(46); const cv = new DataView(cdh.buffer)
    // 中央目录布局：sig0 madeBy4 needVer6 flags8 method10 time12 date14 crc16 compSize20 uncompSize24
    //               nameLen28 extraLen30 commentLen32 disk34 intAttr36 extAttr38 localOff42
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true)
    cv.setUint16(8, f.flags, true); cv.setUint16(10, f.method, true); cv.setUint16(12, f.time ?? 0x6000, true)
    cv.setUint32(16, f.crc, true); cv.setUint32(20, f.stored.length, true); cv.setUint32(24, f.uncompSize, true)
    cv.setUint16(28, nb.length, true); cv.setUint16(30, fextra.length, true); cv.setUint32(42, off, true)
    cds.push(new Uint8Array(Buffer.concat([Buffer.from(cdh), Buffer.from(nb), Buffer.from(fextra)])))
    off += lfh.length + nb.length + fextra.length + f.stored.length
  }
  const cd = new Uint8Array(Buffer.concat(cds.map(Buffer.from)))
  const eocd = new Uint8Array(22); const ev = new DataView(eocd.buffer)
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, entries.length, true); ev.setUint16(10, entries.length, true)
  ev.setUint32(12, cd.length, true); ev.setUint32(16, off, true)
  return new Uint8Array(Buffer.concat([...parts, cd, eocd].map(Buffer.from)))
}

const PW = 'password123'

// ── ZipCrypto ──────────────────────────────────────────────────────────

test('ZipCrypto stored：正确密码解出原文', () => {
  const plain = enc('hello encrypted world')
  const check = (crc32(plain) >>> 24) & 0xFF
  const zip = buildZipRaw([{
    name: 'a.txt', stored: zipCryptoEncrypt(PW, plain, check), method: 0,
    crc: crc32(plain), uncompSize: plain.length, flags: 0x1,
  }])
  assert.equal(zipNeedsPassword(zip), true)
  const map = openZipMap(zip, PW)
  assert.equal(new TextDecoder().decode(map.get('a.txt')!), 'hello encrypted world')
})

test('ZipCrypto deflate：正确密码解出原文', () => {
  const plain = enc('x'.repeat(3000))
  const comp = new Uint8Array(deflateRawSync(Buffer.from(plain)))
  const check = (crc32(plain) >>> 24) & 0xFF
  const zip = buildZipRaw([{
    name: 'big.bin', stored: zipCryptoEncrypt(PW, comp, check), method: 8,
    crc: crc32(plain), uncompSize: plain.length, flags: 0x1,
  }])
  const map = openZipMap(zip, PW)
  assert.equal(map.get('big.bin')!.length, 3000)
})

test('ZipCrypto：错误密码 → wrong_password（校验字节不符）', () => {
  const plain = enc('secret')
  const check = (crc32(plain) >>> 24) & 0xFF
  const zip = buildZipRaw([{
    name: 'a.txt', stored: zipCryptoEncrypt(PW, plain, check), method: 0,
    crc: crc32(plain), uncompSize: plain.length, flags: 0x1,
  }])
  assert.throws(() => openZipMap(zip, 'wrong'), (e: unknown) => e instanceof CryptZipError && e.code === 'wrong_password')
})

test('ZipCrypto：缺密码 → password_required', () => {
  const plain = enc('secret')
  const check = (crc32(plain) >>> 24) & 0xFF
  const zip = buildZipRaw([{
    name: 'a.txt', stored: zipCryptoEncrypt(PW, plain, check), method: 0,
    crc: crc32(plain), uncompSize: plain.length, flags: 0x1,
  }])
  assert.throws(() => openZipMap(zip), (e: unknown) => e instanceof CryptZipError && e.code === 'password_required')
})

// ── WinZip AES ─────────────────────────────────────────────────────────

test('AES-256 AE-1（deflate）：正确密码解出原文 + CRC 通过', () => {
  const plain = enc('y'.repeat(1000))
  const comp = new Uint8Array(deflateRawSync(Buffer.from(plain)))
  const { stored, extra } = aesEncrypt(PW, comp, 3)
  const zip = buildZipRaw([{
    name: 'data.bin', stored, method: 99, crc: crc32(plain), uncompSize: plain.length, flags: 0x1, extra,
  }])
  assert.equal(zipNeedsPassword(zip), true)
  const map = openZipMap(zip, PW)
  assert.deepEqual(map.get('data.bin'), plain)
})

test('AES-128 AE-2（deflate，CRC=0）：HMAC 作为唯一密码判据', () => {
  const plain = enc('ae2 payload')
  const comp = new Uint8Array(deflateRawSync(Buffer.from(plain)))
  const { stored, extra } = aesEncrypt(PW, comp, 1)
  // AE-2：vendor version >= 2 → CRC 校验跳过；中央 CRC 写 0
  const extra2 = extra.slice()
  const ev = new DataView(extra2.buffer)
  ev.setUint16(4, 0x0002, true)
  const zip = buildZipRaw([{
    name: 'ae2.bin', stored, method: 99, crc: 0, uncompSize: plain.length, flags: 0x1, extra: extra2,
  }])
  const map = openZipMap(zip, PW)
  assert.equal(new TextDecoder().decode(map.get('ae2.bin')!), 'ae2 payload')
})

test('AES：错误密码 → wrong_password（HMAC 不符）', () => {
  const plain = enc('y'.repeat(64))
  const { stored, extra } = aesEncrypt(PW, plain, 3)
  const zip = buildZipRaw([{
    name: 'data.bin', stored, method: 99, crc: crc32(plain), uncompSize: plain.length, flags: 0x1, extra,
  }])
  assert.throws(() => openZipMap(zip, 'nope'), (e: unknown) => e instanceof CryptZipError && e.code === 'wrong_password')
})

test('AES：缺密码 → password_required', () => {
  const plain = enc('y'.repeat(64))
  const { stored, extra } = aesEncrypt(PW, plain, 3)
  const zip = buildZipRaw([{
    name: 'data.bin', stored, method: 99, crc: crc32(plain), uncompSize: plain.length, flags: 0x1, extra,
  }])
  assert.throws(() => openZipMap(zip), (e: unknown) => e instanceof CryptZipError && e.code === 'password_required')
})

// ── 混合包与未加密委托 ─────────────────────────────────────────────────

test('混合包：加密 + 明文条目并存，一次全解', () => {
  const plain1 = enc('locked')
  const check = (crc32(plain1) >>> 24) & 0xFF
  const zip = buildZipRaw([
    { name: 'locked.txt', stored: zipCryptoEncrypt(PW, plain1, check), method: 0, crc: crc32(plain1), uncompSize: plain1.length, flags: 0x1 },
    { name: 'open.txt', stored: enc('open'), method: 0, crc: crc32(enc('open')), uncompSize: 4, flags: 0 },
  ])
  const map = openZipMap(zip, PW)
  assert.equal(new TextDecoder().decode(map.get('locked.txt')!), 'locked')
  assert.equal(new TextDecoder().decode(map.get('open.txt')!), 'open')
})

test('未加密 zip：委托 readZipMap 正常读取', () => {
  const plain = enc('plain zip entry')
  const zip = buildZipRaw([{ name: 'p.txt', stored: plain, method: 0, crc: crc32(plain), uncompSize: plain.length, flags: 0 }])
  assert.equal(zipNeedsPassword(zip), false)
  const map = openZipMap(zip)
  assert.equal(new TextDecoder().decode(map.get('p.txt')!), 'plain zip entry')
})

// ── 复合文件（视频+zip polyglot）：zip 数据垫在媒体数据后 ──────────────

test('复合文件：尾部 zip 识别 + concat 偏移修正（真实场景：MP4 垫底内含 7z）', () => {
  const media = randomBytes(1024) // 模拟 1KB 媒体数据（MP4 头部等）
  const plain = enc('7z-payload-simulated')
  // 内层条目：方法 0 stored（模拟未压缩的 .7z 附件）
  const inner = buildZipRaw([{ name: 'FS-DS.7z', stored: plain, method: 0, crc: crc32(plain), uncompSize: plain.length, flags: 0 }])
  // polyglot：媒体数据 + 完整 zip
  const poly = new Uint8Array(Buffer.concat([Buffer.from(media), Buffer.from(inner)]))
  // 头两个字节不是 PK（媒体数据开头），扩展名也不是 .zip —— 靠尾部 EOCD 识别
  assert.equal(poly[0] === 0x50 && poly[1] === 0x4B, false)
  assert.equal(hasZipTrailer(poly), true)
  const map = openZipMap(poly)
  assert.equal(new TextDecoder().decode(map.get('FS-DS.7z')!), '7z-payload-simulated')
  // 加密复合包：需要密码
  const plain1 = enc('secret-inner')
  const check = (crc32(plain1) >>> 24) & 0xFF
  const innerEnc = buildZipRaw([{ name: 'inner.bin', stored: zipCryptoEncrypt(PW, plain1, check), method: 0, crc: crc32(plain1), uncompSize: plain1.length, flags: 0x1 }])
  const polyEnc = new Uint8Array(Buffer.concat([Buffer.from(media), Buffer.from(innerEnc)]))
  assert.equal(hasZipTrailer(polyEnc), true)
  assert.equal(zipNeedsPassword(polyEnc), true)
  assert.throws(() => openZipMap(polyEnc), (e: unknown) => e instanceof CryptZipError && e.code === 'password_required')
  const map2 = openZipMap(polyEnc, PW)
  assert.equal(new TextDecoder().decode(map2.get('inner.bin')!), 'secret-inner')
})

test('复合文件：EOCD 魔数撞库不误判（媒体数据里随机出现 PK\x05\x06 但无中央目录）', () => {
  // 构造：媒体数据尾部恰好含 EOCD 魔数，但其 cdOfs 指向处不是 CD 签名 → locateEocd 应继续向前找到真 EOCD 或返回 false
  const fakeEocd = new Uint8Array(22)
  const fv = new DataView(fakeEocd.buffer)
  fv.setUint32(0, 0x06054b50, true)
  fv.setUint16(10, 1, true) // total=1
  fv.setUint32(12, 100, true) // cdSize
  fv.setUint32(16, 999999, true) // cdOfs 指向不存在的位置
  const junk = new Uint8Array(Buffer.concat([Buffer.from(randomBytes(512)), Buffer.from(fakeEocd)]))
  assert.equal(hasZipTrailer(junk), false)
})
