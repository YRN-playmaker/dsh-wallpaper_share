/**
 * 面板样式（独立构建不再依赖 CSS Modules，运行时注入 <style>）。
 */
export const PANEL_CSS = `
/* ── share 视图激活期间的宿主滚动体锁定 ──────────────────────────
   share 页面装在宿主 GUI 的 .scrollBody（[data-conversation-scroll]）里：
   滚动条与面板外区域的滚轮都归它。挂锁类：隐藏滚动条、收回预留 gutter、
   关闭键盘/拖动滚动路径，确保 share 页内只有虚拟滚动引擎一条滚路。 */
[data-conversation-scroll].wesync-wheel-lock {
  scrollbar-width: none;      /* Firefox */
  scrollbar-gutter: auto;     /* 收回 reserved gutter，滚动条消失不跳动 */
  overflow: hidden;           /* 键盘/拖动滚动路径一并关闭 */
  overscroll-behavior: contain;
}
[data-conversation-scroll].wesync-wheel-lock::-webkit-scrollbar {
  display: none;              /* Chromium/WebView2：彻底隐藏滚动条 */
}
.wesync-panel {
  padding: 0;
  display: flex;
  flex-direction: row;
  gap: 8px;
  /* 撑满宿主会话列：原来 724px 的硬上限让整个面板只占页面左半边，
     壁纸库的网格因此被挤成 2 列、单卡被撑得异常大，右侧空间全浪费。
     宽度上限交给会话列自身决定（宿主 root 的 padding 已提供边距）。 */
  width: 100%;
  max-width: none;
  height: 100%;
  min-height: 0;
  box-sizing: border-box;
}

/* ── 双页虚拟滚动：一套滚轮全接管（设置 ⇄ 壁纸库）──────────────────
   视口 overflow hidden 禁原生滚动，wheel 全部进动量引擎：页内跟手+惯性阻尼，
   页界蓄力（拉扯 ≤7% 视口 + 动量累加，突破 600 翻页，250ms 无输入弹回）。
   轨道 transform 直写，两页之间留断层（.wesync-page-gap）。 */
.wesync-pages {
  flex: 1;
  min-width: 0;
  min-height: 0;
  height: 100%;
  max-height: min(100vh - 32px, 980px);
  overflow: hidden;
  position: relative;
}

.wesync-pages-track {
  will-change: transform;
}

.wesync-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
  /* 每页至少撑满一个视口高（--wesync-vph 由引擎 measure() 注入）：
     保证翻页后当前页独占视口，矮页不会把相邻页尾巴留在视口上方 */
  min-height: var(--wesync-vph, 640px);
  /* 面板现在铺满会话列，右侧也需要内边距，否则卡片贴着列右缘 */
  padding: 24px;
  box-sizing: border-box;
}

/* 设置页保持紧凑阅读宽度：滑块/选项行拉满整列会失去可读性。
   壁纸库页（.wesync-page-library）不设上限，铺满会话列。 */
.wesync-page-settings {
  max-width: 748px;
}

/* 页间断层：只在蓄力拉扯/翻页动画经过时露出，提示「继续滚动翻页」 */
.wesync-page-gap {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 24px 10px 24px;
  opacity: 0.75;
}

.wesync-page-gap-line {
  flex: 1;
  height: 1px;
  background: var(--dsw-alias-border-l1);
}

.wesync-page-hint {
  font-size: 11px;
  color: var(--dsw-alias-label-caption);
  white-space: nowrap;
}

/* ── 右缘页签：当前页高亮 + 蓄力进度条（醒目、可点击兜底）────────── */
.wesync-pager {
  flex: 0 0 auto;
  width: 56px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 10px;
  padding-right: 8px;
}

.wesync-pager-dot {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 30px;
  padding: 6px 4px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--dsw-alias-bg-layer-1) 82%, transparent);
  border: 1px solid var(--dsw-alias-border-l1);
  color: var(--dsw-alias-label-caption);
  cursor: pointer;
  opacity: 0.55;
  overflow: hidden;
  transition: opacity 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;
}

.wesync-pager-dot:hover { opacity: 0.9; }

.wesync-pager-dot-on {
  opacity: 1;
  border-color: rgba(234, 179, 8, 0.85);
  box-shadow: 0 0 10px rgba(234, 179, 8, 0.35);
}

.wesync-pager-label {
  font-size: 11px;
  line-height: 1.2;
  white-space: nowrap;
  text-align: center;
}

.wesync-pager-dot-on .wesync-pager-label {
  color: rgba(250, 204, 21, 0.95);
  font-weight: 600;
}

.wesync-pager-progress {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 100%;
  background: rgba(234, 179, 8, 0.3);
  transform-origin: left center;
  transform: scaleX(0);
  pointer-events: none;
}

.wesync-card {
  padding: 16px 18px;
  border-radius: 12px;
  background: var(--dsw-alias-bg-layer-1);
  border: 1px solid var(--dsw-alias-border-l1);
}

/* 标题行：壁纸名吃掉剩余宽度并省略号，版本号贴右缘、刻意低视觉权重
   （它是排障信息，不参与任何决策，不该占副标题那个位置）。
   user-select: all 让版本号一键整段选中，方便截图/复述。 */
.wesync-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.wesync-head .wesync-title {
  flex: 1;
  min-width: 0;
}

.wesync-ver {
  flex: none;
  font-size: 11px;
  line-height: 16px;
  color: var(--dsw-alias-label-caption);
  font-variant-numeric: tabular-nums;
  user-select: all;
  text-decoration: none;
  transition: color 0.15s ease;
}

.wesync-ver:hover {
  color: var(--dsw-alias-brand-primary);
  text-decoration: underline;
}

.wesync-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
  margin: 0 0 4px 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wesync-sub {
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
}

.wesync-status {
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
  margin-top: 10px;
}

.wesync-sync-hint {
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
  align-self: center;
}

.wesync-actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
  flex-wrap: wrap;
}

/* 专注模式按钮 + 它的子集弹出层（眼动追踪 / 校准视线 / 文字吸附）：
   悬停时横向（从左往右）弹出介绍文字；点击专注模式确认后，一行三个子按钮实体出现。 */
.wesync-focuswrap {
  position: relative;
  display: inline-flex;
  align-items: center;
}

.wesync-focus-flyout {
  position: absolute;
  left: 100%;
  top: 50%;
  margin-left: 10px;
  transform: translateY(-50%);
  z-index: 30;
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 6px;
  width: max-content;
  padding: 8px;
  border-radius: 10px;
  border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-2);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.18);
  transform-origin: left center;
  animation: wesync-flyout-in 0.18s ease-out;
}

@keyframes wesync-flyout-in {
  from { opacity: 0; transform: translateY(-50%) translateX(-12px); }
  to   { opacity: 1; transform: translateY(-50%) translateX(0); }
}

/* 介绍文字（悬停预览态）：一行灰字，不可交互 */
.wesync-focus-intro {
  white-space: nowrap;
  color: var(--dsw-alias-label-secondary);
  font-size: 12.5px;
  line-height: 1.5;
  padding: 0 2px;
}

.wesync-focus-flyout .wesync-gaze-status {
  margin: 2px 6px 2px;
  font-size: 12px;
}

.wesync-btn {
  padding: 6px 14px;
  border-radius: 999px;
  border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  font-size: 13px;
  /* ⏻（U+23FB）不在宿主 --dsw-font-family 里（该栈无 Segoe UI Symbol），
     纯 font-family: inherit 会渲染成豆腐块。这里显式列出宿主字体再补符号字体：
     中英文仍走宿主字体，只有 ⏻ 落到符号字体（字体回退按字形逐个匹配）。 */
  font-family: var(--dsw-font-family), 'Segoe UI Symbol', 'Segoe UI Emoji', 'Noto Sans Symbols 2', sans-serif;
  white-space: nowrap;
}

.wesync-btn:hover:not(:disabled) {
  background: var(--dsw-alias-bg-overlay);
}

.wesync-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

/* 专注 / 眼动 / 吸附按钮 + 渲染模式滑块：
   基线用自适应 token（浅色主题下文字自动变深、选中为反色药丸）；
   深色主题用 body[data-ds-dark-theme] 覆盖回锁定设计（白字 / 选中白底黄字 / 开启白底蓝字）。 */
.wesync-focusOff {
  background: transparent;
  border-color: var(--dsw-alias-border-l1);
  color: var(--dsw-alias-label-primary);
}

.wesync-focusOff:hover:not(:disabled) {
  background: var(--dsw-alias-bg-overlay);
}

.wesync-focusOn {
  background: var(--dsw-alias-label-primary);
  border-color: var(--dsw-alias-label-primary);
  color: #ffffff;
  font-weight: 600;
}

.wesync-focusOn:hover:not(:disabled) {
  background: var(--dsw-alias-label-primary);
  opacity: 0.88;
}

.wesync-seg {
  display: flex;
  gap: 2px;
  margin-top: 12px;
  padding: 3px;
  border-radius: 999px;
  border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-2);
}

.wesync-seg-item {
  flex: 1 1 0;
  min-width: 0;
  padding: 6px 8px;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  font-family: inherit;
  cursor: pointer;
  text-align: center;
  white-space: nowrap;
  transition: background 0.15s ease, color 0.15s ease;
}

.wesync-seg-item:hover:not(.wesync-seg-active) {
  background: var(--dsw-alias-bg-overlay);
}

.wesync-seg-item:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.wesync-seg-active {
  background: var(--dsw-alias-label-primary);
  color: #ffffff;
  font-weight: 600;
}

.wesync-seg-active:hover {
  background: var(--dsw-alias-label-primary);
}

/* 眼动状态文字（跟随中 / 出错 / 加载中）：随主题取色 */
.wesync-gaze-status {
  font-size: 11px;
  align-self: center;
}

.wesync-gaze-status.is-running { color: #16a34a; }
.wesync-gaze-status.is-error { color: #ea580c; }
.wesync-gaze-status.is-loading { color: var(--dsw-alias-label-secondary); }

/* —— 深色主题：恢复锁定设计（白字 / 选中白底黄字 / 开启白底蓝字）—— */
body[data-ds-dark-theme] .wesync-focusOff {
  border-color: rgba(255, 255, 255, 0.5);
  color: #ffffff;
}

body[data-ds-dark-theme] .wesync-focusOff:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.14);
}

body[data-ds-dark-theme] .wesync-focusOn {
  background: #ffffff;
  border-color: #ffffff;
  color: #2563eb;
}

body[data-ds-dark-theme] .wesync-focusOn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.86);
  opacity: 1;
}

body[data-ds-dark-theme] .wesync-seg {
  border-color: rgba(255, 255, 255, 0.28);
  background: rgba(255, 255, 255, 0.06);
}

body[data-ds-dark-theme] .wesync-seg-item {
  color: #ffffff;
}

body[data-ds-dark-theme] .wesync-seg-item:hover:not(.wesync-seg-active) {
  background: rgba(255, 255, 255, 0.12);
}

body[data-ds-dark-theme] .wesync-seg-active,
body[data-ds-dark-theme] .wesync-seg-active:hover {
  background: #ffffff;
  color: #ca8a04;
}

body[data-ds-dark-theme] .wesync-gaze-status.is-running { color: #7ee2a8; }
body[data-ds-dark-theme] .wesync-gaze-status.is-error { color: #fdba74; }

.wesync-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 12px;
}

.wesync-row label {
  flex: 0 0 92px;
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
}

.wesync-row input[type='range'] {
  flex: 1;
  accent-color: var(--dsw-alias-brand-primary);
  height: 20px;
}

.wesync-select {
  flex: 1;
  padding: 4px 8px;
  border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
  font-size: 12px;
  font-family: inherit;
}

.wesync-row output {
  flex: 0 0 44px;
  text-align: right;
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
  font-variant-numeric: tabular-nums;
}

/* 壁纸库：可滚动缩略图栏（全部类型 + 筛选） */
.wesync-apps {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.wesync-apps-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.wesync-apps-count {
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
}

/* 壁纸库页头右侧：切页操作提示 */
.wesync-page-hint {
  font-size: 11px;
  color: var(--dsw-alias-label-caption);
  white-space: nowrap;
}

.wesync-apps-grid {
  display: grid;
  /* 响应式多列：原来固定 2 列，面板一宽单张卡就被撑成半个屏幕
     （缩略图 16:9 随宽度放大 → 单项异常大、一屏放不下几张）。
     按最小 160px 自动铺列，窄容器退化成 2 列，宽容器自然变密。 */
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 8px;
  padding: 2px;
}

.wesync-app-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-2);
  border: 1px solid var(--dsw-alias-border-l1);
  cursor: pointer;
  transition: background 0.15s ease;
}

.wesync-app-card:hover {
  background: var(--dsw-alias-bg-overlay);
}

.wesync-app-thumb {
  width: 100%;
  aspect-ratio: 16 / 9;
  object-fit: cover;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.35);
}

.wesync-app-title {
  font-size: 12px;
  color: var(--dsw-alias-label-primary);
  line-height: 1.3;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  word-break: break-all;
}

.wesync-app-empty {
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
  padding: 10px 2px;
}

/* 壁纸库：本地 / 市场 分类行 + 类型筛选 chips + 标题搜索 */
.wesync-apps-cats {
  display: flex;
  gap: 6px;
  align-items: center;
  margin-bottom: 8px;
}

.wesync-apps-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.wesync-chip {
  padding: 3px 10px;
  border-radius: 999px;
  border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
}

.wesync-chip:hover {
  background: var(--dsw-alias-bg-overlay);
}

.wesync-chip-on {
  border-color: rgba(59, 130, 246, 0.6);
  background: rgba(59, 130, 246, 0.18);
  color: #93c5fd;
}

.wesync-app-search {
  flex: 1;
  min-width: 140px;
  padding: 5px 10px;
  border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
  font-size: 12px;
  font-family: inherit;
}

.wesync-app-search::placeholder {
  color: var(--dsw-alias-label-secondary);
  opacity: 0.7;
}

/* 壁纸库：缩略图左上角类型徽标 */
.wesync-app-thumbwrap {
  position: relative;
}

.wesync-app-badge {
  position: absolute;
  top: 6px;
  left: 6px;
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 10px;
  line-height: 1.6;
  color: #fff;
  background: rgba(107, 114, 128, 0.8);
  border: 1px solid rgba(255, 255, 255, 0.14);
  pointer-events: none;
}

.wesync-badge-scene { background: rgba(59, 130, 246, 0.82); border-color: transparent; }
.wesync-badge-video { background: rgba(168, 85, 247, 0.82); border-color: transparent; }
.wesync-badge-image { background: rgba(34, 197, 94, 0.82); border-color: transparent; }
.wesync-badge-application { background: rgba(239, 68, 68, 0.82); border-color: transparent; }
/* 启动器安装的应用：黄色「应用」徽章，区别于 WE 工坊应用的红色「we 应用」 */
.wesync-badge-launcher { background: rgba(234, 179, 8, 0.85); border-color: transparent; }
.wesync-badge-web { background: rgba(245, 158, 11, 0.82); border-color: transparent; }
.wesync-badge-other { background: rgba(107, 114, 128, 0.82); border-color: transparent; }

.wesync-show-more {
  align-self: center;
}

/* 壁纸读取位置：自定义壁纸目录管理（App Launcher 与视觉效果之间） */
.wesync-dirs {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.wesync-dir-row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.wesync-dir-input {
  flex: 1;
  min-width: 0;
  padding: 5px 10px;
  border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
  font-size: 12px;
  font-family: inherit;
}

.wesync-dir-input::placeholder {
  color: var(--dsw-alias-label-secondary);
  opacity: 0.7;
}

.wesync-dir-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.wesync-dir-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-2);
  border: 1px solid var(--dsw-alias-border-l1);
}

.wesync-dir-path {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  color: var(--dsw-alias-label-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  direction: rtl;
  text-align: left;
}

.wesync-dir-remove {
  flex: 0 0 auto;
  padding: 2px 10px;
  border-radius: 999px;
  border: 1px solid var(--dsw-alias-border-l1);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  font-size: 12px;
  font-family: inherit;
}

.wesync-dir-remove:hover {
  background: rgba(239, 68, 68, 0.15);
  border-color: rgba(239, 68, 68, 0.5);
  color: #fca5a5;
}

.wesync-dir-status {
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
}

/* 壁纸库「市场」一栏：flash 提示 + 卡片元信息 + 安装/卸载按钮 */
.wesync-market-flash {
  font-size: 12px; padding: 6px 10px; border-radius: 8px;
  background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary);
  border: 1px solid var(--dsw-alias-border, rgba(255,255,255,0.08));
}
.wesync-market-card { display: flex; flex-direction: column; }
.wesync-market-meta { font-size: 11px; color: var(--dsw-alias-label-secondary); margin-top: 2px; min-height: 14px; }
.wesync-market-actions { margin-top: 8px; display: flex; gap: 6px; }
.wesync-market-install, .wesync-market-uninstall { flex: 1; font-size: 12px; padding: 6px 8px; }
.wesync-market-uninstall { opacity: 0.8; }

/* ── 应用启动器：确认弹层（每次启动都要用户手势确认）────────────────── */
.wesync-confirm-mask {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(2px);
}
.wesync-confirm {
  width: min(420px, 86vw);
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px 18px;
  border-radius: 14px;
  background: var(--dsw-alias-bg-layer-1, #1c1f26);
  border: 1px solid var(--dsw-alias-border, rgba(255, 255, 255, 0.12));
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
}
.wesync-confirm-title { font-size: 14px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.wesync-confirm-body { font-size: 12px; line-height: 1.7; color: var(--dsw-alias-label-secondary); }
.wesync-confirm-path {
  display: block;
  margin-top: 6px;
  padding: 6px 8px;
  border-radius: 6px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
  font-size: 11px;
  word-break: break-all;
  user-select: all;
}
.wesync-confirm-actions { display: flex; gap: 8px; justify-content: flex-end; }
.wesync-confirm-actions .wesync-market-install { flex: 0 0 auto; padding: 6px 18px; }

/* ── 应用启动器：本地库 we应用 瓷砖的 ▶ 启动按钮 ──────────────────── */
.wesync-app-launch {
  flex: 0 0 auto;
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  color: #fca5a5;
}

/* 禁用会话正文两侧的「拖拽调整宽度」把手，与轨迹页表现一致。
   harness 只在检测到 composer-overlay 标记时隐藏这对把手（见
   ui-conversation ConversationRoot.module.css），而本面板不接管
   composer，套用那个标记会连带改成全出血 + 悬浮输入框布局。
   所以这里按自家根类名精确命中：仅当 wallpaper_share 标签页挂载时
   隐藏把手，切回对话 / 轨迹页不影响 harness 自己的宽度拖拽。 */
body:has(.wesync-panel) [data-width-handle] {
  display: none;
}

/* ── 「设置」页收起宿主输入框 ─────────────────────────────────────────
   share 面板自带全套交互控件，宿主输入框在设置页只会挡住面板底部行；
   翻到「壁纸库」（或切走标签页）自动恢复。page 由 WallpaperSharePanel
   随 state 反射到 body[data-wesync-page]，属性消失即还原。
   收起姿势与沉浸模式同款（opacity+pointer-events，不改布局，seat 高度
   变量稳定）。:has([data-composer-card]) 只认真正的输入条：授权／提问/
   子代理只读条接管编辑器期间 seat 保持可见，不会吞掉等待回答的面板。 */
body[data-wesync-page='settings'] [data-composer-seat]:has([data-composer-card]) {
  opacity: 0 !important;
  pointer-events: none !important;
  transition: opacity 0.3s ease !important;
}
body[data-wesync-page] [data-composer-seat] {
  transition: opacity 0.3s ease !important;
}
`
