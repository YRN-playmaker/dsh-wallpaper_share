window.__ModuleLoader__.load({
	id: "dsh-wallpaper_share",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/GazeLens.ts
		/**
		* GazeLens —— 摄像头眼动追踪（透镜视线源）。
		*
		* 设计要点：
		*  - 惰性加载：WebGazer 3.5.3 依赖 MediaPipe FaceMesh（~1.9MB JS + ~10MB WASM/资产），
		*    绝不进基础包；仅当用户在面板开启「眼动追踪」时才从 CDN 动态加载。
		*  - 隐私：关闭时显式 stopVideo() 释放摄像头（webgazer.end() 并不会停流）；全程本地推理，
		*    画面不上网。
		*  - 回落：getGaze() 带时效（默认 1.2s），无脸 / 陈旧时返回 null，由调用方回落到鼠标。
		*  - 校准：webgazer 在 begin() 期间自动从点击 / 鼠标移动采样自校准；calibrate() 提供 9 点
		*    引导序列加速。params.saveDataAcrossSessions=true → 校准样本存 IndexedDB，跨会话复用。
		*
		* 依赖 window.webgazer（由 CDN 脚本挂载）。本模块不 import 任何重型包。
		*/
		const WEBGAZER_JS = "https://cdn.jsdelivr.net/npm/webgazer@3.5.3/dist/webgazer.js";
		const FACEMESH_PATH = "https://cdn.jsdelivr.net/npm/webgazer@3.5.3/dist/mediapipe/face_mesh";
		let wg = null;
		let loadPromise = null;
		let running = false;
		let status = "off";
		let lastGaze = null;
		let lastError = "";
		const statusListeners = /* @__PURE__ */ new Set();
		function setStatus(s, err = "") {
			status = s;
			lastError = err;
			for (const fn of statusListeners) fn(s, err);
		}
		/** 订阅状态变化（loading / running / error…），返回取消订阅函数 */
		function onGazeStatus(fn) {
			statusListeners.add(fn);
			fn(status, lastError);
			return () => {
				statusListeners.delete(fn);
			};
		}
		function loadScript(src) {
			return new Promise((resolve, reject) => {
				const existing = document.querySelector("script[data-gaze=\"webgazer\"]");
				if (existing !== null) {
					if (existing.dataset.loaded === "1") {
						resolve();
						return;
					}
					existing.addEventListener("load", () => resolve());
					existing.addEventListener("error", () => reject(/* @__PURE__ */ new Error("webgazer 脚本加载失败")));
					return;
				}
				const el = document.createElement("script");
				el.src = src;
				el.async = true;
				el.dataset.plugin = "dsh-wallpaper_share";
				el.dataset.gaze = "webgazer";
				el.addEventListener("load", () => {
					el.dataset.loaded = "1";
					resolve();
				});
				el.addEventListener("error", () => reject(/* @__PURE__ */ new Error("webgazer 脚本加载失败（检查网络 / CDN 可达性）")));
				document.head.appendChild(el);
			});
		}
		/** 惰性加载并配置 webgazer（只加载一次） */
		async function ensureWebgazer() {
			if (wg !== null) return wg;
			if (loadPromise !== null) return loadPromise;
			loadPromise = (async () => {
				await loadScript(WEBGAZER_JS);
				const w = window.webgazer;
				if (w === void 0 || w === null) throw new Error("window.webgazer 未挂载");
				w.params.faceMeshSolutionPath = FACEMESH_PATH;
				w.params.saveDataAcrossSessions = true;
				w.params.showVideoPreview = false;
				w.params.showGazeDot = false;
				w.params.showFaceOverlay = false;
				w.params.showFaceFeedbackBox = false;
				w.params.applyKalmanFilter = true;
				w.params.camConstraints = { video: {
					width: { ideal: 640 },
					height: { ideal: 480 },
					facingMode: "user"
				} };
				wg = w;
				return w;
			})().catch((e) => {
				loadPromise = null;
				throw e;
			});
			return loadPromise;
		}
		/** 开启眼动：加载 + begin（请求摄像头）。失败置 error 并回落。 */
		async function startGaze() {
			if (running) return;
			if (navigator.mediaDevices?.getUserMedia === void 0) {
				setStatus("error", "浏览器不支持摄像头（getUserMedia）");
				return;
			}
			setStatus("loading");
			try {
				const w = await ensureWebgazer();
				setStatus("starting");
				w.setRegression("ridge");
				w.setGazeListener((data) => {
					if (data !== null && data !== void 0) lastGaze = {
						x: data.x,
						y: data.y,
						t: Date.now()
					};
				});
				const origAlert = window.alert;
				window.alert = () => {};
				try {
					await w.begin(() => {});
				} finally {
					window.alert = origAlert;
				}
				running = true;
				setStatus("running");
			} catch (e) {
				running = false;
				setStatus("error", "启动失败：" + String(e.message ?? e) + "（可能无摄像头 / 被拒绝 / CDN 不可达）");
			}
		}
		/** 关闭眼动：清监听 + 停处理 + 释放摄像头。 */
		function stopGaze() {
			if (wg === null) {
				setStatus("off");
				return;
			}
			try {
				wg.clearGazeListener();
				wg.removeMouseEventListeners();
				wg.pause();
				wg.stopVideo();
				wg.end();
			} catch {}
			running = false;
			lastGaze = null;
			setStatus("off");
		}
		/** 取当前注视点（视口坐标）。陈旧（默认 >1.2s 无更新，如离开座位 / 无脸）返回 null → 调用方回落鼠标。 */
		function getGaze(maxAgeMs = 1200) {
			if (!running || lastGaze === null) return null;
			if (Date.now() - lastGaze.t > maxAgeMs) return null;
			return {
				x: lastGaze.x,
				y: lastGaze.y
			};
		}
		const CAL_GRID = [
			.1,
			.5,
			.9
		];
		let calibState = null;
		/** 开始 9 点校准（需先 startGaze 成功）。onDone 在全部点完或取消时调用。 */
		function calibrate(onDone) {
			if (calibState !== null) return;
			if (!running) {
				onDone?.(false);
				return;
			}
			if (wg !== null) wg.showVideoPreview(true);
			const pts = [];
			for (const gy of CAL_GRID) for (const gx of CAL_GRID) pts.push({
				x: Math.round(window.innerWidth * gx),
				y: Math.round(window.innerHeight * gy)
			});
			const overlay = document.createElement("div");
			overlay.dataset.plugin = "dsh-wallpaper_share";
			overlay.style.cssText = "position:fixed;inset:0;z-index:2147483002;background:rgba(6,8,12,0.55);cursor:crosshair;";
			const hint = document.createElement("div");
			hint.style.cssText = "position:fixed;left:50%;top:16px;transform:translateX(-50%);color:#fff;font:14px/1.5 system-ui,sans-serif;background:rgba(0,0,0,0.5);padding:6px 14px;border-radius:999px;pointer-events:none;";
			const dot = document.createElement("div");
			dot.style.cssText = "position:fixed;width:26px;height:26px;border-radius:50%;background:#facc15;box-shadow:0 0 0 6px rgba(250,204,21,0.25);transform:translate(-50%,-50%);pointer-events:none;transition:background 0.1s;";
			overlay.appendChild(hint);
			overlay.appendChild(dot);
			document.body.appendChild(overlay);
			const place = () => {
				const p = calibState.pts[calibState.i];
				dot.style.left = p.x + "px";
				dot.style.top = p.y + "px";
				dot.style.background = "#facc15";
				hint.textContent = "注视黄点并点击它（" + String(calibState.i + 1) + " / " + String(pts.length) + "）· 按 Esc 取消";
			};
			const finish = (completed) => {
				if (calibState === null) return;
				document.removeEventListener("click", calibState.onClick, true);
				document.removeEventListener("keydown", onKey, true);
				overlay.remove();
				calibState = null;
				if (wg !== null) wg.showVideoPreview(false);
				onDone?.(completed);
			};
			const onClick = () => {
				if (calibState === null) return;
				dot.style.background = "#4ade80";
				setTimeout(() => {
					if (calibState === null) return;
					calibState.i += 1;
					if (calibState.i >= calibState.pts.length) finish(true);
					else place();
				}, 120);
			};
			const onKey = (e) => {
				if (e.key === "Escape") finish(false);
			};
			calibState = {
				pts,
				i: 0,
				overlay,
				dot,
				onClick
			};
			document.addEventListener("click", onClick, true);
			document.addEventListener("keydown", onKey, true);
			place();
		}
		//#endregion
		//#region src/client/WallpaperSharePanel.tsx
		/**
		* wallpaper_share 会话视图标签页：当前壁纸信息、同步开关、显示器选择、
		* 专注模式、渲染模式，以及透明度 / 模糊 / 阴影三个滑块（即时生效）。
		* 样式类名由 PANEL_CSS 在 apply 阶段注入，不依赖 CSS Modules。
		*/
		const DICT = {
			zh: {
				noWallpaper: "Wallpaper Engine 尚未应用壁纸",
				webNoPreview: "当前为网页壁纸（无本地预览）",
				applyHint: "在 Wallpaper Engine 中应用壁纸后，此处会同步显示",
				staticSynced: " · 已同步静态预览",
				noStaticPreview: " · 无静态预览图",
				monitorPrefix: " · 显示器 ",
				modelRender: "model 渲染",
				fallbackPrefix: "fallback:",
				bgMonitor: "背景显示器",
				autoFollowLatest: "自动 · 跟随最新变化",
				auto: "auto",
				syncOn: "⏻ 同步开启",
				syncOff: "⏻ 同步关闭",
				flashSyncOn: "已开启壁纸同步",
				flashSyncOff: "已关闭壁纸同步",
				visualTitle: "视觉效果 · 即时生效",
				focusMode: "专注模式",
				flashFocusOn: "专注模式已开启：注视点透镜跟随鼠标（圆心清晰）；可再开「眼动追踪」改为跟随视线",
				flashFocusOff: "专注模式已关闭，恢复手动滑块",
				renderModeTitle: "渲染模式",
				modeEco: "节能",
				modePerf: "性能",
				modeEnhanced: "增强",
				flashEco: "节能模式：静态预览图（最省电）",
				flashPerfScene: "性能模式：捕获 WE 桌面背景",
				flashPerfFallback: "性能模式：WE 未运行 / 捕获不可用 → 回退浏览器渲染",
				flashEnhancedScene: "增强模式：浏览器解 pkg 渲染（不依赖 WE，效果覆盖不全）",
				flashVideo: "使用壁纸源视频实时渲染",
				flashWeb: "加载 Web 壁纸页面",
				flashSource: "使用壁纸源文件实时渲染",
				gazeMode: "眼动追踪",
				gazeCalibrate: "校准视线",
				gazeStarting: "眼动：加载模型并请求摄像头…（无需校准，随日常鼠标使用自动学习）",
				gazeOff: "眼动追踪已关闭（摄像头已释放）",
				gazeNeedOn: "请先开启眼动追踪再校准",
				gazeCalibHint: "校准：依次注视并点击 9 个黄点（Esc 取消）",
				gazeCalibDone: "校准完成，透镜将跟随视线",
				gazeCalibCancel: "校准已取消",
				gazeStatusRunning: "· 视线跟随中",
				gazeStatusLoading: "· 眼动加载中…",
				gazeStatusError: "· 眼动出错",
				gazeSnap: "文字吸附",
				panelAlpha: "面板透明度",
				blur: "背景模糊",
				shadow: "阴影深度",
				appsTitle: "壁纸库 · 场景 / 视频 / 图片 / 应用 / 网页",
				collapse: "收起",
				listApps: "浏览壁纸",
				appsEmpty: "未找到壁纸（扫描 workshop + projects + 自定义目录）。点击卡片在资源管理器中打开所在文件夹。",
				appsNoMatch: "没有匹配当前筛选 / 搜索的壁纸",
				openFolder: "打开文件夹：",
				noPreview: "无预览",
				loadFailed: "列表加载失败",
				openFolderFailed: "打开文件夹失败",
				typeAll: "全部",
				typeScene: "场景",
				typeVideo: "视频",
				typeImage: "图片",
				typeApplication: "应用",
				typeWeb: "网页",
				typeOther: "其他",
				searchPlaceholder: "搜索标题…",
				showMore: "显示更多",
				appsCount: (total, matched) => total === matched ? `共 ${String(total)} 个` : `共 ${String(total)} 个 · 匹配 ${String(matched)} 个`,
				dirsTitle: "壁纸读取位置",
				dirsHint: "添加自己收藏的壁纸文件夹：可直接指向某个壁纸目录（含 project.json），或指向包含多个壁纸目录的集合文件夹",
				dirPlaceholder: "粘贴本地壁纸目录路径，如 D:\\MyWallpapers",
				addDir: "添加",
				removeDir: "移除",
				dirEmpty: "尚未添加自定义目录（默认扫描 workshop + projects）",
				dirExists: "该目录已在列表中",
				dirNotFound: "目录不存在或不可读",
				dirAdded: "已添加目录，重新扫描中",
				dirRemoved: "已移除目录"
			},
			en: {
				noWallpaper: "Wallpaper Engine has no active wallpaper",
				webNoPreview: "Current wallpaper is Web type (no local preview)",
				applyHint: "Apply a wallpaper in Wallpaper Engine to sync here",
				staticSynced: " · Static preview synced",
				noStaticPreview: " · No static preview",
				monitorPrefix: " · Monitor ",
				modelRender: "model render",
				fallbackPrefix: "fallback:",
				bgMonitor: "Background Monitor",
				autoFollowLatest: "Auto · Follow Latest",
				auto: "auto",
				syncOn: "⏻ Sync Enabled",
				syncOff: "⏻ Sync Disabled",
				flashSyncOn: "Wallpaper sync enabled",
				flashSyncOff: "Wallpaper sync disabled",
				visualTitle: "Visual Adjustments · Instant",
				focusMode: "Focus Mode",
				flashFocusOn: "Focus mode on: lens follows mouse (clear center); enable Eye Tracking to follow gaze instead",
				flashFocusOff: "Focus mode off, manual sliders restored",
				renderModeTitle: "Render Mode",
				modeEco: "Eco",
				modePerf: "Perf",
				modeEnhanced: "Enhanced",
				flashEco: "Eco mode: static preview (lowest power)",
				flashPerfScene: "Perf mode: capturing WE desktop",
				flashPerfFallback: "Perf mode: WE not running / capture unavailable → fallback to browser render",
				flashEnhancedScene: "Enhanced mode: browser .pkg render (no WE dependency, partial effects)",
				flashVideo: "Live rendering from source video",
				flashWeb: "Loading Web wallpaper page",
				flashSource: "Live rendering from wallpaper source file",
				gazeMode: "Eye Tracking",
				gazeCalibrate: "Calibrate Gaze",
				gazeStarting: "Eye tracking: loading model & requesting camera… (no calibration — self-learns from mouse use)",
				gazeOff: "Eye tracking off (camera released)",
				gazeNeedOn: "Enable eye tracking before calibrating",
				gazeCalibHint: "Calibration: look at and click each of the 9 yellow dots (Esc to cancel)",
				gazeCalibDone: "Calibrated — lens will follow your gaze",
				gazeCalibCancel: "Calibration cancelled",
				gazeStatusRunning: "· gaze following",
				gazeStatusLoading: "· eye tracking loading…",
				gazeStatusError: "· eye tracking error",
				gazeSnap: "Text snap",
				panelAlpha: "Panel Transparency",
				blur: "Background Blur",
				shadow: "Shadow Depth",
				appsTitle: "Wallpaper Library · Scene / Video / Image / App / Web",
				collapse: "Collapse",
				listApps: "Browse Wallpapers",
				appsEmpty: "No wallpapers found (scanned workshop + projects + custom dirs). Click a card to open its folder in File Explorer.",
				appsNoMatch: "No wallpapers match the current filter / search",
				openFolder: "Open folder: ",
				noPreview: "No Preview",
				loadFailed: "Failed to load list",
				openFolderFailed: "Failed to open folder",
				typeAll: "All",
				typeScene: "Scene",
				typeVideo: "Video",
				typeImage: "Image",
				typeApplication: "App",
				typeWeb: "Web",
				typeOther: "Other",
				searchPlaceholder: "Search titles…",
				showMore: "Show more",
				appsCount: (total, matched) => total === matched ? `Total ${String(total)}` : `Total ${String(total)} · Matched ${String(matched)}`,
				dirsTitle: "Wallpaper Read Locations",
				dirsHint: "Add your own wallpaper folders: point to a single wallpaper dir (with project.json) or a collection folder containing wallpaper dirs",
				dirPlaceholder: "Paste a local wallpaper dir path, e.g. D:\\MyWallpapers",
				addDir: "Add",
				removeDir: "Remove",
				dirEmpty: "No custom dirs yet (defaults: workshop + projects)",
				dirExists: "Dir already in list",
				dirNotFound: "Dir missing or unreadable",
				dirAdded: "Dir added, rescanning",
				dirRemoved: "Dir removed"
			}
		};
		function resolveLang() {
			if (store.locale === "zh" || store.locale === "en") return store.locale;
			if (typeof document !== "undefined") {
				const docLang = (document.documentElement.lang ?? "").toLowerCase();
				if (docLang.startsWith("zh")) return "zh";
				if (docLang.startsWith("en")) return "en";
			}
			if (typeof navigator !== "undefined" && navigator.language?.toLowerCase().startsWith("en")) return "en";
			return "zh";
		}
		function WallpaperSharePanel(props) {
			const [, force] = (0, react.useState)(0);
			const t = DICT[resolveLang()];
			const [info, setInfo] = (0, react.useState)(store.info);
			const [enabled, setEnabled] = (0, react.useState)(store.settings.enabled);
			const [alpha, setAlpha] = (0, react.useState)(store.settings.panelAlpha);
			const [blur, setBlur] = (0, react.useState)(store.settings.blur);
			const [shadow, setShadow] = (0, react.useState)(store.settings.shadow);
			const [status, setStatus] = (0, react.useState)("");
			const [monitor, setMonitor] = (0, react.useState)(store.settings.monitor);
			const [focus, setFocus] = (0, react.useState)(store.settings.focus);
			const [renderMode, setRenderMode] = (0, react.useState)(store.settings.renderMode);
			const [gazeEnabled, setGazeEnabled] = (0, react.useState)(store.settings.gazeEnabled);
			const [gazeStatus, setGazeStatus] = (0, react.useState)("off");
			const [gazeError, setGazeError] = (0, react.useState)("");
			const [gazeSnapText, setGazeSnapText] = (0, react.useState)(store.settings.gazeSnapText);
			(0, react.useEffect)(() => onGazeStatus((s, err) => {
				setGazeStatus(s);
				setGazeError(err);
			}), []);
			const [appsOpen, setAppsOpen] = (0, react.useState)(false);
			const [apps, setApps] = (0, react.useState)([]);
			const [appsCounts, setAppsCounts] = (0, react.useState)({});
			const [typeFilter, setTypeFilter] = (0, react.useState)("all");
			const [search, setSearch] = (0, react.useState)("");
			const [visible, setVisible] = (0, react.useState)(60);
			const [appsError, setAppsError] = (0, react.useState)("");
			const [dirs, setDirs] = (0, react.useState)([]);
			const [dirInput, setDirInput] = (0, react.useState)("");
			const [dirStatus, setDirStatus] = (0, react.useState)("");
			(0, react.useEffect)(() => store.subscribe(() => {
				setInfo(store.info);
				force((x) => x + 1);
			}), []);
			(0, react.useEffect)(() => {
				loadDirs();
			}, []);
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
				flash(next ? t.flashSyncOn : t.flashSyncOff);
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
				if (!next && store.settings.gazeEnabled) {
					store.settings.gazeEnabled = false;
					setGazeEnabled(false);
					stopGaze();
				}
				store.actions.applyTheme();
				store.actions.applyBackground();
				flash(next ? t.flashFocusOn : t.flashFocusOff);
			};
			const onRenderMode = (mode) => {
				store.settings.renderMode = mode;
				setRenderMode(mode);
				store.actions.applyBackground();
				const kind = store.info !== null ? store.info.source.kind : "";
				if (mode === "eco") flash(t.flashEco);
				else if (kind === "scene") {
					if (mode === "perf") flash(store.info?.scene?.available === true ? t.flashPerfScene : t.flashPerfFallback);
					else flash(t.flashEnhancedScene);
				} else if (kind === "video") flash(t.flashVideo);
				else if (kind === "web") flash(t.flashWeb);
				else flash(t.flashSource);
			};
			const onGazeToggle = async () => {
				const next = !store.settings.gazeEnabled;
				store.settings.gazeEnabled = next;
				setGazeEnabled(next);
				store.actions.applyBackground();
				if (next) {
					flash(t.gazeStarting);
					await startGaze();
				} else {
					stopGaze();
					flash(t.gazeOff);
				}
				store.notify();
			};
			const onCalibrate = () => {
				if (!store.settings.gazeEnabled) {
					flash(t.gazeNeedOn);
					return;
				}
				flash(t.gazeCalibHint);
				calibrate((completed) => {
					flash(completed ? t.gazeCalibDone : t.gazeCalibCancel);
				});
			};
			const onToggleSnap = () => {
				const next = !store.settings.gazeSnapText;
				store.settings.gazeSnapText = next;
				setGazeSnapText(next);
				store.notify();
			};
			const onAppsToggle = async () => {
				const next = !appsOpen;
				setAppsOpen(next);
				if (next) loadApps();
			};
			const onAppOpen = (id) => {
				fetch("/we-sync/apps/open?id=" + encodeURIComponent(id), { cache: "no-store" }).then((res) => {
					if (!res.ok) flash(t.openFolderFailed);
				}).catch(() => flash(t.openFolderFailed));
			};
			const loadDirs = async () => {
				try {
					const body = await (await fetch("/we-sync/apps/dirs", { cache: "no-store" })).json();
					setDirs(body.dirs ?? []);
				} catch {}
			};
			const loadApps = async () => {
				try {
					const body = await (await fetch("/we-sync/apps", { cache: "no-store" })).json();
					if (body.error !== void 0) setAppsError(body.error);
					else {
						setApps(body.apps ?? []);
						setAppsCounts(body.counts ?? {});
					}
				} catch {
					setAppsError(t.loadFailed);
				}
			};
			const onAddDir = async () => {
				const dir = dirInput.trim();
				if (dir === "") return;
				if (dirs.some((d) => d.replace(/\\/g, "/") === dir.replace(/\\/g, "/"))) {
					setDirStatus(t.dirExists);
					return;
				}
				try {
					const body = await (await fetch("/we-sync/apps/dirs/add?dir=" + encodeURIComponent(dir), { cache: "no-store" })).json();
					if (body.error !== void 0) {
						setDirStatus(body.error);
						return;
					}
					setDirs(body.dirs ?? []);
					setDirInput("");
					setDirStatus(t.dirAdded);
					if (appsOpen) loadApps();
				} catch {
					setDirStatus(t.dirNotFound);
				}
			};
			const onRemoveDir = async (dir) => {
				try {
					const body = await (await fetch("/we-sync/apps/dirs/remove?dir=" + encodeURIComponent(dir), { cache: "no-store" })).json();
					setDirs(body.dirs ?? []);
					setDirStatus(t.dirRemoved);
					if (appsOpen) loadApps();
				} catch {}
			};
			const typeLabel = (tp) => tp === "scene" ? t.typeScene : tp === "video" ? t.typeVideo : tp === "image" ? t.typeImage : tp === "application" ? t.typeApplication : tp === "web" ? t.typeWeb : t.typeOther;
			const filterTypes = [
				"all",
				"scene",
				"video",
				"image",
				"application"
			].concat((appsCounts.web ?? 0) > 0 ? ["web"] : []).concat((appsCounts.other ?? 0) > 0 ? ["other"] : []);
			const kw = search.trim().toLowerCase();
			const filteredApps = apps.filter((a) => (typeFilter === "all" || a.type === typeFilter) && (kw === "" || a.title.toLowerCase().includes(kw)));
			const shownApps = filteredApps.slice(0, visible);
			const wallpaper = info !== null && info.wallpaper !== null ? info.wallpaper : null;
			const title = wallpaper === null ? info !== null && info.kind === "web" ? t.webNoPreview : t.noWallpaper : wallpaper.title;
			const subtitle = wallpaper === null ? t.applyHint : wallpaper.type + (info !== null && info.kind === "image" ? t.staticSynced : t.noStaticPreview) + (info !== null && info.monitor !== "" ? t.monitorPrefix + info.monitor : "") + (info !== null && info.source.kind === "scene" && info.scene !== null ? " · Scene[" + (renderMode === "eco" ? "eco" : info.scene.live === true ? "external" : "browser") + "] " + (info.scene.live ? "live " + String(info.scene.status?.fps ?? "?") + "fps" : info.scene.model === true ? t.modelRender : t.fallbackPrefix + info.scene.fallback) : "");
			const monitors = info !== null && Array.isArray(info.monitors) && info.monitors.length > 1 ? info.monitors : null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "wesync-panel",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
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
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", { children: t.bgMonitor }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
										className: "wesync-select",
										value: monitor,
										onChange: (e) => onMonitor(e.target.value),
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
											value: "",
											children: t.autoFollowLatest
										}), monitors.map((m) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
											value: m.key,
											children: m.key + " · " + m.title
										}, m.key))]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("output", { children: monitor === "" ? t.auto : monitor })
								]
							}) : null,
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "wesync-actions",
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									className: "wesync-btn",
									onClick: onPower,
									children: enabled ? t.syncOn : t.syncOff
								})
							}),
							status !== "" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "wesync-status",
								children: status
							}) : null
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "wesync-card",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "wesync-sub",
								children: t.visualTitle
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "wesync-seg",
								role: "group",
								"aria-label": t.renderModeTitle,
								children: [
									"eco",
									"perf",
									"enhanced"
								].map((m) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: ["wesync-seg-item", renderMode === m ? "wesync-seg-active" : ""].join(" "),
									onClick: () => onRenderMode(m),
									children: m === "eco" ? t.modeEco : m === "perf" ? t.modePerf : t.modeEnhanced
								}, m))
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "wesync-actions",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									className: ["wesync-btn", focus ? "wesync-focusOn" : "wesync-focusOff"].join(" "),
									onClick: onFocus,
									children: t.focusMode
								}), focus ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										className: ["wesync-btn", gazeEnabled ? "wesync-focusOn" : "wesync-focusOff"].join(" "),
										onClick: () => {
											onGazeToggle();
										},
										children: t.gazeMode
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										className: "wesync-btn",
										onClick: onCalibrate,
										disabled: !gazeEnabled,
										children: t.gazeCalibrate
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										className: ["wesync-btn", gazeSnapText ? "wesync-focusOn" : "wesync-focusOff"].join(" "),
										onClick: onToggleSnap,
										children: t.gazeSnap
									}),
									gazeStatus === "running" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: {
											fontSize: "11px",
											color: "#7ee2a8",
											alignSelf: "center"
										},
										children: t.gazeStatusRunning
									}) : gazeStatus === "error" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										style: {
											fontSize: "11px",
											color: "#fdba74",
											alignSelf: "center"
										},
										children: [t.gazeStatusError, gazeError !== "" ? "：" + gazeError : ""]
									}) : gazeEnabled ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: {
											fontSize: "11px",
											color: "rgba(255,255,255,0.6)",
											alignSelf: "center"
										},
										children: t.gazeStatusLoading
									}) : null
								] }) : null]
							}),
							focus ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Slider, {
									label: t.panelAlpha,
									min: 0,
									max: 100,
									value: alpha,
									unit: "%",
									onChange: onAlpha
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Slider, {
									label: t.blur,
									min: 0,
									max: 30,
									value: blur,
									unit: "px",
									onChange: onBlur
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Slider, {
									label: t.shadow,
									min: 0,
									max: 100,
									value: shadow,
									unit: "%",
									onChange: onShadow
								})
							] })
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "wesync-card",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "wesync-apps",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "wesync-dirs",
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											className: "wesync-sub",
											children: t.dirsTitle
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											className: "wesync-sub",
											style: {
												fontSize: 11,
												opacity: .85
											},
											children: t.dirsHint
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: "wesync-dir-row",
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
												className: "wesync-dir-input",
												placeholder: t.dirPlaceholder,
												value: dirInput,
												onChange: (e) => setDirInput(e.target.value),
												onKeyDown: (e) => {
													if (e.key === "Enter") onAddDir();
												}
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												className: "wesync-btn",
												onClick: () => {
													onAddDir();
												},
												children: t.addDir
											})]
										}),
										dirStatus !== "" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											className: "wesync-dir-status",
											children: dirStatus
										}) : null,
										dirs.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											className: "wesync-dir-status",
											children: t.dirEmpty
										}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											className: "wesync-dir-list",
											children: dirs.map((dir) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												className: "wesync-dir-item",
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: "wesync-dir-path",
													title: dir,
													children: dir
												}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
													className: "wesync-dir-remove",
													onClick: () => {
														onRemoveDir(dir);
													},
													children: t.removeDir
												})]
											}, dir))
										})
									]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "wesync-apps-head",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: "wesync-sub",
										children: t.appsTitle
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										className: "wesync-btn",
										onClick: () => {
											onAppsToggle();
										},
										children: appsOpen ? t.collapse : t.listApps
									})]
								}),
								appsOpen ? appsError !== "" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "wesync-app-empty",
									children: appsError
								}) : apps.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "wesync-app-empty",
									children: t.appsEmpty
								}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "wesync-apps-filters",
										children: [filterTypes.map((tp) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											className: ["wesync-chip", typeFilter === tp ? "wesync-chip-on" : ""].join(" "),
											onClick: () => {
												setTypeFilter(tp);
												setVisible(60);
											},
											children: (tp === "all" ? t.typeAll : typeLabel(tp)) + " " + String(tp === "all" ? appsCounts.all ?? apps.length : appsCounts[tp] ?? 0)
										}, tp)), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											className: "wesync-app-search",
											placeholder: t.searchPlaceholder,
											value: search,
											onChange: (e) => {
												setSearch(e.target.value);
												setVisible(60);
											}
										})]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: "wesync-apps-count",
										children: t.appsCount(apps.length, filteredApps.length)
									}),
									filteredApps.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: "wesync-app-empty",
										children: t.appsNoMatch
									}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: "wesync-apps-grid",
										children: shownApps.map((app) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: "wesync-app-card",
											title: t.openFolder + app.title,
											onClick: () => onAppOpen(app.id),
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												className: "wesync-app-thumbwrap",
												children: [app.hasPreview ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
													className: "wesync-app-thumb",
													src: "/we-sync/apps/preview?id=" + encodeURIComponent(app.id),
													alt: app.title,
													loading: "lazy"
												}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
													className: "wesync-app-thumb",
													style: {
														display: "flex",
														alignItems: "center",
														justifyContent: "center"
													},
													children: t.noPreview
												}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: "wesync-app-badge wesync-badge-" + app.type,
													children: typeLabel(app.type)
												})]
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
												className: "wesync-app-title",
												children: app.title
											})]
										}, app.id))
									}), filteredApps.length > shownApps.length ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										className: "wesync-btn wesync-show-more",
										onClick: () => setVisible((v) => v + 60),
										children: t.showMore + " (+60)"
									}) : null] })
								] }) : null
							]
						})
					})
				]
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

/* 专注模式按钮：未开启 = 透明背景白字；开启 = 白背景蓝字（不再区分任务状态） */
.wesync-focusOff {
  background: transparent;
  border-color: rgba(255, 255, 255, 0.5);
  color: #ffffff;
}

.wesync-focusOff:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.14);
}

.wesync-focusOn {
  background: #ffffff;
  border-color: #ffffff;
  color: #2563eb;
  font-weight: 600;
}

.wesync-focusOn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.86);
}

/* 渲染模式三档滑块：选中 = 白底黄字；未选 = 透明底白字 */
.wesync-seg {
  display: flex;
  gap: 2px;
  margin-top: 12px;
  padding: 3px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.28);
  background: rgba(255, 255, 255, 0.06);
}

.wesync-seg-item {
  flex: 1 1 0;
  min-width: 0;
  padding: 6px 8px;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: #ffffff;
  font-size: 13px;
  font-family: inherit;
  cursor: pointer;
  text-align: center;
  white-space: nowrap;
  transition: background 0.15s ease, color 0.15s ease;
}

.wesync-seg-item:hover:not(.wesync-seg-active) {
  background: rgba(255, 255, 255, 0.12);
}

.wesync-seg-active {
  background: #ffffff;
  color: #ca8a04;
  font-weight: 600;
}

.wesync-seg-active:hover {
  background: #ffffff;
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
		//#region src/scene/PuppetSkin.ts
		function mat4Identity() {
			return [
				1,
				0,
				0,
				0,
				0,
				1,
				0,
				0,
				0,
				0,
				1,
				0,
				0,
				0,
				0,
				1
			];
		}
		/** 列主序 4×4 乘法：out = a × b */
		function mat4Mul(a, b) {
			const o = new Array(16);
			for (let c = 0; c < 4; c++) {
				const b0 = b[c * 4], b1 = b[c * 4 + 1], b2 = b[c * 4 + 2], b3 = b[c * 4 + 3];
				for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b0 + a[4 + r] * b1 + a[8 + r] * b2 + a[12 + r] * b3;
			}
			return o;
		}
		/** 4×4 求逆（伴随矩阵法，支持任意可逆矩阵含非均匀缩放；列主序） */
		function mat4Invert(m) {
			const a0 = m[0] * m[5] - m[4] * m[1];
			const a1 = m[0] * m[6] - m[4] * m[2];
			const a2 = m[0] * m[7] - m[4] * m[3];
			const a3 = m[1] * m[6] - m[5] * m[2];
			const a4 = m[1] * m[7] - m[5] * m[3];
			const a5 = m[2] * m[7] - m[6] * m[3];
			const b0 = m[8] * m[13] - m[12] * m[9];
			const b1 = m[8] * m[14] - m[12] * m[10];
			const b2 = m[8] * m[15] - m[12] * m[11];
			const b3 = m[9] * m[14] - m[13] * m[10];
			const b4 = m[9] * m[15] - m[13] * m[11];
			const b5 = m[10] * m[15] - m[14] * m[11];
			const det = a0 * b5 - a1 * b4 + a2 * b3 + a3 * b2 - a4 * b1 + a5 * b0;
			if (Math.abs(det) < 1e-12) return null;
			const id = 1 / det;
			const o = new Array(16);
			o[0] = (m[5] * b5 - m[6] * b4 + m[7] * b3) * id;
			o[1] = (-m[1] * b5 + m[2] * b4 - m[3] * b3) * id;
			o[2] = (m[13] * a5 - m[14] * a4 + m[15] * a3) * id;
			o[3] = (-m[9] * a5 + m[10] * a4 - m[11] * a3) * id;
			o[4] = (-m[4] * b5 + m[6] * b2 - m[7] * b1) * id;
			o[5] = (m[0] * b5 - m[2] * b2 + m[3] * b1) * id;
			o[6] = (-m[12] * a5 + m[14] * a2 - m[15] * a1) * id;
			o[7] = (m[8] * a5 - m[10] * a2 + m[11] * a1) * id;
			o[8] = (m[4] * b4 - m[5] * b2 + m[7] * b0) * id;
			o[9] = (-m[0] * b4 + m[1] * b2 - m[3] * b0) * id;
			o[10] = (m[12] * a4 - m[13] * a2 + m[15] * a0) * id;
			o[11] = (-m[8] * a4 + m[9] * a2 - m[11] * a0) * id;
			o[12] = (-m[4] * b3 + m[5] * b1 - m[6] * b0) * id;
			o[13] = (m[0] * b3 - m[1] * b1 + m[2] * b0) * id;
			o[14] = (-m[12] * a3 + m[13] * a1 - m[14] * a0) * id;
			o[15] = (m[8] * a3 - m[9] * a1 + m[10] * a0) * id;
			return o;
		}
		/** 4×4 仿射（列主序）：T(x,y,z) × Rz(θ) × S(x,y,z)。平移单位、旋转单位、缩放单位。 */
		function mat4TRS(tx, ty, tz, rot, sx, sy, sz) {
			const c = Math.cos(rot);
			const s = Math.sin(rot);
			return [
				c * sx,
				s * sx,
				0,
				0,
				-s * sy,
				c * sy,
				0,
				0,
				0,
				0,
				sz,
				0,
				tx,
				ty,
				tz,
				1
			];
		}
		/**
		* 由欧拉角（弧度，ZYX 顺序：R = Rz × Ry × Rx）构造旋转矩阵（列主序）。
		* 0013 老格式动画帧的旋转 3 分量实为欧拉角（弧度）而非四元数——
		* 睫毛等大幅旋转分量 |q| 可 > 1（如 -101° ≈ -1.77 rad），四元数解释必然错误。
		*/
		function mat4FromEuler(rx, ry, rz) {
			const c1 = Math.cos(rx), s1 = Math.sin(rx);
			const c2 = Math.cos(ry), s2 = Math.sin(ry);
			const c3 = Math.cos(rz), s3 = Math.sin(rz);
			return [
				c2 * c3,
				c2 * s3,
				-s2,
				0,
				s1 * s2 * c3 - c1 * s3,
				s1 * s2 * s3 + c1 * c3,
				s1 * c2,
				0,
				c1 * s2 * c3 + s1 * s3,
				c1 * s2 * s3 - s1 * c3,
				c1 * c2,
				0,
				0,
				0,
				0,
				1
			];
		}
		/** T × R(欧拉角) × S：0013 老格式动画帧 [pos3][euler3][scale3]。 */
		function mat4TRSEuler(tx, ty, tz, rx, ry, rz, sx, sy, sz) {
			const R = mat4FromEuler(rx, ry, rz);
			return [
				R[0] * sx,
				R[1] * sx,
				R[2] * sx,
				R[3],
				R[4] * sy,
				R[5] * sy,
				R[6] * sy,
				R[7],
				R[8] * sz,
				R[9] * sz,
				R[10] * sz,
				R[11],
				tx,
				ty,
				tz,
				1
			];
		}
		/** 变换点：out = M × (x,y,z,1)，返回 [x,y,z]（w 齐次除） */
		function mat4TransformPoint(m, x, y, z) {
			const w = m[3] * x + m[7] * y + m[11] * z + m[15];
			const iw = w !== 0 ? 1 / w : 0;
			return [
				(m[0] * x + m[4] * y + m[8] * z + m[12]) * iw,
				(m[1] * x + m[5] * y + m[9] * z + m[13]) * iw,
				(m[2] * x + m[6] * y + m[10] * z + m[14]) * iw
			];
		}
		/**
		* 计算各骨骼蒙皮矩阵 M_skin_i = M_global_i × M_inv_bind_i。
		*
		* @param binds 各骨骼全局 bind 矩阵（MDLS bind，16 f32 列主序；null = 单位绑定）
		* @param animMats 各骨骼动画全局矩阵（同长度；null = 该骨骼静止 → M_skin = I）
		* @returns 每骨骼 M_skin（16 f32）或 null（静止/不可逆 → 调用方按原始 pos）
		*/
		function computeSkinMatrices(binds, animMats) {
			const n = Math.max(binds.length, animMats.length);
			const out = [];
			for (let i = 0; i < n; i++) {
				const anim = animMats[i] ?? null;
				if (anim === null) {
					out.push(null);
					continue;
				}
				const bind = binds[i] ?? null;
				if (bind === null) {
					out.push(anim);
					continue;
				}
				const inv = mat4Invert(bind);
				if (inv === null) {
					out.push(null);
					continue;
				}
				out.push(mat4Mul(anim, inv));
			}
			return out;
		}
		/**
		* 蒙皮一个顶点：skinPos = Σ w_k × M_skin_{boneIdx[k]} × pos。
		* 骨骼索引越界/权重为 0 的项跳过；M_skin 为 null（静止骨骼）时该项 = 原始 pos。
		* 权重和 < 1 时余量归原始 pos（WE 顶点权重和通常 = 1）。
		*/
		function skinVertex(pos, weights, boneIndices, skin) {
			let x = 0;
			let y = 0;
			let z = 0;
			let wSum = 0;
			const n = Math.min(weights.length, boneIndices.length, 4);
			for (let k = 0; k < n; k++) {
				const w = weights[k];
				if (!(w > 0)) continue;
				const idx = boneIndices[k];
				const m = idx >= 0 && idx < skin.length ? skin[idx] : null;
				if (m === null) {
					x += w * pos[0];
					y += w * pos[1];
					z += w * pos[2];
				} else {
					const p = mat4TransformPoint(m, pos[0], pos[1], pos[2]);
					x += w * p[0];
					y += w * p[1];
					z += w * p[2];
				}
				wSum += w;
			}
			if (wSum < 1 && wSum > 0) {
				const rem = 1 - wSum;
				x += rem * pos[0];
				y += rem * pos[1];
				z += rem * pos[2];
			}
			return [
				x,
				y,
				z
			];
		}
		//#endregion
		//#region src/client/ParticleRuntime.ts
		var ParticleRuntime = class ParticleRuntime {
			desc;
			rateScale;
			sizeScale;
			particles = [];
			acc = 0;
			time = 0;
			/** 纹理染色缓存（颜色 → 染色 canvas） */
			tintCache = /* @__PURE__ */ new Map();
			/** 渲染器类型（sprite | spritetrail | rope）：决定是否沿速度拉伸 */
			rendererType;
			/** spritetrail 的 length 参数（拖尾时长系数） */
			trailLength;
			/** spritetrail 的 maxlength 参数（拖尾最大长度，场景 px；speed×length 上限） */
			trailMaxLength;
			/** spritetrail 的 minlength 参数（拖尾最小长度，场景 px；速度过低时的下限） */
			trailMinLength;
			/** 控制点线段序列索引（mapsequencebetweencontrolpoints 分布用） */
			seqIndex = 0;
			/** 粒子纹理（由 SceneModelRenderer 加载后注入） */
			texture = null;
			/** spritesheet 帧元数据 */
			frames = 0;
			fw = 0;
			fh = 0;
			/** 子粒子系统（children：如 rain_screen 的 static/fast 子雨滴）；
			*  type="eventfollow" 的子系在父粒子位置生成并跟随父粒子事件 */
			children = [];
			/** 本 runtime 是否为 eventfollow 子系（自身不独立发射，只响应父粒子事件） */
			eventFollow = false;
			/** instantaneous 一次性爆发是否已生成（rate=0 + instantaneous 的系统只爆发一次） */
			instantSpawned = false;
			/** 折射法线纹理（材质第二个纹理，REFRACT 粒子用；RG88/RGBA8888n 布局通用解压 (a,g)） */
			normalTexture = null;
			normalFrames = 0;
			normalFw = 0;
			normalFh = 0;
			constructor(desc, rateScale = 1, sizeScale = 1, eventFollow = false) {
				this.desc = desc;
				this.rateScale = rateScale;
				this.sizeScale = sizeScale;
				this.rendererType = desc.renderer?.type ?? "sprite";
				this.trailLength = desc.renderer?.length ?? 0;
				this.trailMaxLength = desc.renderer?.maxlength ?? 0;
				this.trailMinLength = desc.renderer?.minlength ?? 0;
				this.eventFollow = eventFollow;
				for (const c of desc.children) this.children.push({
					rt: new ParticleRuntime(c.desc, rateScale, sizeScale, c.type === "eventfollow"),
					type: c.type
				});
			}
			/** WE Start Time 语义：创建时预模拟（非延迟启动），避免开场空屏。
			*  由 SceneModelRenderer 在根 runtime 上调用一次；子 runtime 随父 update 自然推进。 */
			preSimulate() {
				const target = this.desc.startTime;
				if (target <= 0) return;
				const step = 1 / 30;
				let t = 0;
				while (t < target) {
					const dt = Math.min(step, target - t);
					this.update(dt);
					t += dt;
				}
			}
			/** SceneModelRenderer 加载纹理后注入（含 spritesheet 帧元数据） */
			setTexture(tex, frames = 0, fw = 0, fh = 0) {
				this.texture = tex;
				this.frames = frames;
				this.fw = fw;
				this.fh = fh;
			}
			/** 注入折射法线纹理（REFRACT 材质第二个纹理） */
			setNormalTexture(tex, frames = 0, fw = 0, fh = 0) {
				this.normalTexture = tex;
				this.normalFrames = frames;
				this.normalFw = fw;
				this.normalFh = fh;
			}
			/** 递归收集自身及所有子 runtime（供 SceneModelRenderer 逐层加载纹理） */
			collect() {
				const out = [];
				const walk = (rt) => {
					if (rt.desc.textureNames.length > 0) out.push({
						rt,
						texName: rt.desc.textureNames[0],
						normalName: rt.desc.refract && rt.desc.textureNames.length > 1 ? rt.desc.textureNames[1] : null
					});
					for (const c of rt.children) walk(c.rt);
				};
				walk(this);
				return out;
			}
			/** 纹理是否已就绪（自身或任一子 runtime）——用于区分"无粒子"与"纹理未加载" */
			get textureReady() {
				if (this.texture !== null) return true;
				for (const c of this.children) if (c.rt.textureReady) return true;
				return false;
			}
			/** 释放纹理（ImageBitmap.close）并递归子 runtime */
			dispose() {
				if (this.texture !== null && "close" in this.texture) try {
					this.texture.close();
				} catch {}
				this.texture = null;
				if (this.normalTexture !== null && "close" in this.normalTexture) try {
					this.normalTexture.close();
				} catch {}
				this.normalTexture = null;
				for (const c of this.children) c.rt.dispose();
			}
			/** 是否存在 rope/ropetrail 线渲染器（需 Canvas 绘制，不能走 WebGL 实例化） */
			hasLineRenderer() {
				if (this.rendererType === "rope" || this.rendererType === "ropetrail") return true;
				return this.children.some((c) => c.rt.hasLineRenderer());
			}
			/**
			* 收集 sprite/spritetrail 粒子为 WebGL 实例化批次（每个 runtime 一个批次，
			* 含纹理/帧/混合/折射信息；rope/ropetrail 由调用方走 Canvas）。
			* 变换与 Canvas draw 一致：屏幕 x = px0 + p.x·lx·s，y = py0 − p.y·ly·s，
			* 尺寸不乘对象 scale；spritetrail 沿速度方向拉伸。
			* 官方 quad 语义（genericparticle.vert ComputeParticlePosition）：
			*   quad 宽度 = size，高度 = size × textureRatio（h/w），quad 居中于粒子。
			*/
			collectGl(lx, ly, px0, py0, s, angle = 0) {
				const out = [];
				const walk = (rt) => {
					if (rt.texture !== null && rt.rendererType !== "rope" && rt.rendererType !== "ropetrail") {
						const tex = rt.texture;
						const frames = rt.frames;
						const fw = rt.fw;
						const fh = rt.fh;
						const texRatio = frames > 1 && fw > 0 && fh > 0 ? fh > 0 ? fh / fw : 1 : tex.height > 0 ? tex.height / tex.width : 1;
						const list = [];
						const ca = Math.cos(angle);
						const sa = Math.sin(angle);
						for (const p of rt.particles) {
							const df = rt.desc.perspective ? rt.depthFactor(p) : 1;
							const rx = p.x * ca - p.y * sa;
							const ry = p.x * sa + p.y * ca;
							const x = px0 + rx * lx * s * df;
							const y = py0 - ry * ly * s * df;
							const pwBase = Math.max(2, p.size * s * df);
							const pw = pwBase * lx;
							let size = pw;
							let aspect = texRatio * (ly / lx);
							let rot = p.rot + angle;
							let alpha = p.alpha;
							let gx = x;
							let gy = y;
							if (rt.rendererType === "spritetrail") {
								const localSpd = Math.hypot(p.vx, p.vy);
								const rvx = p.vx * ca - p.vy * sa;
								const rvy = p.vx * sa + p.vy * ca;
								const svx = rvx * lx * df;
								const svy = rvy * ly * df;
								const spd = Math.hypot(svx, svy);
								const maxL = rt.trailMaxLength > 0 ? rt.trailMaxLength : Infinity;
								const minL = rt.trailMinLength > 0 ? rt.trailMinLength : 0;
								const stretch = Math.max(minL, Math.min(localSpd * rt.trailLength, maxL));
								const spdScale = localSpd > .001 ? spd / localSpd : 1;
								const streakLen = pwBase * texRatio * stretch * spdScale;
								if (spd > 2 && streakLen > 2) {
									size = pw;
									aspect = streakLen / pw;
									rot = Math.atan2(-svx, svy);
									gx = x;
									gy = y;
								}
							}
							if (rt.desc.refract && rt.rendererType === "spritetrail") alpha *= .5;
							const frac = 1 - p.life / p.maxLife;
							const frame = rt.pickFrame(p, frac, frames);
							list.push({
								x: gx,
								y: gy,
								size,
								rot,
								r: p.color[0],
								g: p.color[1],
								b: p.color[2],
								a: Math.max(0, Math.min(1, alpha)),
								frame,
								aspect
							});
						}
						if (list.length > 0) out.push({
							particles: list,
							tex,
							normalTex: rt.desc.refract ? rt.normalTexture : null,
							frames,
							fw,
							fh,
							additive: rt.desc.blending === "additive",
							refract: rt.desc.refract && rt.rendererType === "sprite",
							refractAmount: rt.desc.refractAmount,
							trail: rt.rendererType === "spritetrail"
						});
					}
					for (const c of rt.children) walk(c.rt);
				};
				walk(this);
				return out;
			}
			get count() {
				return this.particles.length;
			}
			update(dt) {
				this.time += dt;
				const em = this.desc.emitter;
				const ini = this.desc.initializers;
				this.desc.operators;
				if (!this.instantSpawned && !this.eventFollow && em.instantaneous > 0) {
					this.instantSpawned = true;
					for (let i = 0; i < em.instantaneous && this.particles.length < this.desc.maxCount; i++) this.spawn(em, ini);
				}
				const newEvents = [];
				if (this.time >= this.desc.startTime && !this.eventFollow) {
					this.acc += em.rate * this.rateScale * dt;
					while (this.acc >= 1 && this.particles.length < this.desc.maxCount) {
						this.acc -= 1;
						const p = this.spawn(em, ini);
						if (p !== null) newEvents.push(p);
					}
				}
				this.updateParticles(dt);
				for (const c of this.children) if (c.type === "eventfollow" || c.type === "eventspawn") c.rt.eventFollowUpdate(this.particles, newEvents, dt);
				else c.rt.update(dt);
			}
			/**
			* eventfollow 子粒子更新：在父粒子位置生成。
			*  - 瞬时爆发：每个父粒子出生事件在其位置生成 instantaneous 个（如 shootingstarglow=1）
			*  - 连续发射：rate × dt 分布在存活父粒子上（如 rain_screen_fast_child）
			* 子粒子自身仍按各自算子更新（alphafade/sizechange 等），位置继承父粒子出生点。
			*/
			eventFollowUpdate(parents, newEvents, dt) {
				this.time += dt;
				const em = this.desc.emitter;
				const ini = this.desc.initializers;
				if (!this.instantSpawned) this.instantSpawned = true;
				for (const ev of newEvents) for (let i = 0; i < em.instantaneous && this.particles.length < this.desc.maxCount; i++) {
					const o = this.emitterOffset(em);
					this.spawnAt(ini, ev.x + o.x, ev.y + o.y, ev.z + o.z);
				}
				this.acc += em.rate * this.rateScale * dt;
				while (this.acc >= 1 && this.particles.length < this.desc.maxCount) {
					this.acc -= 1;
					const par = parents.length > 0 ? parents[Math.floor(Math.random() * parents.length)] : null;
					const o = this.emitterOffset(em);
					this.spawnAt(ini, (par !== null ? par.x : 0) + o.x, (par !== null ? par.y : 0) + o.y, (par !== null ? par.z : 0) + o.z);
				}
				this.updateParticles(dt);
				for (const c of this.children) if (c.type === "eventfollow" || c.type === "eventspawn") c.rt.eventFollowUpdate(this.particles, [], dt);
				else c.rt.update(dt);
			}
			/** 更新自身粒子：移动 / 算子（重力/阻尼/振荡/尺寸变化/透明度）/ 寿命过滤 */
			updateParticles(dt) {
				const ops = this.desc.operators;
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
					p.history.push({
						x: p.x,
						y: p.y
					});
					if (p.history.length > 24) p.history.shift();
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
					let a = p.spawnAlpha;
					let fadeFactor = 1;
					if (fade !== void 0) {
						const fadeIn = (fade.fadeIn ?? 0) / p.maxLife;
						const fadeOut = (fade.fadeOut ?? 0) / p.maxLife;
						if (fadeIn > 0 && frac < fadeIn) fadeFactor = Math.min(fadeFactor, frac / fadeIn);
						if (fadeOut > 0) {
							const tail = 1 - frac;
							if (tail < fadeOut) fadeFactor = Math.min(fadeFactor, tail / fadeOut);
						}
					}
					a *= fadeFactor;
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
			* spritesheet 序列帧（frames>1）：按粒子年龄取帧（出生随机相位），从位图中裁剪
			* 对应帧区域绘制——避免整张 8×8 帧矩阵被画出来（雾/烟 64 帧序列纹理）。
			*/
			draw(ctx, ox, oy, s, t, bg = null, angle = 0) {
				const tex = this.texture;
				const frames = this.frames;
				const fw = this.fw;
				const fh = this.fh;
				const lx = t.sx;
				const ly = t.sy;
				const px0 = ox + t.ox * s;
				const py0 = oy + t.oy * s;
				if (tex !== null) this.drawSelf(ctx, ox, oy, s, t, tex, frames, fw, fh, lx, ly, px0, py0, bg, angle);
				for (const c of this.children) c.rt.draw(ctx, ox, oy, s, t, bg, angle);
			}
			/** 该粒子系统（含子粒子）是否使用折射材质 */
			hasRefract() {
				return this.desc.refract || this.children.some((c) => c.rt.hasRefract());
			}
			/** 绘制自身粒子（tex 非空时） */
			drawSelf(ctx, ox, oy, s, t, tex, frames, fw, fh, lx, ly, px0, py0, bg, angle = 0) {
				const additive = this.desc.blending === "additive";
				const sprite = frames > 1 && fw > 0 && fh > 0;
				const cols = sprite ? Math.max(1, Math.floor(tex.width / fw)) : 1;
				const ca = Math.cos(angle);
				const sa = Math.sin(angle);
				ctx.save();
				if (additive) ctx.globalCompositeOperation = "lighter";
				if (this.rendererType === "rope") {
					const pts = this.particles;
					if (pts.length >= 2) for (let i = 1; i < pts.length; i++) {
						const a = pts[i - 1];
						const b = pts[i];
						const arx = a.x * ca - a.y * sa;
						const ary = a.x * sa + a.y * ca;
						const brx = b.x * ca - b.y * sa;
						const bry = b.x * sa + b.y * ca;
						const ax = px0 + arx * lx * s;
						const ay = py0 - ary * ly * s;
						const bx = px0 + brx * lx * s;
						const by = py0 - bry * ly * s;
						const dx = bx - ax;
						const dy = by - ay;
						const segLen = Math.hypot(dx, dy);
						if (segLen < .5) continue;
						const img = this.tinted(tex, b.color);
						ctx.save();
						ctx.translate(ax, ay);
						ctx.rotate(Math.atan2(dy, dx));
						ctx.globalAlpha = Math.max(0, Math.min(1, b.alpha));
						const w = Math.max(1, b.size * s);
						ctx.drawImage(img, 0, 0, tex.width, tex.height, -segLen / 2, -w / 2, segLen, w);
						ctx.restore();
					}
					ctx.restore();
					return;
				}
				if (this.rendererType === "ropetrail") {
					for (const p of this.particles) {
						const hist = p.history;
						if (hist.length < 2) continue;
						const img = this.tinted(tex, p.color);
						const w = Math.max(1, p.size * s);
						for (let hi = 1; hi < hist.length; hi++) {
							const a = hist[hi - 1];
							const b = hist[hi];
							const arx = a.x * ca - a.y * sa;
							const ary = a.x * sa + a.y * ca;
							const brx = b.x * ca - b.y * sa;
							const bry = b.x * sa + b.y * ca;
							const ax = px0 + arx * lx * s;
							const ay = py0 - ary * ly * s;
							const bx = px0 + brx * lx * s;
							const by = py0 - bry * ly * s;
							const dx = bx - ax;
							const dy = by - ay;
							const segLen = Math.hypot(dx, dy);
							if (segLen < .5) continue;
							ctx.save();
							ctx.translate(ax, ay);
							ctx.rotate(Math.atan2(dy, dx));
							ctx.globalAlpha = Math.max(0, Math.min(1, p.alpha));
							ctx.drawImage(img, 0, 0, tex.width, tex.height, 0, -w / 2, segLen, w);
							ctx.restore();
						}
					}
					ctx.restore();
					return;
				}
				let drawn = 0;
				const DRAW_LIMIT = 400;
				for (const p of this.particles) {
					if (drawn >= DRAW_LIMIT) break;
					drawn++;
					const df = this.desc.perspective ? this.depthFactor(p) : 1;
					const x = px0 + (p.x * ca - p.y * sa) * lx * s * df;
					const y = py0 - (p.x * sa + p.y * ca) * ly * s * df;
					const pwBase = Math.max(2, p.size * s * df);
					const fwPx = sprite ? fw : tex.width;
					const texRatio = (sprite ? fh : tex.height) / fwPx;
					const pw = pwBase * lx;
					const ph = pwBase * texRatio * ly;
					const img = this.tinted(tex, p.color);
					ctx.globalAlpha = Math.max(0, Math.min(1, p.alpha));
					if (this.desc.refract && bg !== null && this.rendererType === "sprite") {
						ctx.save();
						const off = pw * .06;
						ctx.drawImage(bg, x - pw / 2 + off, y - ph / 2 + off, pw, ph, x - pw / 2, y - ph / 2, pw, ph);
						ctx.globalCompositeOperation = "destination-in";
						ctx.drawImage(img, x - pw / 2, y - ph / 2, pw, ph);
						ctx.restore();
						continue;
					}
					if (this.desc.refract && this.rendererType === "spritetrail") ctx.globalAlpha *= .5;
					const localSpd = Math.hypot(p.vx, p.vy);
					const svx = p.vx * lx * df;
					const svy = p.vy * ly * df;
					const spd = Math.hypot(svx, svy);
					const maxL = this.trailMaxLength > 0 ? this.trailMaxLength : Infinity;
					const minL = this.trailMinLength > 0 ? this.trailMinLength : 0;
					const stretch = Math.max(minL, Math.min(localSpd * this.trailLength, maxL));
					const spdScale = localSpd > .001 ? spd / localSpd : 1;
					const streakLen = pwBase * texRatio * stretch * spdScale;
					if (this.rendererType === "spritetrail" && spd > 2 && streakLen > 2) {
						const len = streakLen;
						const wid = pw;
						const ang = Math.atan2(svx, svy);
						ctx.save();
						ctx.translate(x, y);
						ctx.rotate(ang);
						if (sprite) {
							const frac = 1 - p.life / p.maxLife;
							const frame = this.pickFrame(p, frac, frames);
							const col = frame % cols;
							const row = Math.floor(frame / cols);
							ctx.drawImage(img, col * fw, row * fh, fw, fh, -wid / 2, -len / 2, wid, len);
						} else ctx.drawImage(img, -wid / 2, -len / 2, wid, len);
						ctx.restore();
					} else if (p.rot !== 0) {
						ctx.save();
						ctx.translate(x, y);
						ctx.rotate(p.rot + angle);
						if (sprite) {
							const frac = 1 - p.life / p.maxLife;
							const frame = this.pickFrame(p, frac, frames);
							const col = frame % cols;
							const row = Math.floor(frame / cols);
							ctx.drawImage(img, col * fw, row * fh, fw, fh, -pw / 2, -ph / 2, pw, ph);
						} else ctx.drawImage(img, -pw / 2, -ph / 2, pw, ph);
						ctx.restore();
					} else if (sprite) {
						const frac = 1 - p.life / p.maxLife;
						const frame = this.pickFrame(p, frac, frames);
						const col = frame % cols;
						const row = Math.floor(frame / cols);
						ctx.drawImage(img, col * fw, row * fh, fw, fh, x - pw / 2, y - ph / 2, pw, ph);
					} else ctx.drawImage(img, x - pw / 2, y - ph / 2, pw, ph);
				}
				ctx.restore();
			}
			/** 纹理染色（source-in 保留 alpha），按颜色缓存 */
			/**
			* 帧选择（官方 genericparticle.vert ComputeSpriteFrame）：
			*  - randomframe：粒子出生随机帧后固定（静态水珠/雨滴）
			*  - 序列（默认，animationmode null/""/sequence）：从第 0 帧开始按寿命推进，
			*    速度 × sequenceMultiplier（particles-general "Sequence multiplier"）。
			*    旧实现给序列模式加随机起始帧 → 雾/烟每团动画相位错乱，此处修正。
			*/
			/**
			* 透视深度因子（perspective rendering — particles-general "Perspective rendering"）。
			* 2D 场景中粒子按 z 深度近大远小：depthFactor = 1 / (1 + max(0, -z) / focal)，
			* 其中 focal = (场景高/2) / tan(fov/2)，z 负 = 场景方向（远）。
			* 粒子位置（向层中心收缩）、尺寸、速度统一 × depthFactor。
			*/
			depthFactor(p) {
				const depth = Math.max(0, -p.z);
				return this.desc.perspectiveFocal / (this.desc.perspectiveFocal + depth);
			}
			pickFrame(p, frac, frames) {
				if (this.desc.animationMode === "randomframe") return p.frame % frames;
				const mult = this.desc.sequenceMultiplier > 0 ? this.desc.sequenceMultiplier : 1;
				const idx = Math.floor(frac * frames * mult);
				return Math.max(0, Math.min(frames - 1, idx));
			}
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
					g.globalCompositeOperation = "multiply";
					g.fillStyle = "rgb(" + color[0] + "," + color[1] + "," + color[2] + ")";
					g.fillRect(0, 0, c.width, c.height);
					g.globalCompositeOperation = "destination-in";
					g.drawImage(tex, 0, 0);
				}
				this.tintCache.set(key, c);
				return c;
			}
			/** 发射器随机位置（发射区 + origin，含 sign 符号限制）→ spawnAt（返回生成的粒子） */
			spawn(em, ini) {
				let x = 0;
				let y = 0;
				if (this.desc.controlPointLine !== null && this.desc.sequenceCount > 0) {
					const [cpx, cpy] = this.desc.controlPointLine;
					const n = Math.max(1, Math.round(this.desc.sequenceCount));
					const period = this.desc.sequenceMirror ? Math.max(1, 2 * (n - 1)) : n;
					const idx = this.seqIndex % period;
					const pos = this.desc.sequenceMirror ? idx <= n - 1 ? idx : period - idx : idx;
					const t = n > 1 ? pos / (n - 1) : 0;
					x = cpx * t;
					y = cpy * t;
					this.seqIndex++;
				} else {
					const o = this.emitterOffset(em);
					x = o.x;
					y = o.y;
					const z = o.z;
					return this.spawnAt(ini, x, y, z);
				}
				return this.spawnAt(ini, x, y, 0);
			}
			/**
			* 发射区随机偏移（boxrandom/sphererandom + origin + sign 符号限制）。
			* eventfollow/eventspawn 子系在父粒子位置叠加此偏移（子系发射区相对父粒子）。
			* z 为发射区深度（sphererandom dirs.z × 半径，perspective rendering 用）。
			*/
			emitterOffset(em) {
				let x = 0;
				let y = 0;
				let z = 0;
				const [dx, dy, dz] = em.directions;
				if (em.type === "boxrandom") {
					const d = Array.isArray(em.distanceMax) ? em.distanceMax : [
						em.distanceMax,
						em.distanceMax,
						0
					];
					x = (Math.random() * 2 - 1) * d[0];
					y = (Math.random() * 2 - 1) * d[1];
					z = (Math.random() * 2 - 1) * (d[2] ?? 0);
				} else {
					const maxD = typeof em.distanceMax === "number" ? em.distanceMax : Math.hypot(em.distanceMax[0], em.distanceMax[1]);
					const ang = Math.random() * Math.PI * 2;
					const rr = em.distanceMin + Math.sqrt(Math.random()) * Math.max(0, maxD - em.distanceMin);
					x = Math.cos(ang) * rr * dx;
					y = Math.sin(ang) * rr * dy;
					z = (Math.random() * 2 - 1) * rr * (dz ?? 0);
				}
				if (em.sign !== void 0) {
					if (em.sign[0] === 1) x = Math.abs(x);
					else if (em.sign[0] === -1) x = -Math.abs(x);
					if (em.sign[1] === 1) y = Math.abs(y);
					else if (em.sign[1] === -1) y = -Math.abs(y);
					if (em.sign[2] === 1) z = Math.abs(z);
					else if (em.sign[2] === -1) z = -Math.abs(z);
				}
				return {
					x: x + em.origin[0],
					y: y + em.origin[1],
					z: z + em.origin[2]
				};
			}
			/** 在指定位置生成粒子（eventfollow 子系在父粒子位置调用）；z 为发射区深度（perspective） */
			spawnAt(ini, x, y, z) {
				const life = rand(ini.lifetime ?? [1, 1]);
				let size;
				if (ini.size !== void 0) {
					const [smn, smx] = ini.size;
					const exp = ini.sizeExponent ?? 1;
					size = (smn + Math.pow(Math.random(), exp) * Math.max(0, smx - smn)) * this.sizeScale;
				} else size = 32 * this.sizeScale;
				let vx = 0;
				let vy = 0;
				if (this.desc.operators.velocityRemap !== void 0) {
					const rm = this.desc.operators.velocityRemap;
					vx = rand(rm.min[0], rm.max[0]);
					vy = rand(rm.min[1], rm.max[1]);
				} else if (ini.velocityMin !== void 0 && ini.velocityMax !== void 0) {
					vx = rand(ini.velocityMin[0], ini.velocityMax[0]);
					vy = rand(ini.velocityMin[1], ini.velocityMax[1]);
				} else if (this.desc.emitter.speedMin !== void 0 && this.desc.emitter.speedMax !== void 0) {
					const speed = rand(this.desc.emitter.speedMin, this.desc.emitter.speedMax);
					const ang = Math.random() * Math.PI * 2;
					vx = Math.cos(ang) * speed;
					vy = Math.sin(ang) * speed;
				}
				if (ini.turbulentVelocity !== void 0) {
					const tv = ini.turbulentVelocity;
					const spd = tv.speedMin !== void 0 && tv.speedMax !== void 0 ? rand(tv.speedMin, tv.speedMax) : tv.speedMin ?? tv.speedMax ?? 100;
					const phase = tv.phaseMin !== void 0 && tv.phaseMax !== void 0 ? rand(tv.phaseMin, tv.phaseMax) : Math.random() * 2 - 1;
					const ts = tv.timescale ?? .1;
					const t = this.time * ts;
					const nx = Math.sin(phase * 1.7 + t * .7) * .7 + Math.sin(phase * 3.1 + t * 1.3) * .3;
					const ny = Math.sin(phase * 2.3 + t * 1.1) * .7 + Math.sin(phase * 4.9 + t * .8) * .3;
					const nz = Math.sin(phase * 1.3 + t * .5) * .7 + Math.sin(phase * 3.7 + t * 1.7) * .3;
					let dx = tv.scale * nx;
					let dy = tv.offset + tv.scale * ny;
					const dz = tv.scale * nz;
					const len = Math.hypot(dx, dy, dz);
					if (len > 1e-4) {
						dx /= len;
						dy /= len;
					}
					vx += dx * spd;
					vy += dy * spd;
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
				const ob = this.desc.overbright > 0 ? this.desc.overbright : 1;
				cr = Math.min(255, Math.round(cr * ob));
				cg = Math.min(255, Math.round(cg * ob));
				cb = Math.min(255, Math.round(cb * ob));
				const osc = this.desc.operators.oscillatePosition;
				const oscFreq = osc !== void 0 ? rand(osc.frequencyMin, osc.frequencyMax) : 0;
				const oscPhase = Math.random() * Math.PI * 2;
				const p = {
					x,
					y,
					z,
					vx,
					vy,
					life,
					maxLife: Math.max(.001, life),
					baseSize: size,
					size,
					alpha,
					spawnAlpha: alpha,
					color: [
						cr,
						cg,
						cb
					],
					rot,
					angVel,
					frame: Math.floor(Math.random() * 64),
					history: [{
						x,
						y
					}],
					phase: Math.random() * Math.PI * 2,
					oscPhase,
					oscFreq
				};
				this.particles.push(p);
				return p;
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
		//#region src/client/ParticleGL.ts
		const VERT = `#version 300 es
layout(location=0) in vec2 a_Pos;
layout(location=1) in vec2 a_Origin;
layout(location=2) in float a_Size;
layout(location=3) in float a_Rot;
layout(location=4) in vec4 a_Color;
layout(location=5) in float a_Frame;
layout(location=6) in float a_Aspect;
uniform vec2 u_Viewport;
uniform float u_Trail;      // 1 = spritetrail（纹理 v 轴沿线，采样 (y,x)）
out vec4 v_Color;
out vec2 v_QuadUv;
out float v_Frame;
void main() {
  // 官方 ComputeParticlePosition：宽度 = size（right 轴），高度 = size × textureRatio（up 轴）
  vec2 corner = (a_Pos - 0.5) * vec2(a_Size, a_Size * a_Aspect);
  float c = cos(a_Rot);
  float s = sin(a_Rot);
  vec2 rc = vec2(corner.x * c - corner.y * s, corner.x * s + corner.y * c);
  vec2 p = a_Origin + rc;
  gl_Position = vec4(p.x / u_Viewport.x * 2.0 - 1.0, 1.0 - p.y / u_Viewport.y * 2.0, 0.0, 1.0);
  v_Color = a_Color;
  // 官方 spritetrail（common_particles.h）：quad 宽轴沿 right（屏幕水平）、长轴沿 up
  // （速度方向），uvs.x → 纹理 u（宽），uvs.y → 纹理 v（长）——不交换。
  // drop 纹理 32×128：128px 的 v 轴沿线拉成雨丝，32px 的 u 轴为雨滴宽度。
  v_QuadUv = a_Pos;
  v_Frame = a_Frame;
}`;
		const FRAG = `#version 300 es
precision mediump float;
uniform sampler2D u_Tex;
uniform sampler2D u_Bg;
uniform sampler2D u_NormalTex;  // REFRACT 法线贴图（RG88/RGBA8888n 布局）
uniform vec4 u_FrameInfo;   // (frames, cols, fw/texW, fh/texH)
uniform float u_Refract;    // 0 | 1
uniform float u_RefractAmount;
uniform vec2 u_Viewport;    // CSS 像素尺寸（粒子 NDC）
uniform vec2 u_ViewportPx;  // 物理像素尺寸（gl_FragCoord 折射用）
in vec4 v_Color;
in vec2 v_QuadUv;
in float v_Frame;
out vec4 fragColor;
void main() {
  float frame = v_Frame;
  float col = mod(frame, u_FrameInfo.y);
  float row = floor(frame / u_FrameInfo.y);
  vec2 uv = (vec2(col, row) + v_QuadUv) * u_FrameInfo.zw;
  // 官方：color = v_Color * ConvertTexture0Format(sample)
  vec4 tex = texture(u_Tex, uv);
  vec4 color = vec4(v_Color.rgb, 1.0) * tex;
  color.a = v_Color.a * tex.a;
  if (u_Refract > 0.5) {
    // 官方折射（genericparticle.frag + common_fragment.h DecompressNormalWithMask）：
    //   offset = tangents·normal（屏幕朝向 tangent=(1,0,0,1)×amount）
    //          = (normal.x × amount, −normal.y × amount) × normal.a × v_Color.a
    //   法线解压：RG88 与 RGBA8888n 布局通用 —— x 在 alpha、y 在 green、mask 在 red
    //   （decodeTex 对 RG88 输出 rgb=R、a=G；RGBA8888n 原样保留 RGBA）
    vec4 nrm = texture(u_NormalTex, uv);
    vec2 n = nrm.ag * 2.0 - 1.0;
    float mask = nrm.r;
    vec2 scrUv = gl_FragCoord.xy / u_ViewportPx;
    vec2 refr = vec2(n.x * u_RefractAmount, -n.y * u_RefractAmount) * mask * v_Color.a;
    color.rgb *= texture(u_Bg, vec2(scrUv.x, 1.0 - scrUv.y) + refr).rgb;
  }
  // 预乘 alpha 输出（画布 premultipliedAlpha:true）：
  //   normal 用 blendFunc(ONE, ONE_MINUS_SRC_ALPHA) —— 画布内正确累积，
  //   additive 用 blendFuncSeparate(ONE, ONE, ZERO, ONE) —— rgb 加法累积、
  //   alpha 恒 0，drawImage 到主画布时 src.rgb + dst.rgb 纯加法（背景不被衰减）。
  fragColor = vec4(color.rgb * color.a, color.a);
}`;
		var ParticleGL = class ParticleGL {
			canvas;
			gl = null;
			prog = null;
			vao = null;
			instBuf = null;
			quadBuf = null;
			idxBuf = null;
			/** 上下文是否已被浏览器逐出（Too many WebGL contexts / webglcontextlost） */
			lost = false;
			/** WEBGL_lose_context 扩展：丢失后原地恢复（restoreContext），避免新建上下文死循环 */
			loseExt = null;
			/** 恢复节流：两次 restore 之间至少间隔（避免立即再被逐出时疯狂重试） */
			lastRestoreAt = 0;
			restoreTimer = null;
			/** 纹理缓存（以纹理对象为 key，避免同尺寸不同内容冲突） */
			texCache = /* @__PURE__ */ new Map();
			bgTex = null;
			data = /* @__PURE__ */ new Float32Array(81920);
			maxParticles = 8192;
			uViewport = null;
			uViewportPx = null;
			uFrameInfo = null;
			uRefract = null;
			uRefractAmount = null;
			uTrail = null;
			uNormalTex = null;
			/** 法线纹理缓存（独立于主纹理缓存，同图复用） */
			normalTexCache = /* @__PURE__ */ new Map();
			/** 空白法线纹理缓存 key（REFRACT 批次未带法线时绑定，mask=0 折射关闭） */
			static BLANK_KEY = {};
			/** draw 日志节流（全局 1 次/秒，避免每帧刷屏） */
			lastDrawLog = 0;
			/** 丢失日志节流：只记第一次与恢复成功 */
			lostLogged = false;
			/** 已显式释放（dispose）：不再自动恢复 */
			disposed = false;
			constructor(canvas) {
				this.canvas = canvas;
				const gl = canvas.getContext("webgl2", {
					alpha: true,
					premultipliedAlpha: true,
					antialias: false
				});
				if (gl === null) return;
				this.gl = gl;
				this.loseExt = gl.getExtension("WEBGL_lose_context");
				this.data = new Float32Array(this.maxParticles * 10);
				if (!this.buildProgramAndBuffers()) return;
				canvas.addEventListener("webglcontextlost", (e) => {
					if (this.disposed) return;
					e.preventDefault();
					this.lost = true;
					if (!this.lostLogged) {
						this.lostLogged = true;
						console.warn("[ParticleGL] WebGL 上下文丢失，原地恢复中…");
					}
					this.scheduleRestore();
				});
				canvas.addEventListener("webglcontextrestored", () => {
					if (this.disposed) return;
					this.lost = false;
					this.lostLogged = false;
					this.texCache.clear();
					this.normalTexCache.clear();
					this.bgTex = null;
					this.buildProgramAndBuffers();
					console.warn("[ParticleGL] WebGL 上下文已恢复");
				});
			}
			/** 编译 program + 建缓冲；失败返回 false */
			buildProgramAndBuffers() {
				const gl = this.gl;
				if (gl === null) return false;
				if (this.prog !== null) {
					gl.deleteProgram(this.prog);
					this.prog = null;
				}
				if (this.vao !== null) {
					gl.deleteVertexArray(this.vao);
					this.vao = null;
				}
				if (this.instBuf !== null) {
					gl.deleteBuffer(this.instBuf);
					this.instBuf = null;
				}
				if (this.quadBuf !== null) {
					gl.deleteBuffer(this.quadBuf);
					this.quadBuf = null;
				}
				if (this.idxBuf !== null) {
					gl.deleteBuffer(this.idxBuf);
					this.idxBuf = null;
				}
				const prog = this.buildProgram(VERT, FRAG);
				if (prog === null) return false;
				this.prog = prog;
				this.uViewport = gl.getUniformLocation(prog, "u_Viewport");
				this.uViewportPx = gl.getUniformLocation(prog, "u_ViewportPx");
				this.uFrameInfo = gl.getUniformLocation(prog, "u_FrameInfo");
				this.uRefract = gl.getUniformLocation(prog, "u_Refract");
				this.uRefractAmount = gl.getUniformLocation(prog, "u_RefractAmount");
				this.uTrail = gl.getUniformLocation(prog, "u_Trail");
				this.uNormalTex = gl.getUniformLocation(prog, "u_NormalTex");
				this.setupBuffers();
				return true;
			}
			/** 上下文丢失后原地恢复（带 500ms 节流，避免立即再被逐出时疯狂重试） */
			scheduleRestore() {
				if (this.restoreTimer !== null) return;
				const wait = Math.max(500, 1500 - (performance.now() - this.lastRestoreAt));
				this.restoreTimer = setTimeout(() => {
					this.restoreTimer = null;
					this.lastRestoreAt = performance.now();
					try {
						if (this.lost && this.loseExt !== null) this.loseExt.restoreContext();
					} catch {}
				}, wait);
			}
			get available() {
				return !this.lost && this.gl !== null && this.prog !== null;
			}
			/** 每帧清空（透明），避免粒子残影 */
			clear() {
				const gl = this.gl;
				if (gl === null || this.lost) return;
				gl.viewport(0, 0, this.canvas.width, this.canvas.height);
				gl.clearColor(0, 0, 0, 0);
				gl.clear(gl.COLOR_BUFFER_BIT);
			}
			/** 场景切换时清空纹理缓存（保留上下文，避免每次 start() 新建 WebGL 上下文） */
			reset() {
				const gl = this.gl;
				if (gl === null) return;
				for (const t of this.texCache.values()) gl.deleteTexture(t);
				this.texCache.clear();
				for (const t of this.normalTexCache.values()) gl.deleteTexture(t);
				this.normalTexCache.clear();
				if (this.bgTex !== null) {
					gl.deleteTexture(this.bgTex);
					this.bgTex = null;
				}
			}
			/** 完全释放（renderer 生命周期结束）：删除 GPU 资源 + 显式丢失上下文 */
			dispose() {
				this.disposed = true;
				if (this.restoreTimer !== null) {
					clearTimeout(this.restoreTimer);
					this.restoreTimer = null;
				}
				const gl = this.gl;
				if (gl === null) return;
				try {
					const ext = gl.getExtension("WEBGL_lose_context");
					if (ext !== null) ext.loseContext();
				} catch {}
				for (const t of this.texCache.values()) gl.deleteTexture(t);
				this.texCache.clear();
				for (const t of this.normalTexCache.values()) gl.deleteTexture(t);
				this.normalTexCache.clear();
				if (this.bgTex !== null) {
					gl.deleteTexture(this.bgTex);
					this.bgTex = null;
				}
				if (this.prog !== null) gl.deleteProgram(this.prog);
				if (this.vao !== null) gl.deleteVertexArray(this.vao);
				if (this.instBuf !== null) gl.deleteBuffer(this.instBuf);
				if (this.quadBuf !== null) gl.deleteBuffer(this.quadBuf);
				if (this.idxBuf !== null) gl.deleteBuffer(this.idxBuf);
				this.prog = null;
				this.vao = null;
				this.instBuf = null;
				this.quadBuf = null;
				this.idxBuf = null;
				this.gl = null;
				this.lost = true;
			}
			buildProgram(vertSrc, fragSrc) {
				const gl = this.gl;
				if (gl === null) return null;
				const compile = (type, src) => {
					const sh = gl.createShader(type);
					if (sh === null) return null;
					gl.shaderSource(sh, src);
					gl.compileShader(sh);
					if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
						console.error("ParticleGL shader error:", gl.getShaderInfoLog(sh));
						gl.deleteShader(sh);
						return null;
					}
					return sh;
				};
				const vs = compile(gl.VERTEX_SHADER, vertSrc);
				const fs = compile(gl.FRAGMENT_SHADER, fragSrc);
				if (vs === null || fs === null) return null;
				const prog = gl.createProgram();
				if (prog === null) return null;
				gl.attachShader(prog, vs);
				gl.attachShader(prog, fs);
				gl.linkProgram(prog);
				gl.deleteShader(vs);
				gl.deleteShader(fs);
				if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
					console.error("ParticleGL link error:", gl.getProgramInfoLog(prog));
					gl.deleteProgram(prog);
					return null;
				}
				return prog;
			}
			setupBuffers() {
				const gl = this.gl;
				if (gl === null || this.prog === null) return;
				this.vao = gl.createVertexArray();
				gl.bindVertexArray(this.vao);
				const quadVerts = new Float32Array([
					0,
					0,
					1,
					0,
					1,
					1,
					0,
					1
				]);
				this.quadBuf = gl.createBuffer();
				gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
				gl.bufferData(gl.ARRAY_BUFFER, quadVerts, gl.STATIC_DRAW);
				gl.enableVertexAttribArray(0);
				gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
				const idx = new Uint16Array([
					0,
					1,
					2,
					0,
					2,
					3
				]);
				this.idxBuf = gl.createBuffer();
				gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.idxBuf);
				gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
				this.instBuf = gl.createBuffer();
				gl.bindBuffer(gl.ARRAY_BUFFER, this.instBuf);
				gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
				const stride = 40;
				const loc = (i) => i;
				gl.enableVertexAttribArray(loc(1));
				gl.vertexAttribPointer(loc(1), 2, gl.FLOAT, false, stride, 0);
				gl.vertexAttribDivisor(loc(1), 1);
				gl.enableVertexAttribArray(loc(2));
				gl.vertexAttribPointer(loc(2), 1, gl.FLOAT, false, stride, 8);
				gl.vertexAttribDivisor(loc(2), 1);
				gl.enableVertexAttribArray(loc(3));
				gl.vertexAttribPointer(loc(3), 1, gl.FLOAT, false, stride, 12);
				gl.vertexAttribDivisor(loc(3), 1);
				gl.enableVertexAttribArray(loc(4));
				gl.vertexAttribPointer(loc(4), 4, gl.FLOAT, false, stride, 16);
				gl.vertexAttribDivisor(loc(4), 1);
				gl.enableVertexAttribArray(loc(5));
				gl.vertexAttribPointer(loc(5), 1, gl.FLOAT, false, stride, 32);
				gl.vertexAttribDivisor(loc(5), 1);
				gl.enableVertexAttribArray(loc(6));
				gl.vertexAttribPointer(loc(6), 1, gl.FLOAT, false, stride, 36);
				gl.vertexAttribDivisor(loc(6), 1);
				gl.bindVertexArray(null);
			}
			/** 粒子纹理（ImageBitmap/Canvas → GL 纹理），以纹理对象为 key 缓存 */
			textureFor(source) {
				const gl = this.gl;
				if (gl === null) return null;
				const hit = this.texCache.get(source);
				if (hit !== void 0) return hit;
				const tex = gl.createTexture();
				if (tex === null) return null;
				gl.bindTexture(gl.TEXTURE_2D, tex);
				gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
				gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
				gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
				gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
				gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
				this.texCache.set(source, tex);
				return tex;
			}
			/** 上传背景（主画布内容）为纹理，供折射采样 */
			uploadBackground(canvas) {
				const gl = this.gl;
				if (gl === null) return;
				if (this.bgTex === null) {
					this.bgTex = gl.createTexture();
					gl.bindTexture(gl.TEXTURE_2D, this.bgTex);
					gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
					gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
					gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
					gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
				} else gl.bindTexture(gl.TEXTURE_2D, this.bgTex);
				gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
			}
			/**
			* 实例化绘制一组粒子（同一纹理/混合模式）。
			* @param particles 粒子数据（最多 maxParticles 个）
			* @param normalTex 折射法线纹理（REFRACT 批次；null = 无法线，用 mask=0 关闭折射）
			*/
			render(particles, opts, tex, normalTex, viewPxW, viewPxH) {
				const gl = this.gl;
				if (gl === null || this.lost || this.prog === null || this.vao === null || this.instBuf === null) return;
				const n = Math.min(particles.length, this.maxParticles);
				if (n === 0) return;
				const glTex = this.textureFor(tex);
				if (glTex === null) return;
				let o = 0;
				for (let i = 0; i < n; i++) {
					const p = particles[i];
					this.data[o++] = p.x;
					this.data[o++] = p.y;
					this.data[o++] = p.size;
					this.data[o++] = p.rot;
					this.data[o++] = p.r / 255;
					this.data[o++] = p.g / 255;
					this.data[o++] = p.b / 255;
					this.data[o++] = p.a;
					this.data[o++] = p.frame;
					this.data[o++] = p.aspect;
				}
				gl.useProgram(this.prog);
				gl.bindVertexArray(this.vao);
				gl.bindBuffer(gl.ARRAY_BUFFER, this.instBuf);
				gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.data.subarray(0, n * 10));
				gl.uniform2f(this.uViewport, opts.viewW, opts.viewH);
				gl.uniform2f(this.uViewportPx, viewPxW, viewPxH);
				const cols = opts.frames > 1 && opts.fw > 0 ? Math.max(1, Math.floor(tex.width / opts.fw)) : 1;
				gl.uniform4f(this.uFrameInfo, opts.frames, cols, opts.fw > 0 ? opts.fw / tex.width : 1, opts.fh > 0 ? opts.fh / tex.height : 1);
				gl.uniform1f(this.uRefract, opts.refract ? 1 : 0);
				gl.uniform1f(this.uRefractAmount, Number.isFinite(opts.refractAmount) && opts.refractAmount !== 0 ? opts.refractAmount : .06);
				gl.uniform1f(this.uTrail, opts.trail ? 1 : 0);
				gl.activeTexture(gl.TEXTURE0);
				gl.bindTexture(gl.TEXTURE_2D, glTex);
				gl.uniform1i(gl.getUniformLocation(this.prog, "u_Tex"), 0);
				if (opts.refract && this.bgTex !== null) {
					gl.activeTexture(gl.TEXTURE1);
					gl.bindTexture(gl.TEXTURE_2D, this.bgTex);
					gl.uniform1i(gl.getUniformLocation(this.prog, "u_Bg"), 1);
				}
				let glNormal = null;
				if (opts.refract) {
					if (normalTex !== null) {
						glNormal = this.normalTexCache.get(normalTex) ?? null;
						if (glNormal === null) {
							glNormal = gl.createTexture();
							if (glNormal !== null) {
								gl.bindTexture(gl.TEXTURE_2D, glNormal);
								gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, normalTex);
								gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
								gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
								gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
								gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
								this.normalTexCache.set(normalTex, glNormal);
							}
						}
					} else {
						glNormal = this.normalTexCache.get(ParticleGL.BLANK_KEY) ?? null;
						if (glNormal === null) {
							glNormal = gl.createTexture();
							if (glNormal !== null) {
								gl.bindTexture(gl.TEXTURE_2D, glNormal);
								gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([
									0,
									0,
									0,
									0
								]));
								gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
								gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
								gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
								gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
								this.normalTexCache.set(ParticleGL.BLANK_KEY, glNormal);
							}
						}
					}
					if (glNormal !== null) {
						gl.activeTexture(gl.TEXTURE2);
						gl.bindTexture(gl.TEXTURE_2D, glNormal);
						gl.uniform1i(gl.getUniformLocation(this.prog, "u_NormalTex"), 2);
					}
				}
				gl.enable(gl.BLEND);
				if (opts.additive) gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ZERO, gl.ONE);
				else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
				gl.drawElementsInstanced(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0, n);
				gl.bindVertexArray(null);
				const now = performance.now();
				if (n > 0 && now - this.lastDrawLog > 1e3) {
					this.lastDrawLog = now;
					console.log("[ParticleGL] draw n=" + n, "refract=" + opts.refract, "additive=" + opts.additive, "tex=" + tex.width + "x" + tex.height, "frames=" + opts.frames, "glError=" + gl.getError());
				}
			}
		};
		//#endregion
		//#region src/client/WaterwavesGL.ts
		const VERT_SRC$1 = `
attribute vec2 a_Pos;
varying vec2 v_UV;
void main() {
  gl_Position = vec4(a_Pos, 0.0, 1.0);
  v_UV = a_Pos * 0.5 + 0.5;
}
`;
		const FRAG_SRC$1 = `
precision mediump float;
// 独立实现的水波扰动（数学事实：沿某方向传播的正弦波 + 垂直方向扰动）。
// 行为参考 Wallpaper Engine 官方 waterwaves 效果（黑盒观察），代码为独立编写。
uniform sampler2D u_Src;
uniform sampler2D u_MaskTex;
uniform float u_UseMask;
uniform float u_MaskAlpha;
uniform float u_Clock;
uniform vec4 u_Params[4]; // x=方向角, y=速度, z=尺度, w=强度
uniform float u_Power[4]; // 波形指数
uniform int u_Count;
varying vec2 v_Uv;
void main() {
  vec2 uv = v_Uv;
  float gate = 1.0;
  if (u_UseMask > 0.5) {
    vec4 m = texture2D(u_MaskTex, uv);
    gate = u_MaskAlpha > 0.5 ? m.a : m.r;
  }
  vec2 total = vec2(0.0);
  for (int i = 0; i < 4; i++) {
    if (i >= u_Count) break;
    vec4 p = u_Params[i];
    float sinA = sin(p.x);
    float cosA = cos(p.x);
    // 波相位沿 (-sinA, cosA) 方向随空间与时间变化
    float phase = u_Clock * p.y + (uv.x * -sinA + uv.y * cosA) * p.z;
    float wave = sin(phase);
    // 扰动沿 (cosA, sinA)，幅度为强度平方的指数波形
    float amp = pow(abs(wave), u_Power[i]) * sign(wave) * p.w * p.w;
    total += amp * vec2(cosA, sinA);
  }
  uv += total * gate;
  gl_FragColor = texture2D(u_Src, uv);
}
`;
		var WaterwavesGL = class WaterwavesGL {
			canvas = null;
			gl = null;
			prog = null;
			locs = {};
			vbo = null;
			texCache = /* @__PURE__ */ new Map();
			curW = 0;
			curH = 0;
			/** 上下文被逐出后的原地恢复扩展 */
			loseExt = null;
			lost = false;
			lostLogged = false;
			lastRestoreAt = 0;
			/** WebGL 是否可用（惰性缓存，避免每次访问都新建探针上下文） */
			static cachedAvailable = null;
			static get available() {
				if (WaterwavesGL.cachedAvailable === null) try {
					const c = document.createElement("canvas");
					WaterwavesGL.cachedAvailable = !!(c.getContext("webgl") || c.getContext("experimental-webgl"));
				} catch {
					WaterwavesGL.cachedAvailable = false;
				}
				return WaterwavesGL.cachedAvailable;
			}
			ensure() {
				if (this.gl !== null && this.prog !== null && !this.lost) return true;
				if (this.lost) {
					const now = performance.now();
					if (this.canvas !== null && this.loseExt !== null && now - this.lastRestoreAt > 1e3) {
						this.lastRestoreAt = now;
						try {
							this.loseExt.restoreContext();
						} catch {}
					}
					return false;
				}
				try {
					const c = this.canvas ?? document.createElement("canvas");
					const gl = c.getContext("webgl") || c.getContext("experimental-webgl");
					if (gl === null) return false;
					this.canvas = c;
					this.gl = gl;
					this.loseExt = gl.getExtension("WEBGL_lose_context");
					c.addEventListener("webglcontextlost", (e) => {
						e.preventDefault();
						this.lost = true;
						if (!this.lostLogged) {
							this.lostLogged = true;
							console.warn("[waterwaves:GL] 上下文丢失，原地恢复中…");
						}
					});
					c.addEventListener("webglcontextrestored", () => {
						this.lost = false;
						this.lostLogged = false;
						this.texCache.clear();
						this.prog = null;
						this.vbo = null;
						console.warn("[waterwaves:GL] 上下文已恢复");
					});
					const compile = (type, src) => {
						const sh = gl.createShader(type);
						if (sh === null) return null;
						gl.shaderSource(sh, src);
						gl.compileShader(sh);
						if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
							console.warn("waterwaves shader: " + gl.getShaderInfoLog(sh));
							return null;
						}
						return sh;
					};
					const vs = compile(gl.VERTEX_SHADER, VERT_SRC$1);
					const fs = compile(gl.FRAGMENT_SHADER, FRAG_SRC$1);
					if (vs === null || fs === null) return false;
					const prog = gl.createProgram();
					if (prog === null) return false;
					gl.attachShader(prog, vs);
					gl.attachShader(prog, fs);
					gl.linkProgram(prog);
					if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return false;
					this.prog = prog;
					gl.useProgram(prog);
					for (const name of [
						"u_Src",
						"u_MaskTex",
						"u_UseMask",
						"u_MaskAlpha",
						"u_Clock",
						"u_Params",
						"u_Power",
						"u_Count"
					]) this.locs[name] = gl.getUniformLocation(prog, name);
					const aPos = gl.getAttribLocation(prog, "a_Pos");
					this.vbo = gl.createBuffer();
					gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
					gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
						-1,
						-1,
						1,
						-1,
						-1,
						1,
						1,
						1
					]), gl.STATIC_DRAW);
					gl.enableVertexAttribArray(aPos);
					gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
					return true;
				} catch {
					return false;
				}
			}
			uploadTexture(key, src, w, h) {
				const gl = this.gl;
				if (gl === null) return null;
				const hit = this.texCache.get(key);
				if (hit !== void 0) return hit;
				const tex = gl.createTexture();
				if (tex === null) return null;
				gl.bindTexture(gl.TEXTURE_2D, tex);
				gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
				gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
				gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
				gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
				gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
				gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
				this.texCache.set(key, tex);
				return tex;
			}
			/**
			* 渲染 waterwaves 效果到离屏 WebGL canvas（逐像素 UV 场扰动）。
			* src：图层纹理；mask：mask 纹理（null = 无）；maskUseA：mask 用 A 通道（R8 alpha 语义）。
			*/
			render(src, w, h, mask, maskUseA, waves, time, key) {
				if (!this.ensure()) return null;
				const gl = this.gl;
				const prog = this.prog;
				if (gl === null || prog === null || this.canvas === null) return null;
				if (this.curW !== w || this.curH !== h) {
					this.canvas.width = w;
					this.canvas.height = h;
					this.curW = w;
					this.curH = h;
				}
				gl.viewport(0, 0, w, h);
				gl.useProgram(prog);
				const tex = this.uploadTexture("tex:" + key, src, w, h);
				if (tex === null) return null;
				gl.activeTexture(gl.TEXTURE0);
				gl.bindTexture(gl.TEXTURE_2D, tex);
				gl.uniform1i(this.locs["u_Src"], 0);
				if (mask !== null) {
					const mtex = this.uploadTexture("mask:" + key, mask, 0, 0);
					gl.activeTexture(gl.TEXTURE1);
					gl.bindTexture(gl.TEXTURE_2D, mtex);
					gl.uniform1i(this.locs["u_MaskTex"], 1);
					gl.uniform1f(this.locs["u_UseMask"], 1);
					gl.uniform1f(this.locs["u_MaskAlpha"], maskUseA ? 1 : 0);
				} else gl.uniform1f(this.locs["u_UseMask"], 0);
				gl.uniform1f(this.locs["u_Clock"], time);
				const wv = [];
				const ex = [];
				const n = Math.min(4, waves.length);
				for (let i = 0; i < 4; i++) if (i < n) {
					wv.push(waves[i].direction, waves[i].speed, waves[i].scale, waves[i].strength);
					ex.push(Math.max(.5, Math.min(4, waves[i].exponent)));
				} else {
					wv.push(0, 0, 0, 0);
					ex.push(1);
				}
				gl.uniform4fv(this.locs["u_Params"], new Float32Array(wv));
				gl.uniform1fv(this.locs["u_Power"], new Float32Array(ex));
				gl.uniform1i(this.locs["u_Count"], n);
				gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
				return this.canvas;
			}
			/** 场景切换时清空纹理缓存（保留上下文，避免每次 start() 新建 WebGL 上下文） */
			reset() {
				if (this.gl === null) return;
				for (const t of this.texCache.values()) this.gl.deleteTexture(t);
				this.texCache.clear();
				this.curW = 0;
				this.curH = 0;
			}
			/** 完全释放（renderer 生命周期结束） */
			dispose() {
				const gl = this.gl;
				if (gl === null) return;
				try {
					const ext = gl.getExtension("WEBGL_lose_context");
					if (ext !== null) ext.loseContext();
				} catch {}
				for (const t of this.texCache.values()) gl.deleteTexture(t);
				this.texCache.clear();
				if (this.prog !== null) gl.deleteProgram(this.prog);
				if (this.vbo !== null) gl.deleteBuffer(this.vbo);
				this.gl = null;
				this.prog = null;
				this.vbo = null;
				this.canvas = null;
				this.curW = 0;
				this.curH = 0;
			}
		};
		//#endregion
		//#region src/client/NitroGL.ts
		const VERT_SRC = `
attribute vec2 a_Pos;
varying vec2 v_UV;
void main() {
  gl_Position = vec4(a_Pos, 0.0, 1.0);
  v_UV = a_Pos * 0.5 + 0.5;
}
`;
		const FRAG_SRC = `
precision mediump float;
varying vec2 v_Uv;
uniform sampler2D u_Src;    // 底图
uniform sampler2D u_Noise;  // 噪声（clouds_256，R 通道）
uniform sampler2D u_Mask0;
uniform sampler2D u_Mask1;
uniform sampler2D u_Mask2;
uniform sampler2D u_Mask3;
uniform float u_UseMask[4];
uniform float u_Aspect;     // 底图 高/宽（噪声纵横比补偿）
uniform float u_Clock;
uniform vec3 u_Color0[4];
uniform vec3 u_Color1[4];
uniform float u_Multiply[4];
uniform vec2 u_Ranges[4];
uniform vec2 u_Scales[4];
uniform vec4 u_Speeds[4];
uniform int u_Count;

vec4 sampleMask(int i, vec2 uv) {
  if (i == 0) return texture2D(u_Mask0, uv);
  if (i == 1) return texture2D(u_Mask1, uv);
  if (i == 2) return texture2D(u_Mask2, uv);
  return texture2D(u_Mask3, uv);
}

void main() {
  vec4 albedo = texture2D(u_Src, v_Uv);
  vec3 color = albedo.rgb;
  for (int i = 0; i < 4; i++) {
    if (i >= u_Count) break;
    // 两层动画噪声采样：尺度 + 时间流速，x 乘纵横比补偿
    vec2 nuvA = (v_Uv * u_Scales[i].x + u_Clock * u_Speeds[i].xy);
    nuvA.x *= u_Aspect;
    vec2 nuvB = (v_Uv * u_Scales[i].y + u_Clock * u_Speeds[i].zw);
    nuvB.x *= u_Aspect;
    nuvB = vec2(-nuvB.y, nuvB.x); // 第二层 90° 旋转（方向多样性）
    float nitro0 = texture2D(u_Noise, nuvA).r;
    float nitro1 = texture2D(u_Noise, nuvB).r;
    float remap = texture2D(u_Noise, v_Uv).r;
    // 核心噪声 + 两层乘积的带通（ranges 决定 band 宽度/中心）
    float coreNoise = smoothstep(nitro0, nitro1, 0.1 + remap * 0.8);
    float p = nitro0 * nitro1;
    float band = smoothstep(u_Ranges[i].y, u_Ranges[i].x, p) * smoothstep(u_Ranges[i].x, u_Ranges[i].y, p);
    float nitro = coreNoise * band * 4.0;
    vec3 nColor = mix(u_Color0[i], u_Color1[i], nitro);
    float blend = nitro * u_Multiply[i];
    if (u_UseMask[i] > 0.5) {
      // mask R8 解码后灰度在 alpha 通道
      blend *= sampleMask(i, v_Uv).a;
    }
    // 混合模式 22 Glow：BlendGlow(A,B)=BlendReflect(B,A)=min(B*B/(1-A),1)，
    // result = mix(A, glow, blend)。A==1 时避免除零返回 A。
    vec3 A = color;
    vec3 glow = (1.0 - A) > 0.001 ? min(nColor * nColor / max(1.0 - A, 0.001), 1.0) : A;
    color = mix(A, glow, clamp(blend, 0.0, 1.0));
  }
  gl_FragColor = vec4(max(0.0, color), albedo.a);
}
`;
		var NitroGL = class NitroGL {
			canvas = null;
			gl = null;
			prog = null;
			locs = {};
			vbo = null;
			texCache = /* @__PURE__ */ new Map();
			curW = 0;
			curH = 0;
			loseExt = null;
			lost = false;
			lostLogged = false;
			lastRestoreAt = 0;
			static cachedAvailable = null;
			static get available() {
				if (NitroGL.cachedAvailable === null) try {
					const c = document.createElement("canvas");
					NitroGL.cachedAvailable = !!(c.getContext("webgl") || c.getContext("experimental-webgl"));
				} catch {
					NitroGL.cachedAvailable = false;
				}
				return NitroGL.cachedAvailable;
			}
			ensure() {
				if (this.gl !== null && this.prog !== null && !this.lost) return true;
				if (this.lost) {
					const now = performance.now();
					if (this.canvas !== null && this.loseExt !== null && now - this.lastRestoreAt > 1e3) {
						this.lastRestoreAt = now;
						try {
							this.loseExt.restoreContext();
						} catch {}
					}
					return false;
				}
				try {
					const c = this.canvas ?? document.createElement("canvas");
					const gl = c.getContext("webgl") || c.getContext("experimental-webgl");
					if (gl === null) return false;
					this.canvas = c;
					this.gl = gl;
					this.loseExt = gl.getExtension("WEBGL_lose_context");
					c.addEventListener("webglcontextlost", (e) => {
						e.preventDefault();
						this.lost = true;
						if (!this.lostLogged) {
							this.lostLogged = true;
							console.warn("[nitro:GL] 上下文丢失，原地恢复中…");
						}
					});
					c.addEventListener("webglcontextrestored", () => {
						this.lost = false;
						this.lostLogged = false;
						this.texCache.clear();
						this.prog = null;
						this.vbo = null;
						console.warn("[nitro:GL] 上下文已恢复");
					});
					const compile = (type, src) => {
						const sh = gl.createShader(type);
						if (sh === null) return null;
						gl.shaderSource(sh, src);
						gl.compileShader(sh);
						if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
							console.warn("nitro shader: " + gl.getShaderInfoLog(sh));
							return null;
						}
						return sh;
					};
					const vs = compile(gl.VERTEX_SHADER, VERT_SRC);
					const fs = compile(gl.FRAGMENT_SHADER, FRAG_SRC);
					if (vs === null || fs === null) return false;
					const prog = gl.createProgram();
					if (prog === null) return false;
					gl.attachShader(prog, vs);
					gl.attachShader(prog, fs);
					gl.linkProgram(prog);
					if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return false;
					this.prog = prog;
					gl.useProgram(prog);
					for (const name of [
						"u_Src",
						"u_Noise",
						"u_Mask0",
						"u_Mask1",
						"u_Mask2",
						"u_Mask3",
						"u_UseMask",
						"u_Aspect",
						"u_Clock",
						"u_Color0",
						"u_Color1",
						"u_Multiply",
						"u_Ranges",
						"u_Scales",
						"u_Speeds",
						"u_Count"
					]) this.locs[name] = gl.getUniformLocation(prog, name);
					const aPos = gl.getAttribLocation(prog, "a_Pos");
					this.vbo = gl.createBuffer();
					gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
					gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
						-1,
						-1,
						1,
						-1,
						-1,
						1,
						1,
						1
					]), gl.STATIC_DRAW);
					gl.enableVertexAttribArray(aPos);
					gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
					return true;
				} catch {
					return false;
				}
			}
			uploadTexture(key, src, w, h) {
				const gl = this.gl;
				if (gl === null) return null;
				const hit = this.texCache.get(key);
				if (hit !== void 0) return hit;
				const tex = gl.createTexture();
				if (tex === null) return null;
				gl.bindTexture(gl.TEXTURE_2D, tex);
				gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
				gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
				gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
				gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
				gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
				gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
				this.texCache.set(key, tex);
				return tex;
			}
			/**
			* 渲染多个 nitro 效果到离屏 WebGL canvas（逐像素叠加）。
			* src：图层纹理；noise：噪声纹理（clouds_256）；masks：各 nitro 的 mask（null = 无）。
			*/
			render(src, w, h, noise, masks, nitros, time, key) {
				if (!this.ensure()) return null;
				const gl = this.gl;
				const prog = this.prog;
				if (gl === null || prog === null || this.canvas === null) return null;
				if (this.curW !== w || this.curH !== h) {
					this.canvas.width = w;
					this.canvas.height = h;
					this.curW = w;
					this.curH = h;
				}
				gl.viewport(0, 0, w, h);
				gl.useProgram(prog);
				const tex = this.uploadTexture("tex:" + key, src, w, h);
				if (tex === null) return null;
				gl.activeTexture(gl.TEXTURE0);
				gl.bindTexture(gl.TEXTURE_2D, tex);
				gl.uniform1i(this.locs["u_Src"], 0);
				let noiseTex = null;
				if (noise !== null) noiseTex = this.uploadTexture("noise:" + key, noise, noise.width, noise.height);
				else noiseTex = this.uploadTexture("noise:" + key, src, w, h);
				if (noiseTex === null) return null;
				gl.activeTexture(gl.TEXTURE1);
				gl.bindTexture(gl.TEXTURE_2D, noiseTex);
				gl.uniform1i(this.locs["u_Noise"], 1);
				const n = Math.min(4, nitros.length);
				const maskNames = [
					"u_Mask0",
					"u_Mask1",
					"u_Mask2",
					"u_Mask3"
				];
				const maskUnits = [
					2,
					3,
					4,
					5
				];
				const useMask = [];
				for (let i = 0; i < 4; i++) if (i < n && masks[i] !== null && masks[i] !== void 0) {
					const mtex = this.uploadTexture("mask" + i + ":" + key, masks[i], masks[i].width, masks[i].height);
					gl.activeTexture(gl.TEXTURE0 + maskUnits[i]);
					gl.bindTexture(gl.TEXTURE_2D, mtex);
					gl.uniform1i(this.locs[maskNames[i]], maskUnits[i]);
					useMask.push(1);
				} else {
					gl.uniform1i(this.locs[maskNames[i]], 0);
					useMask.push(0);
				}
				gl.uniform1fv(this.locs["u_UseMask"], new Float32Array(useMask));
				gl.uniform1f(this.locs["u_Aspect"], h > 0 ? h / w : 1);
				gl.uniform1f(this.locs["u_Clock"], time);
				gl.uniform1i(this.locs["u_Count"], n);
				const c0 = [];
				const c1 = [];
				const mul = [];
				const rg = [];
				const sc = [];
				const sp = [];
				for (let i = 0; i < 4; i++) if (i < n) {
					const p = nitros[i];
					c0.push(p.colorStart[0], p.colorStart[1], p.colorStart[2]);
					c1.push(p.colorEnd[0], p.colorEnd[1], p.colorEnd[2]);
					mul.push(p.multiply);
					rg.push(p.ranges[0], p.ranges[1]);
					sc.push(p.scales[0], p.scales[1]);
					sp.push(p.speeds[0], p.speeds[1], p.speeds[2], p.speeds[3]);
				} else {
					c0.push(0, 0, 0);
					c1.push(1, 1, 1);
					mul.push(0);
					rg.push(.3, .25);
					sc.push(1, 2);
					sp.push(0, 0, 0, 0);
				}
				gl.uniform3fv(this.locs["u_Color0"], new Float32Array(c0));
				gl.uniform3fv(this.locs["u_Color1"], new Float32Array(c1));
				gl.uniform1fv(this.locs["u_Multiply"], new Float32Array(mul));
				gl.uniform2fv(this.locs["u_Ranges"], new Float32Array(rg));
				gl.uniform2fv(this.locs["u_Scales"], new Float32Array(sc));
				gl.uniform4fv(this.locs["u_Speeds"], new Float32Array(sp));
				gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
				return this.canvas;
			}
			/** 场景切换时清空纹理缓存（保留上下文，避免每次 start() 新建 WebGL 上下文） */
			reset() {
				if (this.gl === null) return;
				for (const t of this.texCache.values()) this.gl.deleteTexture(t);
				this.texCache.clear();
				this.curW = 0;
				this.curH = 0;
			}
			/** 完全释放（renderer 生命周期结束） */
			dispose() {
				const gl = this.gl;
				if (gl === null) return;
				try {
					const ext = gl.getExtension("WEBGL_lose_context");
					if (ext !== null) ext.loseContext();
				} catch {}
				for (const t of this.texCache.values()) gl.deleteTexture(t);
				this.texCache.clear();
				if (this.prog !== null) gl.deleteProgram(this.prog);
				if (this.vbo !== null) gl.deleteBuffer(this.vbo);
				this.gl = null;
				this.prog = null;
				this.vbo = null;
				this.canvas = null;
				this.curW = 0;
				this.curH = 0;
			}
		};
		//#endregion
		//#region src/client/SceneModelRenderer.ts
		/**
		* puppet 网格离屏渲染：把部件网格（三角形 + UV 纹理）渲染一次到离屏 canvas。
		* 模型空间（y-up，原点=图片中心）→ canvas 像素（y 向下）：
		*   x_c = x_m, y_c = -y_m（绘制时经场景变换把图片中心对齐图层锚点）。
		* UV v 翻转（模型 v-up → 纹理 v-down）。
		* 每三角形：clip 路径 + 仿射变换（UV 三角 → 位置三角）+ drawImage 纹理。
		* 骨骼蒙皮（规范）：M_inv_bind_i = inverse(bind_i)；
		*   M_skin_i = M_global_i × M_inv_bind_i，静止骨骼 M_global = bind → M_skin = I；
		*   动画骨骼（骨骼 0）M_global_0 = T(bx,by) × Rz(rot) × T(-bx,-by) × bind_0；
		*   skinPos = Σ w_k × M_skin_{boneIdx[k]} × pos（4 权重 + 4 骨骼索引）。
		* anim 可选：{rot, bx, by} = 动画骨骼（骨骼 0）绕其 bind 位置的旋转。
		*/
		function buildMeshCanvas(mesh, tex, anim, binds, boneMats) {
			const posArr = [];
			if (boneMats !== void 0 && boneMats !== null && boneMats.length > 0) {
				const skin = computeSkinMatrices(binds ?? [], boneMats);
				for (const v of mesh.vertices) {
					const sp = skinVertex(v.pos, v.weights ?? [], v.boneIndices ?? [], skin);
					posArr.push([sp[0], sp[1]]);
				}
			} else if (anim !== void 0 && anim !== null) {
				const anim0 = mat4Mul(mat4TRS(anim.bx, anim.by, 0, 0, 1, 1, 1), mat4Mul(mat4TRS(0, 0, 0, anim.rot, 1, 1, 1), mat4TRS(-anim.bx, -anim.by, 0, 0, 1, 1, 1)));
				const n = binds !== null && binds !== void 0 ? binds.length : 1;
				const animMats = [];
				for (let i = 0; i < n; i++) {
					const bind = binds !== null && binds !== void 0 ? binds[i] : null;
					animMats.push(i === 0 ? mat4Mul(anim0, bind ?? mat4Identity()) : bind ?? null);
				}
				const skin = computeSkinMatrices(binds ?? [], animMats);
				for (const v of mesh.vertices) {
					const sp = skinVertex(v.pos, v.weights ?? [], v.boneIndices ?? [], skin);
					posArr.push([sp[0], sp[1]]);
				}
			} else for (const v of mesh.vertices) posArr.push([v.pos[0], v.pos[1]]);
			let mnx = Infinity;
			let mny = Infinity;
			let mxx = -Infinity;
			let mxy = -Infinity;
			for (const [x, y] of posArr) {
				const yy = -y;
				if (x < mnx) mnx = x;
				if (yy < mny) mny = yy;
				if (x > mxx) mxx = x;
				if (yy > mxy) mxy = yy;
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
				const fv = (val) => (mesh.flipV ? 1 - val : val) * th;
				const u0 = a.uv[0] * tw;
				const v0 = fv(a.uv[1]);
				const u1 = b.uv[0] * tw;
				const v1 = fv(b.uv[1]);
				const u2 = cc.uv[0] * tw;
				const v2 = fv(cc.uv[1]);
				const x0 = posArr[idx[i]][0];
				const y0 = -posArr[idx[i]][1];
				const x1 = posArr[idx[i + 1]][0];
				const y1 = -posArr[idx[i + 1]][1];
				const x2 = posArr[idx[i + 2]][0];
				const y2 = -posArr[idx[i + 2]][1];
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
		/**
		* waterwaves 效果（Canvas2D 条带近似），对照官方 shader：
		*   vert:  v_Direction = rotateVec2((0,1), θ) = (-sinθ, cosθ)   ← 传播方向
		*   frag:  distance = t*speed + dot(uv, v_Direction)*scale
		*          offset = (v_Direction.y, -v_Direction.x) = (cosθ, sinθ)  ← 扰动方向
		*          texCoord += sign(sin)^exp * |sin|^exp * strength² * offset * mask
		* 条带 = 等 phase 线（垂直 v_Direction，即沿 offset），带内沿 offset 整体平移；
		* 多个 waterwaves（ww1-ww4）扰动叠加；mask 限制扰动区域。
		*/
		function applyWaterwaves(src, w, h, waves, time, mask) {
			const c = document.createElement("canvas");
			c.width = w;
			c.height = h;
			const g = c.getContext("2d");
			if (g === null) return c;
			const theta = waves[0].direction;
			const offx = Math.cos(theta);
			const offy = Math.sin(theta);
			const bands = w * h > 9e5 ? 32 : 48;
			const horizontal = Math.abs(offx) >= Math.abs(offy);
			let maskAvg = null;
			if (mask !== null && mask !== void 0) {
				const mc = document.createElement("canvas");
				mc.width = 64;
				mc.height = 64;
				const mg = mc.getContext("2d");
				if (mg !== null) {
					mg.drawImage(mask, 0, 0, 64, 64);
					const img = mg.getImageData(0, 0, 64, 64);
					maskAvg = [];
					for (let i = 0; i < bands; i++) {
						let sumR = 0;
						let sumA = 0;
						let cnt = 0;
						if (horizontal) {
							const x0 = Math.floor(i / bands * 64);
							const x1 = Math.max(x0 + 1, Math.floor((i + 1) / bands * 64));
							for (let x = x0; x < x1; x++) for (let y = 0; y < 64; y++) {
								sumR += img.data[(y * 64 + x) * 4];
								sumA += img.data[(y * 64 + x) * 4 + 3];
								cnt++;
							}
						} else {
							const y0 = Math.floor(i / bands * 64);
							const y1 = Math.max(y0 + 1, Math.floor((i + 1) / bands * 64));
							for (let y = y0; y < y1; y++) for (let x = 0; x < 64; x++) {
								sumR += img.data[(y * 64 + x) * 4];
								sumA += img.data[(y * 64 + x) * 4 + 3];
								cnt++;
							}
						}
						const useA = sumR >= cnt * 254;
						maskAvg.push(cnt > 0 ? (useA ? sumA : sumR) / cnt / 255 : 0);
					}
				}
			}
			if (horizontal) {
				const bw = w / bands;
				for (let i = 0; i < bands; i++) {
					const x0 = i * bw;
					const cx = (x0 + bw / 2) / w;
					let disp = 0;
					for (const p of waves) {
						const s = p.strength * p.strength;
						const e = Math.max(.5, Math.min(4, p.exponent));
						const phase = time * p.speed + (cx * -Math.sin(p.direction) + .5 * Math.cos(p.direction)) * p.scale;
						const val = Math.sin(phase);
						disp += Math.sign(val) * Math.pow(Math.abs(val), e) * s * Math.cos(p.direction) * w;
					}
					disp *= maskAvg !== null ? maskAvg[i] : 1;
					g.drawImage(src, x0, 0, bw + .5, h, x0 + disp, 0, bw + .5, h);
				}
			} else {
				const bh = h / bands;
				for (let i = 0; i < bands; i++) {
					const y0 = i * bh;
					const cy = (y0 + bh / 2) / h;
					let disp = 0;
					for (const p of waves) {
						const s = p.strength * p.strength;
						const e = Math.max(.5, Math.min(4, p.exponent));
						const phase = time * p.speed + (.5 * -Math.sin(p.direction) + cy * Math.cos(p.direction)) * p.scale;
						const val = Math.sin(phase);
						disp += Math.sign(val) * Math.pow(Math.abs(val), e) * s * Math.sin(p.direction) * h;
					}
					disp *= maskAvg !== null ? maskAvg[i] : 1;
					g.drawImage(src, 0, y0, w, bh + .5, 0, y0 + disp, w, bh + .5);
				}
			}
			return c;
		}
		var SceneModelRenderer = class SceneModelRenderer {
			el = null;
			ctx = null;
			model = null;
			base = null;
			layerTextures = /* @__PURE__ */ new Map();
			/** 效果 mask 纹理（waterwaves/shake opacitymask）+ 通道模式（true=R8 alpha 语义用 A） */
			effectMasks = /* @__PURE__ */ new Map();
			/** WebGL waterwaves 渲染器（惰性创建） */
			wwGL = null;
			/** WebGL nitro 渲染器（惰性创建） */
			nitroGL = null;
			/** nitro 效果纹理：图层 id → { 噪声, 各 nitro mask } */
			nitroTex = /* @__PURE__ */ new Map();
			/** 图层纹理的 Image 内容区域尺寸（tex 画布内左上角）；无则用位图原生尺寸 */
			layerTexImage = /* @__PURE__ */ new Map();
			/** 图层 spritesheet 序列帧动画元数据：图层 id → { 帧数, 帧宽, 帧高, 单帧时长（秒）, 帧矩形 }。
			*  (GIF/切分图片动画：纹理含 TEXS 动画段，渲染按时间取帧裁剪) */
			layerSprite = /* @__PURE__ */ new Map();
			/** spritesheet 当前帧裁剪缓存：图层 id → { 帧号, 裁剪矩形, canvas }（帧切换时重建） */
			spriteFrameCache = /* @__PURE__ */ new Map();
			/** 图层世界变换（递归 parent 合并；局部 y-up 翻转） */
			worldTransform = /* @__PURE__ */ new Map();
			/** 图层 id → 图层（链式查找 puppet 祖先用） */
			byId = /* @__PURE__ */ new Map();
			runtimes = /* @__PURE__ */ new Map();
			/** 折射背景快照缓存（每帧只复制一次，多折射层共享） */
			bgCache = null;
			/** WebGL 粒子实例化渲染器（叠加层） */
			particleGL = null;
			glCanvas = null;
			/** 每帧折射背景是否已上传 WebGL（只传一次） */
			bgUploaded = false;
			/** 静态图像层离屏缓存（无动画层只渲染一次，每帧合成） */
			staticBg = null;
			staticBgReady = false;
			/** 前缀静态层 id 集合（只缓存 z-order 底部的连续静态层段，避免动态层被压序） */
			staticPrefixIds = /* @__PURE__ */ new Set();
			/** WebGL 粒子渲染开关（坐标空间已修正，开启） */
			static USE_WEBGL_PARTICLES = true;
			/** puppet 动画状态：puppet 图层 id → { 动画, 播放时间 } */
			puppetAnims = /* @__PURE__ */ new Map();
			/** 每帧计算的动画变换：puppet 图层 id → 平移/旋转 */
			animXform = /* @__PURE__ */ new Map();
			/** 0013 老格式逐骨骼动画全局矩阵：puppet 图层 id → 每骨骼动画矩阵（TRS，绝对姿态） */
			boneAnimMats = /* @__PURE__ */ new Map();
			/** puppet 网格离屏渲染缓存：图层 id → { canvas, 模型原点 } */
			meshCanvases = /* @__PURE__ */ new Map();
			dpr = 1;
			live = false;
			closed = false;
			rafId = 0;
			lastT = 0;
			/** 全局动画时间（秒，effects/粒子用） */
			animTime = 0;
			blurPx = 0;
			scale = 1;
			monitor = "";
			version = 0;
			handlers;
			/** 粒子层日志节流（layer.id → 上次时间） */
			lastParticleLog = /* @__PURE__ */ new Map();
			constructor(handlers = {}) {
				this.handlers = handlers;
			}
			get isLive() {
				return this.live;
			}
			start(monitor, version) {
				if (this.live && this.monitor === monitor && this.version === version && this.model !== null) {
					this.applyVisuals();
					return;
				}
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
				if (SceneModelRenderer.USE_WEBGL_PARTICLES && this.particleGL === null) {
					this.glCanvas = document.createElement("canvas");
					this.particleGL = new ParticleGL(this.glCanvas);
					if (!this.particleGL.available) {
						this.particleGL.dispose();
						this.particleGL = null;
						this.glCanvas = null;
					}
				}
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
				if (this.particleGL !== null) this.particleGL.reset();
				this.model = null;
				this.base = null;
				for (const bmp of this.layerTextures.values()) try {
					bmp.close();
				} catch {}
				this.layerTextures.clear();
				this.layerTexImage.clear();
				this.layerSprite.clear();
				this.spriteFrameCache.clear();
				this.worldTransform.clear();
				this.byId.clear();
				this.puppetAnims.clear();
				this.animXform.clear();
				this.boneAnimMats.clear();
				this.meshCanvases.clear();
				for (const v of this.effectMasks.values()) try {
					if ("close" in v.bmp) v.bmp.close();
				} catch {}
				this.effectMasks.clear();
				if (this.wwGL !== null) this.wwGL.reset();
				for (const rt of this.runtimes.values()) rt.dispose();
				this.runtimes.clear();
				this.staticBg = null;
				this.staticBgReady = false;
				this.staticPrefixIds.clear();
				this.setLive(false);
			}
			/** 完全销毁（renderer 生命周期结束）：释放 WebGL 上下文 + 移除叠加画布 */
			destroy() {
				this.stop();
				if (this.particleGL !== null) {
					this.particleGL.dispose();
					this.particleGL = null;
				}
				if (this.glCanvas !== null) this.glCanvas = null;
				if (this.wwGL !== null) {
					this.wwGL.dispose();
					this.wwGL = null;
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
			/** 昼夜 alpha 因子（0-1）：按本地时长的日出/日落小时计算当前是夜还是昼。
			*  - 默认夜间（<dayStart 或 >dayEnd）→ nightWhenStart/nightWhenEnd 端为 1（夜空层显示）；
			*  - 白天（dayStart..dayEnd）→ 另一侧为 1。
			*  这是 auto 模式（真实时钟驱动），不依赖任何用户控件。 */
			dayNightFactor(dn) {
				const now = /* @__PURE__ */ new Date();
				const hour = now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;
				const { dayStartH: s, dayEndH: e, nightWhenStart, nightWhenEnd } = dn;
				if (s > e) return hour >= s || hour < e ? nightWhenStart ? 1 : 0 : nightWhenStart ? 0 : 1;
				return hour < s || hour >= e ? nightWhenStart ? 1 : 0 : nightWhenStart ? 0 : 1;
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
				{
					const dnLayers = model.layers.filter((l) => l.dayNight !== void 0);
					console.log("[scene:dayNight] 壁纸 " + this.monitor + " 共 " + model.layers.length + " 层，" + dnLayers.length + " 层带昼夜脚本: " + (dnLayers.length === 0 ? "(无)" : dnLayers.map((l) => l.name + "#" + l.id + " DN=" + JSON.stringify(l.dayNight) + " factor=" + (l.alpha * this.dayNightFactor(l.dayNight)).toFixed(3)).join(" | ")));
				}
				this.loadBase(model);
				const jobs = [];
				for (const layer of model.layers) jobs.push(this.loadLayerTexture(layer));
				/** 粒子系统：创建运行时 + 加载粒子纹理（引擎资产 /we-sync/asset/texture） */
				for (const layer of model.layers) if (layer.particle !== null) {
					const rt = new ParticleRuntime(layer.particle, model.particleRateScale, model.particleSizeScale);
					this.runtimes.set(layer.id, rt);
					rt.preSimulate();
					for (const sub of rt.collect()) {
						jobs.push(this.loadParticleTexture(sub.rt, sub.texName));
						if (sub.normalName !== null) jobs.push(this.loadParticleNormalTexture(sub.rt, sub.normalName));
					}
				}
				for (const layer of model.layers) {
					if (layer.puppet === null || layer.puppet.animations.length === 0) continue;
					const anim = layer.animationIds.length > 0 ? layer.puppet.animations.find((a) => layer.animationIds.includes(a.id)) ?? layer.puppet.animations[0] : layer.puppet.animations[0];
					if (anim.keyframes.length < 2) continue;
					if (anim.old13 && anim.boneKeyframes !== void 0 && anim.boneKeyframes.length > 1) {
						let anyAnim = false;
						for (const bk of anim.boneKeyframes) {
							if (bk.length < 2) continue;
							for (let vi = 0; vi < 9; vi++) {
								let mn = Infinity, mx = -Infinity;
								for (const k of bk) {
									const v = k.values[vi];
									if (!Number.isFinite(v)) continue;
									if (v < mn) mn = v;
									if (v > mx) mx = v;
								}
								if (Number.isFinite(mn) && mx - mn > .01) {
									anyAnim = true;
									break;
								}
							}
							if (anyAnim) break;
						}
						if (!anyAnim) continue;
					} else {
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
					}
					this.puppetAnims.set(layer.id, {
						anim,
						time: 0
					});
				}
				if (jobs.length > 0) await Promise.all(jobs);
				if (this.closed) return;
				this.staticBg = null;
				this.staticBgReady = false;
				this.buildStaticBg();
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
			async loadParticleTexture(rt, name) {
				try {
					const res = await fetch("/we-sync/asset/texture?name=" + encodeURIComponent(name), { cache: "no-store" });
					if (!res.ok) {
						console.warn("[particle tex] 加载失败", name, res.status);
						return;
					}
					const frames = Number(res.headers.get("X-Sprite-Frames") ?? "0");
					const fw = Number(res.headers.get("X-Sprite-Width") ?? "0");
					const fh = Number(res.headers.get("X-Sprite-Height") ?? "0");
					const blob = await res.blob();
					const bmp = await createImageBitmap(blob);
					if (this.closed) {
						bmp.close();
						return;
					}
					let tex = bmp;
					if (bmp.width < 128 && bmp.height < 128) {
						tex = makeSoftTexture(bmp);
						bmp.close();
					}
					if (this.closed) return;
					rt.setTexture(tex, frames > 1 && fw > 0 && fh > 0 ? frames : 0, fw, fh);
				} catch (err) {
					console.warn("[particle tex] 加载/解码失败", name, err);
				}
			}
			/** 加载粒子折射法线纹理（REFRACT 材质第二个纹理，如 rain_drops_sheet_normal）。
			*  法线纹理不做软边处理（需要原始 R/G/A 通道做 shader 解压）。 */
			async loadParticleNormalTexture(rt, name) {
				try {
					const res = await fetch("/we-sync/asset/texture?name=" + encodeURIComponent(name), { cache: "no-store" });
					if (!res.ok) {
						console.warn("[particle normal tex] 加载失败", name, res.status);
						return;
					}
					const frames = Number(res.headers.get("X-Sprite-Frames") ?? "0");
					const fw = Number(res.headers.get("X-Sprite-Width") ?? "0");
					const fh = Number(res.headers.get("X-Sprite-Height") ?? "0");
					const blob = await res.blob();
					const bmp = await createImageBitmap(blob);
					if (this.closed) {
						bmp.close();
						return;
					}
					rt.setNormalTexture(bmp, frames > 1 && fw > 0 && fh > 0 ? frames : 0, fw, fh);
				} catch (err) {
					console.warn("[particle normal tex] 加载/解码失败", name, err);
				}
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
					if (got.sprite !== null) this.layerSprite.set(layer.id, got.sprite);
					this.startAnimation();
					return;
				}
				for (const e of layer.effects) {
					const m = e.type === "waterwaves" || e.type === "shake" ? e.mask : null;
					if (m === null || this.effectMasks.has(layer.id)) continue;
					try {
						const maskName = m.startsWith("materials/") ? m : "materials/" + m + ".tex";
						const res = await fetch("/we-sync/scene/texture?monitor=" + encodeURIComponent(this.monitor) + "&name=" + encodeURIComponent(maskName), { cache: "no-store" });
						if (!res.ok) continue;
						const blob = await res.blob();
						const bmp = await createImageBitmap(blob);
						if (this.closed) {
							bmp.close();
							return;
						}
						let useA = false;
						let flowDir = [0, -1];
						try {
							const tc = document.createElement("canvas");
							tc.width = 16;
							tc.height = 16;
							const tg = tc.getContext("2d");
							if (tg !== null) {
								tg.drawImage(bmp, 0, 0, 16, 16);
								const px = tg.getImageData(0, 0, 16, 16);
								let all255 = true;
								let sr = 0;
								let sg = 0;
								let n = 0;
								for (let i = 0; i < px.data.length; i += 4) {
									if (px.data[i] < 254) all255 = false;
									sr += px.data[i];
									sg += px.data[i + 1];
									n++;
								}
								useA = all255;
								if (!all255 && n > 0) {
									flowDir = [(sr / n / 255 - .498) * 2, (sg / n / 255 - .498) * 2];
									const len = Math.hypot(flowDir[0], flowDir[1]);
									if (len > .01) {
										flowDir[0] /= len;
										flowDir[1] /= len;
									}
								}
							}
						} catch {}
						this.effectMasks.set(layer.id, {
							bmp,
							useA,
							flowDir
						});
						this.startAnimation();
					} catch {}
				}
				const nitros = layer.effects.filter((e) => e.type === "nitro");
				if (nitros.length > 0 && !this.nitroTex.has(layer.id)) {
					const jobs = [];
					let noiseBmp = null;
					const masks = new Array(nitros.length).fill(null);
					const noiseName = nitros[0].noise;
					if (noiseName !== null && noiseName !== "") jobs.push((async () => {
						try {
							const res = await fetch("/we-sync/asset/texture?name=" + encodeURIComponent(noiseName), { cache: "no-store" });
							if (res.ok) noiseBmp = await createImageBitmap(await res.blob());
						} catch {}
					})());
					for (let i = 0; i < nitros.length; i++) {
						const m = nitros[i].mask;
						if (m === null || m === "") continue;
						const maskName = m.startsWith("materials/") ? m : "materials/" + m + ".tex";
						const idx = i;
						jobs.push((async () => {
							try {
								const res = await fetch("/we-sync/scene/texture?monitor=" + encodeURIComponent(this.monitor) + "&name=" + encodeURIComponent(maskName), { cache: "no-store" });
								if (res.ok) masks[idx] = await createImageBitmap(await res.blob());
							} catch {}
						})());
					}
					await Promise.all(jobs);
					if (this.closed) {
						const allBmps = [noiseBmp, ...masks];
						for (const bb of allBmps) if (bb !== null) bb.close();
						return;
					}
					this.nitroTex.set(layer.id, {
						noise: noiseBmp,
						masks
					});
					this.startAnimation();
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
					const frames = Number(res.headers.get("X-Sprite-Frames"));
					const fw = Number(res.headers.get("X-Sprite-Width"));
					const fh = Number(res.headers.get("X-Sprite-Height"));
					const dur = Number(res.headers.get("X-Sprite-Duration"));
					let sprite = null;
					if (Number.isFinite(frames) && frames > 1 && Number.isFinite(fw) && fw > 0 && Number.isFinite(fh) && fh > 0) {
						const total = Number.isFinite(dur) && dur > 0 ? dur : frames / 10;
						let rects = null;
						const rectsRaw = res.headers.get("X-Sprite-Rects");
						if (rectsRaw !== null) {
							const parts = rectsRaw.split(";");
							const arr = [];
							for (const p of parts) {
								const n = p.split(",").map((x) => Number(x));
								if (n.length === 4 && n.every((x) => Number.isFinite(x))) arr.push([
									n[0],
									n[1],
									n[2],
									n[3]
								]);
							}
							if (arr.length === frames) rects = arr;
						}
						sprite = {
							frames,
							fw,
							fh,
							per: total / frames,
							rects
						};
					}
					return {
						bmp,
						imgW: Number.isFinite(imgW) && imgW > 0 ? imgW : bmp.width,
						imgH: Number.isFinite(imgH) && imgH > 0 ? imgH : bmp.height,
						sprite
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
				this.animTime += dt;
				this.bgCache = null;
				this.bgUploaded = false;
				for (const rt of this.runtimes.values()) rt.update(dt);
				this.updatePuppetAnims(dt);
				try {
					this.renderScene();
				} catch (e) {
					console.error("[scene:render] renderScene 异常:", e);
				}
				this.rafId = requestAnimationFrame(this.draw);
			};
			/**
			* 更新 puppet 动画 → 部件变换（装配根整体呼吸 + 部件自身摆动）。
			* 帧值布局（实测）：[pos3][rotZ(v4)][scale3]；v4 摆动 = 绕 z 旋转（呼吸/头发/草）；
			* v0/v1（或 v6/v7，petal 类）变化 = 位置位移（相对首帧）。
			*/
			updatePuppetAnims(dt) {
				this.animXform.clear();
				this.boneAnimMats.clear();
				for (const [layerId, st] of this.puppetAnims) {
					st.time += dt;
					const kf = st.anim.keyframes;
					if (kf.length === 0) continue;
					let peak = 0;
					for (let i = 1; i < kf.length; i++) if (kf[i].t > kf[peak].t) peak = i;
					const period = kf[peak].t - kf[0].t;
					if (period > 5e6) continue;
					const dur = st.anim.old13 && st.anim.duration > 0 ? kf.length / st.anim.duration : st.anim.duration > 0 ? st.anim.duration : 3;
					const t = period > 0 ? st.time * period / dur : st.time * (kf.length - 1) / dur;
					if (st.anim.old13 && st.anim.boneKeyframes !== void 0 && st.anim.boneKeyframes.length > 1) {
						const mats = [];
						for (let b = 0; b < st.anim.boneKeyframes.length; b++) {
							const bk = st.anim.boneKeyframes[b];
							if (bk.length === 0) {
								mats.push(null);
								continue;
							}
							const s = sampleAnimation({
								...st.anim,
								keyframes: bk
							}, t);
							if (s === null) {
								mats.push(null);
								continue;
							}
							const v = s.values;
							mats.push(mat4TRSEuler(v[0], v[1], v[2], v[3], v[4], v[5], v[6], v[7], v[8]));
						}
						this.boneAnimMats.set(layerId, mats);
						continue;
					}
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
					if (st.anim.old13) {
						if (spans[0] > .5) dx += v[0] - base[0];
						if (spans[1] > .5) dy += v[1] - base[1];
					} else {
						if (spans[0] > .5) dy += v[0] - base[0];
						if (spans[6] > .5) dx += v[6] - base[6];
						if (spans[7] > .5) dy += v[7] - base[7];
					}
					this.animXform.set(layerId, {
						dx,
						dy,
						rot
					});
				}
			}
			/** 静态图像层：无粒子、无效果、无动画（自身及祖先）、非序列帧动画，可离屏缓存只渲染一次 */
			isStaticImageLayer(layer) {
				if (layer.image === void 0 || layer.particle !== null) return false;
				if (layer.effects.length > 0 || layer.copybackground === true) return false;
				if (layer.dayNight !== void 0) return false;
				if (this.layerSprite.has(layer.id)) return false;
				let p = layer.id;
				while (p !== null && this.byId.has(p)) {
					if (this.animXform.has(p) || this.boneAnimMats.has(p)) return false;
					p = this.byId.get(p)?.parent ?? null;
				}
				return true;
			}
			/** 构建静态层离屏缓存（场景坐标 canvas，模型加载后调用一次） */
			buildStaticBg() {
				const model = this.model;
				if (model === null) return;
				const c = document.createElement("canvas");
				c.width = Math.max(1, Math.round(model.width));
				c.height = Math.max(1, Math.round(model.height));
				const g = c.getContext("2d");
				if (g === null) return;
				this.staticPrefixIds.clear();
				let prefixEnded = false;
				for (const layer of model.layers) {
					if (prefixEnded) break;
					if (!layer.visible || layer.alpha <= 0 || !this.isStaticImageLayer(layer)) {
						prefixEnded = true;
						continue;
					}
					const t = this.worldTransform.get(layer.id);
					const bmp = this.layerTextures.get(layer.id) ?? null;
					if (bmp === null || t === void 0) {
						prefixEnded = true;
						continue;
					}
					this.staticPrefixIds.add(layer.id);
					g.save();
					g.translate(t.ox, t.oy);
					const rot = (layer.angles[2] ?? 0) * Math.PI / 180;
					if (rot !== 0) g.rotate(rot);
					g.scale(t.sx, t.sy);
					if (layer.alpha < 1) g.globalAlpha = Math.max(0, Math.min(1, layer.alpha));
					const ti = this.layerTexImage.get(layer.id);
					const sw = ti !== void 0 ? ti[0] : bmp.width;
					const sh = ti !== void 0 ? ti[1] : bmp.height;
					const dw = layer.size !== null ? layer.size[0] : sw;
					const dh = layer.size !== null ? layer.size[1] : sh;
					g.drawImage(bmp, 0, 0, sw, sh, -dw / 2, -dh / 2, dw, dh);
					g.restore();
				}
				this.staticBg = c;
				this.staticBgReady = true;
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
				if (this.staticBgReady && this.staticBg !== null) ctx.drawImage(this.staticBg, 0, 0, this.staticBg.width, this.staticBg.height, ox, oy, this.staticBg.width * s, this.staticBg.height * s);
				let glSegment = false;
				let glAdditive = false;
				const flushGl = () => {
					if (glSegment && this.particleGL !== null && this.glCanvas !== null) {
						const prevOp = ctx.globalCompositeOperation;
						if (glAdditive) ctx.globalCompositeOperation = "lighter";
						ctx.drawImage(this.glCanvas, 0, 0, this.glCanvas.width, this.glCanvas.height, 0, 0, cw, ch);
						ctx.globalCompositeOperation = prevOp;
						glSegment = false;
						this.bgUploaded = false;
					}
				};
				for (const layer of model.layers) {
					if (!layer.visible || layer.alpha <= 0) continue;
					if (this.staticBgReady && this.staticPrefixIds.has(layer.id)) continue;
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
					if (rt !== void 0) {
						const wt = t ?? {
							ox: layer.origin[0],
							oy: layer.origin[1],
							sx: layer.scale[0] ?? 1,
							sy: layer.scale[1] ?? 1
						};
						if (this.particleGL !== null && this.el !== null && SceneModelRenderer.USE_WEBGL_PARTICLES && !rt.hasLineRenderer()) {
							if (!this.particleGL.available) continue;
							const layerAngle = layer.angles[2] ?? 0;
							const batches = rt.collectGl(wt.sx, wt.sy, ox + wt.ox * s, oy + wt.oy * s, s, layerAngle);
							const now = performance.now();
							if (batches.length === 0) continue;
							const additive = batches[0].additive;
							if (glSegment && glAdditive !== additive) flushGl();
							if (!glSegment) {
								glSegment = true;
								glAdditive = additive;
								this.bgUploaded = false;
								this.particleGL.clear();
							}
							if (now - (this.lastParticleLog.get(layer.id) ?? 0) > 1e3) {
								this.lastParticleLog.set(layer.id, now);
								console.log("[scene:GL] layer=" + layer.name, batches.map((b) => "n=" + b.particles.length + (b.refract ? "/R" : "") + (b.additive ? "/A" : "")).join(" "));
							}
							for (const b of batches) {
								if (b.refract && !this.bgUploaded) {
									this.particleGL.uploadBackground(this.el);
									this.bgUploaded = true;
									console.log("[scene:GL] bg uploaded", this.el.width + "x" + this.el.height);
								}
								this.particleGL.render(b.particles, {
									viewW: this.el.clientWidth,
									viewH: this.el.clientHeight,
									additive: b.additive,
									refract: b.refract,
									frames: b.frames,
									fw: b.fw,
									fh: b.fh,
									refractAmount: b.refractAmount,
									trail: b.trail
								}, b.tex, b.normalTex, this.el.width, this.el.height);
							}
							continue;
						}
						flushGl();
						let bg = null;
						if (rt.hasRefract() && this.el !== null) {
							if (this.bgCache === null) {
								this.bgCache = document.createElement("canvas");
								this.bgCache.width = this.el.width;
								this.bgCache.height = this.el.height;
								const bgctx = this.bgCache.getContext("2d");
								if (bgctx !== null) bgctx.drawImage(this.el, 0, 0);
							}
							bg = this.bgCache;
						}
						rt.draw(ctx, ox, oy, s, wt, bg, layer.angles[2] ?? 0);
						continue;
					}
					flushGl();
					ctx.save();
					ctx.translate(px, py);
					const animB0 = selfXf !== void 0 && layer.puppet !== null ? layer.puppet.bones[0]?.bind ?? null : null;
					const rotAngle = (layer.angles[2] ?? 0) * Math.PI / 180 + arot;
					if (animB0 !== null && animB0.length >= 15 && rotAngle !== 0) {
						const sxv = (t !== void 0 ? t.sx : layer.scale[0] ?? 1) * s;
						const syv = (t !== void 0 ? t.sy : layer.scale[1] ?? 1) * s;
						const bx = animB0[12] * sxv;
						const by = -animB0[13] * syv;
						ctx.translate(bx, by);
						ctx.rotate(rotAngle);
						ctx.translate(-bx, -by);
					} else ctx.rotate(rotAngle);
					ctx.scale((t !== void 0 ? t.sx : layer.scale[0] ?? 1) * s, (t !== void 0 ? t.sy : layer.scale[1] ?? 1) * s);
					let layerAlpha = layer.alpha;
					if (layer.dayNight !== void 0) layerAlpha = layer.alpha * this.dayNightFactor(layer.dayNight);
					if (layerAlpha < 1) ctx.globalAlpha = Math.max(0, Math.min(1, layerAlpha));
					let bmp = this.layerTextures.get(layer.id) ?? null;
					if (model.puppetMeshRender && layer.puppet !== null && layer.puppet.mesh !== null && bmp !== null) {
						const old13Mats = this.boneAnimMats.get(layer.id);
						const selfXf2 = this.animXform.get(layer.id);
						const b0 = layer.puppet.bones[0]?.bind ?? null;
						const animSkin = selfXf2 !== void 0 && b0 !== null && b0.length >= 15 ? {
							rot: selfXf2.rot,
							bx: b0[12],
							by: b0[13]
						} : null;
						const key = layer.id + ":" + (old13Mats !== void 0 ? "old13" + Math.floor(this.animTime * 60).toString(36) : animSkin !== null ? animSkin.rot.toFixed(4) : "static");
						let mc = this.meshCanvases.get(layer.id);
						if (mc === void 0 || mc.animKey !== key) {
							const binds = layer.puppet.bones.map((b) => b.bind ?? b.pose ?? null);
							const built = buildMeshCanvas(layer.puppet.mesh, bmp, animSkin, binds, old13Mats);
							mc = {
								canvas: built.canvas,
								originX: built.originX,
								originY: built.originY,
								animKey: key
							};
							this.meshCanvases.set(layer.id, mc);
						}
						ctx.drawImage(mc.canvas, -mc.originX, -mc.originY);
					} else if (bmp !== null) {
						const ti = this.layerTexImage.get(layer.id);
						let sw = ti !== void 0 ? ti[0] : bmp.width;
						let sh = ti !== void 0 ? ti[1] : bmp.height;
						const dw = layer.size !== null ? layer.size[0] : sw;
						const dh = layer.size !== null ? layer.size[1] : sh;
						const spr = this.layerSprite.get(layer.id);
						if (spr != null && bmp.width >= 1 && bmp.height >= 1) {
							const total = spr.frames * spr.per;
							let frameIdx = Math.floor(this.animTime % total / spr.per);
							if (frameIdx < 0) frameIdx = 0;
							if (frameIdx >= spr.frames) frameIdx = spr.frames - 1;
							const rect = spr.rects !== null && spr.rects[frameIdx] !== void 0 ? spr.rects[frameIdx] : (() => {
								const cols = Math.max(1, Math.floor(bmp.width / spr.fw));
								const col = frameIdx % cols;
								const row = Math.floor(frameIdx / cols);
								return [
									col * spr.fw,
									row * spr.fh,
									spr.fw,
									spr.fh
								];
							})();
							const rx = Math.max(0, Math.min(bmp.width - 1, Math.round(rect[0])));
							const ry = Math.max(0, Math.min(bmp.height - 1, Math.round(rect[1])));
							const rw = Math.max(1, Math.min(bmp.width - rx, Math.round(rect[2])));
							const rh = Math.max(1, Math.min(bmp.height - ry, Math.round(rect[3])));
							const cached = this.spriteFrameCache.get(layer.id);
							let frameBmp;
							if (cached !== void 0 && cached.frame === frameIdx && cached.sx === rx && cached.sy === ry && cached.sw === rw && cached.sh === rh) frameBmp = cached.canvas;
							else {
								frameBmp = document.createElement("canvas");
								frameBmp.width = rw;
								frameBmp.height = rh;
								const fctx = frameBmp.getContext("2d");
								if (fctx !== null) {
									fctx.imageSmoothingEnabled = false;
									fctx.drawImage(bmp, rx, ry, rw, rh, 0, 0, rw, rh);
								}
								this.spriteFrameCache.set(layer.id, {
									frame: frameIdx,
									sx: rx,
									sy: ry,
									sw: rw,
									sh: rh,
									canvas: frameBmp
								});
							}
							bmp = frameBmp;
							sw = rw;
							sh = rh;
						}
						const effScale = model.effectStrengthScale ?? 1;
						const wws = layer.effects.filter((e) => e.type === "waterwaves").map((e) => ({
							...e,
							strength: e.strength * effScale
						}));
						const shk = layer.effects.find((e) => e.type === "shake");
						const nitros = layer.effects.filter((e) => e.type === "nitro");
						if (wws.length > 0) {
							const maskInfo = this.effectMasks.get(layer.id);
							let eff = null;
							if (this.wwGL !== null || WaterwavesGL.available) {
								if (this.wwGL === null) this.wwGL = new WaterwavesGL();
								eff = this.wwGL.render(bmp, sw, sh, maskInfo !== void 0 ? maskInfo.bmp : null, maskInfo !== void 0 ? maskInfo.useA : false, wws, this.animTime, String(layer.id));
							}
							if (eff === null) eff = applyWaterwaves(bmp, sw, sh, wws, this.animTime, maskInfo !== void 0 ? maskInfo.bmp : null);
							ctx.drawImage(eff, 0, 0, sw, sh, -dw / 2, -dh / 2, dw, dh);
						} else if (nitros.length > 0) {
							const nt = this.nitroTex.get(layer.id);
							let eff = null;
							if (nt !== void 0 && (this.nitroGL !== null || NitroGL.available)) {
								if (this.nitroGL === null) this.nitroGL = new NitroGL();
								const params = nitros.map((e) => ({
									colorStart: e.colorStart,
									colorEnd: e.colorEnd,
									multiply: e.multiply,
									ranges: e.ranges,
									scales: e.scales,
									speeds: e.speeds,
									smoothness: e.smoothness,
									useMask: e.mask !== null && e.mask !== ""
								}));
								eff = this.nitroGL.render(bmp, sw, sh, nt.noise, nt.masks, params, this.animTime, String(layer.id));
							}
							if (eff === null) ctx.drawImage(bmp, 0, 0, sw, sh, -dw / 2, -dh / 2, dw, dh);
							else ctx.drawImage(eff, 0, 0, sw, sh, -dw / 2, -dh / 2, dw, dh);
						} else if (shk !== void 0 && shk.type === "shake") {
							const maskInfo2 = this.effectMasks.get(layer.id);
							const fd = maskInfo2 !== void 0 ? maskInfo2.flowDir : [0, -1];
							const offset = Math.sin(this.animTime * shk.speed);
							const amp = shk.strength * shk.strength * effScale;
							const dx = offset * amp * fd[0] * dw;
							const dy = offset * amp * fd[1] * dh;
							ctx.drawImage(bmp, 0, 0, sw, sh, -dw / 2 + dx, -dh / 2 + dy, dw, dh);
						} else ctx.drawImage(bmp, 0, 0, sw, sh, -dw / 2, -dh / 2, dw, dh);
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
				flushGl();
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
				if (this.glCanvas !== null) {
					if (this.glCanvas.width !== w) this.glCanvas.width = w;
					if (this.glCanvas.height !== h) this.glCanvas.height = h;
				}
			}
			onResize = () => {
				this.resize();
				this.staticBg = null;
				this.staticBgReady = false;
				if (this.model !== null) this.buildStaticBg();
				this.startAnimation();
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
		/** 专注模式：任务进行中（本版下调的全局值；鼠标圆内另按 FOCUS_LENS 加浓） */
		const FOCUS_WORK = {
			panelAlpha: 20,
			blur: 9,
			shadow: 75
		};
		/** 专注模式：任务全部完成 */
		const FOCUS_IDLE = {
			panelAlpha: 9,
			blur: 6,
			shadow: 40
		};
		/** 专注模式 · 注视点透镜：鼠标圆形范围内背景采用的参数（比全局更浓的磨砂） */
		const FOCUS_LENS = {
			panelAlpha: 30,
			blur: 15,
			shadow: 90
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
			/** DSH locale 服务同步下来的界面语言（'zh' | 'en'）；null = locale 服务不可用，面板走 DOM 兜底探测。
			*  模块级持久：conversation.view 是 session 作用域插槽，切会话/轨迹会重挂载面板，
			*  重挂载时直接读这里而不是重新探测，语言才不会"弹回英语"。 */
			locale: null,
			settings: {
				enabled: true,
				panelAlpha: 72,
				blur: 6,
				shadow: 30,
				monitor: "",
				focus: false,
				taskActive: false,
				renderMode: "perf",
				gazeEnabled: false,
				gazeSnapText: true,
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
			const localeService = ctx.get("locale");
			if (localeService !== void 0) {
				const syncLocale = () => {
					const active = localeService.getLocale().active;
					const next = active === "en" ? "en" : active === "zh" ? "zh" : null;
					if (next !== null && next !== store.locale) {
						store.locale = next;
						store.notify();
					}
				};
				ctx.effect(() => localeService.subscribe(syncLocale));
				syncLocale();
			}
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
					sceneModelRenderer.destroy();
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
			const FOCUS_LENS_RADIUS = 260;
			const LENS_ENTER_MS = 1400;
			const LINE_HYST = 6;
			const GAZE_SMOOTH = .08;
			const GAZE_DEADZONE = 12;
			let focusLens = null;
			let mouseX = 0;
			let mouseY = 0;
			let lensX = 0;
			let lensY = 0;
			let lensRaf = null;
			let lensStart = 0;
			let lineCache = null;
			let lockedLineCy = null;
			function collectLines(el) {
				const range = document.createRange();
				range.selectNodeContents(el);
				const rects = range.getClientRects();
				const lines = [];
				for (let i = 0; i < rects.length; i++) {
					const r = rects[i];
					if (r.height < 6 || r.width < 8) continue;
					lines.push({
						top: r.top,
						bottom: r.bottom,
						cy: (r.top + r.bottom) / 2
					});
				}
				return lines;
			}
			function findTextBlock(x, y) {
				let cur = document.elementFromPoint(x, y);
				for (let i = 0; i < 6 && cur !== null; i++) {
					if ((cur.textContent || "").trim().length > 1 && cur.getBoundingClientRect().width >= 40) return cur;
					cur = cur.parentElement;
				}
				return null;
			}
			function snapToLine(x, y) {
				const el = findTextBlock(x, y);
				if (el === null) {
					lockedLineCy = null;
					return null;
				}
				const now = performance.now();
				let lines;
				if (lineCache !== null && lineCache.el === el && now - lineCache.at < 200) lines = lineCache.lines;
				else {
					lines = collectLines(el);
					lineCache = {
						el,
						lines,
						at: now
					};
				}
				if (lines.length === 0) return null;
				if (lockedLineCy !== null) {
					const lockCy = lockedLineCy;
					const lk = lines.find((ln) => Math.abs(ln.cy - lockCy) < 2);
					if (lk !== void 0 && y >= lk.top - LINE_HYST && y <= lk.bottom + LINE_HYST) return {
						x,
						y: lk.cy
					};
				}
				let bestCy = null;
				let bestD = Infinity;
				for (const ln of lines) {
					const d = y >= ln.top - 4 && y <= ln.bottom + 4 ? 0 : Math.min(Math.abs(y - ln.top), Math.abs(y - ln.bottom));
					if (d < bestD) {
						bestD = d;
						bestCy = ln.cy;
					}
				}
				if (bestCy === null || bestD > 40) {
					lockedLineCy = null;
					return null;
				}
				lockedLineCy = bestCy;
				return {
					x,
					y: bestCy
				};
			}
			function onLensMove(ev) {
				mouseX = ev.clientX;
				mouseY = ev.clientY;
			}
			function pumpLens() {
				if (focusLens === null) {
					lensRaf = null;
					return;
				}
				const g = store.settings.gazeEnabled ? getGaze() : null;
				if (g !== null) {
					let tx = g.x;
					let ty = g.y;
					if (store.settings.gazeSnapText) {
						const s = snapToLine(tx, ty);
						if (s !== null) {
							tx = s.x;
							ty = s.y;
						}
					}
					if (Math.abs(tx - lensX) < GAZE_DEADZONE && Math.abs(ty - lensY) < GAZE_DEADZONE) {
						tx = lensX;
						ty = lensY;
					}
					lensX += (tx - lensX) * GAZE_SMOOTH;
					lensY += (ty - lensY) * GAZE_SMOOTH;
				} else {
					lensX = mouseX;
					lensY = mouseY;
					lockedLineCy = null;
				}
				const p = Math.min(1, (performance.now() - lensStart) / LENS_ENTER_MS);
				const eased = 1 - Math.pow(1 - p, 3);
				let r;
				let grad;
				r = Math.max(.5, eased * FOCUS_LENS_RADIUS);
				grad = "radial-gradient(circle " + r.toFixed(1) + "px at var(--wesync-lens-x) var(--wesync-lens-y), transparent 0%, transparent 50%, rgba(0,0,0,0.45) 70%, rgba(0,0,0,0.82) 88%, #000 100%)";
				focusLens.style.setProperty("--wesync-lens-x", lensX + "px");
				focusLens.style.setProperty("--wesync-lens-y", lensY + "px");
				focusLens.style.maskImage = grad;
				focusLens.style.webkitMaskImage = grad;
				lensRaf = requestAnimationFrame(pumpLens);
			}
			function destroyFocusLens() {
				if (focusLens === null) return;
				focusLens.remove();
				focusLens = null;
				document.removeEventListener("mousemove", onLensMove, true);
				if (lensRaf !== null) {
					cancelAnimationFrame(lensRaf);
					lensRaf = null;
				}
			}
			function applyFocusLens() {
				if (!store.settings.focus) {
					destroyFocusLens();
					return;
				}
				if (focusLens === null) {
					mouseX = window.innerWidth / 2;
					mouseY = window.innerHeight / 2;
					lensX = mouseX;
					lensY = mouseY;
					lensStart = performance.now();
					focusLens = document.createElement("div");
					focusLens.dataset.plugin = "dsh-wallpaper_share";
					focusLens.style.cssText = "position:fixed;inset:0;z-index:-1;pointer-events:none;";
					focusLens.style.setProperty("--wesync-lens-x", lensX + "px");
					focusLens.style.setProperty("--wesync-lens-y", lensY + "px");
					document.addEventListener("mousemove", onLensMove, true);
					document.body.appendChild(focusLens);
					if (lensRaf === null) lensRaf = requestAnimationFrame(pumpLens);
				}
				const bf = "blur(12px)";
				focusLens.style.backdropFilter = bf;
				focusLens.style.setProperty("-webkit-backdrop-filter", bf);
				focusLens.style.background = "transparent";
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
				const blurPx = store.settings.focus ? 0 : Math.round(visuals.blur);
				const scale = 1 + blurPx / 400;
				const shadowAlpha = visuals.shadow / 100 * .6;
				const monitorKey = info !== null && info.monitor !== "" ? info.monitor : "";
				const monitorQuery = store.settings.monitor !== "" ? "&monitor=" + encodeURIComponent(store.settings.monitor) : "";
				const wantLive = store.settings.renderMode !== "eco";
				const rawSourceKind = enabled && info !== null && wantLive ? info.source.kind : "";
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
					const canExternal = info.scene?.available === true;
					const canBrowser = info.scene?.model === true || info.scene?.texture === true || info.source.scene === true;
					if (store.settings.renderMode === "perf" && canExternal) {
						if (sceneCanvas === null) sceneCanvas = new SceneCanvas();
						sceneCanvas.applyVisuals(blurPx, scale);
						sceneCanvas.start(monitorKey, info.version);
						stopSceneModelRenderer();
					} else if (canBrowser) {
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
				applyFocusLens();
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
				destroyFocusLens();
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
		exports.FOCUS_LENS = FOCUS_LENS;
		exports.FOCUS_WORK = FOCUS_WORK;
		exports.apply = apply;
		exports.effectiveVisuals = effectiveVisuals;
		exports.inject = inject;
		exports.store = store;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map