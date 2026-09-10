import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareVersion } from '../version.ts';

test('compareVersion：逐段数字比较', () => {
  assert.equal(compareVersion('1.1.0', '1.0.0'), 1);
  assert.equal(compareVersion('1.0.0', '1.1.0'), -1);
  assert.equal(compareVersion('1.0.0', '1.0.0'), 0);
  assert.equal(compareVersion('26.9.10', '26.9.9'), 1, '不能按字符串比（"10" < "9"）');
  assert.equal(compareVersion('1.2', '1.2.0'), 0, '缺段视为 0');
  assert.equal(compareVersion('1.2.1', '1.2'), 1);
});

test('compareVersion：忽略 -rc / -T 之类后缀与 v 前缀', () => {
  assert.equal(compareVersion('1.1.0-rc', '1.1.0'), 0);
  assert.equal(compareVersion('v1.2.0', '1.2.0'), 0);
  assert.equal(compareVersion('26.8.31-T', '26.8.31'), 0);
  assert.equal(compareVersion('26.8.31-T', '26.9.3-rc'), -1);
});
