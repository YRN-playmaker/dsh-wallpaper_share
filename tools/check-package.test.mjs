import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validatePackageBytes } from './check-package.mjs';
const valid = Buffer.from(JSON.stringify({ name: 'fixture', version: '1.0.0', description: '中文' }));
test('accepts BOM-free UTF-8 including Chinese', () => assert.equal(validatePackageBytes(valid).description, '中文'));
test('rejects PowerShell 5.1 UTF-8 BOM', () => assert.throws(() => validatePackageBytes(Buffer.concat([Buffer.from([239,187,191]), valid])), /without BOM/));
test('rejects invalid UTF-8 and malformed JSON', () => {
  assert.throws(() => validatePackageBytes(Buffer.from([255])));
  assert.throws(() => validatePackageBytes(Buffer.from('{')));
});
