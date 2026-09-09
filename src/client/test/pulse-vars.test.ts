import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pulseVars, formatBytes, truncateName, PULSE_SLOTS } from '../pulse-vars.ts';

const base = { rel: 'x', at: 0 };

test('空列表：idle 槽亮、全部槽位关、count=0', () => {
  const v = pulseVars([]);
  assert.equal(v.ws_count, 0);
  assert.equal(v.idle_on, 1);
  for (let i = 1; i <= PULSE_SLOTS; i++) {
    assert.equal(v[`b${i}_on`], 0);
  }
  assert.equal(Object.keys(v).length, 2 + PULSE_SLOTS);
});

test('add → 绿徽 +；delta=大小', () => {
  const v = pulseVars([{ ...base, name: 'app.ts', sign: '+', kind: 'add', size: 2048, delta: 2048 }]);
  assert.equal(v.b1_on, 1);
  assert.equal(v.b1_name, 'app.ts');
  assert.equal(v.b1_glyph, '+');
  assert.equal(v.b1_badge, '#3fb950');
  assert.equal(v.b1_size, '+2.0 KB');
});

test('del → 红徽 −；mag 取删除前大小', () => {
  const v = pulseVars([{ ...base, name: 'old.log', sign: '-', kind: 'del', size: 1536, delta: -1536 }]);
  assert.equal(v.b1_glyph, '−');
  assert.equal(v.b1_badge, '#f85149');
  assert.equal(v.b1_size, '−1.5 KB');
});

test('mod：变大 + / 缩小 −；delta=0 视作当前大小', () => {
  const grow = pulseVars([{ ...base, name: 'a', sign: '+', kind: 'mod', size: 3000, delta: 100 }]);
  assert.equal(grow.b1_glyph, '+');
  assert.equal(grow.b1_size, '+100 B');
  const shrink = pulseVars([{ ...base, name: 'a', sign: '-', kind: 'mod', size: 900, delta: -100 }]);
  assert.equal(shrink.b1_glyph, '−');
  assert.equal(shrink.b1_size, '−100 B');
  const same = pulseVars([{ ...base, name: 'a', sign: '+', kind: 'mod', size: 3000, delta: 0 }]);
  assert.equal(same.b1_size, '+2.9 KB');
});

test('多文件按传入顺序占槽，不足槽位隐藏', () => {
  const v = pulseVars([
    { ...base, name: 'a', sign: '+', kind: 'add', size: 1, delta: 1 },
    { ...base, name: 'b', sign: '-', kind: 'del', size: 2, delta: -2 },
  ]);
  assert.equal(v.b1_name, 'a');
  assert.equal(v.b2_name, 'b');
  assert.equal(v.b3_on, 0);
  assert.equal(v.idle_on, 0);
  assert.equal(v.ws_count, 2);
});

test('formatBytes 单位换算', () => {
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(1024), '1.0 KB');
  assert.equal(formatBytes(15_360), '15 KB');
  assert.equal(formatBytes(1_048_576), '1.0 MB');
  assert.equal(formatBytes(-1048_576), '-1.0 MB');
});

test('truncateName 保留尾部（扩展名）', () => {
  assert.equal(truncateName('short.ts'), 'short.ts');
  const long = 'a-very-long-component-name.tsx';
  const t = truncateName(long, 18);
  assert.equal(t.length, 18);
  assert.ok(t.startsWith('…'));
  assert.ok(t.endsWith('.tsx'));
});
