/**
 * 登录态同步助手（Tampermonkey 用户脚本）v2.0.0 —— 139 与 百度网盘 合一。
 *
 * 一个脚本多站点 @match，按 location.hostname 分支：
 *  - yun.139.com / caiyun.139.com：拦截页面自身 API 请求（hook XHR setRequestHeader / fetch）
 *    从真实 Authorization 头捕获登录态 —— v1.0 教训：按 cookie 名 `authorization` 直读会被
 *    Kaspersky 注入的同名 cookie 污染（实测同步进去的是 gc.kis.v2.scr.kaspersky-labs.com 的
 *    URL）；cookie / GM_cookie 仅作兜底且同样过校验。POST /we-sync/launcher/139auth。
 *  - pan.baidu.com：BDUSS/STOKEN 未被 HttpOnly 保护、页面可读，直接从 document.cookie 取值，
 *    值变化才同步（GM_setValue 记上次值）；菜单命令兜底（读不到时 prompt 粘贴一次）。
 *    POST /we-sync/launcher/baiduauth。
 *
 * 服务端两侧都有严格归一校验（normalize139Authorization / normalizeBaiduCookie），杂讯进不来。
 */
export const HELPER_SYNC_URL = '/we-sync/login-sync.user.js'

export const HELPER_SYNC_SCRIPT = `// ==UserScript==
// @name         DSH 壁纸插件 · 登录态同步助手（139 / 百度网盘）
// @namespace    dsh-wallpaper-share
// @version      2.0.0
// @description  装一次即忘：在 yun.139.com 自动拦截页面请求同步 Authorization 登录态；在 pan.baidu.com 自动同步 BDUSS/STOKEN 登录态。之后在 DSH 面板粘贴对应网盘分享链接即可直接安装，无需 F12。
// @author       dsh-wallpaper_share
// @match        https://yun.139.com/*
// @match        https://caiyun.139.com/*
// @match        https://pan.baidu.com/*
// @connect      127.0.0.1
// @connect      localhost
// @grant        GM_xmlhttpRequest
// @grant        GM_cookie
// @grant        GM_registerMenuCommand
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-start
// @noframes
// ==/UserScript==

(function () {
  'use strict'
  var HOST = location.hostname
  var IS139 = /(^|\\.)yun\\.139\\.com$/.test(HOST) || /(^|\\.)caiyun\\.139\\.com$/.test(HOST)
  var ISBD = /(^|\\.)pan\\.baidu\\.com$/.test(HOST)

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
      timeout: 8000,
      onload: function (res) { onDone(res.status) },
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
    if (/^Basic\\s/i.test(s)) s = s.replace(/^Basic\\s+/i, '')
    var inner = ''
    if (/^[A-Za-z0-9+/=]+$/.test(s)) { try { inner = atob(s) } catch (e) { /* 非法 b64 */ } }
    if (!/^\\w+:[^:]*:.+/.test(inner)) inner = s
    var parts = inner.split(':')
    if (parts.length !== 3) return false
    return /^\\w{1,32}$/.test(parts[0]) && parts[1].length >= 4 && /^[\\d@.a-zA-Z_-]+$/.test(parts[1]) && parts[2].length > 0
  }

  var last139 = '' // 本次页面已发送过的值（去重）
  var told139 = false // 成功/失败提示只弹一次
  function send139(value, src) {
    if (!plausible139(value) || value === last139) return
    last139 = value
    post('http://127.0.0.1:3080/we-sync/launcher/139auth', { authorization: String(value).trim() }, function (st) {
      if (st === 200 && !told139) { told139 = true; toast('✔ 已同步 139 登录态到 DSH（来源：' + src + '）', true) }
      else if (st !== 200 && !told139) { told139 = true; toast('✘ 139 同步失败：HTTP ' + st, false) }
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
      if (typeof GM_cookie !== 'function') return resolve('')
      try {
        GM_cookie('list', { name: 'authorization' }, function (cookies, error) {
          if (error || !cookies || !cookies[0]) return resolve('')
          resolve(cookies[0].value || '')
        })
      } catch (e) { resolve('') }
    })
  }
  function pollFallback139() {
    var v = fromCookie139()
    if (v) { send139(v, 'cookie'); return }
    fromGM139().then(function (v2) { if (v2) send139(v2, 'cookie(httpOnly)') })
  }

  // ── 百度：document.cookie 读 BDUSS/STOKEN（未 HttpOnly）────────────
  function extractBaidu() {
    var m = /(?:^|;\\s*)BDUSS=([^;\\s]+)/.exec(document.cookie || '')
    if (!m) return ''
    var s = /(?:^|;\\s*)STOKEN=([^;\\s]+)/.exec(document.cookie || '')
    return 'BDUSS=' + m[1] + (s ? '; STOKEN=' + s[1] : '')
  }
  var toldBD = false
  function sendBaidu(cookie, quiet) {
    if (!cookie) return false
    post('http://127.0.0.1:3080/we-sync/launcher/baiduauth', { cookie: cookie }, function (st) {
      if (quiet) return // 自动轮询：只发不弹
      if (st === 200 && !toldBD) { toldBD = true; toast('✔ 已同步百度网盘登录态到 DSH', true) }
      else if (st !== 200 && !toldBD) { toldBD = true; toast('✘ 百度同步失败：HTTP ' + st + '（DSH 在运行吗？）', false) }
    })
    return true
  }
  function pollBaidu() {
    var cur = extractBaidu()
    if (cur && GM_getValue('baidu_last', '') !== cur) {
      GM_setValue('baidu_last', cur)
      sendBaidu(cur, true)
    }
  }

  // ── 装配 ───────────────────────────────────────────────────────────
  if (IS139) {
    GM_registerMenuCommand('立即同步 139 登录态到 DSH', pollFallback139)
    hookXHR()
    hookFetch()
    setTimeout(pollFallback139, 2000)
    setInterval(pollFallback139, 10000)
  } else if (ISBD) {
    GM_registerMenuCommand('同步百度登录态到 DSH', function () {
      var c = extractBaidu()
      if (!c) {
        var p = prompt('[DSH百度助手] 未能自动读取 BDUSS。\\n请 F12 → 应用 → Cookie → pan.baidu.com → 复制 BDUSS 的值（建议连 STOKEN 一起）粘贴到这里：', '')
        if (!p) return
        c = p.trim()
      }
      if (sendBaidu(c, false)) GM_setValue('baidu_last', c)
    })
    pollBaidu()
    setTimeout(pollBaidu, 3000)
    setInterval(pollBaidu, 15000)
  }
})()
`
