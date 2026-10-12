import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'

const archive = process.argv[2]
if (!archive) throw new Error('Usage: node tools/verify-packed-plugin.mjs <package.tgz>')
const tar = gunzipSync(readFileSync(archive))
const files = new Map()
const string = bytes => bytes.toString('utf8').replace(/\0.*$/s, '')
for (let offset = 0; offset + 512 <= tar.length; ) {
  const header = tar.subarray(offset, offset + 512)
  const name = string(header.subarray(0, 100))
  if (!name) break
  const prefix = string(header.subarray(345, 500))
  const size = parseInt(string(header.subarray(124, 136)).trim(), 8) || 0
  const content = tar.subarray(offset + 512, offset + 512 + size)
  if (header[156] === 0 || header[156] === 48) files.set(prefix ? prefix + '/' + name : name, content)
  offset += 512 + Math.ceil(size / 512) * 512
}
const manifest = files.get('package/package.json')
assert.ok(manifest, 'packed manifest exists')
assert.notDeepEqual([...manifest.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'packed manifest has no UTF-8 BOM')
const pkg = JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(manifest))
for (const name of ['package/lib/index.js', 'package/lib/client.js', 'package/bin/we-capture.exe']) assert.ok(files.get(name)?.length > 0, name + ' exists')
const client = files.get('package/lib/client.js').toString('utf8')
assert.ok(client.includes('window.__ModuleLoader__.load'), 'packed client registers with the host loader')
assert.ok(client.includes(pkg.version), 'packed client version matches manifest')
assert.ok(client.includes('scrollFadeEnd'), 'packed client contains the tab-scene surface fade renderer')
console.log('Verified actual tarball:', pkg.name + '@' + pkg.version, 'entries:', files.size)
