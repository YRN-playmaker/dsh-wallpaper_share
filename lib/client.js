window.__ModuleLoader__.load({
	id: "dsh-wallpaper_share",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/WallpaperSharePanel.tsx
		/**
		* wallpaper_share 会话视图标签页：当前壁纸信息、同步开关、显示器选择、
		* 专注模式、渲染模式，以及透明度 / 模糊 / 阴影三个滑块（即时生效）。
		* 样式类名由 PANEL_CSS 在 apply 阶段注入，不依赖 CSS Modules。
		*/
		function WallpaperSharePanel() {
			const [, force] = (0, react.useState)(0);
			const [info, setInfo] = (0, react.useState)(store.info);
			const [enabled, setEnabled] = (0, react.useState)(store.settings.enabled);
			const [alpha, setAlpha] = (0, react.useState)(store.settings.panelAlpha);
			const [blur, setBlur] = (0, react.useState)(store.settings.blur);
			const [shadow, setShadow] = (0, react.useState)(store.settings.shadow);
			const [status, setStatus] = (0, react.useState)("");
			const [monitor, setMonitor] = (0, react.useState)(store.settings.monitor);
			const [focus, setFocus] = (0, react.useState)(store.settings.focus);
			const [renderMode, setRenderMode] = (0, react.useState)(store.settings.renderMode);
			const [immersive, setImmersive] = (0, react.useState)(store.settings.immersive);
			(0, react.useEffect)(() => store.subscribe(() => {
				setInfo(store.info);
				force((x) => x + 1);
			}), []);
			const flash = (text) => {
				setStatus(text);
				window.setTimeout(() => setStatus(""), 3500);
			};
			const onAlpha = (v) => {
				store.settings.panelAlpha = v;
				setAlpha(v);
				store.actions.applyTheme();
			};
			const onBlur = (v) => {
				store.settings.blur = v;
				setBlur(v);
				store.actions.applyBackground();
			};
			const onShadow = (v) => {
				store.settings.shadow = v;
				setShadow(v);
				store.actions.applyBackground();
			};
			const onPower = () => {
				const next = !store.settings.enabled;
				store.settings.enabled = next;
				setEnabled(next);
				store.actions.applyBackground();
				flash(next ? "已开启壁纸同步" : "已关闭壁纸同步");
			};
			const onMonitor = (v) => {
				store.settings.monitor = v;
				setMonitor(v);
				store.actions.repoll();
			};
			const onFocus = () => {
				const next = !store.settings.focus;
				store.settings.focus = next;
				setFocus(next);
				store.actions.applyTheme();
				store.actions.applyBackground();
				flash(next ? "专注模式已开启：任务中 30%/15px/90%，空闲 9%/6px/40%" : "专注模式已关闭，恢复手动滑块");
			};
			const onImmersive = () => {
				const next = !store.settings.immersive;
				store.settings.immersive = next;
				setImmersive(next);
				store.actions.applyImmersive();
				store.notify();
				flash(next ? "沉浸模式已开启：对话上边栏/输入框已隐藏，壁纸可交互（Esc 或右上角按钮退出）" : "已退出沉浸模式");
			};
			const onRenderMode = () => {
				const next = store.settings.renderMode === "source" ? "preview" : "source";
				store.settings.renderMode = next;
				setRenderMode(next);
				store.actions.applyBackground();
				if (next === "source") {
					const kind = store.info !== null ? store.info.source.kind : "";
					if (kind === "video") flash("增强模式：播放壁纸源视频");
					else if (kind === "web") flash("增强模式：加载 Web 壁纸页面");
					else if (kind === "scene") flash(store.info?.scene?.live === true ? "增强模式：Scene 实时渲染中" : "增强模式：Scene（renderer 未出帧，回退纹理/预览）");
					else flash("当前壁纸（" + (kind === "" ? "无" : kind) + "）仅支持预览，增强模式自动回退");
				} else flash("性能模式：使用静态预览图");
			};
			const wallpaper = info !== null && info.wallpaper !== null ? info.wallpaper : null;
			const title = wallpaper === null ? info !== null && info.kind === "web" ? "当前为网页壁纸（无本地预览）" : "Wallpaper Engine 尚未应用壁纸" : wallpaper.title;
			const subtitle = wallpaper === null ? "在 Wallpaper Engine 中应用壁纸后，此处会同步显示" : wallpaper.type + (info !== null && info.kind === "image" ? " · 已同步静态预览" : " · 无静态预览图") + (info !== null && info.monitor !== "" ? " · 显示器 " + info.monitor : "") + (info !== null && info.kind === "scene" && info.scene !== null ? " · Scene[" + (info.scene.mode ?? "browser") + "] " + (info.scene.live ? "live " + String(info.scene.status?.fps ?? "?") + "fps" : info.scene.model === true ? "model 渲染" : "fallback:" + info.scene.fallback) : "");
			const monitors = info !== null && Array.isArray(info.monitors) && info.monitors.length > 1 ? info.monitors : null;
			const focusVisuals = focus ? store.settings.taskActive ? FOCUS_WORK : FOCUS_IDLE : null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "wesync-panel",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "wesync-card",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "wesync-title",
							children: title
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "wesync-sub",
							children: subtitle
						}),
						monitors !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "wesync-row",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", { children: "背景显示器" }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
									className: "wesync-select",
									value: monitor,
									onChange: (e) => onMonitor(e.target.value),
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: "",
										children: "自动 · 跟随最新变化"
									}), monitors.map((m) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: m.key,
										children: m.key + " · " + m.title
									}, m.key))]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("output", { children: monitor === "" ? "auto" : monitor })
							]
						}) : null,
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "wesync-actions",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								className: "wesync-btn",
								onClick: onPower,
								children: enabled ? "⏻ 同步开启" : "⏻ 同步关闭"
							})
						}),
						status !== "" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "wesync-status",
							children: status
						}) : null
					]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "wesync-card",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "wesync-sub",
							children: "视觉效果 · 即时生效"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "wesync-actions",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									className: ["wesync-btn", focus ? "wesync-focusOn" : "wesync-focusOff"].join(" "),
									onClick: onFocus,
									children: focus ? store.settings.taskActive ? "专注模式 · 任务进行中" : "专注模式 · 已完成" : "开启专注模式"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									className: ["wesync-btn", renderMode === "source" ? "wesync-sourceOn" : "wesync-sourceOff"].join(" "),
									onClick: onRenderMode,
									children: renderMode === "source" ? "渲染：增强（源文件）" : "渲染：性能（预览）"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									className: ["wesync-btn", immersive ? "wesync-focusOn" : "wesync-focusOff"].join(" "),
									onClick: onImmersive,
									children: immersive ? "沉浸模式 · 已开启" : "开启沉浸模式"
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Slider, {
							label: "面板透明度",
							min: 0,
							max: 100,
							value: focusVisuals !== null ? focusVisuals.panelAlpha : alpha,
							unit: "%",
							disabled: focusVisuals !== null,
							onChange: onAlpha
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Slider, {
							label: "背景模糊",
							min: 0,
							max: 30,
							value: focusVisuals !== null ? focusVisuals.blur : blur,
							unit: "px",
							disabled: focusVisuals !== null,
							onChange: onBlur
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Slider, {
							label: "阴影深度",
							min: 0,
							max: 100,
							value: focusVisuals !== null ? focusVisuals.shadow : shadow,
							unit: "%",
							disabled: focusVisuals !== null,
							onChange: onShadow
						})
					]
				})]
			});
		}
		function Slider(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "wesync-row",
				style: props.disabled === true ? { opacity: .45 } : void 0,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", { children: props.label }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						type: "range",
						min: props.min,
						max: props.max,
						step: 1,
						value: props.value,
						disabled: props.disabled,
						onChange: (e) => props.onChange(Number(e.target.value))
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("output", { children: String(props.value) + props.unit })
				]
			});
		}
		//#endregion
		//#region src/client/panelStyle.ts
		/**
		* 面板样式（独立构建不再依赖 CSS Modules，运行时注入 <style>）。
		*/
		const PANEL_CSS = `
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
`;
		//#endregion
		//#region src/client/SceneCanvas.ts
		/**
		* SceneCanvas —— 浏览器半的 scene 动态背景层。
		*
		* 通过 WebSocket（/we-sync/scene/stream）接收 Node 中继的编码帧，
		* 解码为 ImageBitmap 后按 requestAnimationFrame 画到 <canvas>，覆盖铺满。
		*
		* 职责：canvas resize / devicePixelRatio / 帧解码 / rAF 调度 / 可见性暂停 /
		*       自动重连 / 模糊与缩放（模糊 opacity 仍在 CSS 层，不进 renderer）。
		*/
		const MAX_RECONNECT = 5;
		const RECONNECT_DELAY_MS = 1e3;
		var SceneCanvas = class {
			el = null;
			ctx = null;
			ws = null;
			rafId = 0;
			needDraw = false;
			latest = null;
			dpr = 1;
			live = false;
			closed = false;
			retries = 0;
			reconnectTimer = null;
			blurPx = 0;
			scale = 1;
			handlers;
			constructor(handlers = {}) {
				this.handlers = handlers;
			}
			get isLive() {
				return this.live;
			}
			start(monitor, version) {
				this.stop();
				this.closed = false;
				this.retries = 0;
				this.el = document.createElement("canvas");
				this.el.style.position = "fixed";
				this.el.style.top = "0";
				this.el.style.left = "0";
				this.el.style.width = "100%";
				this.el.style.height = "100%";
				this.el.style.zIndex = "-2";
				this.el.style.pointerEvents = "none";
				this.el.style.border = "0";
				document.body.appendChild(this.el);
				this.ctx = this.el.getContext("2d");
				this.resize();
				this.applyVisuals();
				window.addEventListener("resize", this.onResize);
				document.addEventListener("visibilitychange", this.onVisibility);
				const proto = location.protocol === "https:" ? "wss:" : "ws:";
				const query = (monitor !== "" ? "monitor=" + encodeURIComponent(monitor) : "") + (monitor !== "" ? "&v=" : "v=") + encodeURIComponent(String(version));
				this.connect(proto + "//" + location.host + "/we-sync/scene/stream?" + query);
			}
			stop() {
				this.closed = true;
				this.setLive(false);
				if (this.reconnectTimer !== null) {
					clearTimeout(this.reconnectTimer);
					this.reconnectTimer = null;
				}
				if (this.rafId !== 0) {
					cancelAnimationFrame(this.rafId);
					this.rafId = 0;
				}
				if (this.ws !== null) {
					try {
						this.ws.onclose = null;
						this.ws.onerror = null;
						this.ws.onmessage = null;
						this.ws.close();
					} catch {}
					this.ws = null;
				}
				if (this.latest !== null) {
					try {
						this.latest.close();
					} catch {}
					this.latest = null;
				}
				window.removeEventListener("resize", this.onResize);
				document.removeEventListener("visibilitychange", this.onVisibility);
				if (this.el !== null) {
					this.el.remove();
					this.el = null;
					this.ctx = null;
				}
			}
			applyVisuals(blurPx, scale) {
				if (blurPx !== void 0) this.blurPx = blurPx;
				if (scale !== void 0) this.scale = scale;
				if (this.el !== null) {
					this.el.style.filter = "blur(" + Math.round(this.blurPx) + "px)";
					this.el.style.transform = "scale(" + this.scale.toFixed(3) + ")";
				}
			}
			connect(url) {
				if (this.closed) return;
				let ws;
				try {
					ws = new WebSocket(url);
				} catch {
					this.fail();
					return;
				}
				ws.binaryType = "arraybuffer";
				this.ws = ws;
				ws.onopen = () => {
					this.retries = 0;
				};
				ws.onmessage = (ev) => this.onMessage(ev);
				ws.onerror = () => {};
				ws.onclose = () => {
					if (this.closed) return;
					this.ws = null;
					if (this.retries < MAX_RECONNECT) {
						this.retries += 1;
						this.reconnectTimer = setTimeout(() => this.connect(url), RECONNECT_DELAY_MS);
					} else this.fail();
				};
			}
			fail() {
				this.setLive(false);
				this.closed = true;
			}
			onMessage(ev) {
				if (this.closed) return;
				const buf = ev.data;
				if (!(buf instanceof ArrayBuffer)) return;
				const view = new DataView(buf);
				if (buf.byteLength < 9) return;
				const format = view.getUint8(0);
				const w = view.getUint32(1, true);
				const h = view.getUint32(5, true);
				if (w < 1 || h < 1 || w > 16384 || h > 16384) return;
				const payload = new Uint8Array(buf, 9);
				this.decode(format, w, h, payload);
			}
			decode(format, w, h, payload) {
				let promise;
				if (format === 0) promise = createImageBitmap(new Blob([payload], { type: "image/jpeg" }));
				else if (format === 1) promise = createImageBitmap(new Blob([payload], { type: "image/webp" }));
				else if (format === 2 || format === 3) {
					let px = new Uint8ClampedArray(payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength));
					if (format === 3) px = this.bgraToRgba(payload);
					promise = createImageBitmap(new ImageData(px, w, h));
				} else return;
				promise.then((bmp) => {
					if (this.closed) {
						bmp.close();
						return;
					}
					if (this.latest !== null) try {
						this.latest.close();
					} catch {}
					this.latest = bmp;
					this.retries = 0;
					this.setLive(true);
					this.scheduleDraw();
				}).catch(() => {});
			}
			bgraToRgba(payload) {
				const out = new Uint8ClampedArray(payload.length);
				for (let i = 0; i < payload.length; i += 4) {
					out[i] = payload[i + 2];
					out[i + 1] = payload[i + 1];
					out[i + 2] = payload[i];
					out[i + 3] = payload[i + 3];
				}
				return out;
			}
			scheduleDraw() {
				this.needDraw = true;
				if (this.rafId === 0 && !document.hidden) this.rafId = requestAnimationFrame(this.draw);
			}
			draw = () => {
				this.rafId = 0;
				if (this.closed || this.ctx === null || this.el === null) return;
				if (this.needDraw && this.latest !== null) {
					this.needDraw = false;
					this.drawCover(this.ctx, this.latest, this.el.width, this.el.height);
				}
			};
			/** 以 cover 方式绘制（等比裁切铺满），与 background-size: cover 对齐 */
			drawCover(ctx, bmp, cw, ch) {
				const iw = bmp.width;
				const ih = bmp.height;
				if (iw === 0 || ih === 0) return;
				const scale = Math.max(cw / iw, ch / ih);
				const sw = cw / scale;
				const sh = ch / scale;
				const sx = (iw - sw) / 2;
				const sy = (ih - sh) / 2;
				ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, cw, ch);
			}
			resize() {
				if (this.el === null) return;
				this.dpr = window.devicePixelRatio || 1;
				const w = Math.max(1, Math.round(this.el.clientWidth * this.dpr));
				const h = Math.max(1, Math.round(this.el.clientHeight * this.dpr));
				if (this.el.width !== w) this.el.width = w;
				if (this.el.height !== h) this.el.height = h;
			}
			onResize = () => {
				this.resize();
				this.scheduleDraw();
			};
			onVisibility = () => {
				if (document.hidden) {
					if (this.rafId !== 0) {
						cancelAnimationFrame(this.rafId);
						this.rafId = 0;
					}
				} else this.scheduleDraw();
			};
			setLive(live) {
				if (this.live === live) return;
				this.live = live;
				if (this.handlers.onLiveChange !== void 0) this.handlers.onLiveChange(live);
			}
		};
		//#endregion
		//#region src/scene/ScenePuppet.ts
		/** 按相对时间 t 在关键帧间线性插值（循环动画自动回卷处理） */
		function sampleAnimation(anim, t) {
			const kf = anim.keyframes;
			if (kf.length === 0) return null;
			if (kf.length === 1) return {
				values: kf[0].values,
				t: kf[0].t
			};
			let peak = 0;
			for (let i = 1; i < kf.length; i++) if (kf[i].t > kf[peak].t) peak = i;
			const period = kf[peak].t - kf[0].t;
			if (period <= 0) {
				const n = kf.length;
				const idx = (t % n + n) % n;
				const i0 = Math.floor(idx);
				const frac = idx - i0;
				if (i0 + 1 >= n) return {
					values: kf[i0].values,
					t: i0
				};
				return {
					values: kf[i0].values.map((v, k) => v + (kf[i0 + 1].values[k] - v) * frac),
					t: i0 + frac
				};
			}
			const startT = kf[0].t;
			const curve = [];
			for (let i = 0; i <= peak; i++) curve.push({
				p: kf[i].t - startT,
				values: kf[i].values
			});
			for (let i = peak; i < kf.length; i++) curve.push({
				p: period - (kf[i].t - startT),
				values: kf[i].values
			});
			const mono = [];
			let lastP = -Infinity;
			for (const c of curve) if (c.p >= lastP) {
				mono.push(c);
				lastP = c.p;
			}
			if (mono.length < 2) return {
				values: kf[0].values,
				t: kf[0].t
			};
			const prog = (t % period + period) % period;
			let a = mono[0];
			for (let i = 1; i < mono.length; i++) {
				const b = mono[i];
				if (prog <= b.p) {
					const span = b.p - a.p;
					const frac = span > 0 ? Math.min(1, Math.max(0, (prog - a.p) / span)) : 0;
					return {
						values: a.values.map((v, k) => v + (b.values[k] - v) * frac),
						t: prog + startT
					};
				}
				a = b;
			}
			return {
				values: mono[mono.length - 1].values,
				t: prog + startT
			};
		}
		//#endregion
		//#region src/client/ParticleRuntime.ts
		var ParticleRuntime = class {
			desc;
			rateScale;
			sizeScale;
			particles = [];
			acc = 0;
			time = 0;
			/** 纹理染色缓存（颜色 → 染色 canvas） */
			tintCache = /* @__PURE__ */ new Map();
			constructor(desc, rateScale = 1, sizeScale = 1) {
				this.desc = desc;
				this.rateScale = rateScale;
				this.sizeScale = sizeScale;
			}
			get count() {
				return this.particles.length;
			}
			update(dt) {
				this.time += dt;
				const em = this.desc.emitter;
				const ini = this.desc.initializers;
				const ops = this.desc.operators;
				this.acc += em.rate * this.rateScale * dt;
				while (this.acc >= 1 && this.particles.length < this.desc.maxCount) {
					this.acc -= 1;
					this.spawn(em, ini);
				}
				const g = ops.gravity ?? [
					0,
					0,
					0
				];
				const drag = ops.drag ?? 0;
				const angDrag = ops.angularDrag ?? 0;
				const angForce = ops.angularForce ?? [
					0,
					0,
					0
				];
				const fade = ops.alphaFade;
				const osc = ops.oscillateAlpha;
				const oscPos = ops.oscillatePosition;
				const sizeChanges = ops.sizeChanges ?? [];
				const turb = ops.turbulence;
				for (const p of this.particles) {
					p.life -= dt;
					const frac = 1 - p.life / p.maxLife;
					p.x += p.vx * dt;
					p.y += p.vy * dt;
					p.vx += g[0] * dt;
					p.vy += g[1] * dt;
					if (drag > 0) {
						p.vx *= Math.max(0, 1 - drag * dt);
						p.vy *= Math.max(0, 1 - drag * dt);
					}
					if (angDrag > 0) p.angVel *= Math.max(0, 1 - angDrag * dt);
					p.angVel += angForce[2] * dt;
					p.rot += p.angVel * dt;
					if (oscPos !== void 0) {
						const sw = Math.sin(this.time * p.oscFreq + p.oscPhase);
						p.x += sw * oscPos.mask[0] * dt;
						p.y += sw * oscPos.mask[1] * dt;
					}
					if (turb !== void 0) {
						const phase = this.time * (turb.speedMin + (turb.speedMax - turb.speedMin) * .5) + p.phase;
						p.x += Math.sin(phase) * turb.scale * 100 * dt;
						p.y += Math.cos(phase * .7) * turb.scale * 100 * dt;
					}
					let a = 1;
					if (fade !== void 0) {
						const fadeIn = fade.fadeIn ?? 0;
						const fadeOut = fade.fadeOut ?? 0;
						if (fadeIn > 0 && frac < fadeIn) a = Math.min(a, frac / fadeIn);
						if (fadeOut > 0) {
							const tail = 1 - frac;
							if (tail < fadeOut) a = Math.min(a, tail / fadeOut);
						}
					}
					if (osc !== void 0) {
						const s = Math.sin(this.time * osc.frequencyMax * Math.PI * 2 + p.phase);
						a *= osc.scaleMin + (1 - osc.scaleMin) * Math.max(0, s);
					}
					for (const sc of sizeChanges) if (frac >= sc.startTime) {
						const span = Math.max(1e-4, (sc.endTime ?? 1) - sc.startTime);
						const t = Math.min(1, Math.max(0, (frac - sc.startTime) / span));
						p.size = p.baseSize * (sc.startValue + (sc.endValue - sc.startValue) * t);
					}
					p.alpha = Math.max(0, Math.min(1, a));
				}
				this.particles = this.particles.filter((p) => p.life > 0);
			}
			/**
			* 绘制（局部坐标 → 世界变换 → 画布）。
			* 混合模式按材质 blending：translucent → alpha 混合（source-over，雾/雪等半透明）；
			* additive → 'lighter'（光效/火花）。t 为图层世界变换（含 parent 合并）。
			* 粒子局部 y 向上 → 绘制时翻转。粒子颜色按 colorrandom 染色（缓存染色纹理）。
			*/
			draw(ctx, ox, oy, s, t, tex) {
				const lx = t.sx;
				const ly = t.sy;
				const px0 = ox + t.ox * s;
				const py0 = oy + t.oy * s;
				const additive = this.desc.blending === "additive";
				ctx.save();
				if (additive) ctx.globalCompositeOperation = "lighter";
				for (const p of this.particles) {
					const x = px0 + p.x * lx * s;
					const y = py0 - p.y * ly * s;
					const ps = Math.max(2, p.size * lx * s);
					const aspect = tex.width / tex.height;
					const pw = aspect >= 1 ? ps * aspect : ps;
					const ph = aspect >= 1 ? ps : ps / aspect;
					const img = this.tinted(tex, p.color);
					ctx.globalAlpha = Math.max(0, Math.min(1, p.alpha));
					if (p.rot !== 0) {
						ctx.save();
						ctx.translate(x, y);
						ctx.rotate(p.rot);
						ctx.drawImage(img, -pw / 2, -ph / 2, pw, ph);
						ctx.restore();
					} else ctx.drawImage(img, x - pw / 2, y - ph / 2, pw, ph);
				}
				ctx.restore();
			}
			/** 纹理染色（source-in 保留 alpha），按颜色缓存 */
			tinted(tex, color) {
				const key = color[0] + "," + color[1] + "," + color[2];
				const hit = this.tintCache.get(key);
				if (hit !== void 0) return hit;
				const c = document.createElement("canvas");
				c.width = tex.width;
				c.height = tex.height;
				const g = c.getContext("2d");
				if (g !== null) {
					g.drawImage(tex, 0, 0);
					g.globalCompositeOperation = "source-in";
					g.fillStyle = "rgb(" + color[0] + "," + color[1] + "," + color[2] + ")";
					g.fillRect(0, 0, c.width, c.height);
				}
				this.tintCache.set(key, c);
				return c;
			}
			spawn(em, ini) {
				let x = 0;
				let y = 0;
				const [dx, dy] = em.directions;
				if (em.type === "boxrandom") {
					const d = Array.isArray(em.distanceMax) ? em.distanceMax : [
						em.distanceMax,
						em.distanceMax,
						0
					];
					x = (Math.random() * 2 - 1) * d[0] * .5;
					y = (Math.random() * 2 - 1) * d[1] * .5;
				} else {
					const maxD = typeof em.distanceMax === "number" ? em.distanceMax : Math.hypot(em.distanceMax[0], em.distanceMax[1]);
					const dist = em.distanceMin + Math.random() * Math.max(0, maxD - em.distanceMin);
					x = (Math.random() * 2 - 1) * dist * dx;
					y = (Math.random() * 2 - 1) * dist * dy;
				}
				x += em.origin[0];
				y += em.origin[1];
				const life = rand(ini.lifetime ?? [1, 1]);
				let size;
				if (ini.size !== void 0) {
					const [smn, smx] = ini.size;
					const exp = ini.sizeExponent ?? 1;
					size = (smn + Math.pow(Math.random(), exp) * Math.max(0, smx - smn)) * this.sizeScale;
				} else size = 32 * this.sizeScale;
				let vx = 0;
				let vy = 0;
				if (ini.velocityMin !== void 0 && ini.velocityMax !== void 0) {
					vx = rand(ini.velocityMin[0], ini.velocityMax[0]);
					vy = rand(ini.velocityMin[1], ini.velocityMax[1]);
				}
				if (ini.turbulentVelocity !== void 0) {
					const tv = ini.turbulentVelocity;
					vx += (Math.random() * 2 - 1) * Math.abs(tv.scale) * 100;
					vy += (Math.random() * 2 - 1) * Math.abs(tv.scale) * 100;
				}
				const alpha = rand(ini.alphaMin ?? 1, ini.alphaMax ?? 1);
				let cr = 255;
				let cg = 255;
				let cb = 255;
				if (ini.colorMin !== void 0 && ini.colorMax !== void 0) {
					cr = Math.round(rand(ini.colorMin[0], ini.colorMax[0]));
					cg = Math.round(rand(ini.colorMin[1], ini.colorMax[1]));
					cb = Math.round(rand(ini.colorMin[2], ini.colorMax[2]));
				}
				const rot = ini.rotation !== void 0 ? rand(ini.rotation[0], ini.rotation[1]) : 0;
				const angVel = ini.angularVelocity !== void 0 ? rand(ini.angularVelocity[0], ini.angularVelocity[1]) : 0;
				const osc = this.desc.operators.oscillatePosition;
				const oscFreq = osc !== void 0 ? rand(osc.frequencyMin, osc.frequencyMax) : 0;
				const oscPhase = Math.random() * Math.PI * 2;
				this.particles.push({
					x,
					y,
					vx,
					vy,
					life,
					maxLife: Math.max(.001, life),
					baseSize: size,
					size,
					alpha,
					color: [
						cr,
						cg,
						cb
					],
					rot,
					angVel,
					phase: Math.random() * Math.PI * 2,
					oscPhase,
					oscFreq
				});
			}
		};
		function rand(a, b) {
			if (Array.isArray(a)) {
				const [mn, mx] = a;
				return mn + Math.random() * Math.max(0, mx - mn);
			}
			if (b === void 0) return a;
			return a + Math.random() * Math.max(0, b - a);
		}
		//#endregion
		//#region src/client/SceneModelRenderer.ts
		/**
		* puppet 网格离屏渲染：把部件网格（三角形 + UV 纹理）渲染一次到离屏 canvas。
		* 模型空间（y-up，原点=图片中心）→ canvas 像素（y 向下）：
		*   x_c = x_m, y_c = -y_m（绘制时经场景变换把图片中心对齐图层锚点）。
		* UV v 翻转（模型 v-up → 纹理 v-down）。
		* 每三角形：clip 路径 + 仿射变换（UV 三角 → 位置三角）+ drawImage 纹理。
		*/
		function buildMeshCanvas(mesh, tex) {
			let mnx = Infinity;
			let mny = Infinity;
			let mxx = -Infinity;
			let mxy = -Infinity;
			for (const v of mesh.vertices) {
				const x = v.pos[0];
				const y = -v.pos[1];
				if (x < mnx) mnx = x;
				if (y < mny) mny = y;
				if (x > mxx) mxx = x;
				if (y > mxy) mxy = y;
			}
			const c0 = document.createElement("canvas");
			c0.width = 1;
			c0.height = 1;
			if (!Number.isFinite(mnx) || mxx - mnx > 2e4 || mxy - mny > 2e4) return {
				canvas: c0,
				originX: 0,
				originY: 0
			};
			const pad = 4;
			const cw = Math.max(1, Math.ceil(mxx - mnx) + 8);
			const ch = Math.max(1, Math.ceil(mxy - mny) + 8);
			const c = document.createElement("canvas");
			c.width = cw;
			c.height = ch;
			const g = c.getContext("2d");
			if (g === null) return {
				canvas: c,
				originX: pad - mnx,
				originY: pad - mny
			};
			g.translate(pad - mnx, pad - mny);
			const tw = tex.width;
			const th = tex.height;
			const verts = mesh.vertices;
			const idx = mesh.indices;
			for (let i = 0; i + 2 < idx.length; i += 3) {
				const a = verts[idx[i]];
				const b = verts[idx[i + 1]];
				const cc = verts[idx[i + 2]];
				if (a === void 0 || b === void 0 || cc === void 0) continue;
				const u0 = a.uv[0] * tw;
				const v0 = (1 - a.uv[1]) * th;
				const u1 = b.uv[0] * tw;
				const v1 = (1 - b.uv[1]) * th;
				const u2 = cc.uv[0] * tw;
				const v2 = (1 - cc.uv[1]) * th;
				const x0 = a.pos[0];
				const y0 = -a.pos[1];
				const x1 = b.pos[0];
				const y1 = -b.pos[1];
				const x2 = cc.pos[0];
				const y2 = -cc.pos[1];
				const det = (u1 - u0) * (v2 - v0) - (u2 - u0) * (v1 - v0);
				if (Math.abs(det) < 1e-9) continue;
				g.save();
				g.beginPath();
				g.moveTo(x0, y0);
				g.lineTo(x1, y1);
				g.lineTo(x2, y2);
				g.closePath();
				g.clip();
				const m00 = ((x1 - x0) * (v2 - v0) - (x2 - x0) * (v1 - v0)) / det;
				const m01 = ((u1 - u0) * (x2 - x0) - (u2 - u0) * (x1 - x0)) / det;
				const m10 = ((y1 - y0) * (v2 - v0) - (y2 - y0) * (v1 - v0)) / det;
				const m11 = ((u1 - u0) * (y2 - y0) - (u2 - u0) * (y1 - y0)) / det;
				g.transform(m00, m10, m01, m11, x0 - m00 * u0 - m01 * v0, y0 - m10 * u0 - m11 * v0);
				g.drawImage(tex, 0, 0);
				g.restore();
			}
			return {
				canvas: c,
				originX: pad - mnx,
				originY: pad - mny
			};
		}
		/**
		* 粒子纹理径向软边合成：中心不衰减，边缘 30% 区间线性淡出到透明。
		* 用于雾/雪/光晕类粒子，避免硬边方块在大尺寸 + additive 下叠加成"白线"。
		*/
		function makeSoftTexture(src) {
			const w = src.width;
			const h = src.height;
			const c = document.createElement("canvas");
			c.width = w;
			c.height = h;
			const g = c.getContext("2d");
			if (g === null) return c;
			g.drawImage(src, 0, 0);
			const cx = w / 2;
			const cy = h / 2;
			const r = Math.max(1, Math.min(w, h) / 2);
			const grad = g.createRadialGradient(cx, cy, r * .65, cx, cy, r);
			grad.addColorStop(0, "rgba(255,255,255,1)");
			grad.addColorStop(1, "rgba(255,255,255,0)");
			g.globalCompositeOperation = "destination-in";
			g.fillStyle = grad;
			g.fillRect(0, 0, w, h);
			return c;
		}
		var SceneModelRenderer = class {
			el = null;
			ctx = null;
			model = null;
			base = null;
			layerTextures = /* @__PURE__ */ new Map();
			/** 图层纹理的 Image 内容区域尺寸（tex 画布内左上角）；无则用位图原生尺寸 */
			layerTexImage = /* @__PURE__ */ new Map();
			/** 图层世界变换（递归 parent 合并；局部 y-up 翻转） */
			worldTransform = /* @__PURE__ */ new Map();
			/** 图层 id → 图层（链式查找 puppet 祖先用） */
			byId = /* @__PURE__ */ new Map();
			runtimes = /* @__PURE__ */ new Map();
			particleTextures = /* @__PURE__ */ new Map();
			/** puppet 动画状态：puppet 图层 id → { 动画, 播放时间 } */
			puppetAnims = /* @__PURE__ */ new Map();
			/** 每帧计算的动画变换：puppet 图层 id → 平移/旋转 */
			animXform = /* @__PURE__ */ new Map();
			/** puppet 网格离屏渲染缓存：图层 id → { canvas, 模型原点 } */
			meshCanvases = /* @__PURE__ */ new Map();
			dpr = 1;
			live = false;
			closed = false;
			rafId = 0;
			lastT = 0;
			blurPx = 0;
			scale = 1;
			monitor = "";
			version = 0;
			handlers;
			constructor(handlers = {}) {
				this.handlers = handlers;
			}
			get isLive() {
				return this.live;
			}
			start(monitor, version) {
				this.stop();
				this.closed = false;
				this.monitor = monitor;
				this.version = version;
				this.el = document.createElement("canvas");
				this.el.style.position = "fixed";
				this.el.style.top = "0";
				this.el.style.left = "0";
				this.el.style.width = "100%";
				this.el.style.height = "100%";
				this.el.style.zIndex = "-2";
				this.el.style.pointerEvents = "none";
				this.el.style.border = "0";
				document.body.appendChild(this.el);
				this.ctx = this.el.getContext("2d");
				this.resize();
				this.applyVisuals();
				window.addEventListener("resize", this.onResize);
				document.addEventListener("visibilitychange", this.onVisibility);
				this.load();
			}
			stop() {
				this.closed = true;
				if (this.rafId !== 0) {
					cancelAnimationFrame(this.rafId);
					this.rafId = 0;
				}
				window.removeEventListener("resize", this.onResize);
				document.removeEventListener("visibilitychange", this.onVisibility);
				if (this.el !== null) {
					this.el.remove();
					this.el = null;
					this.ctx = null;
				}
				this.model = null;
				this.base = null;
				for (const bmp of this.layerTextures.values()) try {
					bmp.close();
				} catch {}
				this.layerTextures.clear();
				this.layerTexImage.clear();
				this.worldTransform.clear();
				this.byId.clear();
				this.puppetAnims.clear();
				this.animXform.clear();
				this.meshCanvases.clear();
				for (const bmp of this.particleTextures.values()) try {
					if ("close" in bmp) bmp.close();
				} catch {}
				this.particleTextures.clear();
				this.runtimes.clear();
				this.setLive(false);
			}
			applyVisuals(blurPx, scale) {
				if (blurPx !== void 0) this.blurPx = blurPx;
				if (scale !== void 0) this.scale = scale;
				if (this.el !== null) {
					this.el.style.filter = "blur(" + Math.round(this.blurPx) + "px)";
					this.el.style.transform = "scale(" + this.scale.toFixed(3) + ")";
				}
			}
			async load() {
				if (this.closed) return;
				let model;
				try {
					const res = await fetch("/we-sync/scene/model?monitor=" + encodeURIComponent(this.monitor) + "&v=" + this.version, { cache: "no-store" });
					if (!res.ok) throw new Error("model " + res.status);
					model = await res.json();
				} catch {
					this.fail();
					return;
				}
				if (this.closed) return;
				this.model = model;
				this.byId.clear();
				for (const l of model.layers) this.byId.set(l.id, l);
				this.computeWorldTransforms();
				this.setLive(true);
				this.loadBase(model);
				const jobs = [];
				for (const layer of model.layers) jobs.push(this.loadLayerTexture(layer));
				for (const layer of model.layers) if (layer.particle !== null && layer.particle.textureNames.length > 0) {
					this.runtimes.set(layer.id, new ParticleRuntime(layer.particle, model.particleRateScale, model.particleSizeScale));
					jobs.push(this.loadParticleTexture(layer.id, layer.particle.textureNames[0]));
				}
				for (const layer of model.layers) {
					if (layer.puppet === null || layer.puppet.animations.length === 0) continue;
					const anim = layer.animationIds.length > 0 ? layer.puppet.animations.find((a) => layer.animationIds.includes(a.id)) ?? layer.puppet.animations[0] : layer.puppet.animations[0];
					if (anim.keyframes.length < 2) continue;
					const kf = anim.keyframes;
					let maxSpan = 0;
					for (let vi = 0; vi < 8; vi++) {
						let mn = Infinity;
						let mx = -Infinity;
						for (const k of kf) {
							const v = k.values[vi];
							if (!Number.isFinite(v)) continue;
							if (v < mn) mn = v;
							if (v > mx) mx = v;
						}
						if (Number.isFinite(mn) && mx - mn > maxSpan) maxSpan = mx - mn;
					}
					if (maxSpan < .01) continue;
					this.puppetAnims.set(layer.id, {
						anim,
						time: 0
					});
				}
				if (jobs.length > 0) await Promise.all(jobs);
				if (!this.closed) this.startAnimation();
			}
			/**
			* 递归合并 parent 层级变换（含 attachment 骨骼挂载）。
			* 顶层（无 parent）：WE 场景坐标 **y 向上** → 屏幕 y = 场景高 - origin.y。
			* 子图层：局部坐标 y 向上，父 scale 施加于子的位移与尺寸。
			* attachment（如 "head"/"Attachment"）：子层挂到 parent puppet 的具名骨骼，
			* 锚点 = parent 锚点 + 骨骼局部位置（y-up）+ 子层 origin。
			*/
			computeWorldTransforms() {
				const model = this.model;
				if (model === null) return;
				const H = model.height;
				const byId = /* @__PURE__ */ new Map();
				for (const l of model.layers) byId.set(l.id, l);
				const cache = /* @__PURE__ */ new Map();
				const walk = (l) => {
					const hit = cache.get(l.id);
					if (hit !== void 0) return hit;
					let t;
					const parent = l.parent !== null ? byId.get(l.parent) : void 0;
					if (parent !== void 0) {
						const p = walk(parent);
						const bp = l.attachment !== null && parent.puppet !== null ? parent.puppet.bonePositions?.[l.attachment] : void 0;
						t = {
							ox: p.ox + p.sx * (l.origin[0] + (bp !== void 0 ? bp[0] : 0)),
							oy: p.oy - p.sy * (l.origin[1] + (bp !== void 0 ? bp[1] : 0)),
							sx: p.sx * (l.scale[0] ?? 1),
							sy: p.sy * (l.scale[1] ?? 1)
						};
					} else t = {
						ox: l.origin[0],
						oy: H - l.origin[1],
						sx: l.scale[0] ?? 1,
						sy: l.scale[1] ?? 1
					};
					cache.set(l.id, t);
					return t;
				};
				for (const l of model.layers) walk(l);
				this.worldTransform = cache;
			}
			async loadParticleTexture(layerId, name) {
				try {
					const res = await fetch("/we-sync/asset/texture?name=" + encodeURIComponent(name), { cache: "no-store" });
					if (!res.ok) return;
					const blob = await res.blob();
					const bmp = await createImageBitmap(blob);
					if (this.closed) {
						bmp.close();
						return;
					}
					const soft = makeSoftTexture(bmp);
					bmp.close();
					if (this.closed) return;
					this.particleTextures.set(layerId, soft);
				} catch {}
			}
			async loadLayerTexture(layer) {
				if (this.layerTextures.has(layer.id)) return;
				const candidates = layer.decodableTexture !== null ? [layer.decodableTexture, ...layer.textureRefs.filter((t) => t !== layer.decodableTexture)] : layer.textureRefs;
				for (const name of candidates) {
					if (this.closed) return;
					const got = await this.fetchTexture(name);
					if (got === null) continue;
					if (this.closed) {
						got.bmp.close();
						return;
					}
					this.layerTextures.set(layer.id, got.bmp);
					if (got.imgW > 0 && got.imgH > 0) this.layerTexImage.set(layer.id, [got.imgW, got.imgH]);
					this.startAnimation();
					return;
				}
			}
			async fetchTexture(name) {
				try {
					const res = await fetch("/we-sync/scene/texture?monitor=" + encodeURIComponent(this.monitor) + "&name=" + encodeURIComponent(name), { cache: "no-store" });
					if (!res.ok) return null;
					const blob = await res.blob();
					const bmp = await createImageBitmap(blob);
					const imgW = Number(res.headers.get("X-WE-Image-W"));
					const imgH = Number(res.headers.get("X-WE-Image-H"));
					return {
						bmp,
						imgW: Number.isFinite(imgW) && imgW > 0 ? imgW : bmp.width,
						imgH: Number.isFinite(imgH) && imgH > 0 ? imgH : bmp.height
					};
				} catch {
					return null;
				}
			}
			async loadBase(model) {
				try {
					const res = await fetch("/we-sync/preview?v=" + this.version, { cache: "no-store" });
					if (!res.ok) return;
					const blob = await res.blob();
					const img = new Image();
					img.src = URL.createObjectURL(blob);
					await new Promise((resolve, reject) => {
						img.onload = () => resolve();
						img.onerror = () => reject(/* @__PURE__ */ new Error("preview decode"));
					});
					if (this.closed) {
						URL.revokeObjectURL(img.src);
						return;
					}
					this.base = img;
					this.startAnimation();
				} catch {}
			}
			fail() {
				this.setLive(false);
				this.closed = true;
			}
			startAnimation() {
				if (this.rafId === 0 && !document.hidden) {
					this.lastT = performance.now();
					this.rafId = requestAnimationFrame(this.draw);
				}
			}
			draw = () => {
				this.rafId = 0;
				if (this.closed || this.ctx === null || this.el === null) return;
				const now = performance.now();
				const dt = Math.min(.1, (now - this.lastT) / 1e3);
				this.lastT = now;
				for (const rt of this.runtimes.values()) rt.update(dt);
				this.updatePuppetAnims(dt);
				this.renderScene();
				this.rafId = requestAnimationFrame(this.draw);
			};
			/**
			* 更新 puppet 动画 → 部件变换（装配根整体呼吸 + 部件自身摆动）。
			* 帧值布局（实测）：[pos3][rotZ(v4)][scale3]；v4 摆动 = 绕 z 旋转（呼吸/头发/草）；
			* v0/v1（或 v6/v7，petal 类）变化 = 位置位移（相对首帧）。
			*/
			updatePuppetAnims(dt) {
				this.animXform.clear();
				for (const [layerId, st] of this.puppetAnims) {
					st.time += dt;
					const kf = st.anim.keyframes;
					if (kf.length === 0) continue;
					let peak = 0;
					for (let i = 1; i < kf.length; i++) if (kf[i].t > kf[peak].t) peak = i;
					const period = kf[peak].t - kf[0].t;
					if (period > 5e6) continue;
					const t = period > 0 ? st.time * period / 3 : st.time * (kf.length - 1) / 3;
					const s = sampleAnimation(st.anim, t);
					if (s === null) continue;
					const v = s.values;
					const base = st.anim.keyframes[0].values;
					const spans = [
						0,
						0,
						0,
						0,
						0,
						0,
						0,
						0
					];
					for (let vi = 0; vi < 8; vi++) {
						let mn = Infinity;
						let mx = -Infinity;
						for (const k of kf) {
							const val = k.values[vi];
							if (!Number.isFinite(val)) continue;
							if (val < mn) mn = val;
							if (val > mx) mx = val;
						}
						if (Number.isFinite(mn)) spans[vi] = mx - mn;
					}
					const qx = v[3];
					const qy = v[4];
					const qz = v[5];
					const qw = v[6];
					const qlen2 = qx * qx + qy * qy + qz * qz + qw * qw;
					let rot;
					if (Math.abs(qlen2 - 1) < .05) rot = 2 * Math.atan2(qz, qw);
					else rot = v[4];
					let dx = 0;
					let dy = 0;
					if (spans[0] > .5) dx += v[0] - base[0];
					if (spans[1] > .5) dy += v[1] - base[1];
					if (spans[6] > .5) dx += v[6] - base[6];
					if (spans[7] > .5) dy += v[7] - base[7];
					this.animXform.set(layerId, {
						dx,
						dy,
						rot
					});
				}
			}
			renderScene() {
				const ctx = this.ctx;
				if (ctx === null || this.el === null) return;
				const cw = this.el.clientWidth;
				const ch = this.el.clientHeight;
				if (cw === 0 || ch === 0) return;
				ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
				ctx.clearRect(0, 0, cw, ch);
				const model = this.model;
				if (model === null) return;
				if (this.base !== null) this.drawCoverBase(ctx, this.base, cw, ch);
				else if (model.clearColor !== null) {
					ctx.fillStyle = "rgb(" + Math.round(model.clearColor[0] * 255) + "," + Math.round(model.clearColor[1] * 255) + "," + Math.round(model.clearColor[2] * 255) + ")";
					ctx.fillRect(0, 0, cw, ch);
				}
				const s = Math.max(cw / model.width, ch / model.height);
				const ox = (cw - model.width * s) / 2;
				const oy = (ch - model.height * s) / 2;
				for (const layer of model.layers) {
					if (!layer.visible || layer.alpha <= 0) continue;
					const t = this.worldTransform.get(layer.id);
					let ax = 0;
					let ay = 0;
					let arot = 0;
					const selfXf = this.animXform.get(layer.id);
					if (selfXf !== void 0 && t !== void 0) {
						ax = selfXf.dx;
						ay = -selfXf.dy;
						arot = selfXf.rot;
					} else if (layer.parent !== null) {
						let anchorId = null;
						let p = layer.parent;
						while (p !== null && this.byId.has(p)) {
							if (this.animXform.has(p)) {
								anchorId = p;
								break;
							}
							p = this.byId.get(p)?.parent ?? null;
						}
						if (anchorId !== null && t !== void 0) {
							const xf = this.animXform.get(anchorId);
							const pt = this.worldTransform.get(anchorId);
							if (xf !== void 0 && pt !== void 0) {
								const relx = t.ox - pt.ox;
								const rely = t.oy - pt.oy;
								const c = Math.cos(xf.rot);
								const sn = Math.sin(xf.rot);
								ax = pt.ox + c * relx - sn * rely - t.ox;
								ay = pt.oy + sn * relx + c * rely - t.oy;
								arot = xf.rot;
							}
						}
					}
					const px = ox + ((t !== void 0 ? t.ox : layer.origin[0]) + ax) * s;
					const py = oy + ((t !== void 0 ? t.oy : layer.origin[1]) + ay) * s;
					const rt = this.runtimes.get(layer.id);
					const ptex = this.particleTextures.get(layer.id);
					if (rt !== void 0 && ptex !== void 0) {
						const wt = t ?? {
							ox: layer.origin[0],
							oy: layer.origin[1],
							sx: layer.scale[0] ?? 1,
							sy: layer.scale[1] ?? 1
						};
						rt.draw(ctx, ox, oy, s, wt, ptex);
						continue;
					}
					ctx.save();
					ctx.translate(px, py);
					ctx.rotate((layer.angles[2] ?? 0) * Math.PI / 180 + arot);
					ctx.scale((t !== void 0 ? t.sx : layer.scale[0] ?? 1) * s, (t !== void 0 ? t.sy : layer.scale[1] ?? 1) * s);
					if (layer.alpha < 1) ctx.globalAlpha = Math.max(0, Math.min(1, layer.alpha));
					const bmp = this.layerTextures.get(layer.id) ?? null;
					if (model.puppetMeshRender && layer.puppet !== null && layer.puppet.mesh !== null && bmp !== null) {
						let mc = this.meshCanvases.get(layer.id);
						if (mc === void 0) {
							mc = buildMeshCanvas(layer.puppet.mesh, bmp);
							this.meshCanvases.set(layer.id, mc);
						}
						ctx.drawImage(mc.canvas, -mc.originX, -mc.originY);
					} else if (bmp !== null) {
						const ti = this.layerTexImage.get(layer.id);
						const sw = ti !== void 0 ? ti[0] : bmp.width;
						const sh = ti !== void 0 ? ti[1] : bmp.height;
						const dw = layer.size !== null ? layer.size[0] : sw;
						const dh = layer.size !== null ? layer.size[1] : sh;
						ctx.drawImage(bmp, 0, 0, sw, sh, -dw / 2, -dh / 2, dw, dh);
					} else {
						ctx.fillStyle = "rgba(120, 170, 255, 0.5)";
						ctx.beginPath();
						ctx.arc(0, 0, 3, 0, Math.PI * 2);
						ctx.fill();
					}
					ctx.restore();
					ctx.font = "10px system-ui, sans-serif";
					ctx.textBaseline = "top";
					ctx.fillStyle = "rgba(255,255,255,0.85)";
					ctx.strokeStyle = "rgba(0,0,0,0.55)";
					const label = "#" + layer.id + " " + layer.name + " [" + layer.kind + (this.layerTextures.has(layer.id) ? " tex" : "") + "]";
					ctx.lineWidth = 3;
					ctx.strokeText(label, px + 6, py + 6);
					ctx.fillText(label, px + 6, py + 6);
				}
				ctx.strokeStyle = "rgba(255,255,255,0.28)";
				ctx.lineWidth = 1;
				ctx.strokeRect(ox, oy, model.width * s, model.height * s);
			}
			drawCoverBase(ctx, img, cw, ch) {
				const iw = img.naturalWidth;
				const ih = img.naturalHeight;
				if (iw === 0 || ih === 0) return;
				const s = Math.max(cw / iw, ch / ih);
				const sw = cw / s;
				const sh = ch / s;
				ctx.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, 0, 0, cw, ch);
			}
			resize() {
				if (this.el === null) return;
				this.dpr = window.devicePixelRatio || 1;
				const w = Math.max(1, Math.round(this.el.clientWidth * this.dpr));
				const h = Math.max(1, Math.round(this.el.clientHeight * this.dpr));
				if (this.el.width !== w) this.el.width = w;
				if (this.el.height !== h) this.el.height = h;
			}
			onResize = () => {
				this.resize();
			};
			onVisibility = () => {
				if (document.hidden) {
					if (this.rafId !== 0) {
						cancelAnimationFrame(this.rafId);
						this.rafId = 0;
					}
				} else this.startAnimation();
			};
			setLive(live) {
				if (this.live === live) return;
				this.live = live;
				if (this.handlers.onLiveChange !== void 0) this.handlers.onLiveChange(live);
			}
		};
		//#endregion
		//#region src/client/index.ts
		/**
		* dsh-wallpaper_share · browser half（内部 id / 路由前缀仍为 we-sync）
		* 玻璃面板主题覆盖 + 壁纸背景层 + wallpaper_share 会话视图标签页。
		* 与 node half 通过同源 HTTP 路由（/we-sync/state、/we-sync/preview、
		* /we-sync/source、/we-sync/scene）通信，不依赖任何 RPC 基础设施。
		* 多显示器：?monitor= 锁定某台；不传则跟随"最近变化"的一台。
		*/
		const inject = ["slots", "theme"];
		/** 专注模式：任务进行中 */
		const FOCUS_WORK = {
			panelAlpha: 30,
			blur: 15,
			shadow: 90
		};
		/** 专注模式：任务全部完成 */
		const FOCUS_IDLE = {
			panelAlpha: 9,
			blur: 6,
			shadow: 40
		};
		/** 当前生效的视觉参数（专注模式覆盖用户滑块值） */
		function effectiveVisuals() {
			if (store.settings.focus) return store.settings.taskActive ? FOCUS_WORK : FOCUS_IDLE;
			return {
				panelAlpha: store.settings.panelAlpha,
				blur: store.settings.blur,
				shadow: store.settings.shadow
			};
		}
		/** 包内单例 store：apply 循环更新，面板组件订阅渲染。 */
		const store = {
			info: null,
			settings: {
				enabled: true,
				panelAlpha: 72,
				blur: 6,
				shadow: 30,
				monitor: "",
				focus: false,
				taskActive: false,
				renderMode: "preview",
				immersive: false,
				approvalPending: false
			},
			listeners: /* @__PURE__ */ new Set(),
			actions: {
				applyTheme: () => {},
				applyBackground: () => {},
				applyImmersive: () => {},
				repoll: () => {}
			},
			subscribe(fn) {
				store.listeners.add(fn);
				return () => {
					store.listeners.delete(fn);
				};
			},
			notify() {
				for (const fn of store.listeners) fn();
			}
		};
		function apply(ctx) {
			const theme = ctx.get("theme");
			const slots = ctx.get("slots");
			if (theme === void 0 || slots === void 0) return;
			const sessions = ctx.get("sessions");
			const workspaces = ctx.get("workspaces");
			const themeService = theme;
			const slotsService = slots;
			let themeDisposer = null;
			function applyTheme() {
				if (themeDisposer !== null) {
					themeDisposer();
					themeDisposer = null;
				}
				const a = .3 + effectiveVisuals().panelAlpha / 100 * .6;
				const dark = {
					"--dsw-alias-bg-base": "rgba(15,16,20," + a.toFixed(3) + ")",
					"--dsw-alias-bg-layer-1": "rgba(24,26,32," + (a * .95).toFixed(3) + ")",
					"--dsw-alias-bg-layer-2": "rgba(31,33,40," + (a * .9).toFixed(3) + ")",
					"--dsw-alias-bg-overlay": "rgba(22,24,29," + Math.min(a + .12, .96).toFixed(3) + ")",
					"--dsw-specific-sidebar-fill": "rgba(13,14,17," + (a * .92).toFixed(3) + ")"
				};
				const light = {
					"--dsw-alias-bg-base": "rgba(246,247,250," + Math.min(a + .1, .95).toFixed(3) + ")",
					"--dsw-alias-bg-layer-1": "rgba(255,255,255," + (a * .95).toFixed(3) + ")",
					"--dsw-alias-bg-layer-2": "rgba(251,252,253," + (a * .9).toFixed(3) + ")",
					"--dsw-alias-bg-overlay": "rgba(255,255,255," + Math.min(a + .14, .97).toFixed(3) + ")",
					"--dsw-specific-sidebar-fill": "rgba(238,240,244," + (a * .92).toFixed(3) + ")"
				};
				const tokens = {};
				for (const key of Object.keys(dark)) tokens[key] = {
					light: light[key] ?? "",
					dark: dark[key] ?? ""
				};
				themeDisposer = themeService.overrideTokens("we-sync", tokens);
			}
			const styleTag = document.createElement("style");
			styleTag.dataset.plugin = "dsh-wallpaper_share";
			document.head.appendChild(styleTag);
			const panelStyleTag = document.createElement("style");
			panelStyleTag.dataset.plugin = "dsh-wallpaper_share";
			panelStyleTag.textContent = PANEL_CSS;
			document.head.appendChild(panelStyleTag);
			let mediaEl = null;
			let sceneCanvas = null;
			function stopSceneCanvas() {
				if (sceneCanvas !== null) {
					sceneCanvas.stop();
					sceneCanvas = null;
				}
			}
			let sceneModelRenderer = null;
			function stopSceneModelRenderer() {
				if (sceneModelRenderer !== null) {
					sceneModelRenderer.stop();
					sceneModelRenderer = null;
				}
			}
			function stopSceneLayers() {
				stopSceneCanvas();
				stopSceneModelRenderer();
			}
			function setMedia(el) {
				if (mediaEl !== null && mediaEl !== el) {
					if (mediaEl instanceof HTMLVideoElement) mediaEl.pause();
					mediaEl.remove();
				}
				mediaEl = el;
				if (el !== null) {
					el.style.position = "fixed";
					el.style.top = "0";
					el.style.left = "0";
					el.style.width = "100%";
					el.style.height = "100%";
					el.style.zIndex = "-2";
					el.style.pointerEvents = "none";
					el.style.border = "0";
					document.body.appendChild(el);
				}
			}
			const immersiveStyleTag = document.createElement("style");
			immersiveStyleTag.dataset.plugin = "dsh-wallpaper_share";
			document.head.appendChild(immersiveStyleTag);
			const orbBtn = document.createElement("button");
			orbBtn.type = "button";
			orbBtn.title = "";
			orbBtn.style.cssText = "position:fixed;left:11px;top:232px;width:34px;height:34px;border-radius:50%;border:3px solid rgba(255,255,255,0.4);cursor:pointer;z-index:2147483001;opacity:0;visibility:hidden;background:rgba(15,16,20,0.4);box-shadow:0 2px 8px rgba(0,0,0,0.45);outline:none;transition:opacity 0.25s ease, visibility 0.25s ease, border-color 0.25s ease;";
			document.body.appendChild(orbBtn);
			const STATUS_COLORS = {
				approval: "#eab308",
				running: "#3b82f6",
				idle: "#22c55e"
			};
			function syncStatus() {
				const approval = document.querySelector("[data-approval-key]") !== null;
				if (approval !== store.settings.approvalPending) {
					store.settings.approvalPending = approval;
					store.notify();
				}
				const color = approval ? STATUS_COLORS.approval : store.settings.taskActive ? STATUS_COLORS.running : STATUS_COLORS.idle;
				orbBtn.style.borderColor = color;
				orbBtn.title = approval ? "等待授权" : store.settings.taskActive ? "任务进行中" : "空闲";
				const sidebarCollapsed = document.querySelector("[data-sidebar-collapsed]") !== null;
				orbBtn.style.opacity = sidebarCollapsed ? "1" : "0";
				orbBtn.style.visibility = sidebarCollapsed ? "visible" : "hidden";
			}
			function applyImmersive() {
				const on = store.settings.immersive;
				immersiveStyleTag.textContent = on ? "[data-phase] > header, [data-composer-seat] { opacity: 0 !important; pointer-events: none !important; transition: opacity 0.3s ease !important; }" : "";
				if (mediaEl instanceof HTMLIFrameElement) {
					mediaEl.style.zIndex = on ? "2147483000" : "-2";
					mediaEl.style.pointerEvents = on ? "auto" : "none";
					mediaEl.style.left = on ? "56px" : "0";
					mediaEl.style.width = on ? "calc(100% - 56px)" : "100%";
				}
			}
			orbBtn.addEventListener("click", () => {
				if (!store.settings.immersive) {
					const snap = sessions?.list.getSnapshot();
					const id = snap?.current;
					if (!(id === void 0 || snap != null && snap.byId[id]?.blank === true) && typeof workspaces?.startSession === "function") workspaces.startSession();
				}
				store.settings.immersive = !store.settings.immersive;
				applyImmersive();
				store.notify();
			});
			function onDocClick(ev) {
				if (!store.settings.immersive) return;
				const frame = document.querySelector("[data-sidebar-collapsed]");
				if (frame === null) return;
				const sidebarCol = frame.firstElementChild;
				if (sidebarCol === null) return;
				const target = ev.target;
				if (target instanceof Element) {
					const btn = target.closest("button");
					if (btn !== null && sidebarCol.contains(btn)) {
						store.settings.immersive = false;
						applyImmersive();
						store.notify();
					}
				}
			}
			document.addEventListener("click", onDocClick, true);
			function onImmersiveKey(ev) {
				if (ev.key === "Escape" && store.settings.immersive) {
					store.settings.immersive = false;
					applyImmersive();
					store.notify();
				}
			}
			document.addEventListener("keydown", onImmersiveKey);
			syncStatus();
			let statusRaf = null;
			const scheduleSync = () => {
				if (statusRaf !== null) return;
				statusRaf = requestAnimationFrame(() => {
					statusRaf = null;
					syncStatus();
				});
			};
			const statusObserver = new MutationObserver(() => {
				scheduleSync();
			});
			statusObserver.observe(document.body, {
				childList: true,
				subtree: true,
				attributes: true,
				attributeFilter: ["data-sidebar-collapsed"]
			});
			function applyBackground() {
				const info = store.info;
				const visuals = effectiveVisuals();
				const enabled = store.settings.enabled;
				const blurPx = Math.round(visuals.blur);
				const scale = 1 + blurPx / 400;
				const shadowAlpha = visuals.shadow / 100 * .6;
				const monitorKey = info !== null && info.monitor !== "" ? info.monitor : "";
				const monitorQuery = store.settings.monitor !== "" ? "&monitor=" + encodeURIComponent(store.settings.monitor) : "";
				const rawSourceKind = enabled && info !== null && store.settings.renderMode === "source" ? info.source.kind : "";
				const sceneEnhance = rawSourceKind === "scene" && info !== null && (info.scene?.available === true || info.source.scene === true);
				const sourceKind = rawSourceKind === "video" || rawSourceKind === "web" || rawSourceKind === "image" || sceneEnhance ? rawSourceKind : "";
				let imgUrl = "none";
				if (enabled && info !== null) {
					if (sourceKind === "image") imgUrl = "url(\"/we-sync/source?monitor=" + encodeURIComponent(monitorKey) + "&v=" + info.version + "\")";
					else if (sourceKind === "scene") imgUrl = info.source.scene ? "url(\"/we-sync/scene?monitor=" + encodeURIComponent(monitorKey) + "&v=" + info.version + "\")" : "url(\"/we-sync/preview?v=" + info.version + monitorQuery + "\")";
					else if (sourceKind === "" && info.kind === "image") imgUrl = "url(\"/we-sync/preview?v=" + info.version + monitorQuery + "\")";
				}
				styleTag.textContent = "html { background-color: #0d0e12; }" + (imgUrl !== "none" ? "body::before { content: \"\"; position: fixed; top: 0; left: 0; right: 0; bottom: 0; z-index: -2; background-image: " + imgUrl + "; background-size: cover; background-position: center; background-repeat: no-repeat; filter: blur(" + blurPx + "px); transform: scale(" + scale.toFixed(3) + "); transition: filter 0.12s linear; }" : "") + "body::after { content: \"\"; position: fixed; top: 0; left: 0; right: 0; bottom: 0; z-index: -1; background: linear-gradient(rgba(6,8,12," + shadowAlpha.toFixed(3) + "), rgba(6,8,12," + (shadowAlpha * .85).toFixed(3) + ")); }";
				if (sourceKind === "scene" && info !== null) {
					const sceneMode = info.scene?.mode === "external" ? "external" : "browser";
					if (sceneMode === "external" && info.scene?.available === true) {
						if (sceneCanvas === null) sceneCanvas = new SceneCanvas();
						sceneCanvas.applyVisuals(blurPx, scale);
						sceneCanvas.start(monitorKey, info.version);
						stopSceneModelRenderer();
					} else if (sceneMode === "browser") {
						if (sceneModelRenderer === null) sceneModelRenderer = new SceneModelRenderer();
						sceneModelRenderer.applyVisuals(blurPx, scale);
						sceneModelRenderer.start(monitorKey, info.version);
						stopSceneCanvas();
					} else stopSceneLayers();
					setMedia(null);
				} else if (sourceKind === "video" && info !== null) {
					let video = mediaEl instanceof HTMLVideoElement ? mediaEl : null;
					if (video === null) {
						video = document.createElement("video");
						video.muted = true;
						video.loop = true;
						video.playsInline = true;
						video.autoplay = true;
						setMedia(video);
					}
					const src = "/we-sync/source?monitor=" + encodeURIComponent(monitorKey) + "&v=" + info.version;
					if (video.src !== location.origin + src) video.src = src;
					video.style.filter = "blur(" + blurPx + "px)";
					video.style.transform = "scale(" + scale.toFixed(3) + ")";
					video.style.objectFit = "cover";
					const p = video.play();
					if (p !== void 0 && p !== null) p.catch(() => {});
				} else if (sourceKind === "web" && info !== null) {
					let frame = mediaEl instanceof HTMLIFrameElement ? mediaEl : null;
					if (frame === null) {
						frame = document.createElement("iframe");
						frame.setAttribute("sandbox", "allow-scripts allow-same-origin");
						setMedia(frame);
					}
					const src = typeof info.webPort === "number" && info.webPort > 0 ? "http://127.0.0.1:" + info.webPort + "/index.html?monitor=" + encodeURIComponent(monitorKey) + "&v=" + info.version : location.origin + "/we-sync/wallpaper/index.html?monitor=" + encodeURIComponent(monitorKey) + "&v=" + info.version;
					if (frame.src !== src) frame.src = src;
					frame.style.filter = "blur(" + blurPx + "px)";
				} else {
					stopSceneLayers();
					setMedia(null);
				}
				applyImmersive();
			}
			let polling = false;
			let lastHash = "";
			let lastWebPort = -1;
			async function poll() {
				if (polling) return;
				polling = true;
				try {
					const monitorQuery = store.settings.monitor !== "" ? "?monitor=" + encodeURIComponent(store.settings.monitor) : "";
					const res = await fetch("/we-sync/state" + monitorQuery, { cache: "no-store" });
					if (!res.ok) return;
					const info = await res.json();
					const changed = typeof info.hash === "string" && info.hash !== lastHash;
					const portChanged = typeof info.webPort === "number" && info.webPort !== lastWebPort;
					store.info = info;
					store.notify();
					if (changed || portChanged) {
						lastHash = typeof info.hash === "string" ? info.hash : lastHash;
						lastWebPort = typeof info.webPort === "number" ? info.webPort : lastWebPort;
						applyBackground();
					}
				} catch {}
				polling = false;
			}
			store.actions.applyTheme = applyTheme;
			store.actions.applyBackground = applyBackground;
			store.actions.applyImmersive = applyImmersive;
			store.actions.repoll = () => {
				lastHash = "";
				poll();
			};
			ctx.effect(() => () => {
				styleTag.remove();
				panelStyleTag.remove();
				immersiveStyleTag.remove();
				orbBtn.remove();
				statusObserver.disconnect();
				document.removeEventListener("keydown", onImmersiveKey);
				document.removeEventListener("click", onDocClick, true);
				stopSceneLayers();
				setMedia(null);
				if (themeDisposer !== null) {
					themeDisposer();
					themeDisposer = null;
				}
			});
			ctx.effect(() => {
				const timer = setInterval(() => {
					poll();
				}, 2500);
				poll();
				return () => clearInterval(timer);
			});
			if (sessions !== void 0) {
				const updateTaskState = () => {
					const snapshot = sessions.list.getSnapshot();
					const active = snapshot != null && Object.values(snapshot.byId).some((s) => s.running === true);
					if (active !== store.settings.taskActive) {
						store.settings.taskActive = active;
						if (store.settings.focus) {
							applyTheme();
							applyBackground();
						}
						syncStatus();
						store.notify();
					}
				};
				ctx.effect(() => sessions.list.subscribe(updateTaskState));
				updateTaskState();
			}
			applyTheme();
			applyBackground();
			slotsService.inject("conversation.view", () => slotsService.register({
				name: "conversation.view",
				id: "wallpaper_share",
				order: 20,
				label: "wallpaper_share"
			}, WallpaperSharePanel));
		}
		//#endregion
		exports.FOCUS_IDLE = FOCUS_IDLE;
		exports.FOCUS_WORK = FOCUS_WORK;
		exports.apply = apply;
		exports.effectiveVisuals = effectiveVisuals;
		exports.inject = inject;
		exports.store = store;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map