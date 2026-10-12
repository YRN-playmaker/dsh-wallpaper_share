import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, readFileSync, rmSync, mkdirSync, statSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { crc32 } from 'node:zlib'
import { LauncherInstaller, type FetchLike } from '../installer.ts'
import { integrityOf } from '../../market/integrity.ts'

function response(body: AsyncIterable<Uint8Array> | ReadableStream<Uint8Array>, headers: Record<string, string> = {}, status = 200): FetchLike {
  return { ok: true, status, body, headers: { get: (name) => headers[name] ?? null } }
}

test('流下载：逐块写盘并计算哈希，缺 Content-Length 也不读整包', async () => {
  const root = mkdtempSync(join(tmpdir(), 'we-stream-'))
  const chunks = [Buffer.from('first'), Buffer.alloc(1024 * 1024, 7), Buffer.from('last')]
  const installer = new LauncherInstaller({ root, fetchFn: async () => response((async function* () { yield* chunks })()) })
  try {
    const dl = await installer.download('https://example.com/app.exe')
    assert.equal(dl.size, chunks.reduce((sum, c) => sum + c.length, 0))
    assert.equal(dl.sha512, integrityOf(Buffer.concat(chunks)))
    assert.deepEqual(readFileSync(dl.path), Buffer.concat(chunks))
    dl.cleanup()
    assert.deepEqual(readdirSync(root), [])
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('流下载：断流、空响应和截断都清理临时文件', async () => {
  const root = mkdtempSync(join(tmpdir(), 'we-stream-fail-'))
  const cases: Array<[FetchLike, RegExp]> = [
    [response((async function* () { yield Buffer.from('partial'); throw new Error('ECONNRESET') })()), /下载中断.*ECONNRESET/],
    [response((async function* () {})()), /内容为空/],
    [response((async function* () { yield Buffer.from('short') })(), { 'content-length': '10' }), /下载不完整/],
    [response((async function* () { yield Buffer.from('part') })(), { 'content-range': 'bytes 0-3/10' }, 206), /部分文件/],
  ]
  try {
    for (const [res, pattern] of cases) {
      const installer = new LauncherInstaller({ root, fetchFn: async () => res })
      await assert.rejects(installer.download('https://example.com/app.exe'), pattern)
      assert.deepEqual(readdirSync(root), [])
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('流下载：声明超限立即取消网络流；压缩传输按实收大小处理', async () => {
  const root = mkdtempSync(join(tmpdir(), 'we-stream-cap-'))
  let cancelled = false
  try {
    const body = new ReadableStream<Uint8Array>({ cancel() { cancelled = true } })
    const installer = new LauncherInstaller({ root, fetchFn: async () => response(body, { 'content-length': String(64 * 1024 ** 3 + 1) }) })
    await assert.rejects(installer.download('https://example.com/app.exe'), /大小上限/)
    assert.equal(cancelled, true)
    assert.deepEqual(readdirSync(root), [])
    installer.fetchFn = async () => response((async function* () { yield Buffer.alloc(10) })(), { 'content-length': '5', 'content-encoding': 'gzip' })
    const dl = await installer.download('https://example.com/app.exe')
    assert.equal(dl.size, 10)
    dl.cleanup()
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('文件识别：跨 1 MiB 边界的 7z 签名和段复制不会漏字节', async () => {
  const root = mkdtempSync(join(tmpdir(), 'we-stream-sig-'))
  const path = join(root, 'media.bin')
  const offset = 1024 + 1024 * 1024 - 3
  const signature = Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])
  const data = Buffer.concat([Buffer.alloc(offset), signature, Buffer.from('archive')])
  writeFileSync(path, data)
  const installer = new LauncherInstaller({ root })
  try {
    assert.equal((await installer.inspectFile(path)).sevenZipOffset, offset)
    const dest = join(root, 'output')
    installer.extractArchiveFile = async (archive) => {
      assert.deepEqual(readFileSync(archive), data.subarray(offset))
      return ['app.exe']
    }
    assert.deepEqual(await installer.unpackFile(path, dest, 'video.mp4'), ['app.exe'])
    assert.deepEqual(readdirSync(root), ['media.bin'])
  } finally { rmSync(root, { recursive: true, force: true }) }
})

// 可重复压力验证：WESYNC_LARGE_DOWNLOAD_TEST=1，配合 --max-old-space-size=96。
test('实际 HTTP 5 GiB ZIP64 下载 + 磁盘解压：内存不随文件大小增长', { skip: process.env.WESYNC_LARGE_DOWNLOAD_TEST !== '1', timeout: 300000 }, async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'we-stream-5g-'))
  const installer = new LauncherInstaller({ root })
  if (!installer.resolveSevenZip() && !installer.resolveBandizip()) {
    rmSync(root, { recursive: true, force: true })
    t.skip('需要本机外部解压器')
    return
  }
  const chunk = Buffer.alloc(1024 * 1024, 0x61)
  const count = 5120
  const unpacked = chunk.length * count
  let crc = 0
  for (let i = 0; i < count; i++) crc = crc32(chunk, crc)
  const name = Buffer.from('wrapper/app.exe')
  const extra = Buffer.alloc(20)
  extra.writeUInt16LE(1, 0) // ZIP64 extended information
  extra.writeUInt16LE(16, 2)
  extra.writeBigUInt64LE(BigInt(unpacked), 4)
  extra.writeBigUInt64LE(BigInt(unpacked), 12)
  const local = Buffer.alloc(30 + name.length + extra.length)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(45, 4)
  local.writeUInt32LE(crc, 14)
  local.writeUInt32LE(0xffffffff, 18)
  local.writeUInt32LE(0xffffffff, 22)
  local.writeUInt16LE(name.length, 26)
  local.writeUInt16LE(extra.length, 28)
  name.copy(local, 30)
  extra.copy(local, 30 + name.length)
  const central = Buffer.alloc(46 + name.length + extra.length)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt16LE(45, 4)
  central.writeUInt16LE(45, 6)
  central.writeUInt32LE(crc, 16)
  central.writeUInt32LE(0xffffffff, 20)
  central.writeUInt32LE(0xffffffff, 24)
  central.writeUInt16LE(name.length, 28)
  central.writeUInt16LE(extra.length, 30)
  name.copy(central, 46)
  extra.copy(central, 46 + name.length)
  const zip64End = Buffer.alloc(56)
  zip64End.writeUInt32LE(0x06064b50, 0)
  zip64End.writeBigUInt64LE(44n, 4)
  zip64End.writeUInt16LE(45, 12)
  zip64End.writeUInt16LE(45, 14)
  zip64End.writeBigUInt64LE(1n, 24)
  zip64End.writeBigUInt64LE(1n, 32)
  zip64End.writeBigUInt64LE(BigInt(central.length), 40)
  zip64End.writeBigUInt64LE(BigInt(local.length + unpacked), 48)
  const locator = Buffer.alloc(20)
  locator.writeUInt32LE(0x07064b50, 0)
  locator.writeBigUInt64LE(BigInt(local.length + unpacked + central.length), 8)
  locator.writeUInt32LE(1, 16)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(1, 8)
  end.writeUInt16LE(1, 10)
  end.writeUInt32LE(central.length, 12)
  end.writeUInt32LE(0xffffffff, 16)
  const suffix = [central, zip64End, locator, end]
  const downloadSize = local.length + unpacked + suffix.reduce((sum, part) => sum + part.length, 0)
  const hash = createHash('sha512')
  let peakRss = process.memoryUsage().rss
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Length': String(downloadSize) })
    void pipeline(Readable.from((async function* () {
      yield local
      for (let i = 0; i < count; i++) yield chunk
      yield* suffix
    })()), res).catch(() => {})
  })
  try {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const timer = setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage().rss) }, 20)
    try {
      const address = server.address() as { port: number }
      const dl = await installer.download(`http://127.0.0.1:${address.port}/app.zip`)
      hash.update(local)
      for (let i = 0; i < count; i++) hash.update(chunk)
      for (const part of suffix) hash.update(part)
      assert.equal(dl.size, downloadSize)
      assert.equal(statSync(dl.path).size, dl.size)
      assert.equal(dl.sha512, 'sha512-' + hash.digest('base64'))
      const dest = join(root, 'installed')
      mkdirSync(dest)
      assert.deepEqual(await installer.unpackFile(dl.path, dest, 'app.zip'), ['app.exe'])
      assert.equal(statSync(join(dest, 'app.exe')).size, unpacked)
      dl.cleanup()
      assert.ok(!existsSync(dl.path))
      assert.ok(peakRss < 384 * 1024 ** 2, `peak RSS ${Math.round(peakRss / 1024 ** 2)} MiB`)
      console.log(`5 GiB ZIP64 downloaded and extracted; Node peak RSS ${Math.round(peakRss / 1024 ** 2)} MiB`)
    } finally { clearInterval(timer) }
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    rmSync(root, { recursive: true, force: true })
  }
})
