import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bindingFromEvent, describeBinding, isTypingBinding, isValidBinding, matchesBinding } from '../hotkeys.ts';

test('bindingFromEvent：功能键与单字符', () => {
  assert.equal(bindingFromEvent({ key: 'F11' }), 'F11');
  assert.equal(bindingFromEvent({ key: 'F10' }), 'F10');
  assert.equal(bindingFromEvent({ key: 'a' }), 'A');
  assert.equal(bindingFromEvent({ key: 'A', shiftKey: true }), 'Shift+A');
  assert.equal(bindingFromEvent({ key: 'ArrowUp' }), 'ArrowUp');
  assert.equal(bindingFromEvent({ key: ' ' }), 'Space');
});

test('bindingFromEvent：修饰键按 Ctrl → Alt → Shift → Meta 固定顺序', () => {
  assert.equal(bindingFromEvent({ key: 'K', ctrlKey: true, shiftKey: true }), 'Ctrl+Shift+K');
  assert.equal(bindingFromEvent({ key: 'k', metaKey: true, altKey: true, ctrlKey: true }), 'Ctrl+Alt+Meta+K');
});

test('bindingFromEvent：纯修饰键 / 空键不产生绑定', () => {
  for (const key of ['Control', 'Shift', 'Alt', 'Meta', 'CapsLock', 'Dead', '']) {
    assert.equal(bindingFromEvent({ key }), null, key);
  }
});

test('matchesBinding：修饰键必须完全一致', () => {
  assert.equal(matchesBinding('F11', { key: 'F11' }), true);
  assert.equal(matchesBinding('A', { key: 'a' }), true);
  assert.equal(matchesBinding('A', { key: 'a', ctrlKey: true }), false);
  assert.equal(matchesBinding('Ctrl+K', { key: 'k' }), false);
  assert.equal(matchesBinding('Ctrl+K', { key: 'k', ctrlKey: true }), true);
  assert.equal(matchesBinding('F11', { key: 'F10' }), false);
  assert.equal(matchesBinding('Control', { key: 'Control' }), false);
});

test('isValidBinding：接受规范规格，拒绝修饰键 / 重复修饰 / 垃圾值', () => {
  assert.equal(isValidBinding('F11'), true);
  assert.equal(isValidBinding('Ctrl+Shift+K'), true);
  assert.equal(isValidBinding('Control'), false);
  assert.equal(isValidBinding('Ctrl+Ctrl+K'), false);
  assert.equal(isValidBinding('Hyper+K'), false);
  assert.equal(isValidBinding(''), false);
  assert.equal(isValidBinding('x'.repeat(33)), false);
  assert.equal(isValidBinding(null), false);
  assert.equal(isValidBinding({ key: 'F11' }), false);
});

test('describeBinding：规格即显示文本', () => {
  assert.equal(describeBinding('F11'), 'F11');
  assert.equal(describeBinding('Ctrl+Shift+K'), 'Ctrl+Shift+K');
});

test('isTypingBinding：只有不带修饰键的单字符与编辑键算打字键', () => {
  assert.equal(isTypingBinding('A'), true);
  assert.equal(isTypingBinding('Space'), true);
  assert.equal(isTypingBinding('Backspace'), true);
  assert.equal(isTypingBinding('ArrowUp'), true);
  // 功能键与组合键在输入框里照常触发（否则在输入框内按 F11 会失效）
  assert.equal(isTypingBinding('F11'), false);
  assert.equal(isTypingBinding('F10'), false);
  assert.equal(isTypingBinding('Ctrl+K'), false);
  assert.equal(isTypingBinding('Shift+A'), false);
});
