/**
 * 百度网盘登录态同步助手（Tampermonkey 用户脚本）v1.0.0 —— 效仿 139 助手的「装一次即忘」。
 *
 * 139 助手拦截页面自身 API 请求抓 Authorization；百度没有可拦截的等价登录头（浏览器禁改
 * Cookie 头），好在 BDUSS/STOKEN 未被 HttpOnly 保护、页面脚本可读 —— 直接从 document.cookie
 * 取值，变化才同步（GM_setValue 记上次值），并留菜单命令兜底：读不到（个别浏览器策略）时
 * 弹 prompt 让用户粘一次值，同样走本机 /baiduauth 的严格归一校验。
 *
 * 服务端 normalizeBaiduCookie 只认 BDUSS/STOKEN 两键并校验形态，杂讯进不来。
 */
export const HELPER_BAIDU_URL = '/we-sync/baidu-helper.user.js'

export const HELPER_BAIDU_SCRIPT = `// ==UserScript==
// @name         DSH 壁纸插件 · 百度网盘登录态同步助手
// @namespace    dsh-wallpaper-share
// @version      1.0.0
// @description  装一次即忘：访问 pan.baidu.com 时自动把 BDUSS/STOKEN 登录态同步到本机 DSH 壁纸插件。之后在 DSH 面板粘贴百度网盘分享链接即可直接安装，无需 F12 抄 Cookie。
// @author       dsh-wallpaper_share
// @match        https://pan.baidu.com/*
// @connect      127.0.0.1
// @connect      localhost
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
  'use strict'
  var DSH = 'http://127.0.0.1:3080/we-sync/launcher/baiduauth'
  var TAG = '[DSH百度助手]'

  function extract() {
    var m = /(?:^|;\\s*)BDUSS=([^;\\s]+)/.exec(document.cookie || '')
    if (!m) return ''
    var s = /(?:^|;\\s*)STOKEN=([^;\\s]+)/.exec(document.cookie || '')
    return 'BDUSS=' + m[1] + (s ? '; STOKEN=' + s[1] : '')
  }

  function send(cookie) {
    GM_xmlhttpRequest({
      method: 'POST',
      url: DSH,
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify({ cookie: cookie }),
      onload: function (r) {
        try {
          var b = JSON.parse(r.responseText)
          if (b.ok) console.info(TAG, '登录态已同步到本机 DSH 插件 ✔')
          else console.warn(TAG, '本机插件拒绝：', b.error || ('HTTP ' + r.status))
        } catch (e) { console.warn(TAG, '本机插件响应异常：HTTP ' + r.status) }
      },
      onerror: function () { console.warn(TAG, '连不上本机 DSH 插件（' + DSH + '）——插件在运行吗？') },
    })
  }

  // 自动同步：值与上次不同才发（首次登录 / BDUSS 轮换 / 换账号都会触发）
  var cur = extract()
  if (cur && GM_getValue('last', '') !== cur) {
    send(cur)
    GM_setValue('last', cur)
    console.info(TAG, '检测到登录态变化，已同步')
  }

  // 手动兜底菜单：自动读不到（如 HttpOnly 策略）时粘贴一次值
  GM_registerMenuCommand('同步百度登录态到 DSH', function () {
    var c = extract()
    if (!c) {
      var p = prompt(TAG + ' 未能自动读取 BDUSS。\\n请 F12 → 应用 → Cookie → pan.baidu.com → 复制 BDUSS 的值（建议连 STOKEN 一起）粘贴到这里：', '')
      if (!p) return
      c = p.trim()
    }
    send(c)
    alert(TAG + ' 已发送到本机 DSH 壁纸插件（可在控制台看结果）')
  })
})()
`
