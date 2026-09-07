/**
 * 加密 zip 读取器（launcher）：传统 ZipCrypto + WinZip AES（AE-1/AE-2）。
 * 与 market/unzip.ts（无加密的最小读取器）并列：本模块先扫中央目录，
 * 无加密条目直接委托 readZipMap；有加密条目则逐条解密（密码流式只过内存）。
 *
 * ZipCrypto：12 字节加密头（末字节为校验字节）+ 数据，流密码三密钥。
 *   校验字节仅 8bit，弱判定；密码对错最终以解压后 CRC32 定论（AE-1 同理）。
 * WinZip AES（method 99）：extra 0x9901 给出强度（1/2/3 = 128/192/256）与真实方法；
 *   PBKDF2-HMAC-SHA1 1000 轮派生 加密钥+鉴权钥+2B 校验值；AES-CTR（计数器 LE 从 1 起）；
 *   尾部 10 字节 HMAC-SHA1(密文) 截断——AE-2 无 CRC，HMAC 是唯一密码/完整性判据。
 * 密码只作为函数参数存在，不落盘、不进任何记录。
 */
import { createCipheriv, createHmac, pbkdf2Sync } from 'node:crypto'
import { inflateRawSync } from 'node:zlib'
import { readZipMap, type ZipEntry } from '../market/unzip.ts'

/** 密码相关错误：code 供路由映射为 password_required / wrong_password。 */
export class CryptZipError extends Error {
  readonly code: 'password_required' | 'wrong_password'
  constructor(code: 'password_required' | 'wrong_password', msg: string) {
    super(msg)
    this.name = 'CryptZipError'
    this.code = code
  }
}

// ── CRC32（zlib 标准表，ZipCrypto 密钥演化与完整性校验共用）──────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = (c & 1) !== 0 ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
    t[n] = c >>> 0
  }
  return t
})()

function crc32Update(crc: number, byte: number): number {
  return (CRC_TABLE[(crc ^ byte) & 0xFF]! ^ (crc >>> 8)) >>> 0
}

function crc32Of(bytes: Uint8Array): number {
  let c = 0xFFFFFFFF
  for (let i = 0; i < bytes.length; i++) c = crc32Update(c, bytes[i]!)
  return (c ^ 0xFFFFFFFF) >>> 0
}

// ── ZipCrypto 流密码 ───────────────────────────────────────────────────

const CRC32_UPDATE = crc32Update
function zipCryptoStream(password: string, data: Uint8Array): Uint8Array {
  let key0 = 0x12345678
  let key1 = 0x23456789
  let key2 = 0x34567890
  const pw = Buffer.from(password, 'utf-8')
  const update = (b: number): void => {
    key0 = CRC32_UPDATE(key0, b)
    key1 = (key1 + (key0 & 0xFF)) >>> 0
    key1 = (Math.imul(key1, 134775813) + 1) >>> 0
    key2 = CRC32_UPDATE(key2, key1 >>> 24)
  }
  for (let i = 0; i < pw.length; i++) update(pw[i]!)
  const out = new Uint8Array(data.length)
  for (let i = 0; i < data.length; i++) {
    const temp = (key2 | 2) >>> 0
    const d = (data[i]! ^ ((Math.imul(temp, temp ^ 1) >>> 8) & 0xFF)) & 0xFF
    update(d)
    out[i] = d
  }
  return out
}

// ── 中央目录解析（本模块私有，含 flags/extra/本地头偏移）─────────────────

interface CdEntry {
  name: string
  flags: number
  method: number
  crc: number
  compSize: number
  localOff: number
  /** extra 0x9901（WinZip AES）解析结果；无则 null */
  aes: { version: number; strength: number; method: number } | null
}

const SIG_EOCD = 0x06054b50
const SIG_CD = 0x02014b50

/**
 * 定位 EOCD 并计算 concat 偏移。复合文件（视频+zip polyglot）在 zip 前垫了任意数据，
 * 中央目录的 cdOfs 是相对「zip 自身起点」的：真实位置 = cdOfs + concat，其中
 * concat = (EOCD 位置 - 中央目录总长) - cdOfs。从文件尾向前扫，逐候选校验 CD 签名。
 */
function locateEocd(bytes: Uint8Array): { eocd: number; total: number; concat: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const min = Math.max(0, bytes.length - 65557)
  for (let i = bytes.length - 22; i >= min; i--) {
    if (view.getUint32(i, true) !== SIG_EOCD) continue
    const total = view.getUint16(i + 10, true)
    const cdSize = view.getUint32(i + 12, true)
    const cdOfs = view.getUint32(i + 16, true)
    const actualCdStart = i - cdSize
    if (total === 0) return { eocd: i, total, concat: 0 } // 空包
    if (actualCdStart < 0 || actualCdStart + 4 > bytes.length) continue
    if (view.getUint32(actualCdStart, true) === SIG_CD) {
      return { eocd: i, total, concat: actualCdStart - cdOfs }
    }
  }
  return null
}

function parseCentralDirectory(bytes: Uint8Array): { entries: CdEntry[]; concat: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const loc = locateEocd(bytes)
  if (loc === null) throw new Error('不是合法 zip：找不到 EOCD')
  const { eocd, total, concat } = loc
  let p = eocd - view.getUint32(eocd + 12, true) // 真实中央目录起点（EOCD 紧随其后）
  const dec = new TextDecoder()
  const entries: CdEntry[] = []
  for (let n = 0; n < total; n++) {
    if (p < 0 || p + 46 > bytes.length || view.getUint32(p, true) !== SIG_CD) {
      throw new Error('中央目录签名错误 @' + p)
    }
    const flags = view.getUint16(p + 8, true)
    const method = view.getUint16(p + 10, true)
    const crc = view.getUint32(p + 16, true)
    const compSize = view.getUint32(p + 20, true)
    const nameLen = view.getUint16(p + 28, true)
    const extraLen = view.getUint16(p + 30, true)
    const commentLen = view.getUint16(p + 32, true)
    const localOff = view.getUint32(p + 42, true) + concat
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen))
    // extra 0x9901 解析（中央目录 extra 从 p+46+nameLen 开始）
    let aes: CdEntry['aes'] = null
    const extraStart = p + 46 + nameLen
    const extraEnd = extraStart + extraLen
    for (let q = extraStart; q + 4 <= extraEnd;) {
      const id = view.getUint16(q, true)
      const sz = view.getUint16(q + 2, true)
      if (id === 0x9901 && sz >= 7) {
        const ver = view.getUint16(q + 4, true)
        const strength = bytes[q + 8]!
        const realMethod = view.getUint16(q + 9, true)
        aes = { version: ver, strength, method: realMethod }
      }
      q += 4 + sz
    }
    entries.push({ name, flags, method, crc, compSize, localOff, aes })
    p = extraEnd + commentLen
  }
  return { entries, concat }
}

/** 尾部存在可解析的 zip 中央目录（含视频+zip 复合结构）→ true。 */
export function hasZipTrailer(bytes: Uint8Array): boolean {
  try { return locateEocd(bytes) !== null } catch { return false }
}

/** 任一条目带加密位（0x1）或 AES 方法（99）→ true。 */
export function zipNeedsPassword(bytes: Uint8Array): boolean {
  for (const e of parseCentralDirectory(bytes).entries) {
    if ((e.flags & 0x1) !== 0 || e.method === 99) return true
  }
  return false
}

// ── 解密实现 ───────────────────────────────────────────────────────────

function decryptZipCrypto(e: CdEntry, data: Uint8Array, password: string, lfhTime: number): { payload: Uint8Array } {
  if (data.length < 12) throw new CryptZipError('wrong_password', '加密数据过短')
  const plain = zipCryptoStream(password, data)
  // 校验字节：bit3(数据描述符) 置位时用本地头 modtime 高字节，否则用 CRC 高字节
  const check = (e.flags & 0x8) !== 0 ? (lfhTime >>> 8) & 0xFF : (e.crc >>> 24) & 0xFF
  if (plain[11] !== check) throw new CryptZipError('wrong_password', '密码错误（校验字节不符）')
  return { payload: plain.subarray(12) }
}

function decryptAes(e: CdEntry, data: Uint8Array, password: string): { payload: Uint8Array } {
  if (e.aes === null) throw new CryptZipError('wrong_password', 'AES 条目缺少 0x9901 extra')
  const bits = e.aes.strength === 1 ? 128 : e.aes.strength === 2 ? 192 : e.aes.strength === 3 ? 256 : 0
  if (bits === 0) throw new CryptZipError('wrong_password', `未知 AES 强度: ${e.aes.strength}`)
  const keyLen = bits / 8
  const saltLen = keyLen / 2
  if (data.length < saltLen + 2 + 10) throw new CryptZipError('wrong_password', 'AES 数据过短')
  const salt = data.subarray(0, saltLen)
  const pvHeader = data.subarray(saltLen, saltLen + 2)
  const cipherData = data.subarray(saltLen + 2, data.length - 10)
  const authFooter = data.subarray(data.length - 10)
  const derived = pbkdf2Sync(Buffer.from(password, 'utf-8'), Buffer.from(salt), 1000, keyLen * 2 + 2, 'sha1')
  const encKey = derived.subarray(0, keyLen)
  const authKey = derived.subarray(keyLen, keyLen * 2)
  const pvDerived = derived.subarray(keyLen * 2)
  if (pvDerived[0] !== pvHeader[0] || pvDerived[1] !== pvHeader[1]) {
    throw new CryptZipError('wrong_password', '密码错误（PV 校验不符）')
  }
  // HMAC-SHA1(密文) 前 10 字节比对 —— AE-2 无 CRC，这是唯一密码判据
  const mac = createHmac('sha1', Buffer.from(authKey)).update(Buffer.from(cipherData)).digest()
  for (let i = 0; i < 10; i++) {
    if (mac[i] !== authFooter[i]) throw new CryptZipError('wrong_password', '密码错误（HMAC 校验不符）')
  }
  // AES-CTR：计数器 LE 从 1 起（块 = 8 零字节 + LE64 计数），ECB 逐块造 keystream
  const cipher = createCipheriv(`aes-${bits}-ecb`, Buffer.from(encKey), null)
  cipher.setAutoPadding(false)
  const out = new Uint8Array(cipherData.length)
  const counter = new Uint8Array(16)
  for (let off = 0; off < cipherData.length; off += 16) {
    const ctr = BigInt(Math.floor(off / 16) + 1)
    for (let i = 0; i < 8; i++) counter[i] = 0
    for (let i = 0; i < 8; i++) counter[8 + i] = Number((ctr >> BigInt(i * 8)) & 0xFFn)
    const ks = cipher.update(Buffer.from(counter))
    for (let i = 0; off + i < cipherData.length && i < 16; i++) {
      out[off + i] = cipherData[off + i]! ^ ks[i]!
    }
  }
  return { payload: out }
}

/** 单条加密条目 → 原始（未压缩）内容，含 CRC 校验（AE-2 除外）。 */
function decryptEntry(e: CdEntry, bytes: Uint8Array, password: string): Uint8Array {
  // 本地头：取 modtime（ZipCrypto bit3 校验用）与本地名/extra 长度（定位数据）
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const lo = e.localOff
  const lfhNameLen = view.getUint16(lo + 26, true)
  const lfhExtraLen = view.getUint16(lo + 28, true)
  const lfhTime = view.getUint16(lo + 10, true)
  const dataStart = lo + 30 + lfhNameLen + lfhExtraLen
  const data = bytes.subarray(dataStart, dataStart + e.compSize)
  let raw: Uint8Array
  if (e.aes !== null || e.method === 99) {
    raw = decryptAes(e, data, password).payload
  } else {
    raw = decryptZipCrypto(e, data, password, lfhTime).payload
  }
  let payload: Uint8Array
  const realMethod = e.aes !== null ? e.aes.method : e.method
  if (realMethod === 0) {
    payload = raw.slice()
  } else if (realMethod === 8) {
    payload = new Uint8Array(inflateRawSync(Buffer.from(raw)))
  } else {
    throw new CryptZipError('wrong_password', `不支持的压缩方法 ${realMethod}: ${e.name}`)
  }
  // CRC 终判（AE-2 中央 CRC 恒 0，跳过）
  if (!(e.aes !== null && e.aes.version >= 2)) {
    if (crc32Of(payload) !== e.crc) throw new CryptZipError('wrong_password', '密码错误或文件已损坏（CRC 不符）')
  }
  return payload
}

/**
 * 打开 zip：普通包（无加密无前置数据）→ 委托 market/unzip 的 readZipMap；
 * 加密包 → 必须给密码（缺 → password_required），逐条解密；
 * 复合包（视频+zip，concat≠0）即使无加密也走自有解析（readZipMap 不认偏移）。
 */
export function openZipMap(bytes: Uint8Array, password?: string): Map<string, Uint8Array> {
  const { entries, concat } = parseCentralDirectory(bytes)
  const encrypted = entries.filter((e) => (e.flags & 0x1) !== 0 || e.method === 99)
  if (encrypted.length === 0 && concat === 0) return readZipMap(bytes)
  const pwd = password ?? ''
  if (encrypted.length > 0 && pwd === '') {
    throw new CryptZipError('password_required', '压缩包已加密，需要解压密码')
  }
  const map = new Map<string, Uint8Array>()
  for (const e of entries) {
    if (e.name.endsWith('/')) continue
    if ((e.flags & 0x1) !== 0 || e.method === 99) {
      map.set(e.name, decryptEntry(e, bytes, pwd))
    } else {
      // 混合包里的未加密条目走普通路径（直接复用 readZipMap 的结果语义太重，单独解）
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      const lo = e.localOff
      const lfhNameLen = view.getUint16(lo + 26, true)
      const lfhExtraLen = view.getUint16(lo + 28, true)
      const dataStart = lo + 30 + lfhNameLen + lfhExtraLen
      const data = bytes.subarray(dataStart, dataStart + e.compSize)
      let payload: Uint8Array
      if (e.method === 0) payload = data.slice()
      else if (e.method === 8) payload = new Uint8Array(inflateRawSync(Buffer.from(data)))
      else throw new CryptZipError('wrong_password', `不支持的压缩方法 ${e.method}: ${e.name}`)
      map.set(e.name, payload)
    }
  }
  return map
}

export type { ZipEntry }
