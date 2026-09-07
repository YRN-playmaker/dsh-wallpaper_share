/**
 * 139 登录态同步助手（Tampermonkey 用户脚本）v1.1.0。
 * v1.0 的教训：按 cookie 名 `authorization` 读取会被 Kaspersky 注入的同名 cookie 污染
 * （实测同步进去的是 gc.kis.v2.scr.kaspersky-labs.com 的 URL）。
 * v1.1 改为**拦截 139 页面自己的 API 请求**（hook XHR setRequestHeader / fetch），
 * 从真实 Authorization 头捕获登录态，配合格式校验，杂讯无法混入；
 * cookie / GM_cookie 仅作兜底且同样过校验。
 */
export const HELPER_139_URL = '/we-sync/139-helper.user.js'

export const HELPER_139_SCRIPT = `// ==UserScript==
// @name         DSH 壁纸插件 · 139 登录态同步助手
// @namespace    dsh-wallpaper-share
// @version      1.1.0
// @description  装一次即忘：拦截中国移动云盘(yun.139.com)页面自身的 API 请求，把 Authorization 登录态自动同步到本机 DSH 壁纸插件。之后在 DSH 面板粘贴 139 分享链接即可直接安装，无需 F12。
// @author       dsh-wallpaper_share
// @match        https://yun.139.com/*
// @match        https://caiyun.139.com/*
// @connect      127.0.0.1
// @connect      localhost
// @grant        GM_xmlhttpRequest
// @grant        GM_cookie
// @grant        GM_registerMenuCommand
// @run-at       document-start
// @noframes
// ==/UserScript==

(function () {
  'use strict'
  var DSH = 'http://127.0.0.1:3080/we-sync/launcher/139auth'
  var last = '' // 本次页面已发送过的值（去重）
  var told = false // 成功/失败提示只弹一次

  // 形如 b64("<pre>:<账号>:<token>") 或明文三元组；卡巴斯基 URL 等杂讯一律拒绝
  function plausible(v) {
    if (!v) return false
    var s = String(v).trim()
    if (s.indexOf('%') >= 0) { try { s = decodeURIComponent(s) } catch (e) { /* 原样 */ } }
    if (/^Basic\\s/i.test(s)) s = s.replace(/^Basic\\s+/i, '')
    var inner = ''
    if (/^[A-Za-z0-9+/=]+$/.test(s)) { try { inner = atob(s) } catch (e) { /* 非法 b64 */ } }
    if (!/^\\w+:[^:]*:.+/.test(inner)) inner = s
    var parts = inner.split(':')
    if (parts.length !== 3) return false
    return /^\\w{1,32}$/.test(parts[0]) && parts[1].length >= 4 && /^[\\d@.a-zA-Z_-]+$/.test(parts[1]) && parts[2].length > 0
  }

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

  function send(value, src) {
    if (!plausible(value) || value === last) return
    last = value
    GM_xmlhttpRequest({
      method: 'POST',
      url: DSH,
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify({ authorization: String(value).trim() }),
      timeout: 8000,
      onload: function (res) {
        if (res.status === 200 && !told) { told = true; toast('✔ 已同步 139 登录态到 DSH（来源：' + src + '）', true) }
        else if (res.status !== 200 && !told) { told = true; toast('✘ 同步被 DSH 拒绝：HTTP ' + res.status, false) }
      },
      onerror: function () { if (!told) { told = true; toast('✘ 同步失败：本机 DSH (127.0.0.1:3080) 未运行？', false) } },
      ontimeout: function () { if (!told) { told = true; toast('✘ 同步超时：本机 DSH 未响应', false) } },
    })
  }

  // ① 拦截页面自身的 XHR 请求头（139 SPA 走 axios/XHR 带 Authorization）
  function hookXHR() {
    try {
      var orig = XMLHttpRequest.prototype.setRequestHeader
      XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
        try { if (String(name).toLowerCase() === 'authorization') send(value, '页面请求头') } catch (e) { /* 不影响页面 */ }
        return orig.apply(this, arguments)
      }
    } catch (e) { /* 忽略 */ }
  }

  // ② 拦截 fetch（部分调用走 fetch）
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
              if (a) send(a, '页面请求头')
            } else {
              for (var k in headers) {
                if (String(k).toLowerCase() === 'authorization') send(headers[k], '页面请求头')
              }
            }
          }
        } catch (e) { /* 不影响页面 */ }
        return orig.apply(this, arguments)
      }
    } catch (e) { /* 忽略 */ }
  }

  // ③ cookie 兜底（同样过校验，Kaspersky 同名 cookie 会被拒）
  function fromCookie() {
    var hit = document.cookie.split(';').map(function (s) { return s.trim() })
      .find(function (s) { return s.indexOf('authorization=') === 0 })
    return hit ? hit.slice('authorization='.length) : ''
  }
  function fromGM() {
    return new Promise(function (resolve) {
      if (typeof GM_cookie !== 'function') return resolve('')
      try {
        GM_cookie('list', { name: 'authorization' }, function (cookies, error) {
          if (error || !cookies || !cookies[0]) return resolve('')
          resolve(cookies[0].value || '')
        })
      } catch (e) { resolve('') }
    })
  }
  function pollFallback() {
    var v = fromCookie()
    if (v) { send(v, 'cookie'); return }
    fromGM().then(function (v2) { if (v2) send(v2, 'cookie(httpOnly)') })
  }

  GM_registerMenuCommand('立即同步登录态到 DSH', pollFallback)
  hookXHR()
  hookFetch()
  setTimeout(pollFallback, 2000)
  setInterval(pollFallback, 10000)
})()
`
