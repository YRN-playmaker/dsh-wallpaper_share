/**
 * 登录态同步助手（Tampermonkey 用户脚本）v2.0.2 —— 139 与 百度网盘 合一。
 *
 * 一个脚本多站点 @match，按 location.hostname 分支：
 *  - yun.139.com / caiyun.139.com：拦截页面自身 API 请求（hook XHR setRequestHeader / fetch）
 *    从真实 Authorization 头捕获登录态 —— v1.0 教训：按 cookie 名 `authorization` 直读会被
 *    Kaspersky 注入的同名 cookie 污染（实测同步进去的是 gc.kis.v2.scr.kaspersky-labs.com 的
 *    URL）；cookie / GM_cookie 仅作兜底且同样过校验。POST /we-sync/launcher/139auth。
 *  - pan.baidu.com：2026 实测百度自盘接口把登录态与设备指纹 cookie 绑定校验（只送裸 BDUSS
 *    报 errno -6），故同步**整包 Cookie**：GM_cookie 全域抓取（含 HttpOnly 的 BDUSS，需授权）
 *    + document.cookie 主机可见项合并，值变化才发；菜单命令兜底 prompt 粘贴整行 Cookie。
 *    POST /we-sync/launcher/baiduauth。
 *
 * 服务端两侧都有严格归一校验（normalize139Authorization / normalizeBaiduCookie），杂讯进不来。
 */
export const HELPER_SYNC_URL = '/we-sync/login-sync.user.js'

export const HELPER_SYNC_SCRIPT = `// ==UserScript==
// @name         DSH 壁纸插件 · 登录态同步助手（139 / 百度网盘）
// @namespace    dsh-wallpaper-share
// @version      2.0.2
// @description  装一次即忘：在 yun.139.com 自动拦截页面请求同步 Authorization 登录态；在 pan.baidu.com 自动同步整包 Cookie 登录态（2026 风控要求设备指纹，裸 BDUSS 不够）。之后在 DSH 面板粘贴对应网盘分享链接即可直接安装，无需 F12。
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

  // ── 百度：2026 风控实测——自盘接口把登录态和设备指纹 cookie（BAIDUID/BIDUPSID…）绑定校验，
  // 只送裸 BDUSS 会被拒（errno -6）。必须同步**整包 Cookie**：GM_cookie 读含 HttpOnly 的全域
  // cookie（需授权），document.cookie 补当前主机可见项，合并成完整 jar。
  function parseJar(str) {
    var out = {}
    ;(str || '').split(';').forEach(function (p) {
      p = p.trim()
      var eq = p.indexOf('=')
      if (eq > 0) out[p.slice(0, eq).trim()] = p.slice(eq + 1).trim()
    })
    return out
  }
  function jarString(map) {
    var keys = Object.keys(map).sort()
    var s = ''
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i]
      var v = map[k]
      if (!k || !v || v.length > 4096) continue
      if (s.length + k.length + v.length + 2 > 8000) break
      s += (s ? '; ' : '') + k + '=' + v
    }
    return s
  }
  function jarFromGM() {
    return new Promise(function (resolve) {
      if (typeof GM_cookie !== 'function') return resolve({})
      try {
        GM_cookie('list', {}, function (cookies, error) {
          if (error || !cookies) return resolve({})
          var map = {}
          for (var i = 0; i < cookies.length; i++) {
            var c = cookies[i]
            if (c && c.name && c.value && /(^|\\.)baidu\\.com$/i.test(c.domain || '')) map[c.name] = c.value
          }
          resolve(map)
        })
      } catch (e) { resolve({}) }
    })
  }
  function buildJar() {
    return jarFromGM().then(function (gm) {
      var doc = parseJar(document.cookie || '')
      var merged = {}
      Object.keys(gm).forEach(function (k) { merged[k] = gm[k] })
      Object.keys(doc).forEach(function (k) { merged[k] = doc[k] }) // 主机可见值优先（作用域更准）
      return merged.BDUSS ? jarString(merged) : ''
    })
  }
  var toldBD = false // 失败提示只弹一次
  var toldOK = false
  var toldEmpty = false
  var emptyMisses = 0
  // onDone(是否成功)：轮询模式靠它决定是否标记「已同步」——先发后记，DSH 没开时下一轮自动补发
  function sendBaidu(cookie, quiet, onDone) {
    if (!cookie) { if (onDone) onDone(false); return false }
    post('http://127.0.0.1:3080/we-sync/launcher/baiduauth', { cookie: cookie }, function (st) {
      var ok = st === 200
      var connFail = st === -1 || st === -2
      if (ok) {
        if (!quiet && !toldOK) { toldOK = true; toast('✔ 已同步百度网盘登录态到 DSH', true) }
      } else {
        // 静默模式下连接失败不打扰（下轮自动补发）；被服务端拒绝必须说，否则用户无从知道
        if (!toldBD && (!quiet || !connFail)) {
          toldBD = true
          toast(connFail ? '✘ 百度同步失败：本机 DSH (127.0.0.1:3080) 未运行？' : '✘ 百度登录态被 DSH 拒绝（HTTP ' + st + '）', false)
        }
      }
      if (onDone) onDone(ok)
    })
    return true
  }
  function pollBaidu() {
    buildJar().then(function (jar) {
      if (jar) {
        emptyMisses = 0
        if (GM_getValue('baidu_last', '') !== jar) {
          sendBaidu(jar, true, function (ok) { if (ok) GM_setValue('baidu_last', jar) })
        }
        return
      }
      // 整包都凑不出 BDUSS：未登录，或 TM 未授权 cookie 访问
      emptyMisses++
      if (emptyMisses === 2 && !toldEmpty) {
        toldEmpty = true
        toast('⚠ 读不到百度 BDUSS：确认已登录 pan.baidu.com，并在 Tampermonkey 的授权弹窗里允许本脚本访问 Cookie（有角标时点开允许）。兜底：DSH 面板粘贴 F12 整行 Cookie（网络→任一请求→请求标头）', false)
      }
    })
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
      buildJar().then(function (jar) {
        var c = jar
        if (!c) {
          var p = prompt('[DSH百度助手] 未能自动读取整包登录态（需已登录且允许脚本访问 Cookie）。\\n请 F12 → 网络 → 刷新 → 点任一 pan.baidu.com 请求 → 请求标头 → 复制 Cookie 的值粘贴到这里（只贴裸 BDUSS 过不了 2026 设备指纹校验，取直链会报 -6）：', '')
          if (!p) return
          c = p.trim()
        }
        sendBaidu(c, false, function (ok) { if (ok) GM_setValue('baidu_last', c) })
      })
    })
    pollBaidu()
    setTimeout(pollBaidu, 3000)
    setInterval(pollBaidu, 15000)
  }
})()
`
