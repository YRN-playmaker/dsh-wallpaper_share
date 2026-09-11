import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

// Deliberately reject BOM rather than hiding a broken published manifest.
export function validatePackageBytes(bytes) {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    throw new Error('package.json must be UTF-8 without BOM. See docs/encoding-and-release.md');
  }
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const pkg = JSON.parse(text);
  if (!pkg || typeof pkg !== 'object' || typeof pkg.name !== 'string' || typeof pkg.version !== 'string') {
    throw new Error('package.json requires name and version');
  }
  return pkg;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const pkg = validatePackageBytes(readFileSync(resolve(root, 'package.json')));
  for (const key of ['.', './client']) {
    const entry = pkg.exports?.[key];
    if (typeof entry !== 'string' || !entry.startsWith('./') || !existsSync(resolve(root, entry))) {
      throw new Error('Missing package export: ' + key);
    }
  }
  console.log('Package encoding, JSON and host/client entry files OK');
}
