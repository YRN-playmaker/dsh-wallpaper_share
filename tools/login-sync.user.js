// ==UserScript==
// @name         DSH 壁纸插件 · 登录态同步助手（139 网盘）
// @namespace    dsh-wallpaper-share
// @version      3.1.0
// @description  捕获139登录态：Web自动同步；桌面端可从油猴菜单复制登录态，回插件粘贴保存，无需F12。
// @author       dsh-wallpaper_share
// @match        https://yun.139.com/*
// @match        https://caiyun.139.com/*
// @connect      127.0.0.1
// @connect      localhost
// @grant        GM_xmlhttpRequest
// @grant        GM_cookie
// @grant        GM_registerMenuCommand
// @grant        GM_setClipboard
// @run-at       document-start
// @noframes
// ==/UserScript==

(function () {
  'use strict'
  var HOST = location.hostname
  var IS139 = /(^|\.)yun\.139\.com$/.test(HOST) || /(^|\.)caiyun\.139\.com$/.test(HOST)
  if (!IS139) return

  // ── 公共：右上角提示条 ─────────────────────────────────────────────
  function toast(text, ok) {
    try {
      var el = document.createElement('div')
      el.textContent = text
      el.style.cssText = 'position:fixed;top:16px;right:16px;z-index:2147483647;padding:10px 14px;'
        + 'border-radius:8px;font-size:13px;color:#fff;background:' + (ok ? '#2e7d32' : '#c62828')
        + ';box-shadow:0 2px 8px rgba(0,0,0,.3);transition:opacity .6s;pointer-events:none;'
      var mount = function () {
        document.body.appendChild(el)
        setTimeout(function () { el.style.opacity = '0' }, 3200)
        setTimeout(function () { el.remove() }, 4000)
      }
      if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount)
    } catch (e) { /* 忽略 */ }
  }

  function post(url, payload, onDone) {
    GM_xmlhttpRequest({
      method: 'POST',
      url: url,
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify(payload),
      timeout: 20000,
      onload: function (res) { onDone(res.status, res.responseText) },
      onerror: function () { onDone(-1) },
      ontimeout: function () { onDone(-2) },
    })
  }

  // ── 139：拦截页面自身请求抓 Authorization ──────────────────────────
  // 形如 b64("<pre>:<账号>:<token>") 或明文三元组；卡巴斯基 URL 等杂讯一律拒绝
  function plausible139(v) {
    if (!v) return false
    var s = String(v).trim()
    if (s.indexOf('%') >= 0) { try { s = decodeURIComponent(s) } catch (e) { /* 原样 */ } }
    if (/^Basic\s/i.test(s)) s = s.replace(/^Basic\s+/i, '')
    var inner = ''
    if (/^[A-Za-z0-9+/=]+$/.test(s)) { try { inner = atob(s) } catch (e) { /* 非法 b64 */ } }
    if (!/^\w+:[^:]*:.+/.test(inner)) inner = s
    var parts = inner.split(':')
    if (parts.length !== 3) return false
    return /^\w{1,32}$/.test(parts[0]) && parts[1].length >= 4 && /^[\d@.a-zA-Z_-]+$/.test(parts[1]) && parts[2].length > 0
  }

  var captured139 = '' // 只保存在当前页面内存，供用户主动复制
  var last139 = '' // 已成功同步的值（失败后允许重试）
  var pending139 = ''
  var told139 = false // 成功/失败提示只弹一次
  function send139(value, src) {
    if (!plausible139(value)) return
    captured139 = String(value).trim()
    if (value === last139 || value === pending139) return
    pending139 = value
    post('http://127.0.0.1:3080/we-sync/launcher/139auth', { authorization: String(value).trim() }, function (st) {
      pending139 = ''
      if (st === 200) last139 = value
      if (st === 200 && !told139) { told139 = true; toast('✔ 已同步 139 登录态到 DSH（来源：' + src + '）', true) }
      else if (st !== 200 && !told139) { told139 = true; toast('自动同步未连接。桌面端请在油猴菜单选择「复制 139 登录态」，回插件粘贴保存。', false) }
    })
  }
  function hookXHR() {
    try {
      var orig = XMLHttpRequest.prototype.setRequestHeader
      XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
        try { if (String(name).toLowerCase() === 'authorization') send139(value, '页面请求头') } catch (e) { /* 不影响页面 */ }
        return orig.apply(this, arguments)
      }
    } catch (e) { /* 忽略 */ }
  }
  function hookFetch() {
    try {
      if (typeof window.fetch !== 'function') return
      var orig = window.fetch
      window.fetch = function (input, init) {
        try {
          var headers = (init && init.headers) || (input && input.headers)
          if (headers) {
            if (typeof headers.get === 'function') {
              var a = headers.get('authorization')
              if (a) send139(a, '页面请求头')
            } else {
              for (var k in headers) {
                if (String(k).toLowerCase() === 'authorization') send139(headers[k], '页面请求头')
              }
            }
          }
        } catch (e) { /* 不影响页面 */ }
        return orig.apply(this, arguments)
      }
    } catch (e) { /* 忽略 */ }
  }
  function fromCookie139() {
    var hit = document.cookie.split(';').map(function (s) { return s.trim() })
      .find(function (s) { return s.indexOf('authorization=') === 0 })
    return hit ? hit.slice('authorization='.length) : ''
  }
  function fromGM139() {
    return new Promise(function (resolve) {
      if (typeof GM_cookie === 'undefined' || typeof GM_cookie.list !== 'function') return resolve('')
      try {
        GM_cookie.list({ name: 'authorization' }, function (cookies, error) {
          if (error || !cookies || !cookies[0]) return resolve('')
          resolve(cookies[0].value || '')
        })
      } catch (e) { resolve('') }
    })
  }
  function pollFallback139() {
    var v = fromCookie139()
    if (plausible139(v)) { send139(v, 'cookie'); return }
    fromGM139().then(function (v2) { if (v2) send139(v2, 'cookie(httpOnly)') })
  }

  async function copy139() {
    var value = captured139 || fromCookie139()
    if (!plausible139(value)) value = await fromGM139()
    if (!plausible139(value)) {
      toast('尚未获取登录态。请登录139网盘并打开文件列表或分享页，再点击复制。', false)
      return
    }
    try {
      GM_setClipboard(String(value).trim(), 'text', function () {
        toast('✔ 已复制139登录态，请回到插件的「139登录态」输入框粘贴并保存。请勿分享给他人。', true)
      })
    } catch (e) { toast('复制失败，请检查油猴助手的剪贴板权限。', false) }
  }

  // ── 装配 ───────────────────────────────────────────────────────────
  GM_registerMenuCommand('立即同步 139 登录态到 DSH', pollFallback139)
  GM_registerMenuCommand('复制 139 登录态（用于桌面端粘贴）', copy139)
  hookXHR()
  hookFetch()
  setTimeout(pollFallback139, 2000)
  setInterval(pollFallback139, 10000)
})()
