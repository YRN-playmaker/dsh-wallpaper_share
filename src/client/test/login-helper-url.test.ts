import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loginHelperUrl } from '../login-helper-url.ts'

test('Web 助手链接保留实际端口；桌面使用外部浏览器可打开的公开脚本', () => {
  assert.equal(loginHelperUrl('http://localhost:4123/session/1'), 'http://localhost:4123/we-sync/login-sync.user.js')
  assert.equal(loginHelperUrl('https://dsh.example/session/1'), 'https://dsh.example/we-sync/login-sync.user.js')
  assert.equal(loginHelperUrl('dsh-app://app/session/1'), 'https://raw.githubusercontent.com/YRN-playmaker/dsh-wallpaper_share/main/tools/login-sync.user.js')
})
