// Local browser preview using the same module and assets as the plugin.
import { build } from 'tsdown'
import { createServer } from 'node:http'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { readZipMap } from '../src/market/unzip.ts'
import { DAYNIGHT_ID, DAYNIGHT_VERSION } from '../src/daynight/pack.ts'

const outDir = resolve('_dist/dive-preview')
const packageFiles = readZipMap(new Uint8Array(readFileSync(resolve('_dist/daynight', DAYNIGHT_ID + '-' + DAYNIGHT_VERSION + '.dwp'))))
await build({ config: false, entry: ['src/client/daynight-dive.ts', 'src/client/daynight-sidebar.ts'], outDir, platform: 'browser', format: 'esm', loader: { '.png': 'dataurl' }, clean: false })
mkdirSync(outDir, { recursive: true })
writeFileSync(resolve(outDir, 'index.html'), `<!doctype html><html lang="zh"><meta charset="utf-8"><title>DeepSeek 日夜 · 入水预览</title>
<style>body{margin:0;background:#eaf2ff;font:16px system-ui;color:#fff}nav{position:relative;padding:24px;display:flex;gap:12px}button{padding:12px 24px;border:1px solid #ffffff66;border-radius:12px;background:#ffffff24;color:inherit;cursor:pointer}.panel{margin:5vh 6vw;padding:32px;border:1px solid #ffffff66;border-radius:24px;background:#ffffff18;width:32vw;backdrop-filter:blur(8px)}body[data-off]{color:#193052}</style>
<nav><button id="enter">wallpaper_share / 重播</button><button id="leave">切走标签页</button><button id="breathe" aria-pressed="false">呼吸模糊预览</button><select id="time" aria-label="昼夜预览"><option value="auto">昼夜：自动</option><option value="720">白天</option><option value="1260">夜间</option></select></nav><div class="panel"><h1>DeepSeek 日夜</h1><p>入水 → 水幕向下展开 → 泡沫 → 倒置剪影</p><p>上下滚动，查看放大的上半身剪影随滚轮缓慢移动。</p><div class="preview_sidebarCol"><button id="sidebar-selected" aria-selected="true">已选中 / 交互配色</button><button id="sidebar-hover">悬停预览</button></div></div>
<script type="module">import {dayNightSidebarCss} from './daynight-sidebar.js';import {startPackageTabScene} from './daynight-dive.js';const sidebarStyle=document.createElement('style');sidebarStyle.textContent=dayNightSidebarCss('${DAYNIGHT_ID}');document.head.append(sidebarStyle);let stop=()=>{},breathing=false;window.__daynightPreviewMinutes=null;const clock=()=>{const d=new Date();if(window.__daynightPreviewMinutes!==null)d.setHours(0,window.__daynightPreviewMinutes,0,0);return d};document.querySelector('#time').onchange=e=>{window.__daynightPreviewMinutes=e.target.value==='auto'?null:Number(e.target.value)};function enter(){stop();delete document.body.dataset.off;stop=startPackageTabScene('${DAYNIGHT_ID}',{clock,visualState:()=>({focus:breathing,mode:'enhanced'})})}document.querySelector('#enter').onclick=enter;document.querySelector('#leave').onclick=()=>{stop();document.body.dataset.off='1'};document.querySelector('#breathe').onclick=e=>{breathing=!breathing;e.currentTarget.setAttribute('aria-pressed',String(breathing))};enter();</script></html>`, 'utf8')
if (process.argv.includes('--build-only')) process.exit(0)
createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1:4318')
  if (url.pathname.startsWith('/we-sync/dwp/')) {
    if (url.searchParams.get('id') !== DAYNIGHT_ID) { res.writeHead(404).end(); return }
    const name = url.pathname.endsWith('/scene') ? 'scene.json' : url.pathname.endsWith('/manifest') ? 'wallpaper.json' : url.searchParams.get('name')
    const data = packageFiles.get(name)
    if (!data) { res.writeHead(404).end(); return }
    res.setHeader('Content-Type', name.endsWith('.json') ? 'application/json' : 'image/png')
    res.setHeader('Cache-Control', 'no-store'); res.end(data); return
  }
  if (!['/', '/daynight-dive.js', '/daynight-sidebar.js'].includes(req.url)) { res.writeHead(404).end(); return }
  res.setHeader('Content-Type', req.url === '/' ? 'text/html; charset=utf-8' : 'text/javascript')
  res.end(readFileSync(resolve(outDir, req.url === '/' ? 'index.html' : req.url.slice(1))))
}).listen(4318, '127.0.0.1', () => console.log('Preview: http://127.0.0.1:4318'))
