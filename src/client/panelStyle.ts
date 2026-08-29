/**
 * 面板样式（独立构建不再依赖 CSS Modules，运行时注入 <style>）。
 */
export const PANEL_CSS = `
.wesync-panel {
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 660px;
  box-sizing: border-box;
}

.wesync-card {
  padding: 16px 18px;
  border-radius: 12px;
  background: var(--dsw-alias-bg-layer-1);
  border: 1px solid var(--dsw-alias-border-l1);
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

.wesync-actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
  flex-wrap: wrap;
}

.wesync-btn {
  padding: 6px 14px;
  border-radius: 999px;
  border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  font-size: 13px;
  font-family: inherit;
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

.wesync-apps-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
  max-height: 420px;
  overflow-y: auto;
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

/* 壁纸库：类型筛选 chips + 标题搜索 */
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
  padding-bottom: 12px;
  margin-bottom: 12px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
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
  max-height: 140px;
  overflow-y: auto;
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
`
