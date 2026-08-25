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

.wesync-focusOff {
  background: rgba(139, 92, 246, 0.18);
  border-color: rgba(139, 92, 246, 0.55);
  color: #c4b5fd;
}

.wesync-focusOff:hover:not(:disabled) {
  background: rgba(139, 92, 246, 0.32);
}

.wesync-focusOn {
  background: rgba(46, 160, 67, 0.20);
  border-color: rgba(46, 160, 67, 0.55);
  color: #7ee2a8;
}

.wesync-focusOn:hover:not(:disabled) {
  background: rgba(46, 160, 67, 0.32);
}

.wesync-sourceOff {
  background: rgba(249, 115, 22, 0.15);
  border-color: rgba(249, 115, 22, 0.5);
  color: #fdba74;
}

.wesync-sourceOff:hover:not(:disabled) {
  background: rgba(249, 115, 22, 0.28);
}

.wesync-sourceOn {
  background: rgba(46, 160, 67, 0.20);
  border-color: rgba(46, 160, 67, 0.55);
  color: #7ee2a8;
}

.wesync-sourceOn:hover:not(:disabled) {
  background: rgba(46, 160, 67, 0.32);
}

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

/* 应用启动器：右侧 3×2 可滚动缩略图栏 */
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
  max-height: 300px;
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
