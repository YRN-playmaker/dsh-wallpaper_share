import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyIntegrity, integrityOf } from '../integrity.ts';

test('integrityOf → verifyIntegrity 往返一致', () => {
  const bytes = new TextEncoder().encode('hello dwp');
  const integ = integrityOf(bytes);
  assert.match(integ, /^sha512-[A-Za-z0-9+/=]+$/);
  assert.ok(verifyIntegrity(bytes, integ));
});

test('篡改字节 → 校验失败', () => {
  const bytes = new TextEncoder().encode('original');
  const integ = integrityOf(bytes);
  assert.ok(!verifyIntegrity(new TextEncoder().encode('tampered'), integ));
});

test('非 sha512 格式 → 直接判失败', () => {
  assert.ok(!verifyIntegrity(new Uint8Array([1]), 'md5-xyz'));
  assert.ok(!verifyIntegrity(new Uint8Array([1]), 'sha256-abc'));
});

test('integrityOf 确定性：同字节两次结果一致', () => {
  const a = integrityOf(new TextEncoder().encode('deterministic'));
  const b = integrityOf(new TextEncoder().encode('deterministic'));
  assert.equal(a, b);
  assert.notEqual(a, integrityOf(new TextEncoder().encode('different')));
});
