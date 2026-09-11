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
		function isGazeRunning() {
			return running;
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
				w.removeMouseEventListeners();
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
		/** 是否已有校准点击样本（ridge 预测依赖它）。false → 预测返回 null、透镜自动回落鼠标，应提示校准。 */
		function hasCalibrationData() {
			if (wg === null) return false;
			try {
				const regs = wg.getRegression();
				return (Array.isArray(regs) ? regs : Object.values(regs)).some((r) => (r?.eyeFeaturesClicks?.length ?? 0) > 0);
			} catch {
				return false;
			}
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
			if (wg !== null) {
				wg.showVideoPreview(true);
				wg.addMouseEventListeners();
			}
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
				if (wg !== null) {
					wg.showVideoPreview(false);
					wg.removeMouseEventListeners();
				}
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
		//#region src/market/version.ts
		/**
		* 版本串比较（市场用）：点分数字段逐段比大小，后缀（如 `-rc` / `-T` / `+build`）忽略。
		*
		* 为什么需要它：市场目录是**远端数据**（`raw.githubusercontent` 有 CDN 缓存、Actions 也要跑一会儿），
		* 所以"目录里的版本比本机已装的旧"是真会出现的状态。拿它当"更新"用，就会把新包静默装回旧版本
		* （2026-09-10 实际发生过一次：刚发布的 1.1.0 被目录里的 1.0.0 覆盖）。比较在这里统一实现，
		* node 半（安装护栏）与 client 半（卡片按钮状态）共用同一套语义。
		*/
		function compareVersion(a, b) {
			const parse = (v) => v.trim().replace(/^v/i, "").split(".").map((seg) => {
				const m = /^\d+/.exec(seg);
				return m === null ? 0 : Number(m[0]);
			});
			const xs = parse(a);
			const ys = parse(b);
			const n = Math.max(xs.length, ys.length);
			for (let i = 0; i < n; i++) {
				const x = xs[i] ?? 0;
				const y = ys[i] ?? 0;
				if (x !== y) return x < y ? -1 : 1;
			}
			return 0;
		}
		//#endregion
		//#region src/client/market-api.ts
		/**
		* 市场前端的纯逻辑层（client 半，浏览器安全：只用 fetch，零 node 依赖）。
		* 与 node 半 src/market/* 解耦——这里只重声明 UI 需要的类型子集，
		* 避免把 node:crypto / node:fs 拖进 lib/client.js 浏览器包。
		* 全部函数注入 fetch，Node 测试喂假响应即可跑通（无需浏览器）。
		*
		* 范围（本轮锁定）：只做免费。付费条目在 buildCards 里直接过滤掉，
		* 不渲染、不提供购买/授权流程（付费系统暂缓实装）。
		*/
		const defaultFetch$1 = (url, init) => fetch(url, init);
		/**
		* 拉 catalog（node 半缓存 5 分钟）。`refresh: true` = 强制重拉：node 半据此绕开自身缓存，
		* 并给上游 URL 加 cache-buster（catalog 挂在 raw.githubusercontent 上，不加就还是旧目录）。
		*/
		async function fetchCatalog(fetchFn = defaultFetch$1, url = "/we-sync/dwp/market/catalog", opts) {
			const res = await fetchFn(opts?.refresh === true ? url + (url.includes("?") ? "&" : "?") + "refresh=1" : url, { cache: "no-store" });
			if (!res.ok) throw new Error(`catalog ${res.status}`);
			const body = await res.json();
			return Array.isArray(body.entries) ? body.entries : [];
		}
		/** 拉已装列表。 */
		async function fetchInstalled$1(fetchFn = defaultFetch$1, url = "/we-sync/dwp/market/installed") {
			const res = await fetchFn(url, { cache: "no-store" });
			if (!res.ok) throw new Error(`installed ${res.status}`);
			const body = await res.json();
			return Array.isArray(body.installed) ? body.installed : [];
		}
		/**
		* 合并 catalog + installed → 卡片视图模型。免费 only（commercial 过滤掉）。
		* 安装状态按版本比较得出：目录比本地新 = update；**目录比本地旧 = local-ahead**
		* （远端目录可能因为 CDN 缓存还没刷新 —— 这种卡片不给"更新"按钮，避免把新包装回旧版本）。
		*/
		function buildCards(catalog, installed) {
			const byId = new Map(installed.map((i) => [i.id, i]));
			const cards = [];
			for (const entry of catalog) {
				if (entry.license.commercial !== false) continue;
				const rec = byId.get(entry.id);
				const next = entry.dwp.package.version;
				const state = rec === void 0 ? "absent" : rec.version === next ? "installed" : compareVersion(next, rec.version) < 0 ? "local-ahead" : "update";
				cards.push({
					entry,
					state,
					installedVersion: rec?.version
				});
			}
			return cards;
		}
		/** 关键词（名称/作者/描述）+ 标签筛选。 */
		function searchCards(cards, keyword, tag = "") {
			const kw = keyword.trim().toLowerCase();
			return cards.filter((c) => {
				if (tag !== "" && !(c.entry.tags ?? []).includes(tag)) return false;
				if (kw === "") return true;
				return [
					c.entry.name.zh,
					c.entry.name.en,
					c.entry.author,
					c.entry.description ?? ""
				].join(" ").toLowerCase().includes(kw);
			});
		}
		/** 从卡片集合收集全部标签（供筛选下拉）。 */
		function collectTags(cards) {
			const s = /* @__PURE__ */ new Set();
			for (const c of cards) for (const tg of c.entry.tags ?? []) s.add(tg);
			return [...s].sort();
		}
		/** 安装（GET /install?id=）。402 → needsPurchase（本轮 UI 不发起，防御性保留）。 */
		async function install(fetchFn = defaultFetch$1, id) {
			const res = await fetchFn("/we-sync/dwp/market/install?id=" + encodeURIComponent(id), { cache: "no-store" });
			const body = await res.json().catch(() => ({}));
			if (res.status === 402) return {
				ok: false,
				needsPurchase: true,
				salesUrl: body.salesUrl
			};
			if (!res.ok) return {
				ok: false,
				error: body.error ?? `HTTP ${res.status}`
			};
			return { ok: true };
		}
		async function uninstall(fetchFn = defaultFetch$1, id) {
			const res = await fetchFn("/we-sync/dwp/market/uninstall?id=" + encodeURIComponent(id), { cache: "no-store" });
			if (!res.ok) return {
				ok: false,
				error: (await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`
			};
			return { ok: true };
		}
		/** 应用某个已装 DWP 为壁纸（GET /apply?id=）。 */
		async function applyDwp(fetchFn = defaultFetch$1, id) {
			const res = await fetchFn("/we-sync/dwp/apply?id=" + encodeURIComponent(id), { cache: "no-store" });
			const body = await res.json().catch(() => ({}));
			if (!res.ok) return {
				ok: false,
				error: body.error ?? `HTTP ${res.status}`
			};
			return { ok: true };
		}
		/** 取消应用（GET /unapply）。 */
		async function unapplyDwp(fetchFn = defaultFetch$1) {
			const res = await fetchFn("/we-sync/dwp/unapply", { cache: "no-store" });
			if (!res.ok) return {
				ok: false,
				error: (await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`
			};
			return { ok: true };
		}
		/** 查询当前应用的 DWP（GET /applied）。 */
		async function fetchApplied(fetchFn = defaultFetch$1) {
			const res = await fetchFn("/we-sync/dwp/applied", { cache: "no-store" });
			if (!res.ok) return null;
			return (await res.json()).applied ?? null;
		}
		//#endregion
		//#region src/client/launcher-api.ts
		const defaultFetch = (url, init) => fetch(url, init);
		async function fetchInstalled(fetchFn = defaultFetch) {
			const res = await fetchFn("/we-sync/launcher/installed", { cache: "no-store" });
			if (!res.ok) return [];
			const body = await res.json();
			return Array.isArray(body.installed) ? body.installed : [];
		}
		async function installApp(opts, fetchFn = defaultFetch) {
			const res = await fetchFn("/we-sync/launcher/install", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(opts)
			});
			const body = await res.json().catch(() => ({}));
			if (!res.ok) return {
				ok: false,
				error: body.error ?? `HTTP ${res.status}`,
				code: body.code,
				files: body.files
			};
			return {
				ok: true,
				record: body.record,
				candidates: body.candidates
			};
		}
		async function uninstallApp(id, fetchFn = defaultFetch) {
			const res = await fetchFn("/we-sync/launcher/uninstall?id=" + encodeURIComponent(id), { cache: "no-store" });
			if (!res.ok) return {
				ok: false,
				error: (await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`
			};
			return { ok: true };
		}
		/** 启动（用户手势触发；服务端 detached spawn）。 */
		async function launchApp(id, fetchFn = defaultFetch) {
			const res = await fetchFn("/we-sync/apps/launch?id=" + encodeURIComponent(id), { cache: "no-store" });
			const body = await res.json().catch(() => ({}));
			if (!res.ok) return {
				ok: false,
				error: body.error ?? `HTTP ${res.status}`
			};
			return { ok: true };
		}
		/** 多候选时切换入口。 */
		async function setEntry(id, file, fetchFn = defaultFetch) {
			const res = await fetchFn("/we-sync/launcher/entry", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					id,
					file
				})
			});
			const body = await res.json().catch(() => ({}));
			if (!res.ok) return {
				ok: false,
				error: body.error ?? `HTTP ${res.status}`
			};
			return { ok: true };
		}
		/** 139 登录态：查询是否已配置（返回掩码账号）与保存。 */
		async function get139Auth(fetchFn = defaultFetch) {
			const body = await (await fetchFn("/we-sync/launcher/139auth", { cache: "no-store" })).json().catch(() => ({}));
			return {
				present: body.present === true,
				account: typeof body.account === "string" ? body.account : ""
			};
		}
		async function set139Auth(authorization, fetchFn = defaultFetch) {
			const res = await fetchFn("/we-sync/launcher/139auth", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ authorization })
			});
			const body = await res.json().catch(() => ({}));
			if (!res.ok) return {
				ok: false,
				error: body.error ?? `HTTP ${res.status}`
			};
			return { ok: true };
		}
		/** 百度网盘登录态：查询是否已配置（返回 BDUSS 掩码）与保存（整串 Cookie 或裸 BDUSS 值）。 */
		async function getBaiduAuth(fetchFn = defaultFetch) {
			const body = await (await fetchFn("/we-sync/launcher/baiduauth", { cache: "no-store" })).json().catch(() => ({}));
			return {
				present: body.present === true,
				account: typeof body.account === "string" ? body.account : ""
			};
		}
		async function setBaiduAuth(cookie, fetchFn = defaultFetch) {
			const res = await fetchFn("/we-sync/launcher/baiduauth", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ cookie })
			});
			const body = await res.json().catch(() => ({}));
			if (!res.ok) return {
				ok: false,
				error: body.error ?? `HTTP ${res.status}`
			};
			return { ok: true };
		}
		/** 安装位置：查询当前根目录。 */
		async function getLauncherRoot(fetchFn = defaultFetch) {
			const body = await (await fetchFn("/we-sync/launcher/root", { cache: "no-store" })).json().catch(() => ({}));
			return typeof body.root === "string" ? body.root : "";
		}
		/** 安装位置：更换根目录。move=true 时把已装应用整目录搬到新位置（跨盘自动复制+删源）。
		*  moved=成功迁移数；failed=迁移失败的标题列表（留原处，可重装）。 */
		async function setLauncherRoot(root, move, fetchFn = defaultFetch) {
			const res = await fetchFn("/we-sync/launcher/root", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					root,
					move
				})
			});
			const body = await res.json().catch(() => ({}));
			if (!res.ok) return {
				ok: false,
				error: body.error ?? `HTTP ${res.status}`
			};
			return {
				ok: true,
				root: body.root,
				moved: body.moved,
				failed: body.failed
			};
		}
		/** URL 粗校验：仅 http(s)。 */
		const isValidHttpUrl = (text) => {
			try {
				const u = new URL(text.trim());
				return u.protocol === "http:" || u.protocol === "https:";
			} catch {
				return false;
			}
		};
		/** 文件大小的人类可读格式（安装确认弹层展示）。 */
		function humanSize(bytes) {
			if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
			const units = [
				"B",
				"KiB",
				"MiB",
				"GiB"
			];
			let v = bytes;
			let i = 0;
			while (v >= 1024 && i < units.length - 1) {
				v /= 1024;
				i++;
			}
			return (i === 0 ? String(v) : v.toFixed(1)) + " " + units[i];
		}
		//#endregion
		//#region src/client/library-model.ts
		const isApplication = (a) => a.type === "application";
		const isLauncherApp = (a) => (a.source ?? "") === "launcher";
		/** 应用大类切分：all 为全部应用；we 排除启动器装的；launcher 只留启动器装的。 */
		function partitionApps(apps) {
			const only = apps.filter(isApplication);
			return {
				all: only,
				we: only.filter((a) => !isLauncherApp(a)),
				launcher: only.filter(isLauncherApp)
			};
		}
		/** 按二级分类取子集（all 返回全部应用）。 */
		function appsForSub(apps, sub) {
			return partitionApps(apps)[sub];
		}
		/**
		* 目录路径取末段。scanApps 的 id 就是壁纸目录全路径（服务端 normalize 成 '/' 分隔），
		* 启动器安装的应用目录恒为 `<安装根>/<slug>`，因此末段即 slug。
		* 末尾有分隔符时也要正确取到（split + 过滤空段）。
		*/
		function slugOfDir(dir) {
			const parts = dir.replace(/\\/g, "/").split("/").filter((s) => s !== "");
			return parts.length === 0 ? "" : parts[parts.length - 1];
		}
		/**
		* 扫描到的「应用」瓷砖 → 启动器安装记录（用于给出「卸载」）。
		* 优先按目录末段匹配 slug（唯一可信的对应关系）；匹配不到时**只在服务端已标记
		* source === 'launcher' 的前提下**按标题兜底（目录被重命名过的情况）。
		*
		* 标题兜底必须卡在 source 上：工坊 / 自定义目录里的应用和启动器应用完全可能同名，
		* 若放开兜底，点工坊瓷砖的「卸载」会删掉另一条启动器记录——那是真实的数据损失。
		* 返回 null 表示"不是启动器装的"：这种瓷砖只给「打开源文件」。
		*/
		function matchLauncherRecord(app, records) {
			const slug = slugOfDir(app.id).toLowerCase();
			if (slug !== "") {
				const bySlug = records.find((r) => r.slug.toLowerCase() === slug);
				if (bySlug !== void 0) return bySlug;
			}
			if (!isLauncherApp(app)) return null;
			return records.find((r) => r.title === app.title) ?? null;
		}
		/** ISO 安装时间 → 本地 `YYYY-MM-DD HH:mm`（解析失败时原样回显，不吞信息）。 */
		function formatInstalledAt(iso) {
			const d = new Date(iso);
			if (Number.isNaN(d.getTime())) return iso;
			const p = (n) => String(n).padStart(2, "0");
			return String(d.getFullYear()) + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
		}
		/** 启动器应用目录（详情里的「地址」）：安装根 + slug，统一 Windows 反斜杠。 */
		function launcherAppDir(root, slug) {
			const r = root.trim().replace(/[\\/]+$/, "");
			if (r === "") return slug;
			return r.replace(/\//g, "\\") + "\\" + slug;
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
				sceneEco: "场景 · 预览图",
				sceneExternal: "场景 · 捕获 live",
				sceneModel: "场景 · 浏览器模型渲染",
				sceneFallback: "场景 · 回退：",
				versionTitle: "插件版本",
				bgMonitor: "背景显示器",
				autoFollowLatest: "自动 · 跟随最新变化",
				auto: "auto",
				syncOn: "⏻ 同步开启",
				syncOff: "⏻ 同步关闭",
				flashSyncOn: "已开启壁纸同步",
				flashSyncOff: "已关闭壁纸同步",
				dwpMountedHint: "已挂载 DWP 壁纸：期间WE 捕获模式禁用。",
				syncPaused: "⏻ 同步暂停（DWP）",
				perfDisabledHint: "挂载 DWP 期间捕获模式不可用",
				visualTitle: "视觉效果",
				focusMode: "专注模式",
				focusIntro: "随任务自适应调节背景效果",
				flashFocusOn: "专注模式已开启：注视点透镜跟随鼠标（圆心清晰）；可再开「眼动追踪」改为跟随视线",
				flashFocusOff: "专注模式已关闭，恢复手动滑块",
				renderModeTitle: "渲染模式",
				modeEco: "预览",
				modePerf: "捕获",
				modeEnhanced: "完整",
				flashEco: "节能模式：静态预览图（最省电）",
				flashPerfScene: "性能模式：捕获 WE 桌面背景",
				flashPerfFallback: "性能模式：WE 未运行 / 捕获不可用 → 回退浏览器渲染",
				flashEnhancedScene: "增强模式：浏览器解 pkg 渲染（不依赖 WE，效果覆盖不全）",
				flashVideo: "使用壁纸源视频实时渲染",
				flashWeb: "加载 Web 壁纸页面",
				flashSource: "使用壁纸源文件实时渲染",
				gazeMode: "眼动追踪",
				gazeCalibrate: "校准视线",
				gazeStarting: "眼动：加载模型并请求摄像头…（首次请用「校准视线」标定一次）",
				gazeOff: "眼动追踪已关闭（摄像头已释放）",
				gazeNeedOn: "请先开启眼动追踪再校准",
				gazeNeedCalib: "· 眼动待校准：点「校准视线」标定一次",
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
				appsTitle: "壁纸库",
				catLocal: "本地",
				catMarket: "市场",
				collapse: "收起",
				listApps: "浏览壁纸",
				appsEmpty: "暂无内容。",
				appsNoMatch: "没有匹配当前搜索的壁纸",
				openFolder: "打开文件夹：",
				mountHint: "点击挂载为壁纸：",
				unmountHint: "点击取消挂载：",
				unmounted: "已取消挂载",
				noPreview: "无预览",
				loadFailed: "列表加载失败",
				openFolderFailed: "打开文件夹失败",
				mountFailed: "挂载失败",
				typeDwp: "dwp壁纸",
				typeApps: "应用",
				typeWeApp: "we应用",
				typeLauncherApp: "应用",
				appSubAll: "全部",
				manage: "管理",
				manageDone: "完成",
				openSource: "打开源文件",
				detail: "详细",
				detailHide: "收起",
				detailInstalledAt: "安装时间",
				detailAddr: "地址",
				detailExe: "exe 文件",
				launcherManageHint: "启动与卸载到「本地 → 应用」里操作。",
				confirmUninstallTitle: "确认卸载？",
				confirmUninstallBody: "将删除以下内容的本地文件（dwp 壁纸可在市场重装）：",
				manageSelected: "已选",
				bulkUninstall: "卸载选中",
				clearSel: "清空选择",
				manageNotDeletable: "WE 工坊内容不在此卸载（可用「打开源文件」定位）",
				confirmBulkTitle: (n) => "确认卸载选中的 " + String(n) + " 项？",
				flashBulkUninstalled: (n) => "已卸载 " + String(n) + " 项",
				flashBulkPartial: (n, fail) => "已卸载 " + String(n) + " 项，失败：" + fail,
				pageSettings: "设置",
				pageLibrary: "壁纸库",
				pageDwp: "dwp创作",
				dwpStudioHint: "这一页留给 DWP 壁纸创作：滚到这里宿主输入框会重新出现，用来和 agent 讨论、生成 DWP。页面内容下一轮再填。",
				pageHint: "滚动切页 · 用力滚才翻页",
				pageGapHint: "继续滚动翻页 · 轻滑弹回",
				mounted: "已挂载",
				searchPlaceholder: "搜索标题…",
				showMore: "显示更多",
				dwpEmpty: "还没有已安装的 DWP 壁纸，去壁纸库「市场」一栏拉取。",
				weAppEmpty: "没有应用类内容。",
				appsCount: (total, matched) => total === matched ? `共 ${String(total)} 个` : `共 ${String(total)} 个 · 匹配 ${String(matched)} 个`,
				marketRefresh: "刷新",
				marketSearch: "搜索名称 / 作者…",
				marketAll: "全部",
				marketInstall: "安装",
				marketInstalling: "安装中…",
				marketUpdate: "更新",
				marketUninstall: "卸载",
				marketInstalled: "已安装",
				marketLocalAhead: "本地更新",
				marketLocalAheadHint: "本机版本比目录里的新（远端目录可能还没刷新）；不提供回退，避免误装回旧版本",
				dwpTierLead: "DWP 壁纸 · 纹理档：",
				dwpTierHd: "高清（增强 / 完整）",
				dwpTierSd: "标准（预览 / 捕获）",
				marketEmpty: "目录为空",
				marketLoading: "加载中…",
				marketNoMatch: "无匹配结果",
				marketLoadFailed: "目录加载失败（node 半 market 路由未就绪？）",
				marketBy: "作者",
				marketInstalledAt: "已装",
				flashMInstalled: "已安装",
				flashMUpdated: "已更新",
				flashMUninstalled: "已卸载",
				flashMFailed: "操作失败",
				dirsTitle: "壁纸读取位置",
				dirsHint: "添加自己收藏的壁纸文件夹：可直接指向某个壁纸目录（含 project.json），或指向包含多个壁纸目录的集合文件夹",
				dirPlaceholder: "粘贴本地壁纸目录路径，如 D:\\MyWallpapers",
				addDir: "添加",
				removeDir: "移除",
				dirEmpty: "尚未添加自定义目录（默认扫描 workshop + projects）",
				dirExists: "该目录已在列表中",
				dirNotFound: "目录不存在或不可读",
				dirAdded: "已添加目录，重新扫描中",
				dirRemoved: "已移除目录",
				launcherTab: "应用启动器",
				launcherUrlPlaceholder: "粘贴直链（.zip/.7z/.exe）或 139/百度网盘分享页链接…",
				launcherTitlePlaceholder: "标题（留空自动取文件名）",
				launcherPwdPlaceholder: "解压密码（加密包选填）",
				launcherCodePlaceholder: "提取码（139/百度网盘选填）",
				launcherPwdNeed: "压缩包已加密，请填写解压密码后重试",
				launcherPwdWrong: "解压密码错误，或压缩包已损坏",
				launcherAuthTitle: "139 登录态",
				launcherAuthHint: "手动方式：登录 yun.139.com 后，F12 → 网络 → 任意请求 → 请求标头里的 Authorization，整串复制粘贴到这里",
				launcherHelperLink: "一键方式：安装登录态同步助手（139 / 百度网盘合一脚本）",
				launcherTutorialBeta: "该功能为测试版本",
				launcherTutorialPrepTitle: "启动前的准备：",
				launcherTutorialPrep1: "安装油猴（Tampermonkey 浏览器扩展）",
				launcherTutorialPrep2: "在网页登录你的对应网盘（如为网盘链接）",
				launcherTutorialPrep3Lead: "点击“",
				launcherTutorialPrep3Tail: "”（引号内文本为链接）",
				launcherTutorialUseTitle: "日常使用的流程：",
				launcherTutorialUse1: "1. 在对话框内填入你的下载链接、解压密码、提取码、名称",
				launcherTutorialUse2: "2. 点击「下载安装」",
				launcherTutorialUse3: "3. 看到应用栏出现应用后，单击启动应用（每次启动有确认弹窗）",
				launcherAuthPlaceholder: "Basic xxxx… 或 basic:手机号:token",
				launcherAuthSave: "保存",
				launcherAuthClear: "清除",
				launcherAuthSaved: "139 登录态已保存",
				launcherAuthNeed: "139 原始文件下载需要登录态，请在下方粘贴 Authorization",
				launcherAuthNeedShort: "该 139 链接需要登录态：",
				launcherAuthOpenBtn: "一键打开 139 并登录",
				launcherAuthWaiting: "等待登录态同步…（登录后自动检测，最多 10 分钟）",
				launcherAuthSynced: "✔ 已同步 139 登录态，可以安装了",
				launcherRootTag: "（启动器安装位置）",
				launcherRootChange: "更改",
				launcherRootPlaceholder: "例如 D:\\Games\\WeApps（绝对路径）",
				launcherRootSaveLater: "仅改位置（新装生效）",
				launcherRootSaveMove: "迁移已装应用",
				launcherRootSaved: "✔ 安装位置已更新，之后的安装存到新位置",
				launcherRootMoved: "✔ 已迁移应用",
				launcherRootFail: "更改安装位置失败",
				launcherShareCode: "该分享需要提取码：请在提取码框填入后重试",
				launcherShareCodeWrong: "提取码错误，请核对后重试",
				launcherShareFail: "分享解析失败（详情见括号内服务端信息）",
				launcherBaiduTitle: "百度网盘登录态",
				launcherBaiduPlaceholder: "BDUSS=xxxx…（或整行 Cookie: 一起粘进来）",
				launcherBaiduHint: "推荐：装「百度登录态同步助手」油猴脚本（下方教程链接），登录 pan.baidu.com 后自动同步。手动：F12 → 网络 → 刷新 → 点任一 pan.baidu.com 请求 → 请求标头 → 复制整行 Cookie: 粘到这里；或 应用 → Cookie → 复制 BDUSS 的值",
				launcherBaiduSaved: "百度网盘登录态已保存",
				launcherBaiduNeed: "百度网盘文件下载需要登录态（BDUSS），请在下方粘贴",
				launcherBaiduNeedShort: "该百度网盘链接需要登录态：",
				launcherBaiduOpenBtn: "一键打开百度网盘并登录",
				launcherBaiduWaiting: "等待登录态同步…（登录后自动检测，最多 10 分钟）",
				launcherBaiduSynced: "✔ 已同步百度网盘登录态，可以安装了",
				launcherShareCode139: "该 139 分享需要提取码：请在提取码框填入后重试",
				launcherShareCode139Wrong: "139 提取码错误，请核对后重试",
				launcherInstall: "下载安装",
				launcherInstalling: "下载安装中…",
				launcherEmpty: "还没有安装的应用。粘贴直链后点「下载安装」。",
				launcherNoMatch: "没有匹配当前搜索的应用",
				launcherLaunch: "▶ 启动",
				launcherLaunching: "启动中…",
				launcherOpenFolder: "打开文件夹",
				launcherUninstall: "卸载",
				launcherSource: "来源",
				launcherSha: "SHA512",
				launcherEntry: "入口",
				launcherConfirmTitle: "确认启动该程序？",
				launcherConfirmBody: "将从以下路径执行可执行文件。请确认来源可信：",
				launcherConfirmGo: "启动",
				launcherConfirmCancel: "取消",
				launcherSetEntry: "设为入口",
				launcherCandidates: "检测到多个可执行文件，当前入口：",
				flashLInstalled: "安装完成",
				flashLUninstalled: "已卸载",
				flashLLaunched: "已启动",
				flashLFailed: "操作失败",
				launcherPreviewHint: "预览图：安装完成后可用下方「更新预览」按钮重新生成",
				launcherUpdatePreview: "更新预览",
				launcherBadUrl: "链接非法（仅支持 http/https 直链）",
				launcherNoEntry: "未找到可执行入口"
			},
			en: {
				noWallpaper: "Wallpaper Engine has no active wallpaper",
				webNoPreview: "Current wallpaper is Web type (no local preview)",
				applyHint: "Apply a wallpaper in Wallpaper Engine to sync here",
				sceneEco: "Scene · preview image",
				sceneExternal: "Scene · capture live",
				sceneModel: "Scene · browser model render",
				sceneFallback: "Scene · fallback: ",
				versionTitle: "Plugin version",
				bgMonitor: "Background Monitor",
				autoFollowLatest: "Auto · Follow Latest",
				auto: "auto",
				syncOn: "⏻ Sync Enabled",
				syncOff: "⏻ Sync Disabled",
				flashSyncOn: "Wallpaper sync enabled",
				flashSyncOff: "Wallpaper sync disabled",
				dwpMountedHint: "DWP wallpaper mounted: WE capture mode is disabled while active.",
				syncPaused: "⏻ Sync Paused (DWP)",
				perfDisabledHint: "Capture mode is unavailable while a DWP is mounted",
				visualTitle: "Visual Adjustments",
				focusMode: "Focus Mode",
				focusIntro: "Background adjusts adaptively to your task",
				flashFocusOn: "Focus mode on: lens follows mouse (clear center); enable Eye Tracking to follow gaze instead",
				flashFocusOff: "Focus mode off, manual sliders restored",
				renderModeTitle: "Render Mode",
				modeEco: "Preview",
				modePerf: "Capture",
				modeEnhanced: "Full",
				flashEco: "Eco mode: static preview (lowest power)",
				flashPerfScene: "Perf mode: capturing WE desktop",
				flashPerfFallback: "Perf mode: WE not running / capture unavailable → fallback to browser render",
				flashEnhancedScene: "Enhanced mode: browser .pkg render (no WE dependency, partial effects)",
				flashVideo: "Live rendering from source video",
				flashWeb: "Loading Web wallpaper page",
				flashSource: "Live rendering from wallpaper source file",
				gazeMode: "Eye Tracking",
				gazeCalibrate: "Calibrate Gaze",
				gazeStarting: "Eye tracking: loading model & requesting camera… (run Calibrate Gaze once)",
				gazeOff: "Eye tracking off (camera released)",
				gazeNeedOn: "Enable eye tracking before calibrating",
				gazeNeedCalib: "· gaze needs calibration — click Calibrate Gaze once",
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
				appsTitle: "Wallpaper Library",
				catLocal: "Local",
				catMarket: "Market",
				collapse: "Collapse",
				listApps: "Browse Wallpapers",
				appsEmpty: "Nothing here yet.",
				appsNoMatch: "No wallpapers match the current search",
				openFolder: "Open folder: ",
				mountHint: "Click to mount as wallpaper: ",
				unmountHint: "Click to unmount: ",
				unmounted: "Unmounted",
				noPreview: "No Preview",
				loadFailed: "Failed to load list",
				openFolderFailed: "Failed to open folder",
				mountFailed: "Mount failed",
				typeApps: "Apps",
				typeWeApp: "WE app",
				typeLauncherApp: "App",
				appSubAll: "All",
				manage: "Manage",
				manageDone: "Done",
				openSource: "Open source file",
				detail: "Details",
				detailHide: "Hide",
				detailInstalledAt: "Installed",
				detailAddr: "Location",
				detailExe: "Executable",
				launcherManageHint: "Launch and uninstall from Library → Apps.",
				confirmUninstallTitle: "Uninstall?",
				confirmUninstallBody: "This deletes the local files of (DWP wallpapers can be reinstalled from the market):",
				manageSelected: "Selected",
				bulkUninstall: "Uninstall selected",
				clearSel: "Clear",
				manageNotDeletable: "WE Workshop content is not uninstalled here (use \"Open source file\" to locate it)",
				confirmBulkTitle: (n) => "Uninstall the " + String(n) + " selected item(s)?",
				flashBulkUninstalled: (n) => "Uninstalled " + String(n) + " item(s)",
				flashBulkPartial: (n, fail) => "Uninstalled " + String(n) + ", failed: " + fail,
				pageSettings: "Settings",
				pageLibrary: "Library",
				pageDwp: "DWP Studio",
				dwpStudioHint: "Reserved for DWP authoring: the host composer reappears on this page so you can talk to the agent about building DWP wallpapers. Content lands in a later round.",
				pageHint: "Scroll to flip · keep scrolling firmly to turn the page",
				pageGapHint: "Keep scrolling to flip · release to bounce back",
				mounted: "Mounted",
				searchPlaceholder: "Search titles…",
				showMore: "Show more",
				dwpEmpty: "No installed DWP wallpapers yet — pull some in the library \"Market\" tab.",
				typeDwp: "DWP",
				weAppEmpty: "No application wallpapers yet.",
				appsCount: (total, matched) => total === matched ? `Total ${String(total)}` : `Total ${String(total)} · Matched ${String(matched)}`,
				marketRefresh: "Refresh",
				marketSearch: "Search name / author…",
				marketAll: "All",
				marketInstall: "Install",
				marketInstalling: "Installing…",
				marketUpdate: "Update",
				marketUninstall: "Uninstall",
				marketInstalled: "Installed",
				marketLocalAhead: "Local is newer",
				marketLocalAheadHint: "The installed version is newer than the catalog (the remote catalog may not have refreshed yet); downgrading on purpose is not offered here",
				dwpTierLead: "DWP wallpaper · texture tier: ",
				dwpTierHd: "high-res (Enhanced)",
				dwpTierSd: "standard (Eco / Perf)",
				marketEmpty: "Catalog is empty",
				marketLoading: "Loading…",
				marketNoMatch: "No matches",
				marketLoadFailed: "Failed to load catalog (node market route not ready?)",
				marketBy: "by",
				marketInstalledAt: "installed",
				flashMInstalled: "Installed",
				flashMUpdated: "Updated",
				flashMUninstalled: "Uninstalled",
				flashMFailed: "Operation failed",
				dirsTitle: "Wallpaper Read Locations",
				dirsHint: "Add your own wallpaper folders: point to a single wallpaper dir (with project.json) or a collection folder containing wallpaper dirs",
				dirPlaceholder: "Paste a local wallpaper dir path, e.g. D:\\MyWallpapers",
				addDir: "Add",
				removeDir: "Remove",
				dirEmpty: "No custom dirs yet (defaults: workshop + projects)",
				dirExists: "Dir already in list",
				dirNotFound: "Dir missing or unreadable",
				dirAdded: "Dir added, rescanning",
				dirRemoved: "Dir removed",
				launcherTab: "App Launcher",
				launcherUrlPlaceholder: "Paste a direct link (.zip/.7z/.exe) or a 139/Baidu share page URL…",
				launcherTitlePlaceholder: "Title (defaults to filename)",
				launcherPwdPlaceholder: "Archive password (optional)",
				launcherCodePlaceholder: "Share passcode (139/Baidu, optional)",
				launcherPwdNeed: "Archive is encrypted — enter the password and retry",
				launcherPwdWrong: "Wrong password, or the archive is corrupted",
				launcherAuthTitle: "139 Login (Authorization)",
				launcherAuthHint: "Manual: sign in at yun.139.com, open DevTools → Network → any request → copy the whole Authorization request header, paste it here",
				launcherHelperLink: "One-click: install the login-sync helper (139 / Baidu combined)",
				launcherTutorialBeta: "This feature is in beta",
				launcherTutorialPrepTitle: "First-time setup:",
				launcherTutorialPrep1: "Install Tampermonkey (browser extension)",
				launcherTutorialPrep2: "Sign in to your cloud drive in the browser (if the link is a cloud-drive share)",
				launcherTutorialPrep3Lead: "Click “",
				launcherTutorialPrep3Tail: "” (the quoted text is the link)",
				launcherTutorialUseTitle: "Daily usage:",
				launcherTutorialUse1: "1. Fill in the download link, archive password, share passcode and title in the input row",
				launcherTutorialUse2: "2. Click \"Install\"",
				launcherTutorialUse3: "3. Once the app tile appears in the library, click it to launch (a confirm dialog shows each time)",
				launcherAuthPlaceholder: "Basic xxxx… or basic:phone:token",
				launcherAuthSave: "Save",
				launcherAuthClear: "Clear",
				launcherAuthSaved: "139 authorization saved",
				launcherAuthNeed: "139 original-file download needs an Authorization — paste it below",
				launcherAuthNeedShort: "This 139 link needs a login state:",
				launcherAuthOpenBtn: "Open 139 & sign in",
				launcherAuthWaiting: "Waiting for login sync… (auto-detected after sign-in, up to 10 min)",
				launcherAuthSynced: "✔ 139 login synced — ready to install",
				launcherRootTag: "(launcher install root)",
				launcherRootChange: "Change",
				launcherRootPlaceholder: "e.g. D:\\Games\\WeApps (absolute path)",
				launcherRootSaveLater: "Future installs only",
				launcherRootSaveMove: "Move installed apps",
				launcherRootSaved: "✔ Install location updated — future installs go there",
				launcherRootMoved: "✔ Apps moved",
				launcherRootFail: "Failed to update install location",
				launcherShareCode: "This share needs a passcode — enter it in the passcode box and retry",
				launcherShareCodeWrong: "Wrong passcode — check it and retry",
				launcherShareFail: "Share resolve failed (see server detail in brackets)",
				launcherBaiduTitle: "Baidu Netdisk Login (Cookie)",
				launcherBaiduPlaceholder: "BDUSS=xxxx… (or paste the whole Cookie: line)",
				launcherBaiduHint: "Recommended: install the Baidu login-sync helper userscript (tutorial link below) — it syncs automatically once you sign in at pan.baidu.com. Manual: DevTools → Network → reload → click any pan.baidu.com request → copy the whole Cookie: request header; or Application → Cookies → copy the BDUSS value",
				launcherBaiduSaved: "Baidu login cookie saved",
				launcherBaiduNeed: "Baidu file download needs a login cookie (BDUSS) — paste it below",
				launcherBaiduNeedShort: "This Baidu link needs a login state:",
				launcherBaiduOpenBtn: "Open Baidu & sign in",
				launcherBaiduWaiting: "Waiting for login sync… (auto-detected after sign-in, up to 10 min)",
				launcherBaiduSynced: "✔ Baidu login synced — ready to install",
				launcherShareCode139: "This 139 share needs a passcode — enter it in the passcode box and retry",
				launcherShareCode139Wrong: "Wrong 139 passcode — check it and retry",
				launcherInstall: "Download & Install",
				launcherInstalling: "Downloading…",
				launcherEmpty: "No apps installed yet. Paste a direct link and click \"Download & Install\".",
				launcherNoMatch: "No apps match the current search",
				launcherLaunch: "▶ Launch",
				launcherLaunching: "Launching…",
				launcherOpenFolder: "Open folder",
				launcherUninstall: "Uninstall",
				launcherSource: "Source",
				launcherSha: "SHA512",
				launcherEntry: "Entry",
				launcherConfirmTitle: "Launch this program?",
				launcherConfirmBody: "The executable below will be started. Make sure you trust its source:",
				launcherConfirmGo: "Launch",
				launcherConfirmCancel: "Cancel",
				launcherSetEntry: "Set as entry",
				launcherCandidates: "Multiple executables found. Current entry:",
				flashLInstalled: "Installed",
				flashLUninstalled: "Uninstalled",
				flashLLaunched: "Launched",
				flashLFailed: "Operation failed",
				launcherPreviewHint: "Preview: regenerate via \"Update preview\" below after install",
				launcherUpdatePreview: "Update preview",
				launcherBadUrl: "Invalid link (http/https direct links only)",
				launcherNoEntry: "No executable entry found"
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
			const [focusHover, setFocusHover] = (0, react.useState)(false);
			const [renderMode, setRenderMode] = (0, react.useState)(store.settings.renderMode);
			const [gazeEnabled, setGazeEnabled] = (0, react.useState)(store.settings.gazeEnabled);
			const [gazeStatus, setGazeStatus] = (0, react.useState)("off");
			const [gazeError, setGazeError] = (0, react.useState)("");
			const [gazeSnapText, setGazeSnapText] = (0, react.useState)(store.settings.gazeSnapText);
			const [needsCalib, setNeedsCalib] = (0, react.useState)(false);
			(0, react.useEffect)(() => onGazeStatus((s, err) => {
				setGazeStatus(s);
				setGazeError(err);
			}), []);
			const CHARGE_THRESHOLD = 600;
			const CHARGE_DECAY_MS = 250;
			const PULL_RATIO = .07;
			const PAGES = [
				"settings",
				"library",
				"dwp"
			];
			const pageIdx = (p) => PAGES.indexOf(p);
			const [page, setPage] = (0, react.useState)("settings");
			const appsOpen = page === "library";
			const panelRef = (0, react.useRef)(null);
			const viewportRef = (0, react.useRef)(null);
			const trackRef = (0, react.useRef)(null);
			const settingsRef = (0, react.useRef)(null);
			const gapRef = (0, react.useRef)(null);
			const libRef = (0, react.useRef)(null);
			const gap2Ref = (0, react.useRef)(null);
			const dwpRef = (0, react.useRef)(null);
			const progRefs = [
				(0, react.useRef)(null),
				(0, react.useRef)(null),
				(0, react.useRef)(null)
			];
			const libLoadedRef = (0, react.useRef)(false);
			const capRef = (0, react.useRef)(null);
			const pageRef = (0, react.useRef)("settings");
			pageRef.current = page;
			const loadLibraryData = () => {
				if (libLoadedRef.current) return;
				libLoadedRef.current = true;
				loadApps();
				loadDwp();
				loadMarket();
				loadLauncher();
			};
			const geoRef = (0, react.useRef)({
				maxPos: 0,
				tops: [
					0,
					0,
					0
				],
				bottoms: [
					0,
					0,
					0
				]
			});
			const posRef = (0, react.useRef)(0);
			const velRef = (0, react.useRef)(0);
			const accRef = (0, react.useRef)(0);
			const pullRef = (0, react.useRef)(0);
			const pullTargetRef = (0, react.useRef)(0);
			const phaseRef = (0, react.useRef)("idle");
			const animRef = (0, react.useRef)(null);
			const decayTimerRef = (0, react.useRef)(null);
			/** 当前页（翻页动画期间取目标页）：决定可用高度——只有 dwp创作页要避让宿主输入框 */
			const effectivePage = () => {
				const a = animRef.current;
				return phaseRef.current === "anim" && a !== null ? a.target : pageRef.current;
			};
			const measure = () => {
				const vp = viewportRef.current;
				const track = trackRef.current;
				const s = settingsRef.current;
				const gap = gapRef.current;
				const lib = libRef.current;
				const gap2 = gap2Ref.current;
				const dwp = dwpRef.current;
				if (vp === null || track === null || s === null || gap === null || lib === null || gap2 === null || dwp === null) return;
				const vpH = vp.clientHeight;
				vp.style.setProperty("--wesync-vph", Math.max(0, vpH) + "px");
				const maxPos = Math.max(0, track.scrollHeight - vpH);
				const hs = [
					s.offsetHeight,
					lib.offsetHeight,
					dwp.offsetHeight
				];
				const tops = [
					0,
					hs[0] + gap.offsetHeight,
					hs[0] + gap.offsetHeight + hs[1] + gap2.offsetHeight
				];
				const bottoms = tops.map((top, i) => i === PAGES.length - 1 ? maxPos : Math.max(top, Math.min(top + hs[i] - vpH, maxPos)));
				geoRef.current = {
					maxPos,
					tops,
					bottoms
				};
			};
			const rangeOf = (i) => {
				const g = geoRef.current;
				const k = Math.max(0, Math.min(PAGES.length - 1, i));
				return {
					top: g.tops[k],
					bottom: g.bottoms[k]
				};
			};
			/**
			* 可用高度：面板顶 → 底部边界，写进 --wesync-pages-max。
			*
			* 宿主输入框（composer）是 sticky + z-index 7 的常驻条，固定占着会话列底部
			* （实测 126px，多行输入还会变高）。压在它下面的内容点不到——elementFromPoint
			* 命中的是输入框的「+」按钮 / 模式行，而不是卡片按钮。
			* 现在「设置」「壁纸库」两页由 CSS 把输入框整体淡出并放行指针（点得到、看不见），
			* 只有 dwp创作页显示它，所以也只有那页需要把它的高度让出来。
			* 其余页用视口底部当边界——顺带修掉原来写死 32px 造成的底部溢出
			* （实测 1100×700 面板底边超出视口 44px，而宿主滚动被钉住、滚不回来）。
			*/
			const syncViewportCap = () => {
				const host = panelRef.current;
				if (host === null) return;
				const seat = effectivePage() === "dwp" ? document.querySelector("[data-composer-seat]") : null;
				const limit = seat !== null ? Math.min(seat.getBoundingClientRect().top, window.innerHeight - 8) : window.innerHeight - 8;
				let avail = Math.round(limit - host.getBoundingClientRect().top);
				if (avail < 240) avail = 0;
				if (avail > 0) host.style.setProperty("--wesync-pages-max", avail + "px");
				else host.style.removeProperty("--wesync-pages-max");
				measure();
				if (phaseRef.current !== "anim") {
					const r = rangeOf(pageIdx(pageRef.current));
					posRef.current = Math.max(r.top, Math.min(r.bottom, posRef.current));
				}
			};
			const resetProgress = () => {
				for (const p of progRefs) if (p.current !== null) p.current.style.transform = "scaleX(0)";
			};
			const cancelCharge = () => {
				accRef.current = 0;
				pullTargetRef.current = 0;
				resetProgress();
			};
			const disarmDecay = () => {
				if (decayTimerRef.current !== null) {
					window.clearTimeout(decayTimerRef.current);
					decayTimerRef.current = null;
				}
			};
			/** 蓄力翻页：引擎动画滚过断层到相邻页顶，到达后再切页签高亮 */
			const flipTo = (target) => {
				phaseRef.current = "anim";
				cancelCharge();
				disarmDecay();
				animRef.current = {
					from: posRef.current,
					to: posRef.current,
					start: performance.now(),
					target
				};
				syncViewportCap();
				animRef.current.to = rangeOf(pageIdx(target)).top;
				if (target === "library") loadLibraryData();
			};
			(0, react.useEffect)(() => {
				const scroller = document.querySelector("[data-conversation-scroll]");
				if (scroller === null) return;
				const el = scroller;
				el.classList.add("wesync-wheel-lock");
				const pinTop = () => {
					if (el.scrollTop !== 0) el.scrollTop = 0;
					if (el.scrollLeft !== 0) el.scrollLeft = 0;
				};
				pinTop();
				const block = (e) => {
					const t = e.target;
					if (t !== null && t.closest("textarea") !== null) return;
					e.preventDefault();
				};
				el.addEventListener("wheel", block, {
					passive: false,
					capture: true
				});
				el.addEventListener("scroll", pinTop, { passive: true });
				let frames = 0;
				let raf = requestAnimationFrame(function pinEarly() {
					pinTop();
					if (++frames < 20) raf = requestAnimationFrame(pinEarly);
				});
				return () => {
					el.classList.remove("wesync-wheel-lock");
					el.removeEventListener("wheel", block, { capture: true });
					el.removeEventListener("scroll", pinTop);
					cancelAnimationFrame(raf);
				};
			}, []);
			(0, react.useEffect)(() => {
				document.body.dataset.wesyncPage = page;
				if (page === "settings") {
					const seat = document.querySelector("[data-composer-seat]");
					const ae = document.activeElement;
					if (seat !== null && ae instanceof HTMLElement && seat.contains(ae)) ae.blur();
				}
				return () => {
					delete document.body.dataset.wesyncPage;
				};
			}, [page]);
			(0, react.useEffect)(() => {
				const vp = viewportRef.current;
				if (vp === null) return;
				const onWheel = (e) => {
					e.preventDefault();
					if (e.ctrlKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
					if (phaseRef.current === "anim") return;
					let dy = e.deltaY;
					if (e.deltaMode === 1) dy *= 40;
					else if (e.deltaMode === 2) dy *= 800;
					if (dy === 0) return;
					geoRef.current;
					const dir = dy > 0 ? 1 : -1;
					const cur = pageIdx(pageRef.current);
					const { top: pageTop, bottom: pageBottom } = rangeOf(cur);
					const atBoundary = dir === 1 && posRef.current >= pageBottom - .5 || dir === -1 && posRef.current <= pageTop + .5;
					const canFlip = dir === 1 && cur < PAGES.length - 1 || dir === -1 && cur > 0;
					if (phaseRef.current === "charge" && pullTargetRef.current !== 0 && (dir === 1 && pullTargetRef.current > 0 || dir === -1 && pullTargetRef.current < 0)) {
						phaseRef.current = "idle";
						cancelCharge();
						disarmDecay();
					}
					if (!(phaseRef.current === "charge" && pullTargetRef.current !== 0) && !atBoundary) {
						disarmDecay();
						velRef.current = dy * .4;
						posRef.current = Math.max(pageTop, Math.min(pageBottom, posRef.current + dy));
						return;
					}
					if (phaseRef.current !== "charge") {
						phaseRef.current = "charge";
						accRef.current = 0;
					}
					if (!canFlip) {
						pullTargetRef.current = Math.max(-14, Math.min(14, -dy * .12));
						accRef.current = 0;
						resetProgress();
					} else {
						accRef.current += dy;
						const ratio = Math.min(1, Math.abs(accRef.current) / CHARGE_THRESHOLD);
						const maxPull = vp.clientHeight * PULL_RATIO;
						pullTargetRef.current = dir * ratio * maxPull * -1;
						const prog = progRefs[cur + dir];
						if (prog !== void 0 && prog.current !== null) prog.current.style.transform = "scaleX(" + ratio.toFixed(3) + ")";
						const other = progRefs[cur];
						if (other !== void 0 && other.current !== null) other.current.style.transform = "scaleX(0)";
						if (Math.abs(accRef.current) >= CHARGE_THRESHOLD) {
							flipTo(PAGES[cur + dir]);
							return;
						}
					}
					disarmDecay();
					decayTimerRef.current = window.setTimeout(() => {
						decayTimerRef.current = null;
						cancelCharge();
						phaseRef.current = "idle";
					}, CHARGE_DECAY_MS);
				};
				const host = panelRef.current;
				if (host === null) return;
				host.addEventListener("wheel", onWheel, { passive: false });
				capRef.current = syncViewportCap;
				syncViewportCap();
				const seatEl = document.querySelector("[data-composer-seat]");
				const seatRo = seatEl !== null ? new ResizeObserver(syncViewportCap) : null;
				if (seatEl !== null && seatRo !== null) seatRo.observe(seatEl);
				const ro = new ResizeObserver(() => {
					measure();
					const r = rangeOf(pageIdx(pageRef.current));
					posRef.current = Math.max(r.top, Math.min(r.bottom, posRef.current));
				});
				if (trackRef.current !== null) ro.observe(trackRef.current);
				window.addEventListener("resize", syncViewportCap);
				return () => {
					host.removeEventListener("wheel", onWheel);
					ro.disconnect();
					seatRo?.disconnect();
					window.removeEventListener("resize", syncViewportCap);
					host.style.removeProperty("--wesync-pages-max");
					capRef.current = null;
				};
			}, []);
			(0, react.useEffect)(() => {
				capRef.current?.();
			}, [page]);
			(0, react.useEffect)(() => {
				let raf = 0;
				const tick = () => {
					raf = requestAnimationFrame(tick);
					const track = trackRef.current;
					if (track === null) return;
					geoRef.current;
					const a = animRef.current;
					if (phaseRef.current === "anim" && a !== null) {
						const t = Math.min(1, (performance.now() - a.start) / 340);
						const ease = 1 - Math.pow(1 - t, 3);
						posRef.current = a.from + (a.to - a.from) * ease;
						pullRef.current *= .7;
						if (t >= 1) {
							posRef.current = a.to;
							pullRef.current = 0;
							animRef.current = null;
							phaseRef.current = "idle";
							if (pageRef.current !== a.target) setPage(a.target);
						}
					} else {
						if (Math.abs(velRef.current) > .4) {
							posRef.current += velRef.current;
							velRef.current *= .9;
							const r = rangeOf(pageIdx(pageRef.current));
							posRef.current = Math.max(r.top, Math.min(r.bottom, posRef.current));
						} else velRef.current = 0;
						pullRef.current += (pullTargetRef.current - pullRef.current) * .22;
						if (Math.abs(pullRef.current) < .4 && pullTargetRef.current === 0) pullRef.current = 0;
					}
					track.style.transform = "translate3d(0," + (-posRef.current + pullRef.current).toFixed(2) + "px,0)";
				};
				raf = requestAnimationFrame(tick);
				return () => cancelAnimationFrame(raf);
			}, []);
			/** 页签点击：引擎动画滚到对应页顶 */
			const scrollToPage = (target) => {
				if (phaseRef.current === "anim") return;
				if (target === pageRef.current) {
					syncViewportCap();
					const { top } = rangeOf(pageIdx(target));
					phaseRef.current = "anim";
					animRef.current = {
						from: posRef.current,
						to: top,
						start: performance.now(),
						target
					};
					return;
				}
				flipTo(target);
			};
			const [libTab, setLibTab] = (0, react.useState)("local");
			const [apps, setApps] = (0, react.useState)([]);
			const [appsCounts, setAppsCounts] = (0, react.useState)({});
			const [typeFilter, setTypeFilter] = (0, react.useState)("dwp");
			const [appSub, setAppSub] = (0, react.useState)("all");
			const [manageMode, setManageMode] = (0, react.useState)(false);
			const [libFlash, setLibFlash] = (0, react.useState)("");
			/** 管理模式的多选集合：key = 'dwp|<id>' / 'app|<启动器 slug>'（只有可卸载的项能进来） */
			const [sel, setSel] = (0, react.useState)({});
			/** 待确认的卸载目标：单卡卸载是 1 项，批量是 N 项，共用同一个确认弹层与执行路径 */
			const [uninstallFor, setUninstallFor] = (0, react.useState)(null);
			const [search, setSearch] = (0, react.useState)("");
			const [visible, setVisible] = (0, react.useState)(60);
			const [appsError, setAppsError] = (0, react.useState)("");
			const [dwpCards, setDwpCards] = (0, react.useState)([]);
			const [dirs, setDirs] = (0, react.useState)([]);
			const [dirInput, setDirInput] = (0, react.useState)("");
			const [dirStatus, setDirStatus] = (0, react.useState)("");
			const [mCards, setMCards] = (0, react.useState)([]);
			const [mLoading, setMLoading] = (0, react.useState)(false);
			const [mError, setMError] = (0, react.useState)("");
			const [mSearch, setMSearch] = (0, react.useState)("");
			const [mTag, setMTag] = (0, react.useState)("");
			const [mBusy, setMBusy] = (0, react.useState)({});
			const [mFlash, setMFlash] = (0, react.useState)("");
			const [lApps, setLApps] = (0, react.useState)([]);
			const [lUrl, setLUrl] = (0, react.useState)("");
			const [lTitle, setLTitle] = (0, react.useState)("");
			const [lPwd, setLPwd] = (0, react.useState)("");
			const [lPwdErr, setLPwdErr] = (0, react.useState)(false);
			const [lCode, setLCode] = (0, react.useState)("");
			const [lCodeErr, setLCodeErr] = (0, react.useState)(false);
			const [lAuthOpen, setLAuthOpen] = (0, react.useState)(false);
			const [lAuth, setLAuth] = (0, react.useState)("");
			const [lAuthPresent, setLAuthPresent] = (0, react.useState)("");
			const [lAuthBusy, setLAuthBusy] = (0, react.useState)(false);
			const [lAuthWaiting, setLAuthWaiting] = (0, react.useState)(false);
			const [lBaiduAuthOpen, setLBaiduAuthOpen] = (0, react.useState)(false);
			const [lBaiduAuth, setLBaiduAuth] = (0, react.useState)("");
			const [lBaiduAuthPresent, setLBaiduAuthPresent] = (0, react.useState)("");
			const [lBaiduAuthBusy, setLBaiduAuthBusy] = (0, react.useState)(false);
			const [lBaiduAuthWaiting, setLBaiduAuthWaiting] = (0, react.useState)(false);
			const [lRoot, setLRoot] = (0, react.useState)("");
			const [lRootOpen, setLRootOpen] = (0, react.useState)(false);
			const [lRootDraft, setLRootDraft] = (0, react.useState)("");
			const [lRootBusy, setLRootBusy] = (0, react.useState)(false);
			const [lBusy, setLBusy] = (0, react.useState)(false);
			const [lFlash, setLFlash] = (0, react.useState)("");
			const [lSearch, setLSearch] = (0, react.useState)("");
			const [lConfirm, setLConfirm] = (0, react.useState)(null);
			const [lEntryFor, setLEntryFor] = (0, react.useState)(null);
			const [lDetailFor, setLDetailFor] = (0, react.useState)(null);
			const [lChoices, setLChoices] = (0, react.useState)({});
			(0, react.useEffect)(() => {
				if (lDetailFor === null) return;
				const raf = requestAnimationFrame(() => {
					const host = panelRef.current;
					const vp = viewportRef.current;
					if (host === null || vp === null) return;
					const el = Array.from(host.querySelectorAll("[data-wesync-detail]")).find((x) => x.getAttribute("data-wesync-detail") === lDetailFor) ?? null;
					if (el === null) return;
					measure();
					const overflow = el.getBoundingClientRect().bottom - vp.getBoundingClientRect().bottom + 12;
					if (overflow <= 0) return;
					const r = rangeOf(pageIdx("library"));
					posRef.current = Math.max(r.top, Math.min(r.bottom, posRef.current + overflow));
				});
				return () => cancelAnimationFrame(raf);
			}, [lDetailFor]);
			(0, react.useEffect)(() => store.subscribe(() => {
				setInfo(store.info);
				setEnabled(store.settings.enabled);
				setAlpha(store.settings.panelAlpha);
				setBlur(store.settings.blur);
				setShadow(store.settings.shadow);
				setMonitor(store.settings.monitor);
				setFocus(store.settings.focus);
				setRenderMode(store.settings.renderMode);
				setGazeEnabled(store.settings.gazeEnabled);
				setGazeSnapText(store.settings.gazeSnapText);
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
					const noCalib = !hasCalibrationData();
					setNeedsCalib(noCalib);
					if (noCalib) flash(t.gazeNeedCalib);
				} else {
					stopGaze();
					setNeedsCalib(false);
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
					if (completed) setNeedsCalib(false);
					flash(completed ? t.gazeCalibDone : t.gazeCalibCancel);
				});
			};
			const onToggleSnap = () => {
				const next = !store.settings.gazeSnapText;
				store.settings.gazeSnapText = next;
				setGazeSnapText(next);
				store.notify();
			};
			const loadDwp = async () => {
				const f = (url, init) => fetch(url, init);
				let installed = [];
				try {
					installed = await fetchInstalled$1(f);
				} catch {}
				let catalog = [];
				try {
					catalog = await fetchCatalog(f);
				} catch {}
				try {
					const byId = new Map(catalog.map((e) => [e.id, e]));
					const cards = await Promise.all(installed.map(async (it) => {
						const e = byId.get(it.id);
						if (e !== void 0) return {
							id: it.id,
							name: resolveLang() === "en" ? e.name.en : e.name.zh,
							thumbnail: e.dwp.thumbnail,
							version: it.version
						};
						try {
							const r = await f(`/we-sync/dwp/manifest?id=${encodeURIComponent(it.id)}`, { cache: "no-store" });
							if (r.ok) {
								const m = await r.json();
								return {
									id: it.id,
									name: resolveLang() === "en" ? m.name?.en ?? it.id : m.name?.zh ?? it.id,
									thumbnail: m.preview !== void 0 && m.preview !== "" ? `/we-sync/dwp/file?id=${encodeURIComponent(it.id)}&name=${encodeURIComponent(m.preview)}` : "",
									version: it.version
								};
							}
						} catch {}
						return {
							id: it.id,
							name: it.id,
							thumbnail: "",
							version: it.version
						};
					}));
					setDwpCards(cards);
				} catch {}
			};
			const onToggleDwp = async (id) => {
				if (store.settings.dwpMounted === id) {
					await store.actions.unmountDwp();
					flash(t.unmounted);
					return;
				}
				if (await store.actions.mountDwp(id)) flash(t.mountHint + id);
				else flash(t.mountFailed);
			};
			const loadMarket = async (refresh = false) => {
				setMLoading(true);
				setMError("");
				try {
					const f = (url, init) => fetch(url, init);
					const [catalog, installed] = await Promise.all([fetchCatalog(f, void 0, { refresh }), fetchInstalled$1(f)]);
					setMCards(buildCards(catalog, installed));
				} catch (e) {
					setMError(String(e.message ?? e));
				}
				setMLoading(false);
			};
			const flashM = (msg) => {
				setMFlash(msg);
				window.setTimeout(() => setMFlash(""), 3e3);
			};
			const mInstall = async (id, isUpdate) => {
				setMBusy((b) => ({
					...b,
					[id]: true
				}));
				const r = await install((url, init) => fetch(url, init), id);
				setMBusy((b) => {
					const n = { ...b };
					delete n[id];
					return n;
				});
				if (r.ok) {
					loadMarket();
					loadDwp();
					flashM(isUpdate ? t.flashMUpdated : t.flashMInstalled);
				} else flashM(t.flashMFailed + (r.error ? ": " + r.error : ""));
			};
			const mUninstall = async (id) => {
				setMBusy((b) => ({
					...b,
					[id]: true
				}));
				const r = await uninstall((url, init) => fetch(url, init), id);
				setMBusy((b) => {
					const n = { ...b };
					delete n[id];
					return n;
				});
				if (r.ok) {
					if (store.settings.dwpMounted === id) await store.actions.unmountDwp();
					loadMarket();
					loadDwp();
					flashM(t.flashMUninstalled);
				} else flashM(t.flashMFailed);
			};
			const flashLib = (msg) => {
				setLibFlash(msg);
				window.setTimeout(() => setLibFlash(""), 3e3);
			};
			/** dwp 壁纸的「打开源文件」：node 半在资源管理器里定位 packages/<id>.dwp。 */
			const onRevealDwp = (id) => {
				fetch("/we-sync/dwp/market/reveal?id=" + encodeURIComponent(id), { cache: "no-store" }).then((res) => {
					if (!res.ok) flashLib(t.openFolderFailed);
				}).catch(() => flashLib(t.openFolderFailed));
			};
			/** 确认后的卸载：按列表逐项执行（单选=1 项，多选=N 项）；dwp 正挂载先撤背景。 */
			const onConfirmUninstall = async () => {
				const targets = uninstallFor;
				setUninstallFor(null);
				if (targets === null || targets.length === 0) return;
				let ok = 0;
				const failed = [];
				for (const t of targets) if (t.kind === "dwp") {
					if (!(await uninstall((url, init) => fetch(url, init), t.id)).ok) {
						failed.push(t.title);
						continue;
					}
					if (store.settings.dwpMounted === t.id) await store.actions.unmountDwp();
					ok += 1;
				} else {
					if (!(await uninstallApp(t.id, (u) => fetch(u))).ok) {
						failed.push(t.title);
						continue;
					}
					ok += 1;
				}
				loadDwp();
				loadMarket();
				loadApps();
				loadLauncher();
				setSel({});
				flashLib(failed.length === 0 ? targets.length === 1 ? t.flashMUninstalled : t.flashBulkUninstalled(ok) : t.flashBulkPartial(ok, failed.join("、")));
			};
			const selKey = (kind, id) => kind + "|" + id;
			const toggleSel = (key) => {
				setSel((s) => {
					const n = { ...s };
					if (n[key] === true) delete n[key];
					else n[key] = true;
					return n;
				});
			};
			const selCount = Object.keys(sel).length;
			/** 选中集 → 卸载目标列表（标题与路径现查，保证与实际安装记录一致）。 */
			const collectSelTargets = () => {
				const out = [];
				for (const key of Object.keys(sel)) {
					const cut = key.indexOf("|");
					const kind = key.slice(0, cut);
					const id = key.slice(cut + 1);
					if (kind === "dwp") {
						const card = dwpCards.find((d) => d.id === id);
						out.push({
							kind: "dwp",
							id,
							title: card !== void 0 ? card.name : id,
							path: "packages/" + id + ".dwp"
						});
					} else {
						const rec = lApps.find((r) => r.id === id);
						out.push({
							kind: "app",
							id,
							title: rec !== void 0 ? rec.title : id,
							path: launcherAppDir(lRoot, rec !== void 0 ? rec.slug : id)
						});
					}
				}
				return out;
			};
			(0, react.useEffect)(() => {
				if (!manageMode) setSel({});
			}, [manageMode]);
			(0, react.useEffect)(() => {
				setSel({});
			}, [libTab]);
			const onAppOpen = (id) => {
				fetch("/we-sync/apps/open?id=" + encodeURIComponent(id), { cache: "no-store" }).then((res) => {
					if (!res.ok) flash(t.openFolderFailed);
				}).catch(() => flash(t.openFolderFailed));
			};
			const loadLauncher = async () => {
				try {
					setLApps(await fetchInstalled((url, init) => fetch(url, init)));
					const a = await get139Auth((url, init) => fetch(url, init));
					setLAuthPresent(a.present ? a.account : "");
					const b = await getBaiduAuth((url, init) => fetch(url, init));
					setLBaiduAuthPresent(b.present ? b.account : "");
					setLRoot(await getLauncherRoot((url, init) => fetch(url, init)));
				} catch {}
			};
			const flashL = (msg) => {
				setLFlash(msg);
				window.setTimeout(() => setLFlash(""), 3e3);
			};
			/** 错误条常驻：不自动消失（用户反馈 3 秒来不及抄报错），直到下一次成功操作或新消息覆盖 */
			const flashLErr = (msg) => {
				setLFlash("⚠ " + msg);
			};
			const onRootSave = async (move) => {
				const next = lRootDraft.trim();
				if (next === "" || next === lRoot) {
					setLRootOpen(false);
					return;
				}
				setLRootBusy(true);
				try {
					const r = await setLauncherRoot(next, move, (u, i) => fetch(u, i));
					if (!r.ok) {
						flashLErr(t.launcherRootFail + "：" + (r.error ?? ""));
						return;
					}
					setLRoot(r.root ?? next);
					setLRootOpen(false);
					flashL(move ? t.launcherRootMoved + `（${String(r.moved ?? 0)}）` + (r.failed !== void 0 && r.failed.length > 0 ? " ⚠ " + r.failed.join("、") : "") : t.launcherRootSaved);
					loadLauncher();
					loadDirs();
				} catch (e) {
					flashLErr(t.launcherRootFail + "：" + String(e.message ?? e));
				} finally {
					setLRootBusy(false);
				}
			};
			const is139Share = (u) => /yun\.139\.com\/shareweb\/#\/w\/i\//i.test(u.trim());
			const isBaiduShare = (u) => /pan\.baidu\.com\/(s\/1|share\/init\?surl=)/i.test(u.trim());
			(0, react.useEffect)(() => {
				if (isBaiduShare(lUrl) && lBaiduAuthPresent === "") setLBaiduAuthOpen(true);
			}, [lUrl, lBaiduAuthPresent]);
			const onOpen139Login = async () => {
				window.open("https://yun.139.com/", "_blank", "noopener");
				setLAuthWaiting(true);
				setLAuthOpen(true);
				const started = Date.now();
				while (Date.now() - started < 6e5) {
					await new Promise((r) => setTimeout(r, 2e3));
					try {
						const a = await get139Auth((url, init) => fetch(url, init));
						if (a.present) {
							setLAuthPresent(a.account);
							setLAuthWaiting(false);
							flashL(t.launcherAuthSynced);
							return;
						}
					} catch {}
				}
				setLAuthWaiting(false);
			};
			const onOpenBaiduLogin = async () => {
				window.open("https://pan.baidu.com/", "_blank", "noopener");
				setLBaiduAuthWaiting(true);
				setLBaiduAuthOpen(true);
				const started = Date.now();
				while (Date.now() - started < 6e5) {
					await new Promise((r) => setTimeout(r, 2e3));
					try {
						const b = await getBaiduAuth((url, init) => fetch(url, init));
						if (b.present) {
							setLBaiduAuthPresent(b.account);
							setLBaiduAuthWaiting(false);
							flashL(t.launcherBaiduSynced);
							return;
						}
					} catch {}
				}
				setLBaiduAuthWaiting(false);
			};
			/** canvas 预览卡：渐变底 + 首字母徽章 + 标题（服务端兜底卡无文字，客户端版优先）。 */
			const makeLauncherCard = (title) => {
				try {
					const c = document.createElement("canvas");
					c.width = 1280;
					c.height = 720;
					const g = c.getContext("2d");
					if (g === null) return "";
					let h = 0;
					for (let i = 0; i < title.length; i++) h = h * 31 + title.charCodeAt(i) >>> 0;
					const hue = h % 360;
					const grad = g.createLinearGradient(0, 0, 1280, 720);
					grad.addColorStop(0, "hsl(" + String(hue) + ", 55%, 22%)");
					grad.addColorStop(1, "hsl(" + String((hue + 40) % 360) + ", 60%, 42%)");
					g.fillStyle = grad;
					g.fillRect(0, 0, 1280, 720);
					g.fillStyle = "hsla(" + String(hue) + ", 70%, 62%, 0.35)";
					g.beginPath();
					g.arc(640, 290, 175, 0, Math.PI * 2);
					g.fill();
					g.fillStyle = "#fff";
					g.textAlign = "center";
					g.textBaseline = "middle";
					const first = [...title.trim()][0] ?? "A";
					g.font = "700 170px system-ui, \"Segoe UI\", sans-serif";
					g.fillText(first.toUpperCase(), 640, 290);
					g.font = "600 58px system-ui, \"Segoe UI\", sans-serif";
					g.fillText(title.slice(0, 26), 640, 555);
					g.font = "400 30px system-ui, \"Segoe UI\", sans-serif";
					g.fillStyle = "rgba(255,255,255,0.72)";
					g.fillText("dsh · app launcher", 640, 630);
					return c.toDataURL("image/png");
				} catch {
					return "";
				}
			};
			const onLauncherInstall = async () => {
				const url = lUrl.trim();
				if (!isValidHttpUrl(url)) {
					flashL(t.launcherBadUrl);
					return;
				}
				setLBusy(true);
				try {
					const title = lTitle.trim() === "" ? void 0 : lTitle.trim();
					const pwd = lPwd.trim() === "" ? void 0 : lPwd;
					const code = lCode.trim() === "" ? void 0 : lCode;
					const preview = makeLauncherCard(title ?? url);
					const out = await installApp({
						url,
						title,
						password: pwd,
						passcode: code,
						previewDataUrl: preview !== "" ? preview : void 0
					}, (u, i) => fetch(u, i));
					if (!out.ok) {
						if (out.code === "password_required" || out.code === "wrong_password") {
							setLPwdErr(true);
							flashLErr(t.flashLFailed + "：" + (out.code === "password_required" ? t.launcherPwdNeed : t.launcherPwdWrong));
							return;
						}
						if (out.code === "share_passcode_required" || out.code === "share_passcode_wrong") {
							setLCodeErr(true);
							const req = out.code === "share_passcode_required" ? isBaiduShare(url) ? t.launcherShareCode : is139Share(url) ? t.launcherShareCode139 : t.launcherShareCode : isBaiduShare(url) ? t.launcherShareCodeWrong : is139Share(url) ? t.launcherShareCode139Wrong : t.launcherShareCodeWrong;
							flashLErr(t.flashLFailed + "：" + req + (out.error !== void 0 ? "（" + out.error + "）" : ""));
							return;
						}
						if (out.code === "share_auth_required") {
							if (isBaiduShare(url)) {
								setLBaiduAuthOpen(true);
								getBaiduAuth((u) => fetch(u)).then((b) => {
									setLBaiduAuthPresent(b.present ? b.account : "");
								});
								flashLErr(t.flashLFailed + "：" + t.launcherBaiduNeed + (out.error !== void 0 ? "（" + out.error + "）" : ""));
							} else {
								setLAuthOpen(true);
								get139Auth((u) => fetch(u)).then((a) => {
									setLAuthPresent(a.present ? a.account : "");
								});
								flashLErr(t.flashLFailed + "：" + t.launcherAuthNeed + (out.error !== void 0 ? "（" + out.error + "）" : ""));
							}
							return;
						}
						if (out.code === "share_api_error" || out.code === "share_not_file") {
							flashLErr(t.flashLFailed + "：" + t.launcherShareFail + (out.error !== void 0 ? "（" + out.error + "）" : ""));
							return;
						}
						flashLErr(t.flashLFailed + (out.error !== void 0 ? "：" + out.error : ""));
						return;
					}
					if (out.record !== void 0 && (out.candidates?.length ?? 0) > 1) {
						setLChoices((m) => ({
							...m,
							[out.record.id]: out.candidates
						}));
						setLEntryFor(out.record.id);
					}
					setLUrl("");
					setLTitle("");
					setLPwd("");
					setLPwdErr(false);
					setLCode("");
					setLCodeErr(false);
					flashL(t.flashLInstalled);
					loadLauncher();
					loadApps();
				} catch (e) {
					flashLErr(t.flashLFailed + "：" + String(e.message ?? e));
				} finally {
					setLBusy(false);
				}
			};
			/** 启动入口：launcher 记录用 slug id；本地库 we应用 瓷砖用扫描 id（服务端两条都认）。 */
			const onLaunch = (id, title, file, previewRec) => {
				if (file.trim() === "") {
					flashL(t.flashLFailed + "：" + t.launcherNoEntry);
					return;
				}
				setLConfirm(previewRec ?? {
					id,
					title,
					file
				});
			};
			/** 139 登录态保存/清除。 */
			const on139AuthSave = async () => {
				setLAuthBusy(true);
				try {
					const r = await set139Auth(lAuth.trim(), (u, i) => fetch(u, i));
					if (!r.ok) {
						flashL(t.flashLFailed + "：" + (r.error ?? ""));
						return;
					}
					setLAuth("");
					const a = await get139Auth((u) => fetch(u));
					setLAuthPresent(a.present ? a.account : "");
					flashL(t.launcherAuthSaved);
				} finally {
					setLAuthBusy(false);
				}
			};
			/** 百度网盘登录态保存/清除（整串 Cookie 或裸 BDUSS 值；服务端归一并校验）。 */
			const onBaiduAuthSave = async () => {
				setLBaiduAuthBusy(true);
				try {
					const r = await setBaiduAuth(lBaiduAuth.trim(), (u, i) => fetch(u, i));
					if (!r.ok) {
						flashL(t.flashLFailed + "：" + (r.error ?? ""));
						return;
					}
					setLBaiduAuth("");
					const b = await getBaiduAuth((u) => fetch(u));
					setLBaiduAuthPresent(b.present ? b.account : "");
					flashL(t.launcherBaiduSaved);
				} finally {
					setLBaiduAuthBusy(false);
				}
			};
			const onConfirmGo = async () => {
				const rec = lConfirm;
				setLConfirm(null);
				if (rec === null) return;
				const r = await launchApp(rec.id, (u) => fetch(u));
				if (r.ok) flashL(t.flashLLaunched + "：" + rec.title);
				else flashLErr(t.flashLFailed + (r.error !== void 0 ? "：" + r.error : ""));
			};
			const onUpdatePreview = async (rec) => {
				const dataUrl = makeLauncherCard(rec.title);
				if (dataUrl === "") {
					flashL(t.flashLFailed);
					return;
				}
				if ((await fetch("/we-sync/launcher/preview", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						id: rec.id,
						dataUrl
					})
				})).ok) {
					flashL(t.launcherUpdatePreview + " ✓");
					loadApps();
				} else flashL(t.flashLFailed);
			};
			const onSetEntry = async (rec, file) => {
				const r = await setEntry(rec.id, file, (u, i) => fetch(u, i));
				if (r.ok) {
					flashL(t.launcherEntry + " → " + file);
					setLEntryFor(null);
					loadApps();
				} else flashL(t.flashLFailed + (r.error !== void 0 ? "：" + r.error : ""));
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
			const appGroups = partitionApps(apps);
			const kw = search.trim().toLowerCase();
			const filteredApps = appsForSub(apps, appSub).filter((a) => kw === "" || a.title.toLowerCase().includes(kw));
			const filteredDwp = dwpCards.filter((d) => kw === "" || d.name.toLowerCase().includes(kw));
			const shownApps = filteredApps.slice(0, visible);
			const shownDwp = filteredDwp.slice(0, visible);
			const mTags = collectTags(mCards);
			const mShown = searchCards(mCards, mSearch, mTag);
			const wallpaper = info !== null && info.wallpaper !== null ? info.wallpaper : null;
			const title = wallpaper === null ? info !== null && info.kind === "web" ? t.webNoPreview : t.noWallpaper : wallpaper.title;
			const scene = info !== null && info.source.kind === "scene" ? info.scene : null;
			const subtitle = store.settings.dwpMounted !== null ? t.dwpTierLead + (renderMode === "enhanced" ? t.dwpTierHd : t.dwpTierSd) : wallpaper === null ? t.applyHint : scene === null ? "" : renderMode === "eco" ? t.sceneEco : scene.live === true ? t.sceneExternal + " " + String(scene.status?.fps ?? "?") + "fps" : scene.model === true ? t.sceneModel : t.sceneFallback + scene.fallback;
			const monitors = info !== null && Array.isArray(info.monitors) && info.monitors.length > 1 ? info.monitors : null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "wesync-panel",
				ref: panelRef,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "wesync-pages",
						ref: viewportRef,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "wesync-pages-track",
							ref: trackRef,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "wesync-page wesync-page-settings",
									ref: settingsRef,
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: "wesync-card",
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
													className: "wesync-head",
													children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
														className: "wesync-title",
														children: title
													}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
														className: "wesync-ver",
														href: PLUGIN_REPO_URL,
														target: "_blank",
														rel: "noreferrer noopener",
														title: t.versionTitle,
														children: "v" + PLUGIN_VERSION
													})]
												}),
												subtitle !== "" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
													className: "wesync-sub",
													children: subtitle
												}) : null,
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
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
													className: "wesync-actions",
													children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
														className: "wesync-btn",
														onClick: onPower,
														disabled: store.settings.dwpMounted !== null,
														children: store.settings.dwpMounted !== null ? t.syncPaused : enabled ? t.syncOn : t.syncOff
													}), store.settings.dwpMounted !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: "wesync-sync-hint",
														children: t.dwpMountedHint
													}) : null]
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
													].map((m) => {
														const perfOff = m === "perf" && store.settings.dwpMounted !== null;
														return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
															type: "button",
															disabled: perfOff,
															title: perfOff ? t.perfDisabledHint : "",
															className: ["wesync-seg-item", renderMode === m ? "wesync-seg-active" : ""].join(" "),
															onClick: () => onRenderMode(m),
															children: m === "eco" ? t.modeEco : m === "perf" ? t.modePerf : t.modeEnhanced
														}, m);
													})
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
													className: "wesync-actions",
													children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
														className: "wesync-focuswrap",
														onMouseEnter: () => setFocusHover(true),
														onMouseLeave: () => setFocusHover(false),
														children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
															className: ["wesync-btn", focus ? "wesync-focusOn" : "wesync-focusOff"].join(" "),
															onClick: onFocus,
															children: t.focusMode
														}), focusHover || focus ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
															className: "wesync-focus-flyout",
															children: [focus ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
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
																})
															] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
																className: "wesync-focus-intro",
																children: t.focusIntro
															}), focus && (gazeEnabled && needsCalib ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
																className: "wesync-gaze-status is-error",
																children: t.gazeNeedCalib
															}) : gazeStatus === "running" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
																className: "wesync-gaze-status is-running",
																children: t.gazeStatusRunning
															}) : gazeStatus === "error" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
																className: "wesync-gaze-status is-error",
																children: [t.gazeStatusError, gazeError !== "" ? "：" + gazeError : ""]
															}) : gazeEnabled ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
																className: "wesync-gaze-status is-loading",
																children: t.gazeStatusLoading
															}) : null)]
														}) : null]
													})
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
														children: dirs.map((dir) => {
															const isLauncherRoot = dir.replace(/\\/g, "/") === lRoot.replace(/\\/g, "/");
															return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
																className: "wesync-dir-item",
																children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
																	className: "wesync-dir-path",
																	title: dir,
																	children: dir
																}), isLauncherRoot ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
																	style: {
																		fontSize: 11,
																		opacity: .7,
																		flex: "0 0 auto"
																	},
																	children: t.launcherRootTag
																}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
																	className: "wesync-dir-remove",
																	onClick: () => {
																		setLRootDraft(lRoot);
																		setLRootOpen(!lRootOpen);
																	},
																	children: t.launcherRootChange
																})] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
																	className: "wesync-dir-remove",
																	onClick: () => {
																		onRemoveDir(dir);
																	},
																	children: t.removeDir
																})]
															}, dir);
														})
													}),
													lRootOpen ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
														className: "wesync-dir-row",
														style: {
															alignItems: "center",
															marginTop: 6
														},
														children: [
															/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
																className: "wesync-dir-input",
																placeholder: t.launcherRootPlaceholder,
																value: lRootDraft,
																onChange: (e) => setLRootDraft(e.target.value),
																onKeyDown: (e) => {
																	if (e.key === "Enter" && !lRootBusy) onRootSave(false);
																}
															}),
															/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
																className: "wesync-btn",
																disabled: lRootBusy,
																onClick: () => {
																	onRootSave(false);
																},
																children: t.launcherRootSaveLater
															}),
															/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
																className: "wesync-btn",
																disabled: lRootBusy || lApps.length === 0,
																onClick: () => {
																	onRootSave(true);
																},
																children: t.launcherRootSaveMove
															})
														]
													}) : null
												]
											})
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											className: "wesync-page-hint",
											style: { textAlign: "center" },
											children: t.pageHint
										})
									]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "wesync-page-gap",
									ref: gapRef,
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "wesync-page-gap-line" }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "wesync-page-hint",
											children: t.pageGapHint
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "wesync-page-gap-line" })
									]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "wesync-page wesync-page-library",
									ref: libRef,
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: "wesync-card",
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: "wesync-apps",
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
													className: "wesync-apps-head",
													children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
														className: "wesync-sub",
														children: t.appsTitle
													}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: "wesync-page-hint",
														children: t.pageHint
													})]
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
													className: "wesync-apps-cats",
													children: [
														/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
															className: ["wesync-chip", libTab === "local" ? "wesync-chip-on" : ""].join(" "),
															onClick: () => setLibTab("local"),
															children: t.catLocal
														}),
														/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
															className: ["wesync-chip", libTab === "market" ? "wesync-chip-on" : ""].join(" "),
															onClick: () => setLibTab("market"),
															children: t.catMarket
														}),
														/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
															className: ["wesync-chip", libTab === "launcher" ? "wesync-chip-on" : ""].join(" "),
															onClick: () => {
																setLibTab("launcher");
																loadLauncher();
															},
															children: t.launcherTab
														})
													]
												}),
												libTab === "local" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
													/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
														className: "wesync-apps-filters",
														children: [
															/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
																className: ["wesync-chip", typeFilter === "dwp" ? "wesync-chip-on" : ""].join(" "),
																onClick: () => {
																	setTypeFilter("dwp");
																	setVisible(60);
																},
																children: t.typeDwp + " " + String(dwpCards.length)
															}),
															/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
																className: ["wesync-chip", typeFilter === "apps" ? "wesync-chip-on" : ""].join(" "),
																onClick: () => {
																	setTypeFilter("apps");
																	setVisible(60);
																},
																children: t.typeApps + " " + String(appGroups.all.length)
															}),
															/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
																className: "wesync-app-search",
																placeholder: t.searchPlaceholder,
																value: search,
																onChange: (e) => {
																	setSearch(e.target.value);
																	setVisible(60);
																}
															}),
															/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
																className: ["wesync-chip", manageMode ? "wesync-chip-on" : ""].join(" "),
																title: manageMode ? t.manageDone : t.manage,
																onClick: () => {
																	setManageMode(!manageMode);
																},
																children: manageMode ? t.manageDone : t.manage
															})
														]
													}),
													typeFilter === "apps" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
														className: "wesync-apps-filters wesync-apps-subs",
														children: [
															/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
																className: ["wesync-chip", appSub === "all" ? "wesync-chip-on" : ""].join(" "),
																onClick: () => {
																	setAppSub("all");
																	setVisible(60);
																},
																children: t.appSubAll + " " + String(appGroups.all.length)
															}),
															/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
																className: ["wesync-chip", appSub === "we" ? "wesync-chip-on" : ""].join(" "),
																onClick: () => {
																	setAppSub("we");
																	setVisible(60);
																},
																children: t.typeWeApp + " " + String(appGroups.we.length)
															}),
															/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
																className: ["wesync-chip", appSub === "launcher" ? "wesync-chip-on" : ""].join(" "),
																onClick: () => {
																	setAppSub("launcher");
																	setVisible(60);
																},
																children: t.typeLauncherApp + " " + String(appGroups.launcher.length)
															})
														]
													}) : null,
													libFlash !== "" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
														className: "wesync-market-flash",
														children: libFlash
													}) : null,
													manageMode ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
														className: "wesync-apps-filters wesync-selbar",
														children: [
															/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
																className: "wesync-selbar-count",
																children: [
																	t.manageSelected,
																	" ",
																	String(selCount)
																]
															}),
															/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
																className: "wesync-btn wesync-manage-del",
																disabled: selCount === 0,
																onClick: () => setUninstallFor(collectSelTargets()),
																children: t.bulkUninstall
															}),
															/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
																className: "wesync-btn",
																disabled: selCount === 0,
																onClick: () => setSel({}),
																children: t.clearSel
															})
														]
													}) : null,
													typeFilter === "dwp" ? dwpCards.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
														className: "wesync-app-empty",
														children: t.dwpEmpty
													}) : filteredDwp.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
														className: "wesync-app-empty",
														children: t.appsNoMatch
													}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
														/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
															className: "wesync-apps-count",
															children: t.appsCount(dwpCards.length, filteredDwp.length)
														}),
														/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
															className: "wesync-apps-grid",
															children: shownDwp.map((d, di) => {
																const key = selKey("dwp", d.id);
																const picked = sel[key] === true;
																return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
																	className: [
																		"wesync-app-card",
																		manageMode ? "wesync-app-card-manage" : "",
																		picked ? "wesync-app-card-selected" : ""
																	].join(" "),
																	style: manageMode ? { animationDelay: (-.24 * (di % 5)).toFixed(2) + "s" } : void 0,
																	title: manageMode ? d.name : (store.settings.dwpMounted === d.id ? t.unmountHint : t.mountHint) + d.name,
																	onClick: manageMode ? () => {
																		toggleSel(key);
																	} : () => {
																		onToggleDwp(d.id);
																	},
																	children: [
																		/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
																			className: "wesync-app-thumbwrap",
																			children: [
																				d.thumbnail !== "" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
																					className: "wesync-app-thumb",
																					src: d.thumbnail,
																					alt: d.name,
																					loading: "lazy",
																					onError: (e) => {
																						e.currentTarget.style.visibility = "hidden";
																					}
																				}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
																					className: "wesync-app-thumb",
																					style: {
																						display: "flex",
																						alignItems: "center",
																						justifyContent: "center"
																					},
																					children: t.noPreview
																				}),
																				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
																					className: "wesync-app-badge wesync-badge-" + (store.settings.dwpMounted === d.id ? "video" : "image"),
																					children: store.settings.dwpMounted === d.id ? t.mounted : t.typeDwp
																				}),
																				picked ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
																					className: "wesync-app-selmark",
																					children: "✓"
																				}) : null
																			]
																		}),
																		/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
																			className: "wesync-app-title",
																			children: d.name
																		}),
																		manageMode ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
																			className: "wesync-manage-row",
																			children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
																				className: "wesync-btn",
																				onClick: (e) => {
																					e.stopPropagation();
																					onRevealDwp(d.id);
																				},
																				children: t.openSource
																			}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
																				className: "wesync-btn wesync-manage-del",
																				onClick: (e) => {
																					e.stopPropagation();
																					setUninstallFor([{
																						kind: "dwp",
																						id: d.id,
																						title: d.name,
																						path: "packages/" + d.id + ".dwp"
																					}]);
																				},
																				children: t.marketUninstall
																			})]
																		}) : null
																	]
																}, d.id);
															})
														}),
														filteredDwp.length > shownDwp.length ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
															className: "wesync-btn wesync-show-more",
															onClick: () => setVisible((v) => v + 60),
															children: t.showMore + " (+60)"
														}) : null
													] }) : appGroups.all.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
														className: "wesync-app-empty",
														children: t.weAppEmpty
													}) : filteredApps.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
														className: "wesync-app-empty",
														children: t.appsNoMatch
													}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
														/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
															className: "wesync-apps-count",
															children: t.appsCount(appGroups.all.length, filteredApps.length)
														}),
														/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
															className: "wesync-apps-grid",
															children: shownApps.map((app, ai) => {
																const rec = matchLauncherRecord(app, lApps);
																const isLauncher = (app.source ?? "") === "launcher";
																const key = rec !== null ? selKey("app", rec.id) : "";
																const picked = rec !== null && sel[key] === true;
																return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
																	className: [
																		"wesync-app-card",
																		manageMode ? "wesync-app-card-manage" : "",
																		picked ? "wesync-app-card-selected" : ""
																	].join(" "),
																	style: manageMode ? { animationDelay: (-.24 * (ai % 5)).toFixed(2) + "s" } : void 0,
																	title: manageMode ? app.title : t.launcherLaunch + app.title,
																	onClick: manageMode ? () => {
																		if (rec === null) flashLib(t.manageNotDeletable);
																		else toggleSel(key);
																	} : () => {
																		onLaunch(app.id, app.title, app.file, null);
																	},
																	children: [
																		/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
																			className: "wesync-app-thumbwrap",
																			children: [
																				app.hasPreview ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
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
																				}),
																				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
																					className: "wesync-app-badge " + (isLauncher ? "wesync-badge-launcher" : "wesync-badge-application"),
																					children: isLauncher ? t.typeLauncherApp : t.typeWeApp
																				}),
																				picked ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
																					className: "wesync-app-selmark",
																					children: "✓"
																				}) : null
																			]
																		}),
																		/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
																			className: "wesync-app-title",
																			children: app.title
																		}),
																		manageMode ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
																			className: "wesync-manage-row",
																			children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
																				className: "wesync-btn",
																				onClick: (e) => {
																					e.stopPropagation();
																					onAppOpen(app.id);
																				},
																				children: t.openSource
																			}), rec === null ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
																				className: "wesync-btn wesync-manage-del",
																				onClick: (e) => {
																					e.stopPropagation();
																					setUninstallFor([{
																						kind: "app",
																						id: rec.id,
																						title: app.title,
																						path: launcherAppDir(lRoot, rec.slug)
																					}]);
																				},
																				children: t.marketUninstall
																			})]
																		}) : null
																	]
																}, app.id);
															})
														}),
														filteredApps.length > shownApps.length ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
															className: "wesync-btn wesync-show-more",
															onClick: () => setVisible((v) => v + 60),
															children: t.showMore + " (+60)"
														}) : null
													] })
												] }) : libTab === "market" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
													/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
														className: "wesync-apps-filters",
														children: [
															/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
																className: ["wesync-chip", mTag === "" ? "wesync-chip-on" : ""].join(" "),
																onClick: () => setMTag(""),
																children: t.marketAll
															}),
															mTags.map((tg) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
																className: ["wesync-chip", mTag === tg ? "wesync-chip-on" : ""].join(" "),
																onClick: () => setMTag(tg),
																children: tg
															}, tg)),
															/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
																className: "wesync-app-search",
																placeholder: t.marketSearch,
																value: mSearch,
																onChange: (e) => setMSearch(e.target.value)
															}),
															/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
																className: "wesync-btn",
																onClick: () => {
																	loadMarket(true);
																},
																children: t.marketRefresh
															})
														]
													}),
													mFlash !== "" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
														className: "wesync-market-flash",
														children: mFlash
													}) : null,
													mLoading ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
														className: "wesync-app-empty",
														children: t.marketLoading
													}) : mError !== "" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
														className: "wesync-app-empty",
														children: t.marketLoadFailed
													}) : mCards.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
														className: "wesync-app-empty",
														children: t.marketEmpty
													}) : mShown.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
														className: "wesync-app-empty",
														children: t.marketNoMatch
													}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
														className: "wesync-apps-grid",
														children: mShown.map((c) => {
															const busyId = mBusy[c.entry.id] === true;
															const mName = resolveLang() === "en" ? c.entry.name.en : c.entry.name.zh;
															c.state === "installed" || c.state;
															return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
																className: "wesync-app-card wesync-market-card",
																children: [
																	/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
																		className: "wesync-app-thumbwrap",
																		children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
																			className: "wesync-app-thumb",
																			src: c.entry.dwp.thumbnail,
																			alt: mName,
																			loading: "lazy",
																			onError: (e) => {
																				e.currentTarget.style.visibility = "hidden";
																			}
																		}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
																			className: "wesync-app-badge wesync-badge-" + (c.state === "installed" ? "image" : c.state === "update" ? "video" : "web"),
																			children: c.state === "installed" ? t.marketInstalled : c.state === "update" ? t.marketUpdate : ""
																		})]
																	}),
																	/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
																		className: "wesync-app-title",
																		children: mName
																	}),
																	/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
																		className: "wesync-market-meta",
																		children: [
																			t.marketBy,
																			" ",
																			c.entry.author,
																			c.installedVersion ? " · " + t.marketInstalledAt + " " + c.installedVersion : ""
																		]
																	}),
																	/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
																		className: "wesync-market-actions",
																		children: [
																			c.state === "absent" || c.state === "update" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
																				className: "wesync-btn wesync-market-install",
																				disabled: busyId,
																				onClick: () => {
																					mInstall(c.entry.id, c.state === "update");
																				},
																				children: busyId ? t.marketInstalling : c.state === "update" ? t.marketUpdate : t.marketInstall
																			}) : null,
																			c.state === "local-ahead" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
																				className: "wesync-btn",
																				disabled: true,
																				title: t.marketLocalAheadHint,
																				children: t.marketLocalAhead
																			}) : null,
																			c.state === "installed" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
																				className: "wesync-btn wesync-market-uninstall",
																				disabled: busyId,
																				onClick: () => {
																					mUninstall(c.entry.id);
																				},
																				children: t.marketUninstall
																			}) : null,
																			c.state === "local-ahead" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
																				className: "wesync-btn wesync-market-uninstall",
																				disabled: busyId,
																				onClick: () => {
																					mUninstall(c.entry.id);
																				},
																				children: t.marketUninstall
																			}) : null
																		]
																	})
																]
															}, c.entry.id);
														})
													})
												] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
													/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
														className: "wesync-dir-row",
														children: [
															/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
																className: "wesync-dir-input",
																placeholder: t.launcherUrlPlaceholder,
																value: lUrl,
																onChange: (e) => setLUrl(e.target.value),
																onKeyDown: (e) => {
																	if (e.key === "Enter" && !lBusy) onLauncherInstall();
																}
															}),
															/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
																className: "wesync-dir-input",
																style: { maxWidth: 180 },
																placeholder: t.launcherTitlePlaceholder,
																value: lTitle,
																onChange: (e) => setLTitle(e.target.value)
															}),
															/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
																className: "wesync-dir-input",
																type: "password",
																style: {
																	maxWidth: 150,
																	borderColor: lPwdErr ? "rgba(248,113,113,0.85)" : void 0
																},
																placeholder: t.launcherPwdPlaceholder,
																value: lPwd,
																onChange: (e) => {
																	setLPwd(e.target.value);
																	if (lPwdErr) setLPwdErr(false);
																},
																onKeyDown: (e) => {
																	if (e.key === "Enter" && !lBusy) onLauncherInstall();
																}
															}),
															/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
																className: "wesync-dir-input",
																style: {
																	maxWidth: 130,
																	borderColor: lCodeErr ? "rgba(248,113,113,0.85)" : void 0
																},
																placeholder: t.launcherCodePlaceholder,
																value: lCode,
																onChange: (e) => {
																	setLCode(e.target.value);
																	if (lCodeErr) setLCodeErr(false);
																},
																onKeyDown: (e) => {
																	if (e.key === "Enter" && !lBusy) onLauncherInstall();
																}
															}),
															/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
																className: "wesync-btn",
																disabled: lBusy,
																onClick: () => {
																	onLauncherInstall();
																},
																children: lBusy ? t.launcherInstalling : t.launcherInstall
															})
														]
													}),
													is139Share(lUrl) && lAuthPresent === "" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
														className: "wesync-dir-row",
														style: { alignItems: "center" },
														children: [
															/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
																style: {
																	flex: "0 0 auto",
																	fontSize: 12,
																	opacity: .75
																},
																children: t.launcherAuthNeedShort
															}),
															/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
																className: "wesync-btn",
																disabled: lAuthWaiting,
																onClick: () => {
																	onOpen139Login();
																},
																children: t.launcherAuthOpenBtn
															}),
															lAuthWaiting ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
																style: {
																	fontSize: 12,
																	opacity: .7
																},
																children: t.launcherAuthWaiting
															}) : null
														]
													}) : null,
													isBaiduShare(lUrl) && lBaiduAuthPresent === "" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
														className: "wesync-dir-row",
														style: { alignItems: "center" },
														children: [
															/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
																style: {
																	flex: "0 0 auto",
																	fontSize: 12,
																	opacity: .75
																},
																children: t.launcherBaiduNeedShort
															}),
															/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
																className: "wesync-btn",
																disabled: lBaiduAuthWaiting,
																onClick: () => {
																	onOpenBaiduLogin();
																},
																children: t.launcherBaiduOpenBtn
															}),
															lBaiduAuthWaiting ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
																style: {
																	fontSize: 12,
																	opacity: .7
																},
																children: t.launcherBaiduWaiting
															}) : null
														]
													}) : null,
													lAuthOpen || lAuthPresent !== "" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
														className: "wesync-dir-row",
														style: { alignItems: "center" },
														children: [
															/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
																style: {
																	flex: "0 0 auto",
																	fontSize: 12,
																	opacity: .75
																},
																children: [t.launcherAuthTitle, lAuthPresent !== "" ? `（${lAuthPresent}）` : ""]
															}),
															/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
																className: "wesync-dir-input",
																type: "password",
																placeholder: t.launcherAuthPlaceholder,
																value: lAuth,
																onChange: (e) => setLAuth(e.target.value)
															}),
															/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
																className: "wesync-btn",
																disabled: lAuthBusy || lAuth.trim() === "",
																onClick: () => {
																	on139AuthSave();
																},
																children: t.launcherAuthSave
															})
														]
													}) : null,
													lBaiduAuthOpen || lBaiduAuthPresent !== "" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
														className: "wesync-dir-row",
														style: { alignItems: "center" },
														children: [
															/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
																style: {
																	flex: "0 0 auto",
																	fontSize: 12,
																	opacity: .75
																},
																title: t.launcherBaiduHint,
																children: [t.launcherBaiduTitle, lBaiduAuthPresent !== "" ? `（${lBaiduAuthPresent}）` : ""]
															}),
															/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
																className: "wesync-dir-input",
																type: "password",
																placeholder: t.launcherBaiduPlaceholder,
																value: lBaiduAuth,
																onChange: (e) => setLBaiduAuth(e.target.value)
															}),
															/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
																className: "wesync-btn",
																disabled: lBaiduAuthBusy || lBaiduAuth.trim() === "",
																onClick: () => {
																	onBaiduAuthSave();
																},
																children: t.launcherAuthSave
															})
														]
													}) : null,
													/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
														style: {
															fontSize: 12,
															opacity: .8,
															marginTop: 8,
															lineHeight: 1.7
														},
														children: [
															/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
																style: { opacity: .65 },
																children: ["⚠ ", t.launcherTutorialBeta]
															}),
															/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
																style: { marginTop: 4 },
																children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", { children: t.launcherTutorialPrepTitle })
															}),
															/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: ["1. ", t.launcherTutorialPrep1] }),
															/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: ["2. ", t.launcherTutorialPrep2] }),
															/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
																"3. ",
																t.launcherTutorialPrep3Lead,
																/* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
																	href: "/we-sync/login-sync.user.js",
																	target: "_blank",
																	rel: "noreferrer",
																	style: {
																		color: "inherit",
																		textDecoration: "underline"
																	},
																	children: t.launcherHelperLink
																}),
																t.launcherTutorialPrep3Tail
															] }),
															/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
																style: { marginTop: 4 },
																children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", { children: t.launcherTutorialUseTitle })
															}),
															/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: t.launcherTutorialUse1 }),
															/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: t.launcherTutorialUse2 }),
															/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: t.launcherTutorialUse3 })
														]
													}),
													lAuthOpen ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
														style: {
															fontSize: 12,
															opacity: .6,
															marginTop: 4
														},
														children: t.launcherAuthHint
													}) : null,
													lFlash !== "" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
														className: "wesync-market-flash",
														children: lFlash
													}) : null,
													lApps.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
														className: "wesync-app-empty",
														children: t.launcherEmpty
													}) : (() => {
														const kwL = lSearch.trim().toLowerCase();
														const filteredL = lApps.filter((a) => kwL === "" || a.title.toLowerCase().includes(kwL));
														return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
															/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
																className: "wesync-apps-filters",
																children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
																	className: "wesync-app-search",
																	placeholder: t.searchPlaceholder,
																	value: lSearch,
																	onChange: (e) => setLSearch(e.target.value)
																})
															}),
															/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
																className: "wesync-market-meta",
																children: t.launcherManageHint
															}),
															filteredL.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
																className: "wesync-app-empty",
																children: t.launcherNoMatch
															}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
																className: "wesync-apps-grid",
																children: filteredL.map((rec) => {
																	const candidates = lChoices[rec.id] ?? [];
																	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
																		className: "wesync-app-card wesync-market-card",
																		children: [
																			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
																				className: "wesync-app-thumbwrap",
																				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
																					className: "wesync-app-thumb",
																					src: "/we-sync/launcher/preview-file?id=" + encodeURIComponent(rec.id),
																					alt: rec.title,
																					loading: "lazy",
																					onError: (e) => {
																						e.currentTarget.style.visibility = "hidden";
																					}
																				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
																					className: "wesync-app-badge wesync-badge-launcher",
																					children: t.typeLauncherApp
																				})]
																			}),
																			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
																				className: "wesync-app-title",
																				children: rec.title
																			}),
																			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
																				className: "wesync-market-meta",
																				children: [
																					humanSize(rec.size),
																					" · ",
																					rec.file
																				]
																			}),
																			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
																				className: "wesync-market-actions",
																				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
																					className: "wesync-btn wesync-detail-btn",
																					onClick: () => {
																						setLDetailFor(lDetailFor === rec.id ? null : rec.id);
																					},
																					children: lDetailFor === rec.id ? t.detailHide : t.detail
																				})
																			}),
																			lDetailFor === rec.id ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
																				className: "wesync-market-meta",
																				"data-wesync-detail": rec.id,
																				style: { width: "100%" },
																				children: [
																					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
																						t.detailInstalledAt,
																						": ",
																						formatInstalledAt(rec.installedAt)
																					] }),
																					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
																						t.detailAddr,
																						": ",
																						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
																							style: { wordBreak: "break-all" },
																							children: launcherAppDir(lRoot, rec.slug)
																						})
																					] }),
																					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
																						t.detailExe,
																						": ",
																						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
																							style: { wordBreak: "break-all" },
																							children: rec.file
																						})
																					] }),
																					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
																						t.launcherSource,
																						": ",
																						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
																							style: { wordBreak: "break-all" },
																							children: rec.sourceUrl
																						})
																					] }),
																					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
																						t.launcherSha,
																						": ",
																						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
																							style: { wordBreak: "break-all" },
																							children: [rec.sha512.slice(0, 32), "…"]
																						})
																					] }),
																					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
																						className: "wesync-btn",
																						style: { marginTop: 4 },
																						onClick: () => {
																							onUpdatePreview(rec);
																						},
																						children: t.launcherUpdatePreview
																					}),
																					candidates.length > 1 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
																						style: { marginTop: 6 },
																						children: t.launcherCandidates
																					}), candidates.map((f) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
																						className: "wesync-btn",
																						style: { margin: "2px 4px 0 0" },
																						onClick: () => {
																							onSetEntry(rec, f);
																						},
																						children: [
																							f === rec.file ? "● " : "",
																							f,
																							f === rec.file ? "" : " → " + t.launcherSetEntry
																						]
																					}, f))] }) : null
																				]
																			}) : null
																		]
																	}, rec.id);
																})
															})
														] });
													})()
												] })
											]
										})
									})
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "wesync-page-gap",
									ref: gap2Ref,
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "wesync-page-gap-line" }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "wesync-page-hint",
											children: t.pageGapHint
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "wesync-page-gap-line" })
									]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "wesync-page wesync-page-dwp",
									ref: dwpRef,
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "wesync-card",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											className: "wesync-sub",
											children: t.pageDwp
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											className: "wesync-app-empty",
											style: { padding: "6px 2px" },
											children: t.dwpStudioHint
										})]
									})
								})
							]
						})
					}),
					lConfirm !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "wesync-confirm-mask",
						onClick: () => setLConfirm(null),
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "wesync-confirm",
							onClick: (e) => {
								e.stopPropagation();
							},
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "wesync-confirm-title",
									children: t.launcherConfirmTitle
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "wesync-confirm-body",
									children: [t.launcherConfirmBody, /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
										className: "wesync-confirm-path",
										children: lConfirm.file
									})]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "wesync-confirm-actions",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										className: "wesync-btn",
										onClick: () => setLConfirm(null),
										children: t.launcherConfirmCancel
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										className: "wesync-btn wesync-market-install",
										onClick: () => {
											onConfirmGo();
										},
										children: t.launcherConfirmGo
									})]
								})
							]
						})
					}) : null,
					uninstallFor !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "wesync-confirm-mask",
						onClick: () => setUninstallFor(null),
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "wesync-confirm",
							onClick: (e) => {
								e.stopPropagation();
							},
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "wesync-confirm-title",
									children: uninstallFor.length === 1 ? t.confirmUninstallTitle : t.confirmBulkTitle(uninstallFor.length)
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "wesync-confirm-body",
									children: [
										t.confirmUninstallBody,
										uninstallFor.slice(0, 8).map((x) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
											className: "wesync-confirm-path",
											children: x.title
										}, x.kind + x.id)),
										uninstallFor.length === 1 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
											className: "wesync-confirm-path",
											children: uninstallFor[0].path
										}) : null,
										uninstallFor.length > 8 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											style: {
												marginTop: 4,
												opacity: .75
											},
											children: "… +" + String(uninstallFor.length - 8)
										}) : null
									]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "wesync-confirm-actions",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										className: "wesync-btn",
										onClick: () => setUninstallFor(null),
										children: t.launcherConfirmCancel
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										className: "wesync-btn wesync-market-uninstall",
										onClick: () => {
											onConfirmUninstall();
										},
										children: t.marketUninstall
									})]
								})
							]
						})
					}) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "wesync-pager",
						children: PAGES.map((p, i) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							className: ["wesync-pager-dot", page === p ? "wesync-pager-dot-on" : ""].join(" "),
							title: p === "settings" ? t.pageSettings : p === "library" ? t.pageLibrary : t.pageDwp,
							onClick: () => scrollToPage(p),
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "wesync-pager-label",
								children: p === "settings" ? t.pageSettings : p === "library" ? t.pageLibrary : t.pageDwp
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "wesync-pager-progress",
								ref: progRefs[i]
							})]
						}, p))
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
  /* 高度上限：默认给宿主头部留 32px、再封 980px。
     --wesync-pages-max 由面板实测覆盖（面板顶 → 宿主输入框顶）：输入框是
     sticky + z-index 7 的常驻条，压在它下面的内容点不到（elementFromPoint
     命中的是输入框），所以滚动视口必须止于输入框上沿。 */
  max-height: var(--wesync-pages-max, min(100vh - 32px, 980px));
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

/* 壁纸库「本地」栏：应用大类下的二级分类行（全部 / we应用 / 应用）。
   与上一行筛选 chips 分开一点点间距，视觉上从属而非并列。 */
.wesync-apps-subs {
  margin: 6px 0 8px;
}

/* 应用启动器卡片：操作行只剩「详细」，撑满整行——点击区域大，
   不再是一排挤在卡片底部、字号 11px 的小按钮（原先「启动 / … / 卸载」三个）。 */
.wesync-detail-btn {
  flex: 1;
  font-size: 12px;
  padding: 6px 10px;
}

/* 壁纸库「本地」栏 · 管理模式：卡片上的操作行（打开源文件 / 卸载）。
   只在「管理」开启时渲染，平时卡片上没有任何小按钮。 */
.wesync-manage-row {
  display: flex;
  gap: 6px;
  margin-top: 6px;
}

.wesync-manage-row .wesync-btn {
  flex: 1;
  font-size: 11px;
  padding: 4px 8px;
}

/* 卸载是破坏性操作：与「打开源文件」拉开颜色差异 */
.wesync-manage-del {
  color: #fca5a5;
}

/* 壁纸库「本地」栏 · 管理模式：卡片进入"编辑态"——
   整体轻微晃动（iOS 桌面编辑态的观感，每张卡由内联 animation-delay 错开相位），
   点卡片 = 多选：选中项固定不再晃，背景转蓝并打勾。
   只有真正可卸载的项（dwp 壁纸 / 启动器装的应用）能选中，工坊内容点了给提示。 */
@keyframes wesync-jiggle {
  0% { transform: rotate(-0.9deg); }
  50% { transform: rotate(0.9deg); }
  100% { transform: rotate(-0.9deg); }
}

.wesync-app-card-manage {
  cursor: pointer;
  /* 0.72s = 原 0.36s 放慢 50%（太快会显得躁，慢一点更像"编辑态待命"） */
  animation: wesync-jiggle 0.72s ease-in-out infinite;
}

/* 选中：停住晃动 + 蓝色高亮（用户要求的"被固定、背景变蓝"） */
.wesync-app-card-manage.wesync-app-card-selected {
  animation: none;
  transform: none;
  background: rgba(59, 130, 246, 0.26);
  border-color: rgba(59, 130, 246, 0.72);
  box-shadow: 0 0 0 1px rgba(59, 130, 246, 0.45);
}

.wesync-app-card-selected:hover {
  background: rgba(59, 130, 246, 0.32);
}

/* 选中角标：缩略图右上角的勾 */
.wesync-app-selmark {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  line-height: 1;
  color: #fff;
  background: rgba(59, 130, 246, 0.95);
  pointer-events: none;
}

/* 管理模式的选择计数条：已选 N + 卸载选中 + 清空选择 */
.wesync-selbar {
  margin: 6px 0 8px;
}

.wesync-selbar-count {
  font-size: 12px;
  color: var(--dsw-alias-label-primary);
  margin-right: 2px;
}

.wesync-selbar .wesync-btn {
  font-size: 12px;
  padding: 4px 10px;
}

/* 无障碍：系统开启「减少动态效果」时不晃，选中态仍然清晰 */
@media (prefers-reduced-motion: reduce) {
  .wesync-app-card-manage { animation: none; }
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

/* 禁用会话正文两侧的「拖拽调整宽度」把手，与轨迹页表现一致。
   harness 只在检测到 composer-overlay 标记时隐藏这对把手（见
   ui-conversation ConversationRoot.module.css），而本面板不接管
   composer，套用那个标记会连带改成全出血 + 悬浮输入框布局。
   所以这里按自家根类名精确命中：仅当 wallpaper_share 标签页挂载时
   隐藏把手，切回对话 / 轨迹页不影响 harness 自己的宽度拖拽。 */
body:has(.wesync-panel) [data-width-handle] {
  display: none;
}

/* ── 「设置」「壁纸库」全程收起宿主输入框，只有「dwp创作」页显示 ────────
   两层原因：
   1) 观感：输入框固定占着会话列底部（实测 126px），两页的卡片底部行被它压住；
   2) 可点性：它是 sticky + z-index 7 的常驻条，压在它下面的控件点不到——
      elementFromPoint 命中的是输入框的「+」按钮 / 模式行，而不是卡片按钮
      （实测 1280×800：应用启动器卡片的按钮点击全被输入框吞掉）。
   收起姿势与沉浸模式同款（opacity + pointer-events，不改布局、seat 高度稳定）：
   看不见，但点击穿透到面板。dwp创作页（唯一需要输入框的页）不加这条规则，
   其可用高度由面板实测的 --wesync-pages-max 扣掉输入框高度。
   :has([data-composer-card]) 只认真正的输入条：授权／提问／子代理只读条
   接管编辑器期间 seat 保持可见，不会把等待回答的输入框一起藏掉。 */
body[data-wesync-page]:not([data-wesync-page='dwp']) [data-composer-seat]:has([data-composer-card]) {
  opacity: 0 !important;
  pointer-events: none !important;
  transition: opacity 0.3s ease !important;
}
body[data-wesync-page] [data-composer-seat] {
  transition: opacity 0.3s ease !important;
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
		/** 重连基础间隔（秒数 = 失败次数，线性退避） */
		const RECONNECT_DELAY_MS = 1e3;
		/** 重连间隔上限：renderer 崩溃自动重启 / 睡眠唤醒可能远超几秒，必须一直等到它回来 */
		const RECONNECT_DELAY_MAX_MS = 1e4;
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
					this.scheduleReconnect(url);
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
					this.setLive(false);
					this.scheduleReconnect(url);
				};
			}
			/** 断线后无限重连（线性退避到上限）。服务端 renderer 崩溃会自动重启并继续广播，
			*  客户端不能因「重试耗尽」永久放弃——那会让 live 背景冻结成最后一帧直到换壁纸。 */
			scheduleReconnect(url) {
				if (this.closed) return;
				this.retries += 1;
				const delay = Math.min(RECONNECT_DELAY_MS * this.retries, RECONNECT_DELAY_MAX_MS);
				if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
				this.reconnectTimer = setTimeout(() => {
					this.reconnectTimer = null;
					this.connect(url);
				}, delay);
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
					const need = w * h * 4;
					if (payload.length < need) return;
					const slice = payload.subarray(0, need);
					const px = format === 3 ? this.bgraToRgba(slice) : new Uint8ClampedArray(slice.buffer.slice(slice.byteOffset, slice.byteOffset + need));
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
		/**
		* 采样 MDLA0006 新格式（9 列循环交错）某帧的每骨骼世界位姿（parent 链 2D 累乘）。
		* 读值异常（越界/非有限/量级过大）的骨骼回退其 MDLS 局部 bind 矩阵（链乘继续，不炸）。
		* 与官方引擎一致：角度相加、平移 = 父平移 + Rz(父角度)·局部平移。
		*/
		function samplePuppetRT(puppet, animIdx, frame) {
			const anim = puppet.animsV2[animIdx];
			if (anim === void 0) return [];
			const bones = puppet.bones;
			const nb = Math.max(bones.length, anim.boneCount);
			const out = new Array(nb);
			const totalFrames = Math.max(1, anim.frameCount);
			const f = (frame % totalFrames + totalFrames) % totalFrames;
			for (let b = 0; b < nb; b++) {
				const bone = bones[b];
				const parent = bone !== void 0 ? bone.parent : -1;
				const base = b * totalFrames * 3 + f * 3;
				const px = anim.localFrames[base];
				const py = anim.localFrames[base + 1];
				const rotZ = anim.localFrames[base + 2];
				if (Number.isFinite(px) && Number.isFinite(py) && Math.abs(px) < 1e4 && Math.abs(py) < 1e4 && Number.isFinite(rotZ)) {
					if (parent >= 0 && parent < nb && out[parent] !== null && out[parent] !== void 0) {
						const pa = out[parent].angle;
						const pc = Math.cos(pa);
						const ps = Math.sin(pa);
						out[b] = {
							angle: pa + rotZ,
							tx: out[parent].tx + px * pc - py * ps,
							ty: out[parent].ty + px * ps + py * pc
						};
					} else out[b] = {
						angle: rotZ,
						tx: px,
						ty: py
					};
				} else {
					const bind = bone !== void 0 ? bone.bind : null;
					if (bind !== null && bind.length >= 16) {
						const ang = Math.atan2(bind[1], bind[0]);
						if (parent >= 0 && parent < nb && out[parent] !== null && out[parent] !== void 0) {
							const pa = out[parent].angle;
							const pc = Math.cos(pa);
							const ps = Math.sin(pa);
							out[b] = {
								angle: pa + ang,
								tx: out[parent].tx + bind[12] * pc - bind[13] * ps,
								ty: out[parent].ty + bind[12] * ps + bind[13] * pc
							};
						} else out[b] = {
							angle: ang,
							tx: bind[12],
							ty: bind[13]
						};
					} else {
						const pr = parent >= 0 && parent < nb ? out[parent] ?? {
							angle: 0,
							tx: 0,
							ty: 0
						} : {
							angle: 0,
							tx: 0,
							ty: 0
						};
						out[b] = {
							angle: pr.angle,
							tx: pr.tx,
							ty: pr.ty
						};
					}
				}
			}
			return out;
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
		* 把 scene.json animationlayers 映射到 MDLA 新格式动画索引（官方语义）：
		* 仅 visible=true 层参与；动画选择 = id 直配 → 名字匹配 → "动画 N" 数字后缀 → 层索引回退。
		* 多动画 + 非空 layers 时按此合成；否则回退单动画（动画 0）。
		*/
		function resolveAnimLayers(puppet, layer) {
			if (puppet.animsV2.length > 1 && layer.animationLayers.length > 0) {
				const out = [];
				for (const l of layer.animationLayers) {
					if (!l.visible) continue;
					const blend = l.blend >= 0 && l.blend <= 1 ? l.blend : 1;
					const rate = l.rate > 0 ? l.rate : 1;
					let idx = -1;
					if (l.animation !== null) idx = puppet.animsV2.findIndex((a) => a.id === l.animation);
					if (idx < 0 && l.name !== null && l.name !== "") idx = puppet.animsV2.findIndex((a) => a.name !== "" && a.name === l.name);
					if (idx < 0 && l.name !== null) {
						const m = String(l.name).match(/(\d+)/);
						if (m !== null) {
							const n = parseInt(m[1], 10);
							if (n >= 1 && n <= puppet.animsV2.length) idx = n - 1;
						}
					}
					if (idx < 0) {
						const li = layer.animationLayers.indexOf(l);
						if (li >= 0 && li < puppet.animsV2.length) idx = li;
					}
					if (idx < 0) idx = 0;
					out.push({
						animIdx: idx,
						blend,
						rate,
						additive: l.additive
					});
				}
				if (out.length > 0) return out;
			}
			return [{
				animIdx: 0,
				blend: 1,
				rate: 1,
				additive: false
			}];
		}
		/** 新格式静态检测：所有合成层的帧 0 / 1 / 中 三采样位姿全同 → 静态（不播放） */
		function isStaticPuppetV2(puppet, layers) {
			for (const L of layers) {
				const fc = Math.max(1, puppet.animsV2[L.animIdx]?.frameCount ?? 1);
				const f0 = samplePuppetRT(puppet, L.animIdx, 0);
				const f1 = fc > 1 ? samplePuppetRT(puppet, L.animIdx, 1) : f0;
				const fm = fc > 2 ? samplePuppetRT(puppet, L.animIdx, Math.floor(fc / 2)) : f0;
				const nb = Math.max(f0.length, f1.length, fm.length);
				for (let b = 0; b < nb; b++) {
					const a = f0[b];
					const c = f1[b];
					const d = fm[b];
					if (a === null || c === null || d === null) continue;
					if (Math.abs(a.angle - c.angle) > 1e-4 || Math.abs(a.tx - c.tx) > .001 || Math.abs(a.ty - c.ty) > .001) return false;
					if (Math.abs(a.angle - d.angle) > 1e-4 || Math.abs(a.tx - d.tx) > .001 || Math.abs(a.ty - d.ty) > .001) return false;
				}
			}
			return true;
		}
		/** 链乘 MDLS 局部矩阵 → 每骨骼 bind 世界位姿（列主序；parent 链 2D 分解） */
		function computeBindWorldRT(puppet) {
			const bones = puppet.bones;
			const nb = bones.length;
			const bindWorld = new Array(nb);
			for (let b = 0; b < nb; b++) {
				const local = bones[b].bind ?? bones[b].pose ?? null;
				const parent = bones[b].parent;
				bindWorld[b] = local === null ? parent >= 0 && parent < nb ? bindWorld[parent] ?? null : null : parent >= 0 && parent < nb && bindWorld[parent] !== null && bindWorld[parent] !== void 0 ? mat4Mul(bindWorld[parent], local) : local;
			}
			return bindWorld.map((m) => m !== null ? {
				angle: Math.atan2(m[1], m[0]),
				tx: m[12],
				ty: m[13]
			} : {
				angle: 0,
				tx: 0,
				ty: 0
			});
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
			/** 新格式（MDLA0006）逐骨骼动画全局矩阵（列主序世界）：puppet 图层 id → 每骨骼 */
			puppetGlobalMats = /* @__PURE__ */ new Map();
			/** 新格式逐骨骼链乘 bind 世界矩阵（M_skin = M_global × inv(bindWorld)） */
			puppetBindWorld = /* @__PURE__ */ new Map();
			/** 新格式逐骨骼最终位姿 {angle,tx,ty}（attachment 锚点跟随用） */
			puppetPosesRT = /* @__PURE__ */ new Map();
			/** 新格式动画播放状态：图层 id → { 合成层, 播放时间 } */
			puppetAnimsV2 = /* @__PURE__ */ new Map();
			/** 新格式 bind 世界位姿缓存（静态，attachment 无动画帧时用）：图层 id → 每骨骼 */
			bindWorldCache = /* @__PURE__ */ new Map();
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
				this.puppetAnimsV2.clear();
				this.animXform.clear();
				this.boneAnimMats.clear();
				this.puppetGlobalMats.clear();
				this.puppetBindWorld.clear();
				this.puppetPosesRT.clear();
				this.bindWorldCache.clear();
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
					if (layer.puppet === null) continue;
					if (layer.puppet.animsV2.length > 0) {
						this.bindWorldCache.set(layer.id, computeBindWorldRT(layer.puppet));
						const layers = resolveAnimLayers(layer.puppet, layer);
						if (isStaticPuppetV2(layer.puppet, layers)) continue;
						this.puppetAnimsV2.set(layer.id, {
							layers,
							time: 0
						});
						continue;
					}
					if (layer.puppet.animations.length === 0) continue;
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
			* attachment（如 "head"/"Attachment"）：子层挂到 parent puppet 的具名骨骼锚点，
			* 锚点 = 锚定骨骼最终世界位姿（动画合成后）+ R(骨骼角)·锚点局部矩阵平移 + 子层 origin。
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
						let ao = null;
						if (l.attachment !== null && parent.puppet !== null) {
							const anchor = parent.puppet.boneAnchors.find((a) => a.name === l.attachment);
							if (anchor !== void 0 && anchor.boneIdx >= 0 && anchor.boneIdx < parent.puppet.bones.length) {
								if (parent.puppet.animsV2.length > 0) {
									const pose = this.puppetPosesRT.get(parent.id)?.[anchor.boneIdx] ?? this.bindWorldCache.get(parent.id)?.[anchor.boneIdx] ?? null;
									if (pose !== null && pose !== void 0) {
										const c = Math.cos(pose.angle);
										const s = Math.sin(pose.angle);
										ao = [pose.tx + anchor.m[12] * c - anchor.m[13] * s, pose.ty + anchor.m[12] * s + anchor.m[13] * c];
									}
								} else ao = [anchor.m[12], anchor.m[13]];
							}
						}
						t = {
							ox: p.ox + p.sx * (l.origin[0] + (ao !== null ? ao[0] : 0)),
							oy: p.oy - p.sy * (l.origin[1] + (ao !== null ? ao[1] : 0)),
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
				this.puppetGlobalMats.clear();
				this.puppetBindWorld.clear();
				this.puppetPosesRT.clear();
				for (const [layerId, st] of this.puppetAnimsV2) {
					st.time += dt;
					const puppet = this.byId.get(layerId)?.puppet ?? null;
					if (puppet === null) continue;
					const nb = puppet.bones.length;
					if (nb === 0) continue;
					const bindWorld = new Array(nb);
					for (let b = 0; b < nb; b++) {
						const local = puppet.bones[b].bind ?? puppet.bones[b].pose ?? null;
						const parent = puppet.bones[b].parent;
						bindWorld[b] = local === null ? parent >= 0 && parent < nb ? bindWorld[parent] ?? null : null : parent >= 0 && parent < nb && bindWorld[parent] !== null && bindWorld[parent] !== void 0 ? mat4Mul(bindWorld[parent], local) : local;
					}
					const final = bindWorld.map((m) => m !== null ? {
						angle: Math.atan2(m[1], m[0]),
						tx: m[12],
						ty: m[13]
					} : {
						angle: 0,
						tx: 0,
						ty: 0
					}).map((r) => ({
						angle: r.angle,
						tx: r.tx,
						ty: r.ty
					}));
					const refCache = /* @__PURE__ */ new Map();
					for (const L of st.layers) {
						const fc = Math.max(1, puppet.animsV2[L.animIdx]?.frameCount ?? 1);
						const frame = Math.floor(st.time * 30 * L.rate) % fc;
						const lw = samplePuppetRT(puppet, L.animIdx, frame);
						let refRT = null;
						if (L.additive) {
							if (!refCache.has(L.animIdx)) refCache.set(L.animIdx, samplePuppetRT(puppet, L.animIdx, 0));
							refRT = refCache.get(L.animIdx) ?? null;
						}
						for (let b = 0; b < nb; b++) {
							const w = lw[b];
							if (w === null || w === void 0) continue;
							if (L.additive) {
								const ref = refRT !== null ? refRT[b] : null;
								if (ref === null || ref === void 0) continue;
								let da = w.angle - ref.angle;
								while (da > Math.PI) da -= 2 * Math.PI;
								while (da < -Math.PI) da += 2 * Math.PI;
								final[b].angle += da * L.blend;
								final[b].tx += (w.tx - ref.tx) * L.blend;
								final[b].ty += (w.ty - ref.ty) * L.blend;
							} else {
								let da = w.angle - final[b].angle;
								while (da > Math.PI) da -= 2 * Math.PI;
								while (da < -Math.PI) da += 2 * Math.PI;
								final[b].angle += da * L.blend;
								final[b].tx += (w.tx - final[b].tx) * L.blend;
								final[b].ty += (w.ty - final[b].ty) * L.blend;
							}
						}
					}
					const globals = new Array(nb);
					for (let b = 0; b < nb; b++) globals[b] = mat4TRS(final[b].tx, final[b].ty, 0, final[b].angle, 1, 1, 1);
					this.puppetGlobalMats.set(layerId, globals);
					this.puppetBindWorld.set(layerId, bindWorld);
					this.puppetPosesRT.set(layerId, final);
				}
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
				if (this.puppetPosesRT.size > 0) this.computeWorldTransforms();
			}
			/** 静态图像层：无粒子、无效果、无动画（自身及祖先）、非序列帧动画，可离屏缓存只渲染一次 */
			isStaticImageLayer(layer) {
				if (layer.image === void 0 || layer.particle !== null) return false;
				if (layer.effects.length > 0 || layer.copybackground === true) return false;
				if (layer.dayNight !== void 0) return false;
				if (this.layerSprite.has(layer.id)) return false;
				let p = layer.id;
				while (p !== null && this.byId.has(p)) {
					if (this.animXform.has(p) || this.boneAnimMats.has(p) || this.puppetGlobalMats.has(p)) return false;
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
						const newGlobals = this.puppetGlobalMats.get(layer.id);
						const newBindWorld = this.puppetBindWorld.get(layer.id);
						const old13Mats = this.boneAnimMats.get(layer.id);
						const selfXf2 = this.animXform.get(layer.id);
						const b0 = layer.puppet.bones[0]?.bind ?? null;
						const animSkin = selfXf2 !== void 0 && b0 !== null && b0.length >= 15 ? {
							rot: selfXf2.rot,
							bx: b0[12],
							by: b0[13]
						} : null;
						let key;
						let binds;
						let mats;
						let anim;
						if (newGlobals !== void 0 && newBindWorld !== void 0) {
							key = "v2:" + Math.floor(this.animTime * 30).toString(36);
							binds = newBindWorld;
							mats = newGlobals;
							anim = null;
						} else {
							key = old13Mats !== void 0 ? "old13:" + Math.floor(this.animTime * 60).toString(36) : animSkin !== null ? animSkin.rot.toFixed(4) : "static";
							binds = layer.puppet.bones.map((b) => b.bind ?? b.pose ?? null);
							mats = old13Mats;
							anim = animSkin;
						}
						let mc = this.meshCanvases.get(layer.id);
						if (mc === void 0 || mc.animKey !== key) {
							const built = buildMeshCanvas(layer.puppet.mesh, bmp, anim, binds, mats);
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
						let src = bmp;
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
							src = frameBmp;
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
								eff = this.wwGL.render(src, sw, sh, maskInfo !== void 0 ? maskInfo.bmp : null, maskInfo !== void 0 ? maskInfo.useA : false, wws, this.animTime, String(layer.id));
							}
							if (eff === null) eff = applyWaterwaves(src, sw, sh, wws, this.animTime, maskInfo !== void 0 ? maskInfo.bmp : null);
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
								eff = this.nitroGL.render(src, sw, sh, nt.noise, nt.masks, params, this.animTime, String(layer.id));
							}
							if (eff === null) ctx.drawImage(src, 0, 0, sw, sh, -dw / 2, -dh / 2, dw, dh);
							else ctx.drawImage(eff, 0, 0, sw, sh, -dw / 2, -dh / 2, dw, dh);
						} else if (shk !== void 0 && shk.type === "shake") {
							const maskInfo2 = this.effectMasks.get(layer.id);
							const fd = maskInfo2 !== void 0 ? maskInfo2.flowDir : [0, -1];
							const offset = Math.sin(this.animTime * shk.speed);
							const amp = shk.strength * shk.strength * effScale;
							const dx = offset * amp * fd[0] * dw;
							const dy = offset * amp * fd[1] * dh;
							ctx.drawImage(src, 0, 0, sw, sh, -dw / 2 + dx, -dh / 2 + dy, dw, dh);
						} else ctx.drawImage(src, 0, 0, sw, sh, -dw / 2, -dh / 2, dw, dh);
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
		//#region src/client/settings.ts
		/** localStorage 键（沿用插件内部 id 前缀 we-sync） */
		const SETTINGS_STORAGE_KEY = "we-sync.settings";
		/** 落盘字段白名单；不在表内的字段（派生态 / 临时态）写入不触发保存，也不会被存下 */
		const PERSISTED_KEYS = [
			"enabled",
			"panelAlpha",
			"blur",
			"shadow",
			"monitor",
			"focus",
			"renderMode",
			"gazeEnabled",
			"gazeSnapText"
		];
		const asNumber = (v, fallback, min, max) => typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
		const asBoolean = (v, fallback) => typeof v === "boolean" ? v : fallback;
		/** 逐字段校验 + 夹取，顺带修复「眼动开但专注关」这类跨版本残留的非法组合 */
		function sanitizeSettings(raw, d) {
			const o = raw !== null && typeof raw === "object" ? raw : {};
			const focus = asBoolean(o.focus, d.focus);
			const mode = o.renderMode;
			return {
				...d,
				enabled: asBoolean(o.enabled, d.enabled),
				panelAlpha: asNumber(o.panelAlpha, d.panelAlpha, 0, 100),
				blur: asNumber(o.blur, d.blur, 0, 30),
				shadow: asNumber(o.shadow, d.shadow, 0, 100),
				monitor: typeof o.monitor === "string" ? o.monitor : d.monitor,
				focus,
				renderMode: mode === "eco" || mode === "perf" || mode === "enhanced" ? mode : d.renderMode,
				gazeEnabled: focus && asBoolean(o.gazeEnabled, d.gazeEnabled),
				gazeSnapText: asBoolean(o.gazeSnapText, d.gazeSnapText),
				taskActive: d.taskActive,
				approvalPending: d.approvalPending,
				immersive: d.immersive
			};
		}
		/** 读存档并返回一份已校验的设置对象；无存档 / 读失败 → 默认值副本 */
		function readStoredSettings(defaults) {
			try {
				const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
				if (raw === null) return { ...defaults };
				return sanitizeSettings(JSON.parse(raw), defaults);
			} catch {
				return { ...defaults };
			}
		}
		/**
		* 生成「写即存」的设置对象：初始值来自存档，之后每次改动自动落盘。
		* 滑块拖动会高频触发写入，故合并成 250ms 的尾随写；页面隐藏 / 关闭前强制补一次，避免丢最后一次改动。
		*/
		function createPersistentSettings(defaults) {
			const target = readStoredSettings(defaults);
			let timer = null;
			const flush = () => {
				if (timer !== null) {
					clearTimeout(timer);
					timer = null;
				}
				try {
					const out = {};
					for (const key of PERSISTED_KEYS) out[key] = target[key];
					localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(out));
				} catch {}
			};
			const schedule = () => {
				if (timer !== null) return;
				timer = window.setTimeout(flush, 250);
			};
			window.addEventListener("pagehide", flush);
			document.addEventListener("visibilitychange", () => {
				if (document.visibilityState === "hidden") flush();
			});
			return new Proxy(target, { set(obj, prop, value) {
				const key = prop;
				const rec = obj;
				const prev = rec[key];
				rec[key] = value;
				if (prev !== value && PERSISTED_KEYS.includes(key)) schedule();
				return true;
			} });
		}
		//#endregion
		//#region vendor/dwp/packages/dwp-web/src/clock.ts
		function createClock(opts = {}) {
			return {
				t: opts.t0 ?? 0,
				playing: opts.playing ?? true,
				maxStep: opts.maxStep ?? .25
			};
		}
		/** 按真实经过 dt 推进；返回本帧实际 t。playing=false 时冻结。 */
		function advance(clock, dt) {
			if (clock.playing) clock.t += Math.min(Math.max(dt, 0), clock.maxStep);
			return clock.t;
		}
		/** 直接跳转（scrub / seek / 快照定位）：不受 maxStep 约束。 */
		function seek(clock, t) {
			clock.t = Math.max(0, t);
			return clock.t;
		}
		function play(clock) {
			clock.playing = true;
		}
		function pause(clock) {
			clock.playing = false;
		}
		//#endregion
		//#region vendor/dwp/packages/dwp-web/src/canvas2d.ts
		/** 协议混合名 → Canvas2D globalCompositeOperation（normal 即 source-over）。 */
		const BLEND2D = {
			normal: "source-over",
			lighter: "lighter",
			multiply: "multiply",
			screen: "screen",
			overlay: "overlay",
			darken: "darken",
			lighten: "lighten",
			"color-dodge": "color-dodge",
			"soft-light": "soft-light",
			"hard-light": "hard-light",
			difference: "difference",
			exclusion: "exclusion"
		};
		const rgbaCss = (c) => `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${c[3] ?? 1})`;
		var Canvas2DRenderer = class {
			ctx;
			o;
			constructor(ctx, opts) {
				this.ctx = ctx;
				this.o = {
					viewport: opts.viewport,
					image: opts.image,
					dpr: opts.dpr ?? 1,
					maxParticles: opts.maxParticles ?? 2e3
				};
			}
			/** 渲染一帧；返回被降级的项（pass 效果名 / 缺资源层 id）。 */
			render(plan) {
				const ctx = this.ctx, dpr = this.o.dpr;
				const degraded = [];
				const W = this.o.viewport.w * dpr, H = this.o.viewport.h * dpr;
				ctx.setTransform(1, 0, 0, 1, 0, 0);
				ctx.globalAlpha = 1;
				ctx.globalCompositeOperation = "source-over";
				ctx.fillStyle = rgbaCss(plan.clear);
				ctx.fillRect(0, 0, W, H);
				for (const step of plan.steps) switch (step.op) {
					case "quad":
						this.quad(step, degraded);
						break;
					case "particles":
						this.particles(step, degraded);
						break;
					case "text":
						this.text(step);
						break;
					case "pass": degraded.push(`pass:${step.effect}`);
				}
				ctx.setTransform(1, 0, 0, 1, 0, 0);
				return { degraded };
			}
			quad(step, degraded) {
				const ctx = this.ctx, dpr = this.o.dpr, m = step.matrix;
				const w = step.verts[2] - step.verts[0], h = step.verts[5] - step.verts[1];
				ctx.setTransform(dpr * m[0], dpr * m[1], dpr * m[2], dpr * m[3], dpr * m[4], dpr * m[5]);
				ctx.globalAlpha = step.alpha;
				ctx.globalCompositeOperation = BLEND2D[step.blend] ?? "source-over";
				if (step.tex === "@solid") {
					const t = step.tint ?? [
						1,
						1,
						1,
						1
					];
					ctx.fillStyle = rgbaCss(t);
					ctx.fillRect(-w / 2, -h / 2, w, h);
				} else {
					const img = this.o.image(step.tex);
					if (!img) {
						degraded.push(`layer:${step.layer}`);
						return;
					}
					ctx.drawImage(img, -w / 2, -h / 2, w, h);
				}
			}
			particles(step, degraded) {
				if (step.count === 0) return;
				const img = this.o.image(step.tex);
				if (!img) {
					degraded.push(`layer:${step.layer}`);
					return;
				}
				const ctx = this.ctx, dpr = this.o.dpr, b = step.buffer, S = step.stride;
				const n = Math.min(step.count, this.o.maxParticles);
				if (step.count > this.o.maxParticles) degraded.push(`particles-capped:${step.layer}`);
				ctx.globalCompositeOperation = BLEND2D[step.blend] ?? "source-over";
				for (let i = 0; i < n; i++) {
					const o = i * S;
					const x = b[o], y = b[o + 1], rot = b[o + 2], sw = b[o + 3], sh = b[o + 4], alpha = b[o + 5];
					const r = rot * Math.PI / 180, cs = Math.cos(r), sn = Math.sin(r);
					ctx.setTransform(dpr * cs, dpr * sn, -dpr * sn, dpr * cs, dpr * x, dpr * y);
					ctx.globalAlpha = alpha;
					ctx.drawImage(img, -sw / 2, -sh / 2, sw, sh);
				}
			}
			text(step) {
				const ctx = this.ctx, dpr = this.o.dpr, m = step.run.matrix, run = step.run;
				ctx.setTransform(dpr * m[0], dpr * m[1], dpr * m[2], dpr * m[3], dpr * m[4], dpr * m[5]);
				ctx.globalAlpha = step.alpha;
				ctx.globalCompositeOperation = BLEND2D[step.blend] ?? "source-over";
				ctx.font = run.font;
				ctx.textBaseline = run.baseline;
				ctx.textAlign = run.align;
				ctx.fillStyle = rgbaCss(run.color);
				ctx.fillText(run.text, 0, 0);
			}
		};
		//#endregion
		//#region vendor/dwp/packages/dwp-core/src/easing.ts
		const linear = (x) => x;
		/** 标准 CSS cubic-bezier 求值：Newton-Raphson（4 轮）+ 二分兜底。 */
		function cubicBezier(x1, y1, x2, y2) {
			const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
			const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
			const sampleX = (t) => ((ax * t + bx) * t + cx) * t;
			const sampleY = (t) => ((ay * t + by) * t + cy) * t;
			const sampleDX = (t) => (3 * ax * t + 2 * bx) * t + cx;
			return (x) => {
				if (x <= 0) return 0;
				if (x >= 1) return 1;
				let t = x;
				for (let i = 0; i < 8; i++) {
					const err = sampleX(t) - x;
					if (Math.abs(err) < 1e-7) return sampleY(t);
					const d = sampleDX(t);
					if (Math.abs(d) < 1e-7) break;
					t -= err / d;
				}
				let lo = 0, hi = 1;
				t = x;
				while (hi - lo > 1e-7) {
					const v = sampleX(t);
					if (Math.abs(v - x) < 1e-7) break;
					if (v < x) lo = t;
					else hi = t;
					t = (lo + hi) / 2;
				}
				return sampleY(t);
			};
		}
		const BEZ = /^cubic-bezier\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)$/;
		function parseEasing(spec) {
			if (spec === void 0 || spec === "" || spec === "linear") return linear;
			switch (spec) {
				case "ease": return cubicBezier(.25, .1, .25, 1);
				case "ease-in": return cubicBezier(.42, 0, 1, 1);
				case "ease-out": return cubicBezier(0, 0, .58, 1);
				case "ease-in-out": return cubicBezier(.42, 0, .58, 1);
			}
			const m = BEZ.exec(spec.trim());
			if (m) {
				const [x1, y1, x2, y2] = m.slice(1, 5).map(Number);
				if (x1 < 0 || x1 > 1 || x2 < 0 || x2 > 1) throw new Error(`cubic-bezier x 必须在 [0,1]: ${spec}`);
				return cubicBezier(x1, y1, x2, y2);
			}
			throw new Error(`未知 easing: ${spec}`);
		}
		//#endregion
		//#region vendor/dwp/packages/dwp-core/src/anim.ts
		const TWO_PI = Math.PI * 2;
		function compileAnimation(anim, pointer) {
			switch (anim.kind) {
				case "keyframes": {
					const tracks = [];
					for (const [property, tr] of Object.entries(anim.tracks ?? {})) {
						const frames = tr.frames;
						for (let i = 1; i < frames.length; i++) if (frames[i][0] <= frames[i - 1][0]) {
							const err = /* @__PURE__ */ new Error(`关键帧时间未递增（第 ${i} 帧）`);
							err.code = "non-monotonic-frames";
							throw err;
						}
						tracks.push({
							property,
							times: frames.map((f) => f[0]),
							values: frames.map((f) => f[1]),
							easing: parseEasing(tr.easing),
							loop: tr.loop ?? false,
							span: frames[frames.length - 1][0]
						});
					}
					return {
						kind: "keyframes",
						tracks
					};
				}
				case "oscillate": return {
					kind: "oscillate",
					property: anim.property,
					amplitude: anim.amplitude ?? 0,
					period: anim.period ?? 1,
					phase: anim.phase ?? 0
				};
				case "scroll": return {
					kind: "scroll",
					property: anim.property,
					perSecond: anim.perSecond ?? 0,
					wrap: anim.wrap
				};
			}
		}
		/** keyframes 单轨求值（绝对值）。t 先按 loop 折叠到 [0, span]。 */
		function evalTrack(tr, t, vars) {
			const { times, values } = tr;
			let tt = t;
			if (tr.loop && tr.span > 0) tt = (t % tr.span + tr.span) % tr.span;
			if (tt <= times[0]) return resolveFrame(values[0], vars);
			if (tt >= times[times.length - 1]) return resolveFrame(values[values.length - 1], vars);
			let i = 0;
			while (i < times.length - 2 && tt > times[i + 1]) i++;
			const t0 = times[i], t1 = times[i + 1];
			const u = t1 === t0 ? 0 : (tt - t0) / (t1 - t0);
			const e = tr.easing(u);
			const a = resolveFrame(values[i], vars);
			const b = resolveFrame(values[i + 1], vars);
			if (typeof a === "number" && typeof b === "number") return a + (b - a) * e;
			return e < .5 ? a : b;
		}
		function resolveFrame(v, vars) {
			if (typeof v === "string" && v.startsWith("$")) {
				const got = vars.get(v.slice(1));
				if (typeof got === "number" || typeof got === "string") return got;
			}
			return v;
		}
		/** oscillate 相对增量。 */
		function oscillateDelta(tr, t) {
			return (tr.amplitude ?? 0) * Math.sin(TWO_PI * t / (tr.period ?? 1) + (tr.phase ?? 0));
		}
		/** scroll 绝对值（base + perSecond·t，可选 wrap 折叠到 [0, wrap)）。 */
		function scrollValue(base, tr, t) {
			let v = base + (tr.perSecond ?? 0) * t;
			const w = tr.wrap;
			if (w !== void 0 && w > 0) v = (v % w + w) % w;
			return v;
		}
		/**
		* 应用图层动画 → 返回属性增量/绝对值表。
		* 单 animation 对象：keyframes 可多轨；oscillate/scroll 单属性相对基值。
		*/
		function evalLayerAnimation(anim, t, vars) {
			const out = {};
			if (!anim) return out;
			if (anim.kind === "keyframes") for (const tr of anim.tracks ?? []) out[tr.property] = evalTrack(tr, t, vars);
			return out;
		}
		//#endregion
		//#region vendor/dwp/packages/dwp-core/src/layout.ts
		function mul(m1, m2) {
			const [a1, b1, c1, d1, e1, f1] = m1, [a2, b2, c2, d2, e2, f2] = m2;
			return [
				a1 * a2 + c1 * b2,
				b1 * a2 + d1 * b2,
				a1 * c2 + c1 * d2,
				b1 * c2 + d1 * d2,
				a1 * e2 + c1 * f2 + e1,
				b1 * e2 + d1 * f2 + f1
			];
		}
		const translate = (x, y) => [
			1,
			0,
			0,
			1,
			x,
			y
		];
		const scale = (sx, sy) => [
			sx,
			0,
			0,
			sy,
			0,
			0
		];
		/** 角度制（协议 §3：rotation 用度）。 */
		function rotate(deg) {
			const r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
			return [
				c,
				s,
				-s,
				c,
				0,
				0
			];
		}
		/** 图层盒矩阵：中心 (cx,cy) 视口px、尺寸 (w,h)、origin 枢轴、rotation 度、scaleX/Y 倍率。 */
		function boxMatrix(cx, cy, w, h, origin, rotDeg, sclX, sclY = sclX) {
			const px = (.5 - origin[0]) * w, py = (.5 - origin[1]) * h;
			let m = translate(cx + px, cy + py);
			m = mul(m, rotate(rotDeg));
			m = mul(m, scale(sclX, sclY));
			m = mul(m, translate(-px, -py));
			return m;
		}
		/** 单位四边形 → 盒局部坐标（左上原点系，中心对齐 ±w/2,±h/2）。 */
		function quadVerts(w, h) {
			return new Float32Array([
				-w / 2,
				-h / 2,
				w / 2,
				-h / 2,
				w / 2,
				h / 2,
				-w / 2,
				h / 2
			]);
		}
		/** 共享只读 UV（全 quad 恒等，plan 契约只读 → 单例省分配）。 */
		const QUAD_UV = new Float32Array([
			0,
			0,
			1,
			0,
			1,
			1,
			0,
			1
		]);
		const quadUV = () => QUAD_UV;
		const HEX = /^#([0-9a-fA-F]{3,8})$/;
		const RGBA_RE = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/;
		function parseColor(input) {
			if (typeof input === "number") return [
				(input >> 16 & 255) / 255,
				(input >> 8 & 255) / 255,
				(input & 255) / 255,
				1
			];
			const h = HEX.exec(input.trim());
			if (h) {
				const s = h[1];
				const at = (i, n) => parseInt(s.slice(i, i + n), 16) / (n === 1 ? 15 : 255);
				if (s.length === 3) return [
					at(0, 1),
					at(1, 1),
					at(2, 1),
					1
				];
				if (s.length === 4) return [
					at(0, 1),
					at(1, 1),
					at(2, 1),
					at(3, 1)
				];
				if (s.length === 6) return [
					at(0, 2),
					at(2, 2),
					at(4, 2),
					1
				];
				if (s.length === 8) return [
					at(0, 2),
					at(2, 2),
					at(4, 2),
					at(6, 2)
				];
			}
			const r = RGBA_RE.exec(input.trim());
			if (r) {
				const n = (v, d) => {
					const x = parseFloat(v);
					return Number.isFinite(x) ? x : d;
				};
				return [
					n(r[1], 0) / 255,
					n(r[2], 0) / 255,
					n(r[3], 0) / 255,
					r[4] !== void 0 ? n(r[4], 1) : 1
				];
			}
			throw new Error(`无法解析颜色: ${input}`);
		}
		/** fit 策略 → 设计px→视口px 缩放（cover 等比铺满裁切 / contain 留边 / stretch 非等比）。 */
		function fitScale(fit, dw, dh, vw, vh) {
			if (fit === "stretch") return [vw / dw, vh / dh];
			const a = vw / dw, b = vh / dh;
			const s = fit === "cover" ? Math.max(a, b) : Math.min(a, b);
			return [s, s];
		}
		//#endregion
		//#region vendor/dwp/packages/dwp-core/src/errors.ts
		/** 语义编译错误：带 JSON Pointer 路径（编辑器据此标红）。 */
		var DocumentError = class extends Error {
			pointer;
			code;
			constructor(code, pointer, message) {
				super(message);
				this.code = code;
				this.pointer = pointer;
			}
		};
		var DocumentErrors = class extends Error {
			errors;
			constructor(errors) {
				super(`DWP document invalid (${errors.length}): ` + errors.slice(0, 5).map((e) => `${e.code}@${e.pointer}: ${e.message}`).join(" | "));
				this.errors = errors;
			}
		};
		//#endregion
		//#region vendor/dwp/packages/dwp-core/src/vars.ts
		const REF = /^\$([a-zA-Z][a-zA-Z0-9_]*)$/;
		function buildVarTable(scene, manifest, overrides = {}) {
			const table = /* @__PURE__ */ new Map();
			for (const [k, v] of Object.entries(scene.variables ?? {})) table.set(k, v);
			for (const p of manifest?.params ?? []) table.set(p.key, p.default);
			for (const [k, v] of Object.entries(overrides)) table.set(k, v);
			return table;
		}
		/** 收集文档内全部 "$name" 引用（编译期孤儿检测用）。 */
		function collectVarRefs(node, pointer = "", out = []) {
			if (typeof node === "string") {
				const m = REF.exec(node);
				if (m) out.push({
					name: m[1],
					pointer
				});
			} else if (Array.isArray(node)) node.forEach((child, i) => collectVarRefs(child, `${pointer}/${i}`, out));
			else if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) collectVarRefs(v, `${pointer}/${k}`, out);
			return out;
		}
		function assertRefsDefined(refs, vars) {
			const errors = [];
			for (const r of refs) if (!vars.has(r.name)) errors.push(new DocumentError("undefined-var", r.pointer, `引用 "$${r.name}" 无对应 variables/params 声明`));
			return errors;
		}
		function resolveNum(v, vars, fallback) {
			if (v === void 0) return fallback;
			if (typeof v === "number") return v;
			const m = REF.exec(v);
			if (!m) return Number(v);
			const got = vars.get(m[1]);
			return typeof got === "number" ? got : fallback;
		}
		function resolveColor(v, vars) {
			if (typeof v === "string") {
				const m = REF.exec(v);
				if (m) {
					const got = vars.get(m[1]);
					if (typeof got === "string" || typeof got === "number") return got;
				}
			}
			return v;
		}
		//#endregion
		//#region vendor/dwp/packages/dwp-core/src/bones.ts
		const TRACK_KEY = /^([a-zA-Z][a-zA-Z0-9_-]*)\.(offset\.[xy]|rotation|scale(?:\.[xy])?)$/;
		function compileMesh(layer, ptr) {
			const errors = [];
			const bones = layer.bones ?? [];
			const parts = layer.parts ?? [];
			const clips = layer.clips ?? [];
			const byName = /* @__PURE__ */ new Map();
			const compiled = [];
			bones.forEach((b, i) => {
				const p = `${ptr}/bones/${i}`;
				if (byName.has(b.name)) {
					errors.push(new DocumentError("dup-bone-name", p, `骨骼名重复: ${b.name}`));
					return;
				}
				if (b.parent != null && !byName.has(b.parent) && !bones.some((x, j) => j > i && x.name === b.parent)) errors.push(new DocumentError("bone-parent-missing", p, `骨骼 ${b.name} 的父不存在: ${b.parent}`));
				byName.set(b.name, {
					name: b.name,
					parent: b.parent ?? null,
					offset: [b.bind?.offset?.[0] ?? 0, b.bind?.offset?.[1] ?? 0],
					rotation: b.bind?.rotation ?? 0
				});
			});
			const indeg = /* @__PURE__ */ new Map();
			const children = /* @__PURE__ */ new Map();
			for (const [name, b] of byName) {
				const parentOk = b.parent != null && byName.has(b.parent);
				indeg.set(name, parentOk ? 1 : 0);
				if (parentOk) children.set(b.parent, [...children.get(b.parent) ?? [], name]);
			}
			let queue = [...byName.keys()].filter((n) => indeg.get(n) === 0);
			while (queue.length) {
				const n = queue.shift();
				compiled.push(byName.get(n));
				for (const c of children.get(n) ?? []) {
					indeg.set(c, indeg.get(c) - 1);
					if (indeg.get(c) === 0) queue.push(c);
				}
			}
			if (compiled.length !== byName.size) errors.push(new DocumentError("bone-cycle", `${ptr}/bones`, "骨骼父子关系存在环"));
			const compiledParts = parts.map((pt, i) => {
				const p = `${ptr}/parts/${i}`;
				if (!byName.has(pt.bone)) errors.push(new DocumentError("part-bone-missing", p, `部件 ${pt.src} 绑定的骨骼不存在: ${pt.bone}`));
				return {
					src: pt.src,
					bone: pt.bone,
					offset: [pt.offset?.[0] ?? 0, pt.offset?.[1] ?? 0],
					rotation: pt.rotation ?? 0,
					order: pt.order ?? 0,
					alpha: pt.alpha ?? 1,
					index: i,
					skinned: !!pt.mesh
				};
			}).sort((a, b) => a.order - b.order || a.index - b.index);
			const active = clips.filter((c) => c.active === true);
			if (active.length > 1) errors.push(new DocumentError("multi-active-clip", `${ptr}/clips`, `v1.0 只允许一个 active clip，收到 ${active.length} 个`));
			let activeClip;
			if (active.length === 1) {
				const clip = active[0];
				const tracks = [];
				let span = 0;
				for (const [key, anim] of Object.entries(clip.tracks ?? {})) {
					const m = TRACK_KEY.exec(key);
					const p = `${ptr}/clips/${clip.name}/tracks/${key}`;
					if (!m) {
						errors.push(new DocumentError("bad-clip-track", p, `track key 需为 "骨名.offset.x|offset.y|rotation|scale[.x|.y]"，收到: ${key}`));
						continue;
					}
					const [, bone, prop] = m;
					if (!byName.has(bone)) {
						errors.push(new DocumentError("clip-track-bone-missing", p, `track 引用骨骼不存在: ${bone}`));
						continue;
					}
					try {
						const compiledAnim = compileClipTrack(prop, anim, p);
						for (const tr of compiledAnim.tracks ?? []) span = Math.max(span, tr.span);
						tracks.push({
							bone,
							prop,
							anim: compiledAnim
						});
					} catch (e) {
						errors.push(new DocumentError(e.code ?? "bad-clip-track", p, e.message));
					}
				}
				activeClip = {
					name: clip.name,
					loop: clip.loop !== false,
					span,
					tracks
				};
			}
			if (errors.length) return { errors };
			return {
				mesh: {
					bones: compiled,
					parts: compiledParts,
					activeClip
				},
				errors
			};
		}
		/** clip 单轨直写形态（§4.5 示例）：keyframes 用顶层 frames；oscillate/scroll 的 property 由 track key 提供。 */
		function compileClipTrack(prop, anim, ptr) {
			if (anim.kind === "keyframes") {
				if (!anim.frames) {
					const err = /* @__PURE__ */ new Error("clip track 的 keyframes 必须直写 frames（不接受嵌套 tracks）");
					err.code = "bad-clip-track";
					throw err;
				}
				return compileAnimation({
					kind: "keyframes",
					tracks: { [prop]: {
						easing: anim.easing,
						loop: anim.loop,
						frames: anim.frames
					} }
				}, ptr);
			}
			return compileAnimation({
				...anim,
				property: prop
			}, ptr);
		}
		/**
		* 求值 mesh 图层 → 部件四边形（设计px局部，matrix 已含 layerMatrix 与父链）。
		* layerMatrix：mesh 图层整体变换（anchor/fit/layer 动画），部件尺寸用 assetSizes 自然尺寸。
		*/
		function evalMesh(mesh, t, vars, layerMatrix) {
			const state = /* @__PURE__ */ new Map();
			for (const b of mesh.bones) state.set(b.name, {
				offX: b.offset[0],
				offY: b.offset[1],
				rot: b.rotation,
				sclX: 1,
				sclY: 1
			});
			const clip = mesh.activeClip;
			if (clip) {
				const tt = clip.loop && clip.span > 0 ? (t % clip.span + clip.span) % clip.span : t;
				for (const tr of clip.tracks) {
					const s = state.get(tr.bone);
					const base = tr.prop === "offset.x" ? s.offX : tr.prop === "offset.y" ? s.offY : tr.prop === "rotation" ? s.rot : 1;
					if (tr.anim.kind === "keyframes") {
						const v = evalTrack(tr.anim.tracks[0], tt, vars);
						const n = typeof v === "number" ? v : resolveNum(v, vars, base);
						applyBoneProp(s, tr.prop, n, false);
					} else if (tr.anim.kind === "oscillate") applyBoneProp(s, tr.prop, base + oscillateDelta(tr.anim, tt), false);
					else if (tr.anim.kind === "scroll") applyBoneProp(s, tr.prop, scrollValue(base, tr.anim, tt), false);
				}
			}
			const world = /* @__PURE__ */ new Map();
			for (const b of mesh.bones) {
				const s = state.get(b.name);
				let local = mul(translate(s.offX, s.offY), rotate(s.rot));
				local = mul(local, scale(s.sclX, s.sclY));
				const parentWorld = b.parent ? world.get(b.parent) : layerMatrix;
				world.set(b.name, mul(parentWorld, local));
			}
			return mesh.parts.map((pt) => {
				const m = mul(mul(world.get(pt.bone) ?? layerMatrix, translate(pt.offset[0], pt.offset[1])), rotate(pt.rotation));
				return {
					src: pt.src,
					matrix: m,
					alpha: pt.alpha,
					skinned: pt.skinned
				};
			});
		}
		function applyBoneProp(s, prop, value, _relative) {
			switch (prop) {
				case "offset.x":
					s.offX = value;
					break;
				case "offset.y":
					s.offY = value;
					break;
				case "rotation":
					s.rot = value;
					break;
				case "scale":
					s.sclX = value;
					s.sclY = value;
					break;
				case "scale.x":
					s.sclX = value;
					break;
				case "scale.y": s.sclY = value;
			}
		}
		//#endregion
		//#region vendor/dwp/packages/dwp-core/src/compile.ts
		const BLENDS = /* @__PURE__ */ new Set([
			"normal",
			"lighter",
			"multiply",
			"screen",
			"overlay",
			"darken",
			"lighten",
			"color-dodge",
			"soft-light",
			"hard-light",
			"difference",
			"exclusion"
		]);
		const EFFECTS = /* @__PURE__ */ new Set([
			"waterwaves",
			"waterripple",
			"shake",
			"scroll",
			"tint",
			"pulse",
			"filmgrain",
			"opacity",
			"vignette",
			"chromatic",
			"blur"
		]);
		const ANIM_PROPS = /* @__PURE__ */ new Set([
			"offset.x",
			"offset.y",
			"scale",
			"scale.x",
			"scale.y",
			"rotation",
			"alpha",
			"size.w",
			"size.h",
			"uvOffset",
			"color"
		]);
		const SCROLL_PROPS = /* @__PURE__ */ new Set([
			"uvOffset",
			"offset.x",
			"offset.y"
		]);
		const VAR_ID = /^[a-zA-Z][a-zA-Z0-9_]*$/;
		function compile(manifest, scene) {
			const errors = [];
			const vars = buildVarTable(scene, manifest);
			for (const e of assertRefsDefined(collectVarRefs(scene), vars)) errors.push(e);
			const paramIds = /* @__PURE__ */ new Set();
			for (const [i, p] of (manifest?.params ?? []).entries()) {
				if (!VAR_ID.test(p.key)) errors.push(new DocumentError("bad-param-key", `/params/${i}/key`, `参数 key 非法: ${p.key}`));
				if (paramIds.has(p.key)) errors.push(new DocumentError("dup-param-key", `/params/${i}/key`, `参数 key 重复: ${p.key}`));
				paramIds.add(p.key);
				if (p.kind === "slider" && (typeof p.min !== "number" || typeof p.max !== "number")) errors.push(new DocumentError("slider-bounds", `/params/${i}`, `slider 参数 ${p.key} 缺 min/max`));
				if (p.kind === "select" && (!Array.isArray(p.options) || p.options.length === 0)) errors.push(new DocumentError("select-options", `/params/${i}`, `select 参数 ${p.key} 缺 options`));
			}
			const ids = /* @__PURE__ */ new Set();
			const compiled = [];
			scene.layers.forEach((layer, i) => {
				const ptr = `/layers/${i}`;
				if (ids.has(layer.id)) errors.push(new DocumentError("dup-layer-id", ptr, `图层 id 重复: ${layer.id}`));
				ids.add(layer.id);
				if (layer.blend !== void 0 && !BLENDS.has(layer.blend)) errors.push(new DocumentError("bad-blend", `${ptr}/blend`, `混合模式不在白名单: ${layer.blend}`));
				let anim;
				if (layer.animation) try {
					anim = compileAnimation(layer.animation, ptr);
					validateAnim(anim, `${ptr}/animation`, errors);
				} catch (e) {
					const code = e.code ?? "bad-easing";
					errors.push(new DocumentError(code, `${ptr}/animation`, e.message));
				}
				let mesh;
				if (layer.type === "mesh") {
					const r = compileMesh(layer, ptr);
					errors.push(...r.errors);
					mesh = r.mesh;
				}
				compiled.push({
					index: i,
					raw: layer,
					anim,
					mesh
				});
			});
			(scene.effects ?? []).forEach((fx, i) => {
				if (!EFFECTS.has(fx.type)) errors.push(new DocumentError("bad-effect", `/effects/${i}/type`, `效果不在白名单: ${fx.type}`));
				if (fx.target !== "scene" && !ids.has(fx.target)) errors.push(new DocumentError("effect-target-missing", `/effects/${i}/target`, `效果目标图层不存在: ${fx.target}`));
			});
			if (errors.length) throw new DocumentErrors(errors);
			return {
				manifest,
				scene,
				vars,
				layers: compiled,
				canvas: {
					width: scene.canvas.width,
					height: scene.canvas.height,
					fit: scene.canvas.fit ?? "cover",
					background: scene.canvas.background ?? "#000000"
				},
				loop: scene.loop
			};
		}
		function validateAnim(anim, ptr, errors) {
			if (anim.kind === "keyframes") for (const tr of anim.tracks ?? []) {
				if (!ANIM_PROPS.has(tr.property)) errors.push(new DocumentError("bad-anim-property", `${ptr}/tracks/${tr.property}`, `动画属性不在白名单: ${tr.property}`));
				if (tr.times.length < 2) errors.push(new DocumentError("short-track", `${ptr}/tracks/${tr.property}`, "关键帧至少 2 帧"));
			}
			else if (anim.kind === "oscillate") {
				if (!anim.property || !ANIM_PROPS.has(anim.property)) errors.push(new DocumentError("bad-anim-property", `${ptr}/property`, `动画属性不在白名单: ${anim.property}`));
				if (!(anim.period && anim.period > 0)) errors.push(new DocumentError("bad-period", `${ptr}/period`, "oscillate 需要 period > 0"));
			} else if (anim.kind === "scroll") {
				if (!anim.property || !SCROLL_PROPS.has(anim.property)) errors.push(new DocumentError("bad-anim-property", `${ptr}/property`, `scroll 仅支持 uvOffset/offset.x/offset.y，收到: ${anim.property}`));
			}
		}
		/** 不可变参数更新（design-runtime.md §1）：返回新 CompiledDoc，原实例不动。 */
		function setParam(doc, id, value) {
			const overrides = {
				...doc.overrides ?? {},
				[id]: value
			};
			const vars = buildVarTable(doc.scene, doc.manifest, overrides);
			return {
				...doc,
				vars,
				overrides
			};
		}
		//#endregion
		//#region vendor/dwp/packages/dwp-core/src/particles.ts
		const DT = 1 / 60;
		const STRIDE = 8;
		const OUT_STRIDE = 8;
		const CHECKPOINT_EVERY = 300;
		const CHECKPOINT_RING = 8;
		function mix(...nums) {
			let h = 2166136261;
			for (const n of nums) {
				h ^= n | 0;
				h = Math.imul(h, 16777619);
			}
			return h >>> 0;
		}
		function mulberry32(a) {
			return () => {
				a = a + 1831565813 | 0;
				let t = Math.imul(a ^ a >>> 15, 1 | a);
				t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
				return ((t ^ t >>> 14) >>> 0) / 4294967296;
			};
		}
		/** [[fraction, value], ...] 分段线性（钳两端）。 */
		function curve(pairs, f) {
			if (!pairs.length) return 0;
			if (f <= pairs[0][0]) return pairs[0][1];
			if (f >= pairs[pairs.length - 1][0]) return pairs[pairs.length - 1][1];
			for (let i = 1; i < pairs.length; i++) if (f <= pairs[i][0]) {
				const [f0, v0] = pairs[i - 1], [f1, v1] = pairs[i];
				const u = f1 === f0 ? 0 : (f - f0) / (f1 - f0);
				return v0 + (v1 - v0) * u;
			}
			return pairs[pairs.length - 1][1];
		}
		/** 收集 particle 图层（文档声明序）。 */
		function createSim(doc, seed) {
			const emitters = [];
			for (const cl of doc.layers) {
				if (cl.raw.type !== "particle") continue;
				const cap = Math.min(cl.raw.maxCount ?? 2e3, 2e4);
				emitters.push({
					layerIndex: cl.index,
					seed: mix(seed, cl.raw.seed ?? 0, cl.index),
					lastK: 0,
					count: 0,
					data: new Float32Array(cap * STRIDE),
					acc: 0,
					spawnSeq: 0,
					checkpoints: [],
					outBufs: [/* @__PURE__ */ new Float32Array(0), /* @__PURE__ */ new Float32Array(0)],
					outIdx: 0
				});
			}
			return emitters.length ? {
				seed,
				emitters
			} : null;
		}
		function advanceEmitter(em, layer, toK, seed, emitterIdx, vars, canvasW, canvasH) {
			if (toK < em.lastK || toK - em.lastK > CHECKPOINT_EVERY) {
				let best = null;
				for (const cp of em.checkpoints) if (cp.k <= toK && (!best || cp.k > best.k)) best = cp;
				if (best) {
					em.count = best.count;
					em.data.set(best.data);
					em.acc = best.acc;
					em.spawnSeq = best.spawnSeq;
					em.lastK = best.k;
				} else {
					em.count = 0;
					em.acc = 0;
					em.spawnSeq = 0;
					em.lastK = 0;
				}
			}
			while (em.lastK < toK) {
				em.lastK++;
				stepOnce(em, layer, em.lastK, seed, emitterIdx, vars, canvasW, canvasH);
				if (em.lastK % CHECKPOINT_EVERY === 0) {
					em.checkpoints.push({
						k: em.lastK,
						count: em.count,
						data: em.data.slice(),
						acc: em.acc,
						spawnSeq: em.spawnSeq
					});
					if (em.checkpoints.length > CHECKPOINT_RING) em.checkpoints.shift();
				}
			}
		}
		function stepOnce(em, layer, k, seed, emitterIdx, vars, canvasW, canvasH) {
			const cap = em.data.length / STRIDE;
			const emu = layer.emitter ?? { shape: "point" };
			const rate = resolveNum(emu.rate, vars, 0);
			em.acc += rate * DT;
			let n = Math.floor(em.acc);
			em.acc -= n;
			const boxW = (emu.size?.[0] ?? 0) * canvasW, boxH = (emu.size?.[1] ?? 0) * canvasH;
			const dir0 = resolveNum(layer.velocity?.direction, vars, 90);
			const spread = layer.velocity?.spread ?? 0;
			const sp0 = resolveNum(layer.velocity?.speed?.[0], vars, 100);
			const sp1 = resolveNum(layer.velocity?.speed?.[1], vars, sp0);
			const life0 = layer.life?.[0] ?? 1, life1 = layer.life?.[1] ?? life0;
			const spin = typeof layer.rotation === "object" && layer.rotation.spin ? layer.rotation.spin : [0, 0];
			const spin0 = resolveNum(spin[0], vars, 0), spin1 = resolveNum(spin[1], vars, spin0);
			const rol0 = resolveNum(layer.rotationOverLife?.[0], vars, 0);
			const rol1 = resolveNum(layer.rotationOverLife?.[1], vars, rol0);
			while (n-- > 0 && em.count < cap) {
				const r = mulberry32(mix(em.seed, k, em.spawnSeq++));
				const i = em.count * STRIDE;
				const d = em.data;
				d[i] = emu.shape === "box" ? (r() * 2 - 1) * boxW / 2 : 0;
				d[i + 1] = emu.shape === "box" ? (r() * 2 - 1) * boxH / 2 : 0;
				const dir = (dir0 + (r() * 2 - 1) * spread) * Math.PI / 180;
				const sp = sp0 + (sp1 - sp0) * r();
				d[i + 2] = Math.cos(dir) * sp;
				d[i + 3] = Math.sin(dir) * sp;
				d[i + 4] = spin0 + (spin1 - spin0) * r();
				d[i + 5] = rol0 + (rol1 - rol0) * r();
				d[i + 6] = 0;
				d[i + 7] = life0 + (life1 - life0) * r();
				em.count++;
			}
			const g = layer.gravity ?? 0;
			const drag = layer.drag ?? 0;
			const dragK = Math.max(0, 1 - drag * DT);
			const d = em.data;
			let i = 0;
			while (i < em.count) {
				const b = i * STRIDE;
				d[b + 6] += DT;
				if (d[b + 6] >= d[b + 7]) {
					em.count--;
					if (i !== em.count) {
						const last = em.count * STRIDE;
						for (let f = 0; f < STRIDE; f++) d[b + f] = d[last + f];
					}
					continue;
				}
				d[b + 3] += g * DT;
				d[b + 2] *= dragK;
				d[b + 3] *= dragK;
				d[b] += d[b + 2] * DT;
				d[b + 1] += d[b + 3] * DT;
				i++;
			}
		}
		/** 求值到步号 k 并产出 particles step（视口px烘焙）。 */
		function emitParticleSteps(sim, doc, vars, t, vw, vh, sx, sy, input) {
			const out = [];
			sim.emitters.forEach((em, ei) => {
				const layer = doc.layers[em.layerIndex].raw;
				advanceEmitter(em, layer, Math.floor(t * 60 + 1e-9), sim.seed, ei, vars, doc.canvas.width, doc.canvas.height);
				const anchor = layer.anchor ?? [.5, .5];
				const cx = anchor[0] * vw + (layer.offset?.[0] ?? 0) * sx;
				const cy = anchor[1] * vh + (layer.offset?.[1] ?? 0) * sy;
				const tex = layer.texture ?? "";
				const nat = input.assetSizes?.[tex] ?? {
					w: 32,
					h: 32
				};
				const align = typeof layer.rotation === "object" && layer.rotation.alignToVelocity;
				const sol = layer.sizeOverLife ?? [[0, 1], [1, 1]];
				const aol = layer.alphaOverLife ?? [[0, 1], [1, 1]];
				const layerAlpha = resolveNum(layer.alpha, vars, 1);
				const need = em.count * OUT_STRIDE;
				em.outIdx ^= 1;
				let full = em.outBufs[em.outIdx];
				if (full.length < need) full = em.outBufs[em.outIdx] = new Float32Array(need);
				const buf = full.subarray(0, need);
				const d = em.data;
				for (let i = 0; i < em.count; i++) {
					const b = i * STRIDE, o = i * OUT_STRIDE;
					const life01 = d[b + 6] / d[b + 7];
					let rot = d[b + 4] + d[b + 5] * d[b + 6];
					if (align) rot = Math.atan2(d[b + 3], d[b + 2]) * 180 / Math.PI;
					const sm = curve(sol, life01);
					buf[o] = cx + d[b] * sx;
					buf[o + 1] = cy + d[b + 1] * sy;
					buf[o + 2] = rot;
					buf[o + 3] = nat.w * sm * sx;
					buf[o + 4] = nat.h * sm * sy;
					buf[o + 5] = curve(aol, life01) * layerAlpha;
					buf[o + 6] = life01;
				}
				const colors = (layer.colorOverLife ?? []).length ? layer.colorOverLife.map((c) => String(resolveColor(c, vars) ?? "#ffffff")) : ["#ffffff", "#ffffff"];
				out.push({
					layer: layer.id,
					step: {
						op: "particles",
						layer: layer.id,
						tex,
						buffer: buf,
						count: em.count,
						stride: OUT_STRIDE,
						blend: layer.blend ?? "lighter",
						colorA: colors[0],
						colorB: colors[1] ?? colors[0]
					}
				});
			});
			return out;
		}
		//#endregion
		//#region vendor/dwp/packages/dwp-core/src/effects.ts
		const num = (v, vars, fb) => typeof v === "number" || typeof v === "string" ? resolveNum(v, vars, fb) : fb;
		const col = (v, vars, fb) => parseColor(resolveColor(typeof v === "string" ? v : void 0, vars) ?? fb);
		/** 确定性伪噪声（shake）：双正弦积——无 RNG，跨实现逐位一致。 */
		function shakeOffset(intensity, speed, t) {
			const w = 2 * Math.PI * speed * t;
			return [intensity * Math.sin(w) * Math.sin(w * .61 + 1.3), intensity * Math.cos(w * .83 + .7) * Math.sin(w * .47 + 2.1)];
		}
		/** pulse 亮度/透明度因子：min + (max-min)·(0.5+0.5·sin(2πt/speed))，core 侧烘焙。 */
		function pulseFactor(p, vars, t) {
			const speed = num(p.speed, vars, 1);
			const min = num(p.min, vars, .6);
			return min + (num(p.max, vars, 1) - min) * (.5 + .5 * Math.sin(2 * Math.PI * t / Math.max(speed, 1e-6)));
		}
		function foldLayerEffects(effects, layerId, t, vars) {
			const fold = {
				alphaMul: 1,
				offX: 0,
				offY: 0,
				deferred: []
			};
			for (const fx of effects) {
				if (fx.target !== layerId) continue;
				const p = fx.params ?? {};
				switch (fx.type) {
					case "opacity":
						fold.alphaMul *= Math.min(1, Math.max(0, num(p.value, vars, 1)));
						break;
					case "pulse":
						fold.alphaMul *= pulseFactor(p, vars, t);
						break;
					case "tint":
						fold.tint = col(p.color, vars, "#ffffff");
						break;
					case "scroll": {
						const sx = num(Array.isArray(p.speed) ? p.speed[0] : p.speed, vars, 0);
						const sy = num(Array.isArray(p.speed) ? p.speed[1] : 0, vars, 0);
						fold.offX += sx * t;
						fold.offY += sy * t;
						break;
					}
					case "shake": {
						const [dx, dy] = shakeOffset(num(p.intensity ?? p.amplitude, vars, 10), num(p.speed, vars, 3), t);
						fold.offX += dx;
						fold.offY += dy;
						break;
					}
					default: fold.deferred.push(fx.type);
				}
			}
			return fold;
		}
		function expandSceneEffects(effects, t, vars, vw, vh) {
			const scene = effects.filter((fx) => fx.target === "scene");
			const passes = [];
			let viewDX = 0, viewDY = 0, opacityMul = 1;
			const passFx = [];
			for (const fx of scene) {
				const p = fx.params ?? {};
				switch (fx.type) {
					case "opacity":
						opacityMul *= Math.min(1, Math.max(0, num(p.value, vars, 1)));
						break;
					case "scroll": {
						const sx = num(Array.isArray(p.speed) ? p.speed[0] : p.speed, vars, 0);
						const sy = num(Array.isArray(p.speed) ? p.speed[1] : 0, vars, 0);
						viewDX += sx * t;
						viewDY += sy * t;
						break;
					}
					case "shake": {
						const [dx, dy] = shakeOffset(num(p.intensity ?? p.amplitude, vars, 10), num(p.speed, vars, 3), t);
						viewDX += dx;
						viewDY += dy;
						break;
					}
					case "waterwaves":
					case "waterripple": {
						const strength = num(p.strength, vars, .5);
						const scale = num(p.scale, vars, 24);
						passFx.push({
							template: "distort",
							effect: fx.type,
							params: {
								mode: fx.type === "waterripple" ? 1 : 0,
								amp: strength * 20,
								freq: 2 * Math.PI / scale,
								speed: num(p.speed, vars, 1),
								t
							}
						});
						break;
					}
					case "blur": {
						const r = num(p.radius, vars, 8) / Math.max(vw, 1);
						passFx.push({
							template: "blurDown",
							effect: "blur",
							params: {}
						});
						passFx.push({
							template: "blurX",
							effect: "blur",
							params: { radius: r }
						});
						passFx.push({
							template: "blurY",
							effect: "blur",
							params: { radius: r }
						});
						passFx.push({
							template: "blurCombine",
							effect: "blur",
							params: { radius: r }
						});
						break;
					}
					case "chromatic":
						passFx.push({
							template: "chromatic",
							effect: "chromatic",
							params: { strength: num(p.strength, vars, .005) }
						});
						break;
					case "vignette":
						passFx.push({
							template: "overlay",
							effect: "vignette",
							params: {
								kind: 0,
								intensity: num(p.intensity, vars, .5),
								color: Array.from(col(p.color, vars, "#000000"))
							}
						});
						break;
					case "filmgrain":
						passFx.push({
							template: "overlay",
							effect: "filmgrain",
							params: {
								kind: 1,
								intensity: num(p.intensity, vars, .1),
								speed: num(p.speed, vars, 8),
								t
							}
						});
						break;
					case "tint":
						passFx.push({
							template: "overlay",
							effect: "tint",
							params: {
								kind: 2,
								color: Array.from(col(p.color, vars, "#ffffff")),
								mix: num(p.mix, vars, .5)
							}
						});
						break;
					case "pulse": passFx.push({
						template: "overlay",
						effect: "pulse",
						params: {
							kind: 3,
							brightness: pulseFactor(p, vars, t)
						}
					});
				}
			}
			let cur = "scene";
			passFx.forEach((f, i) => {
				const last = i === passFx.length - 1;
				let target;
				if (f.template === "blurDown") target = "rtHalf";
				else if (f.template === "blurX") target = "rtHalfB";
				else if (f.template === "blurY") target = "rtHalf";
				else if (last) target = "screen";
				else target = i % 2 === 0 ? "rt0" : "rt1";
				passes.push({
					op: "pass",
					effect: f.effect,
					template: f.template,
					params: f.params,
					inputs: [cur],
					target
				});
				cur = target;
			});
			return {
				passes,
				viewDX,
				viewDY,
				opacityMul
			};
		}
		//#endregion
		//#region vendor/dwp/packages/dwp-core/src/pool.ts
		function createPool(size = 2) {
			const slots = Array.from({ length: size }, () => ({
				steps: [],
				unsupported: [],
				vertBufs: [],
				nVerts: 0
			}));
			let i = 0;
			return {
				slots,
				acquire() {
					const s = slots[i % slots.length];
					i++;
					s.steps.length = 0;
					s.unsupported.length = 0;
					s.nVerts = 0;
					return s;
				}
			};
		}
		/** 从槽取一块 quad 顶点缓冲并填充（中心原点，视口px）。 */
		function slotVerts(s, w, h) {
			let b = s.vertBufs[s.nVerts];
			if (!b) b = s.vertBufs[s.nVerts] = /* @__PURE__ */ new Float32Array(8);
			s.nVerts++;
			const hw = w / 2, hh = h / 2;
			b[0] = -hw;
			b[1] = -hh;
			b[2] = hw;
			b[3] = -hh;
			b[4] = hw;
			b[5] = hh;
			b[6] = -hw;
			b[7] = hh;
			return b;
		}
		//#endregion
		//#region vendor/dwp/packages/dwp-core/src/eval.ts
		const clamp01 = (v) => Math.min(1, Math.max(0, v));
		/** tint 叠加：base × tint（预乘 alpha 空间，协议 §5.3）。tint 缺省直通。 */
		function tintMul(base, tint) {
			if (!tint) return base;
			return [
				base[0] * tint[0],
				base[1] * tint[1],
				base[2] * tint[2],
				base[3] * tint[3]
			];
		}
		/**
		* 文本层 $var 替换（本地扩展，见 vendor README「本地补丁」）：
		* 协议 §2 的 $name 语义是**整串替换**（数值/颜色字段）；文本层 v1 未定义 $var，
		* 这里做附加式**子串**替换以支持组合文案（如 "工作区 ● $count"）。
		* 未定义的变量原样保留——普通含 $ 的文案不受影响；整串 $name 会被
		* compile 的 collectVarRefs/assertRefsDefined 收录，仍受孤儿检查约束。
		*/
		function formatVars(value, vars) {
			return value.replace(/\$([a-zA-Z][a-zA-Z0-9_]*)/g, (all, name) => {
				const got = vars.get(name);
				return got === void 0 ? all : String(got);
			});
		}
		function evaluate(doc, input, sim, pool) {
			const { viewport } = input;
			const dpr = input.dpr ?? 1;
			const t = doc.loop && doc.loop > 0 ? (input.t % doc.loop + doc.loop) % doc.loop : input.t;
			const [sx, sy] = fitScale(doc.canvas.fit, doc.canvas.width, doc.canvas.height, viewport.w, viewport.h);
			const ctx = {
				doc,
				input,
				t,
				vw: viewport.w,
				vh: viewport.h,
				sx,
				sy,
				vars: doc.vars
			};
			const slot = pool?.acquire();
			const steps = slot?.steps ?? [];
			const unsupported = slot?.unsupported ?? [];
			const clearColor = parseColor(resolveColor(doc.canvas.background, doc.vars) ?? "#000000");
			const effects = doc.scene.effects ?? [];
			const sceneFx = expandSceneEffects(effects, t, doc.vars, viewport.w, viewport.h);
			const particleSteps = /* @__PURE__ */ new Map();
			if (sim) for (const p of emitParticleSteps(sim, doc, doc.vars, t, viewport.w, viewport.h, sx, sy, input)) particleSteps.set(p.layer, p.step);
			for (const cl of doc.layers) {
				const layer = cl.raw;
				if (layer.visible === false) continue;
				const fold = foldLayerEffects(effects, layer.id, t, doc.vars);
				if (fold.deferred.length) unsupported.push({
					id: layer.id,
					reason: `layer-effect-deferred (${[...new Set(fold.deferred)].join(",")})`
				});
				if (layer.type === "particle") {
					const ps = particleSteps.get(layer.id);
					if (ps) {
						applyParticleAlpha(ps, sceneFx.opacityMul * fold.alphaMul);
						steps.push(ps);
					} else unsupported.push({
						id: layer.id,
						reason: "particle-sim-not-supplied (createSim)"
					});
					continue;
				}
				const r = layer.type === "mesh" ? resolveMeshLayer(layer, cl, ctx, fold, sceneFx.opacityMul, slot) : resolveLayer(layer, cl, ctx, fold, sceneFx.opacityMul, slot);
				if ("reason" in r) unsupported.push({
					id: layer.id,
					reason: r.reason
				});
				else {
					steps.push(...r.steps);
					if (r.notes) unsupported.push(...r.notes);
				}
			}
			steps.push(...sceneFx.passes);
			return {
				planVersion: 1,
				view: [
					dpr,
					0,
					0,
					dpr,
					sceneFx.viewDX * dpr,
					sceneFx.viewDY * dpr
				],
				clear: clearColor,
				steps,
				unsupported
			};
		}
		function applyParticleAlpha(step, mul) {
			if (mul === 1 || step.op !== "particles") return;
			for (let i = 5; i < step.buffer.length; i += step.stride) step.buffer[i] *= mul;
		}
		function resolveBaseTransform(layer, anim, ctx) {
			const { vars, t } = ctx;
			const num = (v, fb) => v === void 0 ? fb : typeof v === "number" ? v : resolveNum(v, vars, fb);
			let offX = layer.offset?.[0] ?? 0, offY = layer.offset?.[1] ?? 0;
			let rot = typeof layer.rotation === "object" ? 0 : resolveNum(layer.rotation, vars, 0);
			let sclX = resolveNum(layer.scale, vars, 1), sclY = sclX;
			let alpha = resolveNum(layer.alpha, vars, 1);
			const kv = evalLayerAnimation(anim, t, vars);
			if (kv["offset.x"] !== void 0) offX = num(kv["offset.x"], offX);
			if (kv["offset.y"] !== void 0) offY = num(kv["offset.y"], offY);
			if (kv.rotation !== void 0) rot = num(kv.rotation, rot);
			if (kv.scale !== void 0) {
				sclX = num(kv.scale, sclX);
				sclY = sclX;
			}
			if (kv["scale.x"] !== void 0) sclX = num(kv["scale.x"], sclX);
			if (kv["scale.y"] !== void 0) sclY = num(kv["scale.y"], sclY);
			if (kv.alpha !== void 0) alpha = num(kv.alpha, alpha);
			if (anim?.kind === "oscillate" && anim.property) {
				const d = oscillateDelta(anim, t);
				switch (anim.property) {
					case "offset.x":
						offX += d;
						break;
					case "offset.y":
						offY += d;
						break;
					case "rotation":
						rot += d;
						break;
					case "scale":
						sclX += d;
						sclY += d;
						break;
					case "scale.x":
						sclX += d;
						break;
					case "scale.y":
						sclY += d;
						break;
					case "alpha": alpha += d;
				}
			}
			if (anim?.kind === "scroll" && anim.property) {
				if (anim.property === "offset.x") offX = scrollValue(layer.offset?.[0] ?? 0, anim, t);
				else if (anim.property === "offset.y") offY = scrollValue(layer.offset?.[1] ?? 0, anim, t);
			}
			return {
				offX,
				offY,
				rot,
				sclX,
				sclY,
				alpha: clamp01(alpha)
			};
		}
		function resolveLayer(layer, cl, ctx, fold, opacityMul, slot) {
			const { vars } = ctx;
			const bt = resolveBaseTransform(layer, cl.anim, ctx);
			const anchor = layer.anchor ?? [.5, .5];
			const origin = layer.origin ?? [.5, .5];
			const alpha = clamp01(bt.alpha * fold.alphaMul * opacityMul);
			const vertsOf = (w, h) => slot ? slotVerts(slot, w, h) : quadVerts(w, h);
			let sizeW = layer.size?.[0], sizeH = layer.size?.[1];
			const kv = evalLayerAnimation(cl.anim, ctx.t, vars);
			const num = (v, fb) => v === void 0 ? fb : typeof v === "number" ? v : resolveNum(v, vars, fb);
			if (kv["size.w"] !== void 0) sizeW = num(kv["size.w"], sizeW ?? 0);
			if (kv["size.h"] !== void 0) sizeH = num(kv["size.h"], sizeH ?? 0);
			if (cl.anim?.kind === "oscillate") {
				const d = oscillateDelta(cl.anim, ctx.t);
				if (cl.anim.property === "size.w") sizeW = (sizeW ?? 0) + d;
				if (cl.anim.property === "size.h") sizeH = (sizeH ?? 0) + d;
			}
			let uvOffset;
			if (cl.anim?.kind === "scroll" && cl.anim.property === "uvOffset") uvOffset = [scrollValue(0, cl.anim, ctx.t), 0];
			let texW = sizeW, texH = sizeH;
			if (layer.type === "text") {
				texW = sizeW ?? 0;
				texH = sizeH ?? 0;
			} else if (texW === void 0 || texH === void 0) {
				const path = layer.src ?? layer.texture;
				const natural = path ? ctx.input.assetSizes?.[path] : void 0;
				if (!natural) return { reason: `size:null 且宿主未注入纹理尺寸: ${path ?? layer.id}` };
				texW = natural.w;
				texH = natural.h;
			}
			const w = texW * ctx.sx, h = texH * ctx.sy;
			const matrix = boxMatrix(anchor[0] * ctx.vw + (bt.offX + fold.offX) * ctx.sx, anchor[1] * ctx.vh + (bt.offY + fold.offY) * ctx.sy, w, h, origin, bt.rot, bt.sclX, bt.sclY);
			const blend = layer.blend ?? "normal";
			switch (layer.type) {
				case "solid": {
					const tint = tintMul(parseColor(resolveColor(layer.color, vars) ?? "#ffffff"), fold.tint);
					return { steps: [{
						op: "quad",
						layer: layer.id,
						tex: "@solid",
						verts: vertsOf(w, h),
						uv: quadUV(),
						matrix,
						blend,
						alpha,
						tint
					}] };
				}
				case "image":
				case "video": return { steps: [{
					op: "quad",
					layer: layer.id,
					tex: layer.src ?? "",
					verts: vertsOf(w, h),
					uv: quadUV(),
					matrix,
					blend,
					alpha,
					...fold.tint ? { tint: fold.tint } : {},
					...uvOffset ? { uvOffset } : {}
				}] };
				case "text": {
					const text = formatVars(formatPlaceholders(layer.value ?? "", ctx.input.timeContext), vars);
					const { sizePx, font } = parseFont(layer.font ?? "16px sans-serif");
					const color = tintMul(parseColor(resolveColor(layer.color, vars) ?? "#ffffff"), fold.tint);
					return { steps: [{
						op: "text",
						layer: layer.id,
						blend,
						alpha,
						run: {
							text,
							font,
							sizePx,
							color,
							align: "center",
							baseline: "middle",
							matrix
						}
					}] };
				}
				default: return { reason: `未知图层类型: ${layer.type}` };
			}
		}
		function resolveMeshLayer(layer, cl, ctx, fold, opacityMul, slot) {
			if (!cl.mesh) return { reason: "mesh 编译缺失" };
			const bt = resolveBaseTransform(layer, cl.anim, ctx);
			const anchor = layer.anchor ?? [.5, .5];
			const cx = anchor[0] * ctx.vw + (bt.offX + fold.offX) * ctx.sx;
			const cy = anchor[1] * ctx.vh + (bt.offY + fold.offY) * ctx.sy;
			const alpha = clamp01(bt.alpha * fold.alphaMul * opacityMul);
			let layerMatrix = mul(translate(cx, cy), rotate(bt.rot));
			layerMatrix = mul(layerMatrix, [
				bt.sclX * ctx.sx,
				0,
				0,
				bt.sclY * ctx.sy,
				0,
				0
			]);
			const quads = evalMesh(cl.mesh, ctx.t, ctx.vars, layerMatrix);
			const blend = layer.blend ?? "normal";
			const steps = [];
			const missing = [];
			let skinnedCount = 0;
			for (const q of quads) {
				if (q.skinned) {
					skinnedCount++;
					continue;
				}
				const nat = ctx.input.assetSizes?.[q.src];
				if (!nat) {
					missing.push(q.src);
					continue;
				}
				steps.push({
					op: "quad",
					layer: layer.id,
					tex: q.src,
					verts: slot ? slotVerts(slot, nat.w, nat.h) : quadVerts(nat.w, nat.h),
					uv: quadUV(),
					matrix: q.matrix,
					blend,
					alpha: alpha * q.alpha,
					...fold.tint ? { tint: fold.tint } : {}
				});
			}
			const notes = [];
			if (skinnedCount) notes.push({
				id: layer.id,
				reason: `skinned-part-deferred ×${skinnedCount}`
			});
			if (missing.length) return { reason: `部件纹理尺寸未注入: ${missing.join(", ")}` };
			return {
				steps,
				notes
			};
		}
		const pad = (n) => String(n).padStart(2, "0");
		function formatPlaceholders(value, ctx) {
			return value.replace(/\{(time|date):([^}]+)\}/g, (_all, kind, fmt) => {
				if (!ctx) return kind === "time" ? "12:34" : "2026-01-01";
				return fmt.replaceAll("yyyy", String(ctx.year)).replaceAll("MM", pad(ctx.month)).replaceAll("dd", pad(ctx.day)).replaceAll("HH", pad(ctx.hour)).replaceAll("mm", pad(ctx.minute)).replaceAll("ss", pad(ctx.second)).replaceAll("weekday", ctx.weekday);
			});
		}
		/** CSS font 简写解析："700 220px 'Segoe UI', sans-serif" → sizePx=220，font 保留全串（执行器直接喂 ctx.font） */
		function parseFont(spec) {
			const m = /(\d+(?:\.\d+)?)px/.exec(spec);
			if (m) return {
				sizePx: parseFloat(m[1]),
				font: spec
			};
			return {
				sizePx: 16,
				font: spec
			};
		}
		//#endregion
		//#region vendor/dwp/packages/dwp-gl/src/gl-types.ts
		/**
		* WebGL2 最小接口 + 标准枚举常量（design-runtime.md §3，R2）。
		* 执行器只依赖 GLContext 方法子集：浏览器喂真 WebGL2RenderingContext（结构兼容），
		* Node 测试喂 MockGL（录制调用序列）——无 GPU 也能验证绘制编排。
		* 常量值取自 WebGL2 规范（固定），不要求 context 暴露。
		*/
		const GL = {
			ARRAY_BUFFER: 34962,
			STATIC_DRAW: 35044,
			DYNAMIC_DRAW: 35048,
			STREAM_DRAW: 35040,
			TRIANGLES: 4,
			FLOAT: 5126,
			UNSIGNED_INT: 5125,
			ELEMENT_ARRAY_BUFFER: 34963,
			BLEND: 3042,
			DEPTH_TEST: 2929,
			SCISSOR_TEST: 3089,
			COLOR_BUFFER_BIT: 16384,
			ZERO: 0,
			ONE: 1,
			SRC_ALPHA: 770,
			ONE_MINUS_SRC_ALPHA: 771,
			DST_COLOR: 774,
			ONE_MINUS_SRC_COLOR: 769,
			FUNC_ADD: 32774,
			MIN: 32775,
			MAX: 32776,
			VERTEX_SHADER: 35633,
			FRAGMENT_SHADER: 35632,
			COMPILE_STATUS: 35713,
			LINK_STATUS: 35714,
			TEXTURE_2D: 3553,
			TEXTURE0: 33984,
			TEXTURE_MIN_FILTER: 10241,
			TEXTURE_MAG_FILTER: 10240,
			TEXTURE_WRAP_S: 10242,
			TEXTURE_WRAP_T: 10243,
			LINEAR: 9729,
			NEAREST: 9728,
			CLAMP_TO_EDGE: 33071,
			REPEAT: 10497,
			RGBA: 6408,
			UNSIGNED_BYTE: 5121,
			UNPACK_PREMULTIPLY_ALPHA_WEBGL: 37441,
			UNPACK_FLIP_Y_WEBGL: 37440,
			FRAMEBUFFER: 36160,
			COLOR_ATTACHMENT0: 36064,
			FRAMEBUFFER_COMPLETE: 36053
		};
		//#endregion
		//#region vendor/dwp/packages/dwp-gl/src/blend.ts
		/**
		* 混合模式 → GL 状态（design-runtime.md §3.2，R2）。协议 §5.3：预乘 alpha 空间。
		* 6 个直接 GL（固定功能可达）+ 6 个 shader 合成（CSS separable/非分离混合，需 RT 后合成）。
		*/
		/** 固定功能可达的 6 个（预乘 alpha）。 */
		const DIRECT_BLEND = {
			normal: {
				sf: GL.ONE,
				df: GL.ONE_MINUS_SRC_ALPHA,
				equation: GL.FUNC_ADD
			},
			lighter: {
				sf: GL.ONE,
				df: GL.ONE,
				equation: GL.FUNC_ADD
			},
			multiply: {
				sf: GL.DST_COLOR,
				df: GL.ZERO,
				equation: GL.FUNC_ADD
			},
			screen: {
				sf: GL.ONE,
				df: GL.ONE_MINUS_SRC_COLOR,
				equation: GL.FUNC_ADD
			},
			darken: {
				sf: GL.ONE,
				df: GL.ONE,
				equation: GL.MIN
			},
			lighten: {
				sf: GL.ONE,
				df: GL.ONE,
				equation: GL.MAX
			}
		};
		/** 需 shader 合成的 6 个（CSS 非分离混合公式，见 shaders.ts compositeBlend）。 */
		const SHADER_BLEND = /* @__PURE__ */ new Set([
			"overlay",
			"color-dodge",
			"soft-light",
			"hard-light",
			"difference",
			"exclusion"
		]);
		function isDirectBlend(b) {
			return b in DIRECT_BLEND;
		}
		/** 应用某混合到 GL（调用方已 enable(BLEND)）。 */
		function applyBlend(gl, b) {
			const d = DIRECT_BLEND[b] ?? DIRECT_BLEND.normal;
			gl.blendFuncSeparate(d.sf, d.df, GL.ONE, GL.ONE_MINUS_SRC_ALPHA);
			gl.blendEquation(d.equation);
		}
		//#endregion
		//#region vendor/dwp/packages/dwp-gl/src/mat3.ts
		const m6ToMat3 = (m) => [
			m[0],
			m[1],
			0,
			m[2],
			m[3],
			0,
			m[4],
			m[5],
			1
		];
		/** 列主序 3×3 乘法 a·b。 */
		function m3Mul(a, b) {
			const r = new Array(9);
			for (let c = 0; c < 3; c++) for (let row = 0; row < 3; row++) r[c * 3 + row] = a[row] * b[c * 3] + a[3 + row] * b[c * 3 + 1] + a[6 + row] * b[c * 3 + 2];
			return r;
		}
		/** 设备像素（y 向下，0..W/0..H）→ 裁剪空间（y 向上，-1..1）。 */
		function clipFromDevice(wDev, hDev) {
			return [
				2 / wDev,
				0,
				0,
				0,
				-2 / hDev,
				0,
				-1,
				1,
				1
			];
		}
		/**
		* plan.view（CSS px → 设备 px，含 dpr + 相机平移）合成 clip 变换。
		* 返回 uView：CSS px → clip。
		*/
		function viewMatrix(planView, dpr, vw, vh) {
			return m3Mul(clipFromDevice(vw * dpr, vh * dpr), [
				planView[0],
				planView[1],
				0,
				planView[2],
				planView[3],
				0,
				planView[4],
				planView[5],
				1
			]);
		}
		//#endregion
		//#region vendor/dwp/packages/dwp-gl/src/program-cache.ts
		/**
		* 程序缓存（R2）：按名编译链接 GLSL 模板，缓存 program + uniform/attrib location。
		* 编译失败抛带 info log 的错误（demo/CI 定位用）。
		*/
		var ProgramCache = class {
			cache = /* @__PURE__ */ new Map();
			gl;
			constructor(gl) {
				this.gl = gl;
			}
			get(name, vs, fs) {
				let p = this.cache.get(name);
				if (!p) {
					p = this.compile(name, vs, fs);
					this.cache.set(name, p);
				}
				return p;
			}
			compile(name, vsSrc, fsSrc) {
				const gl = this.gl;
				const vs = this.shader(GL.VERTEX_SHADER, vsSrc, `${name}.vs`);
				const fs = this.shader(GL.FRAGMENT_SHADER, fsSrc, `${name}.fs`);
				const program = gl.createProgram();
				if (!program) throw new Error(`createProgram 失败: ${name}`);
				gl.attachShader(program, vs);
				gl.attachShader(program, fs);
				gl.linkProgram(program);
				if (!gl.getProgramParameter(program, GL.LINK_STATUS)) throw new Error(`链接失败 ${name}: ${gl.getProgramInfoLog(program)}`);
				gl.deleteShader(vs);
				gl.deleteShader(fs);
				return {
					program,
					uniforms: /* @__PURE__ */ new Map(),
					attribs: /* @__PURE__ */ new Map()
				};
			}
			shader(type, src, label) {
				const gl = this.gl;
				const s = gl.createShader(type);
				if (!s) throw new Error(`createShader 失败: ${label}`);
				gl.shaderSource(s, src);
				gl.compileShader(s);
				if (!gl.getShaderParameter(s, GL.COMPILE_STATUS)) throw new Error(`编译失败 ${label}: ${gl.getShaderInfoLog(s)}`);
				return s;
			}
			/** uniform location 惰性查询 + 缓存。 */
			u(p, name) {
				let loc = p.uniforms.get(name);
				if (loc === void 0) {
					loc = this.gl.getUniformLocation(p.program, name);
					p.uniforms.set(name, loc);
				}
				return loc;
			}
			a(p, name) {
				let loc = p.attribs.get(name);
				if (loc === void 0) {
					loc = this.gl.getAttribLocation(p.program, name);
					p.attribs.set(name, loc);
				}
				return loc;
			}
			get size() {
				return this.cache.size;
			}
		};
		//#endregion
		//#region vendor/dwp/packages/dwp-gl/src/shaders.ts
		/**
		* GLSL ES 3.0 模板（design-runtime.md §3.3，R2）——gl 侧只有这些固定模板，
		* 不解释第三方 shader（协议护栏）。core 侧展开表产出的 template 名与此一一对应。
		* 预乘 alpha 空间（协议 §5.3）。
		*/
		/** 全屏三角形 VS：所有 post pass 共用，输出 uv∈[0,1]。 */
		const FS_QUAD_VS = `#version 300 es
precision highp float;
out vec2 vUv;
void main(){
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;
		const QUAD_VS = `#version 300 es
precision highp float;
layout(location=0) in vec2 aPos;
layout(location=1) in vec2 aUv;
uniform mat3 uView;   // 视口px -> clip（含 dpr + 相机 scroll/shake）
uniform mat3 uMtx;    // 图层局部矩阵（anchor/fit/动画/骨骼）
out vec2 vUv;
void main(){ vec3 c = uView * uMtx * vec3(aPos, 1.0); gl_Position = vec4(c.xy, 0.0, c.z); vUv = aUv; }`;
		const QUAD_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform vec4 uTint;        // 预乘色（solid 用纯 tint，image 用 #ffffff 直通）
uniform float uAlpha;
uniform vec2 uUvOffset;    // scroll 动画的 UV 平移
out vec4 o;
void main(){
  vec4 c = texture(uTex, vUv + uUvOffset);
  o = vec4(c.rgb * uTint.rgb, c.a * uTint.a) * uAlpha;
}`;
		const PARTICLES_VS = `#version 300 es
precision highp float;
layout(location=0) in vec2 aCorner;   // 单位四边形 ±0.5
layout(location=1) in vec4 aA;        // x,y,rot,sizeW
layout(location=2) in vec4 aB;        // sizeH,alpha,life01,reserved
uniform mat3 uView;
out vec2 vUv;
out float vLife;
out float vAlpha;
void main(){
  float r = radians(aA.z);
  float cs = cos(r), sn = sin(r);
  vec2 local = vec2(aCorner.x * aA.w, aCorner.y * aB.x);
  vec2 rot = vec2(local.x * cs - local.y * sn, local.x * sn + local.y * cs);
  vec3 c = uView * vec3(rot.x + aA.x, rot.y + aA.y, 1.0);
  gl_Position = vec4(c.xy, 0.0, c.z);
  vUv = aCorner + 0.5;
  vLife = aB.z;
  vAlpha = aB.y;
}`;
		const PARTICLES_FS = `#version 300 es
precision highp float;
in vec2 vUv;
in float vLife;
in float vAlpha;
uniform sampler2D uTex;
uniform vec4 uColorA;
uniform vec4 uColorB;
out vec4 o;
void main(){
  vec4 t = texture(uTex, vUv);
  vec3 col = mix(uColorA.rgb, uColorB.rgb, vLife);
  o = vec4(t.rgb * col, t.a) * (vAlpha * uColorA.a);
}`;
		/** distort：waterwaves(mode0 正弦)/waterripple(mode1 径向)。 */
		const DISTORT_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uSrc;
uniform float uAmp;      // 视口px
uniform float uFreq;     // 角频率
uniform float uSpeed;
uniform float uT;
uniform float uMode;     // 0=waves 1=ripple
uniform vec2 uRes;
out vec4 o;
void main(){
  vec2 d = vUv - 0.5;
  float phase = uT * uSpeed;
  float off;
  if (uMode < 0.5) off = sin(vUv.y * uFreq * uRes.y + phase);
  else off = sin(length(d) * uFreq * uRes.y - phase);
  vec2 uv = vUv + vec2(off * uAmp / uRes.x, off * uAmp * 0.5 / uRes.y);
  o = texture(uSrc, clamp(uv, 0.0, 1.0));
}`;
		/** blurDown：2× downsample（4 tap 盒）。 */
		const BLUR_DOWN_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uSrc;
uniform vec2 uTexel;
out vec4 o;
void main(){
  vec4 s = texture(uSrc, vUv + uTexel * vec2(-1,-1)) + texture(uSrc, vUv + uTexel * vec2(1,-1))
         + texture(uSrc, vUv + uTexel * vec2(-1,1)) + texture(uSrc, vUv + uTexel * vec2(1,1));
  o = s * 0.25;
}`;
		/** 可分离高斯 X/Y（5 tap）。 */
		function gauss(axis) {
			return `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uSrc;
uniform vec2 uTexel;
uniform float uRadius;
out vec4 o;
void main(){
  vec2 d = uTexel * ${axis === "x" ? "vec2(1.0,0.0)" : "vec2(0.0,1.0)"} * uRadius;
  o = texture(uSrc, vUv) * 0.2270270270
    + (texture(uSrc, vUv + d) + texture(uSrc, vUv - d)) * 0.1945945946
    + (texture(uSrc, vUv + d * 2.0) + texture(uSrc, vUv - d * 2.0)) * 0.1216216216
    + (texture(uSrc, vUv + d * 3.0) + texture(uSrc, vUv - d * 3.0)) * 0.0540540541
    + (texture(uSrc, vUv + d * 4.0) + texture(uSrc, vUv - d * 4.0)) * 0.0162162162;
}`;
		}
		const BLUR_X_FS = gauss("x");
		const BLUR_Y_FS = gauss("y");
		/** blurCombine：半分辨率模糊结果上采样回全屏（双线性）。 */
		const BLUR_COMBINE_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uSrc;
out vec4 o;
void main(){ o = texture(uSrc, vUv); }`;
		/** chromatic：RGB 三通道径向色散。 */
		const CHROMATIC_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uSrc;
uniform float uStrength;
out vec4 o;
void main(){
  vec2 d = (vUv - 0.5) * uStrength;
  o = vec4(texture(uSrc, vUv + d).r, texture(uSrc, vUv).g, texture(uSrc, vUv - d).b, 1.0);
}`;
		/** overlay 族（kind 0=vignette 1=filmgrain 2=tint 3=pulse）。 */
		const OVERLAY_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uSrc;
uniform float uKind;
uniform float uIntensity;
uniform float uSpeed;
uniform float uT;
uniform float uMix;
uniform float uBrightness;
uniform vec4 uColor;
out vec4 o;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
void main(){
  vec4 c = texture(uSrc, vUv);
  if (uKind < 0.5) {
    vec2 q = (vUv - 0.5) * 2.0;
    float v = 1.0 - dot(q, q) * uIntensity;
    o = vec4(mix(uColor.rgb, c.rgb, clamp(v, 0.0, 1.0)) * mix(1.0, v, uColor.a), c.a);
  } else if (uKind < 1.5) {
    float g = hash(floor(vUv * 512.0) + floor(uT * uSpeed));
    o = vec4(c.rgb + (g - 0.5) * uIntensity, c.a);
  } else if (uKind < 2.5) {
    o = vec4(mix(c.rgb, uColor.rgb, uMix), c.a);
  } else {
    o = vec4(c.rgb * uBrightness, c.a);
  }
}`;
		/** compositeBlend：把已渲染到 RT 的图层（预乘）按 CSS 非分离混合合成到场景。 */
		const COMPOSITE_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uSrc;   // 图层（预乘）
uniform sampler2D uDst;   // 场景（预乘）
uniform int uMode;        // 0=overlay 1=color-dodge 2=soft-light 3=hard-light 4=difference 5=exclusion
out vec4 o;
vec3 blendOverlay(vec3 s, vec3 d){ return d <= 0.5 ? 2.0*s*d : 1.0 - 2.0*(1.0-s)*(1.0-d); }
vec3 blendDodge(vec3 s, vec3 d){ return min(d / max(1.0 - s, 1e-4), 1.0); }
vec3 blendHardLight(vec3 s, vec3 d){ return blendOverlay(d, s); }
vec3 blendSoftLight(vec3 s, vec3 d){
  return (1.0 - 2.0*s) * d + 2.0 * s * mix(sqrt(d)*abs(d-0.5)+0.5-d, ((16.0*d-12.0)*d+4.0)*d, step(0.25, d));
}
void main(){
  vec4 S = texture(uSrc, vUv);
  vec4 D = texture(uDst, vUv);
  vec3 s = S.rgb, d = D.rgb;
  vec3 cb;
  if (uMode == 0) cb = blendOverlay(s, d);
  else if (uMode == 1) cb = blendDodge(s, d);
  else if (uMode == 2) cb = blendSoftLight(s, d);
  else if (uMode == 3) cb = blendHardLight(s, d);
  else if (uMode == 4) cb = abs(d - s);
  else cb = d + s - 2.0 * d * s;   // exclusion
  // 预乘 alpha 合成：结果 = (1-ad)*src + (1-as)*dst + src*dst 混合
  vec3 outc = (1.0 - D.a) * s + (1.0 - S.a) * d + cb * S.a * D.a;
  o = vec4(outc, S.a + D.a * (1.0 - S.a));
}`;
		/** template 名 → 片元源（core 展开表用同名）。 */
		const PASS_FRAGMENTS = {
			distort: DISTORT_FS,
			blurDown: BLUR_DOWN_FS,
			blurX: BLUR_X_FS,
			blurY: BLUR_Y_FS,
			blurCombine: BLUR_COMBINE_FS,
			chromatic: CHROMATIC_FS,
			overlay: OVERLAY_FS
		};
		//#endregion
		//#region vendor/dwp/packages/dwp-gl/src/renderer.ts
		/**
		* WebGL2 执行器（R2）：RenderPlan → 绘制调用序列。
		* 依赖注入 GLContext + TextureProvider + TextProvider：浏览器喂真 context/DOM，
		* Node 测试喂 MockGL/桩——无 GPU 也能验证编排。
		*
		* 管线：图层渲入 scene RT（直接混合族内联；shader 合成族经 scratch+composite 折回 scene），
		* 再按 core 展开的 pass 链逐段渲染（target 名解析到 RT，'screen'=默认帧缓冲）。
		*/
		const UNIT_QUAD = new Float32Array([
			-.5,
			-.5,
			0,
			0,
			.5,
			-.5,
			1,
			0,
			.5,
			.5,
			1,
			1,
			-.5,
			-.5,
			0,
			0,
			.5,
			.5,
			1,
			1,
			-.5,
			.5,
			0,
			1
		]);
		const UNIT_CORNER = new Float32Array([
			-.5,
			-.5,
			.5,
			-.5,
			.5,
			.5,
			-.5,
			-.5,
			.5,
			.5,
			-.5,
			.5
		]);
		const FULL_UV = new Float32Array([
			0,
			0,
			1,
			0,
			1,
			1,
			0,
			1
		]);
		const TRI = [
			0,
			1,
			2,
			0,
			2,
			3
		];
		var Renderer = class {
			gl;
			progs;
			dpr;
			vp;
			textures;
			text;
			quadBuf;
			cornerBuf;
			partBuf;
			dynBuf;
			scratch = /* @__PURE__ */ new Float32Array(36);
			rts = /* @__PURE__ */ new Map();
			whiteTex;
			W;
			H;
			constructor(gl, opts) {
				this.gl = gl;
				this.dpr = opts.dpr ?? 1;
				this.vp = opts.viewport;
				this.textures = opts.textures;
				this.text = opts.text;
				this.W = Math.round(opts.viewport.w * this.dpr);
				this.H = Math.round(opts.viewport.h * this.dpr);
				this.progs = new ProgramCache(gl);
				const mkBuf = (data) => {
					const b = gl.createBuffer();
					gl.bindBuffer(GL.ARRAY_BUFFER, b);
					gl.bufferData(GL.ARRAY_BUFFER, data, GL.STATIC_DRAW);
					return b;
				};
				this.quadBuf = mkBuf(UNIT_QUAD);
				this.cornerBuf = mkBuf(UNIT_CORNER);
				this.partBuf = gl.createBuffer();
				this.dynBuf = gl.createBuffer();
				this.whiteTex = gl.createTexture();
				gl.bindTexture(GL.TEXTURE_2D, this.whiteTex);
				gl.texImage2D(GL.TEXTURE_2D, 0, GL.RGBA, 1, 1, 0, GL.RGBA, GL.UNSIGNED_BYTE, new Uint8Array([
					255,
					255,
					255,
					255
				]));
				gl.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_MIN_FILTER, GL.NEAREST);
				gl.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_MAG_FILTER, GL.NEAREST);
				gl.disable(GL.DEPTH_TEST);
				gl.enable(GL.BLEND);
				gl.pixelStorei(GL.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
			}
			/** 视口变化：更新尺寸并丢弃 RT（下次 render 按新尺寸重建）。 */
			resize(viewport, dpr = this.dpr) {
				this.vp = viewport;
				this.dpr = dpr;
				this.W = Math.round(viewport.w * dpr);
				this.H = Math.round(viewport.h * dpr);
				for (const rt of this.rts.values()) {
					this.gl.deleteTexture(rt.tex);
					if (rt.fbo) this.gl.deleteFramebuffer(rt.fbo);
				}
				this.rts.clear();
			}
			render(plan) {
				const gl = this.gl;
				const uView = viewMatrix(plan.view, this.dpr, this.vp.w, this.vp.h);
				const scene = this.rt("scene", this.W, this.H);
				gl.bindFramebuffer(GL.FRAMEBUFFER, scene.fbo);
				gl.viewport(0, 0, scene.w, scene.h);
				gl.clearColor(plan.clear[0] / 255, plan.clear[1] / 255, plan.clear[2] / 255, plan.clear[3] / 255);
				gl.clear(GL.COLOR_BUFFER_BIT);
				let wroteScreen = false;
				for (const step of plan.steps) switch (step.op) {
					case "quad":
						if (isDirectBlend(step.blend)) this.drawQuad(step, scene, uView);
						else this.drawQuadComposited(step, scene, uView);
						break;
					case "particles":
						this.drawParticles(step, scene, uView);
						break;
					case "text":
						if (this.text) this.drawText(step, scene, uView);
						break;
					case "pass": if (this.runPass(step, uView)) wroteScreen = true;
				}
				if (!wroteScreen) this.blit(scene.tex);
			}
			drawQuad(step, rt, uView, texOverride) {
				const gl = this.gl;
				const p = this.progs.get("quad", QUAD_VS, QUAD_FS);
				gl.useProgram(p.program);
				gl.bindFramebuffer(GL.FRAMEBUFFER, rt.fbo);
				gl.viewport(0, 0, rt.w, rt.h);
				applyBlend(gl, step.blend);
				const v = step.verts, uv = step.uv, s = this.scratch;
				for (let i = 0; i < 6; i++) {
					const c = TRI[i] * 2;
					s[i * 4] = v[c];
					s[i * 4 + 1] = v[c + 1];
					s[i * 4 + 2] = uv[c];
					s[i * 4 + 3] = uv[c + 1];
				}
				gl.bindBuffer(GL.ARRAY_BUFFER, this.dynBuf);
				gl.bufferData(GL.ARRAY_BUFFER, s, GL.DYNAMIC_DRAW);
				const aPos = this.progs.a(p, "aPos"), aUv = this.progs.a(p, "aUv");
				gl.enableVertexAttribArray(aPos);
				gl.vertexAttribPointer(aPos, 2, GL.FLOAT, false, 16, 0);
				gl.enableVertexAttribArray(aUv);
				gl.vertexAttribPointer(aUv, 2, GL.FLOAT, false, 16, 8);
				gl.uniformMatrix3fv(this.progs.u(p, "uView"), false, Float32Array.from(uView));
				gl.uniformMatrix3fv(this.progs.u(p, "uMtx"), false, Float32Array.from(m6ToMat3(step.matrix)));
				const tint = step.tint ?? [
					1,
					1,
					1,
					1
				];
				gl.uniform4f(this.progs.u(p, "uTint"), tint[0], tint[1], tint[2], tint[3]);
				gl.uniform1f(this.progs.u(p, "uAlpha"), step.alpha);
				const uo = step.uvOffset ?? [0, 0];
				gl.uniform2f(this.progs.u(p, "uUvOffset"), uo[0], uo[1]);
				gl.activeTexture(GL.TEXTURE0);
				gl.bindTexture(GL.TEXTURE_2D, texOverride ?? (step.tex === "@solid" ? this.whiteTex : this.textures.acquire(step.tex).tex));
				gl.uniform1i(this.progs.u(p, "uTex"), 0);
				gl.drawArrays(GL.TRIANGLES, 0, 6);
			}
			/** shader 合成混合：图层→scratch（透明底）→ composite(scratch,scene)→alt → 拷回 scene。 */
			drawQuadComposited(step, scene, uView) {
				const gl = this.gl;
				const scratch = this.rt("scratch", this.W, this.H);
				gl.bindFramebuffer(GL.FRAMEBUFFER, scratch.fbo);
				gl.viewport(0, 0, scratch.w, scratch.h);
				gl.clearColor(0, 0, 0, 0);
				gl.clear(GL.COLOR_BUFFER_BIT);
				this.drawQuad({
					...step,
					blend: "normal"
				}, scratch, uView);
				const alt = this.rt("compositeAlt", this.W, this.H);
				this.composite(scratch.tex, scene.tex, step.blend, alt);
				this.blitTo(alt.tex, scene);
			}
			composite(src, dst, blend, out) {
				const gl = this.gl;
				const p = this.progs.get("composite", FS_QUAD_VS, COMPOSITE_FS);
				gl.useProgram(p.program);
				gl.bindFramebuffer(GL.FRAMEBUFFER, out.fbo);
				gl.viewport(0, 0, out.w, out.h);
				gl.disable(GL.BLEND);
				const mode = [...SHADER_BLEND].indexOf(blend);
				gl.uniform1i(this.progs.u(p, "uMode"), Math.max(0, mode));
				gl.activeTexture(GL.TEXTURE0);
				gl.bindTexture(GL.TEXTURE_2D, src);
				gl.uniform1i(this.progs.u(p, "uSrc"), 0);
				gl.activeTexture(GL.TEXTURE0 + 1);
				gl.bindTexture(GL.TEXTURE_2D, dst);
				gl.uniform1i(this.progs.u(p, "uDst"), 1);
				gl.drawArrays(GL.TRIANGLES, 0, 3);
				gl.enable(GL.BLEND);
			}
			drawParticles(step, rt, uView) {
				if (step.count === 0) return;
				const gl = this.gl;
				const p = this.progs.get("particles", PARTICLES_VS, PARTICLES_FS);
				gl.useProgram(p.program);
				gl.bindFramebuffer(GL.FRAMEBUFFER, rt.fbo);
				gl.viewport(0, 0, rt.w, rt.h);
				applyBlend(gl, step.blend);
				gl.bindBuffer(GL.ARRAY_BUFFER, this.cornerBuf);
				const aC = this.progs.a(p, "aCorner");
				gl.enableVertexAttribArray(aC);
				gl.vertexAttribPointer(aC, 2, GL.FLOAT, false, 8, 0);
				gl.bindBuffer(GL.ARRAY_BUFFER, this.partBuf);
				gl.bufferData(GL.ARRAY_BUFFER, step.buffer, GL.STREAM_DRAW);
				const stride = step.stride * 4;
				const aA = this.progs.a(p, "aA"), aB = this.progs.a(p, "aB");
				gl.enableVertexAttribArray(aA);
				gl.vertexAttribPointer(aA, 4, GL.FLOAT, false, stride, 0);
				gl.enableVertexAttribArray(aB);
				gl.vertexAttribPointer(aB, 4, GL.FLOAT, false, stride, 16);
				gl.vertexAttribDivisor(aA, 1);
				gl.vertexAttribDivisor(aB, 1);
				gl.uniformMatrix3fv(this.progs.u(p, "uView"), false, Float32Array.from(uView));
				gl.uniform4f(this.progs.u(p, "uColorA"), ...rgba(step.colorA));
				gl.uniform4f(this.progs.u(p, "uColorB"), ...rgba(step.colorB));
				gl.activeTexture(GL.TEXTURE0);
				gl.bindTexture(GL.TEXTURE_2D, this.textures.acquire(step.tex).tex);
				gl.uniform1i(this.progs.u(p, "uTex"), 0);
				gl.drawArraysInstanced(GL.TRIANGLES, 0, 6, step.count);
				gl.vertexAttribDivisor(aA, 0);
				gl.vertexAttribDivisor(aB, 0);
			}
			drawText(step, rt, uView) {
				const { tex, w, h } = this.text.rasterize(step.run);
				const hw = w / 2, hh = h / 2;
				this.drawQuad({
					op: "quad",
					layer: step.layer,
					tex: "",
					verts: new Float32Array([
						-hw,
						-hh,
						hw,
						-hh,
						hw,
						hh,
						-hw,
						hh
					]),
					uv: FULL_UV,
					matrix: step.run.matrix,
					blend: step.blend,
					alpha: step.alpha,
					tint: step.run.color
				}, rt, uView, tex);
			}
			/** 返回是否写到了默认帧缓冲（target==='screen'）。 */
			runPass(step, _uView) {
				const gl = this.gl;
				const fs = PASS_FRAGMENTS[step.template];
				if (!fs) return false;
				const srcTex = this.texOf(step.inputs[0]);
				const toScreen = step.target === "screen";
				const out = toScreen ? this.screenRT() : this.rtFor(step.target);
				const p = this.progs.get(`pass:${step.template}`, FS_QUAD_VS, fs);
				gl.useProgram(p.program);
				gl.bindFramebuffer(GL.FRAMEBUFFER, out.fbo);
				gl.viewport(0, 0, out.w, out.h);
				gl.disable(GL.BLEND);
				gl.uniform2f(this.progs.u(p, "uRes"), out.w, out.h);
				gl.uniform2f(this.progs.u(p, "uTexel"), 1 / out.w, 1 / out.h);
				this.setPassUniforms(p, step);
				gl.activeTexture(GL.TEXTURE0);
				gl.bindTexture(GL.TEXTURE_2D, srcTex);
				gl.uniform1i(this.progs.u(p, "uSrc"), 0);
				gl.drawArrays(GL.TRIANGLES, 0, 3);
				gl.enable(GL.BLEND);
				return toScreen;
			}
			setPassUniforms(p, step) {
				const gl = this.gl;
				const pr = step.params;
				const f = (k) => typeof pr[k] === "number" ? pr[k] : void 0;
				const set = (name, v) => {
					if (v !== void 0) gl.uniform1f(this.progs.u(p, name), v);
				};
				set("uAmp", f("amp"));
				set("uFreq", f("freq"));
				set("uSpeed", f("speed"));
				set("uT", f("t"));
				set("uMode", f("mode"));
				set("uRadius", f("radius"));
				set("uStrength", f("strength"));
				set("uKind", f("kind"));
				set("uIntensity", f("intensity"));
				set("uMix", f("mix"));
				set("uBrightness", f("brightness"));
				if (Array.isArray(pr.color)) {
					const c = pr.color;
					gl.uniform4f(this.progs.u(p, "uColor"), c[0], c[1], c[2], c[3] ?? 1);
				}
			}
			texOf(target) {
				if (target === "scene") return this.rt("scene", this.W, this.H).tex;
				return this.rtFor(target).tex;
			}
			/** core target 名 → RT（rtHalf/rtHalfB 半分辨率，其余全分辨率）。 */
			rtFor(name) {
				const half = name === "rtHalf" || name === "rtHalfB";
				return this.rt(name, half ? Math.max(1, this.W >> 1) : this.W, half ? Math.max(1, this.H >> 1) : this.H);
			}
			screenRT() {
				return {
					tex: null,
					fbo: null,
					w: this.W,
					h: this.H
				};
			}
			rt(name, w, h) {
				let rt = this.rts.get(name);
				if (rt && rt.w === w && rt.h === h) return rt;
				const gl = this.gl;
				if (rt) {
					gl.deleteTexture(rt.tex);
					gl.deleteFramebuffer(rt.fbo);
				}
				const tex = gl.createTexture();
				gl.bindTexture(GL.TEXTURE_2D, tex);
				gl.texImage2D(GL.TEXTURE_2D, 0, GL.RGBA, w, h, 0, GL.RGBA, GL.UNSIGNED_BYTE, null);
				gl.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_MIN_FILTER, GL.LINEAR);
				gl.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_MAG_FILTER, GL.LINEAR);
				gl.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_WRAP_S, GL.CLAMP_TO_EDGE);
				gl.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_WRAP_T, GL.CLAMP_TO_EDGE);
				const fbo = gl.createFramebuffer();
				gl.bindFramebuffer(GL.FRAMEBUFFER, fbo);
				gl.framebufferTexture2D(GL.FRAMEBUFFER, GL.COLOR_ATTACHMENT0, GL.TEXTURE_2D, tex, 0);
				rt = {
					tex,
					fbo,
					w,
					h
				};
				this.rts.set(name, rt);
				return rt;
			}
			blit(tex) {
				this.blitTo(tex, this.screenRT());
			}
			blitTo(tex, out) {
				const gl = this.gl;
				const p = this.progs.get("copy", FS_QUAD_VS, PASS_FRAGMENTS.blurCombine);
				gl.useProgram(p.program);
				gl.bindFramebuffer(GL.FRAMEBUFFER, out.fbo);
				gl.viewport(0, 0, out.w, out.h);
				gl.disable(GL.BLEND);
				gl.activeTexture(GL.TEXTURE0);
				gl.bindTexture(GL.TEXTURE_2D, tex);
				gl.uniform1i(this.progs.u(p, "uSrc"), 0);
				gl.drawArrays(GL.TRIANGLES, 0, 3);
				gl.enable(GL.BLEND);
			}
			dispose() {
				const gl = this.gl;
				for (const rt of this.rts.values()) {
					gl.deleteTexture(rt.tex);
					if (rt.fbo) gl.deleteFramebuffer(rt.fbo);
				}
				this.rts.clear();
				gl.deleteTexture(this.whiteTex);
				gl.deleteBuffer(this.quadBuf);
				gl.deleteBuffer(this.cornerBuf);
				gl.deleteBuffer(this.partBuf);
				gl.deleteBuffer(this.dynBuf);
			}
		};
		/** #rrggbb[aa] 或 RGBA[0..1] → 0..1 四分量。 */
		function rgba(c) {
			if (Array.isArray(c)) return [
				c[0],
				c[1],
				c[2],
				c[3] ?? 1
			];
			const hex = c.replace("#", "");
			const n = (i) => parseInt(hex.slice(i, i + 2), 16) / 255;
			return [
				n(0),
				n(2),
				n(4),
				hex.length >= 8 ? n(6) : 1
			];
		}
		//#endregion
		//#region vendor/dwp/packages/dwp-gl/src/browser.ts
		/**
		* 浏览器侧真实 Provider（R2 落地）：把 DOM 资源喂进执行器。
		* 仅在浏览器运行（依赖 document/Image/HTMLVideoElement/OffscreenCanvas）；
		* Node 测试用桩替代，故本文件不进测试网。
		*/
		/** 图片/视频纹理解码 + 上传缓存。key = 资源路径。 */
		var DomTextureProvider = class {
			gl;
			map = /* @__PURE__ */ new Map();
			/** 宿主预加载：图片解码完 / 视频首帧就绪后调用，把源登记进来。 */
			sources = /* @__PURE__ */ new Map();
			constructor(gl) {
				this.gl = gl;
			}
			registerImage(id, img) {
				this.sources.set(id, img);
			}
			registerVideo(id, video) {
				this.sources.set(id, video);
			}
			registerCanvas(id, canvas) {
				this.sources.set(id, canvas);
			}
			/** 通用登记（mount 用 createImageBitmap 解码后喂入）。 */
			register(id, src) {
				this.sources.set(id, src);
			}
			acquire(id) {
				const hit = this.map.get(id);
				if (hit) {
					const src = this.sources.get(id);
					if (src && isVideo(src)) this.upload(hit, src);
					return hit;
				}
				const src = this.sources.get(id);
				if (!src) throw new Error(`纹理未预加载: ${id}`);
				const gl = this.gl;
				const tex = gl.createTexture();
				const rec = {
					tex,
					w: srcWidth(src),
					h: srcHeight(src)
				};
				gl.bindTexture(GL.TEXTURE_2D, tex);
				gl.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_MIN_FILTER, GL.LINEAR);
				gl.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_MAG_FILTER, GL.LINEAR);
				gl.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_WRAP_S, GL.CLAMP_TO_EDGE);
				gl.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_WRAP_T, GL.CLAMP_TO_EDGE);
				this.upload(rec, src);
				this.map.set(id, rec);
				return rec;
			}
			upload(rec, src) {
				const gl = this.gl;
				gl.bindTexture(GL.TEXTURE_2D, rec.tex);
				gl.texImage2D(GL.TEXTURE_2D, 0, GL.RGBA, GL.RGBA, GL.UNSIGNED_BYTE, src);
				rec.w = srcWidth(src);
				rec.h = srcHeight(src);
			}
			release(id) {
				const rec = this.map.get(id);
				if (rec) {
					this.gl.deleteTexture(rec.tex);
					this.map.delete(id);
				}
			}
			dispose() {
				for (const id of [...this.map.keys()]) this.release(id);
			}
		};
		const isVideo = (s) => "readyState" in s && "videoWidth" in s;
		const srcWidth = (s) => isVideo(s) ? s.videoWidth : s.width;
		const srcHeight = (s) => isVideo(s) ? s.videoHeight : s.height;
		/**
		* 文本光栅化（design-runtime.md §3.2）：离屏 Canvas2D 画整段 run（非逐字），
		* LRU 32 条缓存。字体缺失回退 sans-serif（Canvas 自动回退，上报交宿主）。
		*/
		var CanvasTextProvider = class {
			gl;
			cache = /* @__PURE__ */ new Map();
			order = [];
			limit;
			canvas;
			onFontFallback;
			constructor(gl, opts = {}) {
				this.gl = gl;
				this.limit = opts.maxCache ?? 32;
				this.canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(1, 1) : document.createElement("canvas");
			}
			rasterize(run) {
				const key = `${run.text}|${run.font}|${run.sizePx}|${run.color.join(",")}|${run.align}`;
				const hit = this.cache.get(key);
				if (hit) {
					this.touch(key);
					return hit;
				}
				const ctx = this.canvas.getContext("2d") ?? this.canvas.getContext("2d");
				if (!ctx) throw new Error("无法获取 2D 上下文");
				ctx.font = run.font;
				const metrics = ctx.measureText(run.text);
				const w = Math.ceil(metrics.width) + 4;
				const h = Math.ceil(run.sizePx * 1.4);
				this.canvas.width = w;
				this.canvas.height = h;
				ctx.clearRect(0, 0, w, h);
				ctx.font = run.font;
				ctx.textBaseline = "middle";
				ctx.textAlign = run.align;
				const [r, g, b, a] = run.color;
				ctx.fillStyle = `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${a})`;
				const x = run.align === "center" ? w / 2 : run.align === "right" ? w - 2 : 2;
				ctx.fillText(run.text, x, h / 2);
				const gl = this.gl;
				const tex = gl.createTexture();
				gl.bindTexture(GL.TEXTURE_2D, tex);
				gl.pixelStorei(GL.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
				gl.texImage2D(GL.TEXTURE_2D, 0, GL.RGBA, GL.RGBA, GL.UNSIGNED_BYTE, this.canvas);
				gl.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_MIN_FILTER, GL.LINEAR);
				gl.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_MAG_FILTER, GL.LINEAR);
				gl.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_WRAP_S, GL.CLAMP_TO_EDGE);
				gl.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_WRAP_T, GL.CLAMP_TO_EDGE);
				const rec = {
					tex,
					w,
					h
				};
				this.cache.set(key, rec);
				this.touch(key);
				this.evict();
				return rec;
			}
			touch(key) {
				this.order = this.order.filter((k) => k !== key);
				this.order.push(key);
			}
			evict() {
				while (this.order.length > this.limit) {
					const old = this.order.shift();
					const rec = this.cache.get(old);
					if (rec) {
						this.gl.deleteTexture(rec.tex);
						this.cache.delete(old);
					}
				}
			}
		};
		//#endregion
		//#region vendor/dwp/packages/dwp-web/src/assets.ts
		/** 收集场景引用的资源路径（image/video 用 src，particle 用 texture 作 stamp）。 */
		function collectAssetRefs(scene) {
			const seen = /* @__PURE__ */ new Map();
			for (const l of scene.layers ?? []) if (l.type === "image") add(seen, l.src, "image");
			else if (l.type === "video") add(seen, l.src, "video");
			else if (l.type === "particle") add(seen, l.texture, "image");
			else if (l.type === "mesh") for (const p of l.parts ?? []) add(seen, p.texture, "image");
			return [...seen.values()];
		}
		function add(m, path, kind) {
			if (path && path !== "@solid" && !m.has(path)) m.set(path, {
				path,
				kind
			});
		}
		async function loadAssets(scene, opts = {}) {
			const refs = collectAssetRefs(scene);
			const sizes = {};
			const bitmaps = /* @__PURE__ */ new Map();
			const videos = /* @__PURE__ */ new Map();
			const blobOf = async (path) => {
				const hit = opts.files?.get(path) ?? opts.files?.get(normalize(path));
				if (hit) return hit instanceof Blob ? hit : new Blob([hit]);
				if (opts.baseUrl) {
					const res = await fetch(new URL(path, opts.baseUrl).href);
					if (!res.ok) throw new Error(`资源拉取失败 ${path}: ${res.status}`);
					return await res.blob();
				}
				throw new Error(`包内缺资源且无 baseUrl: ${path}`);
			};
			await Promise.all(refs.map(async (ref) => {
				const blob = await blobOf(ref.path);
				if (ref.kind === "image") {
					const bmp = await createImageBitmap(blob);
					bitmaps.set(ref.path, bmp);
					sizes[ref.path] = {
						w: bmp.width,
						h: bmp.height
					};
				} else {
					const url = URL.createObjectURL(blob);
					const v = document.createElement("video");
					v.src = url;
					v.loop = true;
					v.muted = true;
					v.playsInline = true;
					v.preload = "auto";
					await new Promise((res) => {
						v.onloadedmetadata = () => res();
						v.onerror = () => res();
					});
					videos.set(ref.path, v);
					sizes[ref.path] = {
						w: v.videoWidth || 0,
						h: v.videoHeight || 0
					};
				}
			}));
			return {
				sizes,
				registerInto(tex) {
					for (const [id, bmp] of bitmaps) tex.register(id, bmp);
					for (const [id, v] of videos) tex.registerVideo(id, v);
				},
				imageSource(id) {
					return bitmaps.get(id) ?? videos.get(id) ?? null;
				},
				playVideos() {
					for (const v of videos.values()) v.play().catch(() => {});
				},
				pauseVideos() {
					for (const v of videos.values()) v.pause();
				},
				dispose() {
					for (const b of bitmaps.values()) b.close?.();
					for (const [id, v] of videos) {
						v.pause();
						v.src = "";
						const u = v.currentSrc;
						if (u?.startsWith("blob:")) URL.revokeObjectURL(u);
					}
				}
			};
		}
		const normalize = (p) => p.replace(/^\.\//, "").replace(/^\/+/, "");
		//#endregion
		//#region vendor/dwp/packages/dwp-web/src/mount.ts
		/**
		* mount / Handle（design-runtime.md §4，R3）：把 core + gl/canvas2d + 资源 + 时钟
		* 组装成一个可挂载到 <canvas> 的壁纸实例。web 层唯一读墙钟处。
		*
		* 执行器选择：canvas.getContext('webgl2') 成功 → GL 路径；否则 → Canvas2D 降级
		* （消费同一 RenderPlan，post pass 记 degraded）。两者输入完全一致 → 布局/动画同源。
		* 浏览器专用，不进 Node 测试网（依赖 DOM/RAF/createImageBitmap）。
		*/
		async function mount(canvas, opts) {
			let doc = compile(opts.manifest, opts.scene);
			if (opts.params) for (const [k, v] of Object.entries(opts.params)) doc = setParam(doc, k, v);
			const assets = await loadAssets(opts.scene, {
				files: opts.files,
				baseUrl: opts.baseUrl
			});
			const dpr = opts.dpr ?? Math.min(window.devicePixelRatio || 1, 2);
			const sim = createSim(doc, opts.seed ?? 0);
			const pool = createPool();
			const clock = createClock({ playing: opts.autoplay ?? true });
			const gl = opts.forceCanvas2D ? null : canvas.getContext("webgl2", {
				alpha: false,
				antialias: true,
				premultipliedAlpha: true
			});
			let executor;
			let mode;
			if (gl) {
				mode = "gl";
				const textures = new DomTextureProvider(gl);
				assets.registerInto(textures);
				const text = new CanvasTextProvider(gl);
				const renderer = new Renderer(gl, {
					dpr,
					viewport: {
						w: canvas.clientWidth,
						h: canvas.clientHeight
					},
					textures,
					text
				});
				executor = {
					render: (plan) => {
						renderer.render(plan);
						return [];
					},
					resize: (w, h, d) => renderer.resize({
						w,
						h
					}, d),
					dispose: () => {
						renderer.dispose();
						textures.dispose();
					}
				};
				assets.playVideos();
			} else {
				mode = "canvas2d";
				const ctx = canvas.getContext("2d");
				if (!ctx) throw new Error("无法获取 WebGL2 或 2D 上下文");
				const renderer = new Canvas2DRenderer(ctx, {
					dpr,
					viewport: {
						w: canvas.clientWidth,
						h: canvas.clientHeight
					},
					image: (id) => assets.imageSource(id)
				});
				executor = {
					render: (plan) => renderer.render(plan).degraded,
					resize: (w, h, d) => {
						canvas.width = w * d;
						canvas.height = h * d;
					},
					dispose: () => {}
				};
				assets.playVideos();
			}
			let raf = 0;
			let last = performance.now();
			let vw = canvas.clientWidth, vh = canvas.clientHeight;
			let lastDegradedKey = "";
			let frames = 0, fpsAt = performance.now(), fps = 0;
			let frameErrors = 0;
			let glFallbackDone = false;
			function frameInput(t) {
				return {
					t,
					viewport: {
						w: vw,
						h: vh
					},
					dpr,
					timeContext: nowContext(),
					assetSizes: assets.sizes
				};
			}
			function drawFrame(t) {
				if (canvas.width !== vw * dpr || canvas.height !== vh * dpr) {
					canvas.width = vw * dpr;
					canvas.height = vh * dpr;
					executor.resize(vw, vh, dpr);
				}
				const plan = evaluate(doc, frameInput(t), sim, pool);
				const degraded = [...plan.unsupported.map((u) => `${u.id}:${u.reason}`), ...executor.render(plan)];
				const key = degraded.join("|");
				if (key !== lastDegradedKey) {
					lastDegradedKey = key;
					opts.onDegrade?.(degraded);
				}
			}
			/** 运行期 GL 异常 → 一次性降级 Canvas2D：同一 canvas 的 context mode 固定（webgl2 后
			*  getContext('2d') 返回 null），故换一个新 canvas 元素原位替换（样式/属性复制），
			*  用同一 RenderPlan 继续渲染。降级失败抛错由调用方兜底。 */
			function swapToCanvas2D(err) {
				const oldCanvas = canvas;
				const fresh = document.createElement("canvas");
				const style = oldCanvas.getAttribute("style") ?? "";
				if (style !== "") fresh.setAttribute("style", style);
				for (let i = 0; i < oldCanvas.attributes.length; i++) {
					const a = oldCanvas.attributes[i];
					if (a.name === "style") continue;
					fresh.setAttribute(a.name, a.value);
				}
				executor.dispose();
				oldCanvas.replaceWith(fresh);
				const ctx = fresh.getContext("2d");
				if (!ctx) throw new Error("无法获取 2D 上下文");
				canvas = fresh;
				vw = fresh.clientWidth || oldCanvas.clientWidth || 0;
				vh = fresh.clientHeight || oldCanvas.clientHeight || 0;
				const renderer = new Canvas2DRenderer(ctx, {
					dpr,
					viewport: {
						w: vw,
						h: vh
					},
					image: (id) => assets.imageSource(id)
				});
				executor = {
					render: (plan) => renderer.render(plan).degraded,
					resize: (w, h, d) => {
						fresh.width = w * d;
						fresh.height = h * d;
					},
					dispose: () => {}
				};
				mode = "canvas2d";
				console.warn("[dwp] GL 渲染异常，已降级 Canvas2D：", err);
				opts.onDegrade?.(["gl-fallback-canvas2d:" + (err?.message ?? String(err))]);
			}
			function loop(now) {
				const dt = (now - last) / 1e3;
				last = now;
				vw = canvas.clientWidth;
				vh = canvas.clientHeight;
				const t = advance(clock, dt);
				try {
					drawFrame(t);
					frameErrors = 0;
				} catch (e) {
					frameErrors++;
					if (mode === "gl" && !glFallbackDone) {
						glFallbackDone = true;
						try {
							swapToCanvas2D(e);
							frameErrors = 0;
						} catch (fe) {
							console.error("[dwp] Canvas2D 降级失败：", fe);
						}
					}
					if (frameErrors === 1 || frameErrors % 300 === 0) {
						console.error("[dwp] 渲染帧错误（跳过该帧，循环继续）：", e);
						opts.onDegrade?.(["frame-error:" + (e?.message ?? String(e))]);
					}
				}
				frames++;
				if (now - fpsAt >= 500) {
					fps = frames * 1e3 / (now - fpsAt);
					frames = 0;
					fpsAt = now;
				}
				opts.onFrame?.({
					t,
					fps,
					mode
				});
				raf = requestAnimationFrame(loop);
			}
			if (opts.autoplay ?? true) raf = requestAnimationFrame(loop);
			else drawFrame(clock.t);
			return {
				get mode() {
					return mode;
				},
				play() {
					play(clock);
					assets.playVideos();
					if (!raf) {
						last = performance.now();
						raf = requestAnimationFrame(loop);
					}
				},
				pause() {
					pause(clock);
					assets.pauseVideos();
					if (raf) {
						cancelAnimationFrame(raf);
						raf = 0;
					}
				},
				seek(t) {
					seek(clock, t);
					drawFrame(clock.t);
				},
				setParam(key, value) {
					doc = setParam(doc, key, value);
					drawFrame(clock.t);
				},
				setParams(map) {
					let changed = false;
					const cur = doc.overrides ?? {};
					for (const [k, v] of Object.entries(map)) {
						if (cur[k] === v) continue;
						doc = setParam(doc, k, v);
						changed = true;
					}
					if (changed) drawFrame(clock.t);
				},
				resize() {
					vw = canvas.clientWidth;
					vh = canvas.clientHeight;
					drawFrame(clock.t);
				},
				async snapshotAt(t) {
					const wasRaf = raf;
					if (raf) {
						cancelAnimationFrame(raf);
						raf = 0;
					}
					drawFrame(t);
					const blob = await new Promise((res, rej) => canvas.toBlob((b) => b ? res(b) : rej(/* @__PURE__ */ new Error("toBlob 失败")), "image/png"));
					if (wasRaf) raf = requestAnimationFrame(loop);
					return blob;
				},
				dispose() {
					if (raf) cancelAnimationFrame(raf);
					executor.dispose();
					assets.dispose();
				}
			};
		}
		/** 墙钟 → TimeContext（web 层特权；core 不读时间）。 */
		function nowContext() {
			const d = /* @__PURE__ */ new Date();
			const weekday = [
				"Sun",
				"Mon",
				"Tue",
				"Wed",
				"Thu",
				"Fri",
				"Sat"
			][d.getDay()];
			return {
				year: d.getFullYear(),
				month: d.getMonth() + 1,
				day: d.getDate(),
				hour: d.getHours(),
				minute: d.getMinutes(),
				second: d.getSeconds(),
				weekday
			};
		}
		/** 1×1 RGBA、全透明、filter 0 的合法 PNG 字节。 */
		const TINY_PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII="), (c) => c.charCodeAt(0));
		//#endregion
		//#region src/client/dwp-stage.ts
		/**
		* DWP 渲染面（R4 client 半）：从 node 半伺服端点拉 scene + 资源，组装 PackageFiles，
		* 调 @dwp/web 的 mount() 把已装 .dwp 画到给定 <canvas>。
		* 浏览器专用（依赖 DOM/canvas/createImageBitmap），不进 Node 测试网；
		* 逻辑与 demo（dwp-runtime-web/demo）同源，复用同一 mount() → 像素一致。
		*/
		/**
		* 低档位用 1×1 全透明 PNG 顶替高档资源（字节见 tiny-png.ts，带回归测试）。
		* 为什么是"顶替"而不是"不传"：@dwp/web 的 loadAssets 对缺失资源直接抛错（整次挂载失败），
		* 所以必须给一个合法但极小的位图；这些图层在低档位 alpha 恒 0，画面上完全看不出来。
		*/
		/** 读取 scene 顶层的插件扩展字段 dsh.hdAssets（未知键 core 会忽略，这里防御式读取）。 */
		function hdAssetsOf(scene) {
			const list = scene.dsh?.hdAssets;
			return Array.isArray(list) ? list.filter((p) => typeof p === "string") : [];
		}
		/** 拉取并挂载一个已装 DWP 到 canvas，返回可播放/截图/销毁的 Handle。 */
		async function mountDwp(canvas, id, opts = {}) {
			const fetchFn = opts.fetchFn ?? ((u, i) => fetch(u, i));
			const base = opts.base ?? "/we-sync/dwp";
			const sceneRes = await fetchFn(`${base}/scene?id=${encodeURIComponent(id)}`, { cache: "no-store" });
			if (!sceneRes.ok) throw new Error(`DWP scene 拉取失败 (${sceneRes.status})`);
			const scene = await sceneRes.json();
			let manifest;
			try {
				const mres = await fetchFn(`${base}/manifest?id=${encodeURIComponent(id)}`, { cache: "no-store" });
				if (mres.ok) manifest = await mres.json();
			} catch {}
			const stub = new Set(opts.quality === "hd" ? [] : hdAssetsOf(scene));
			const vq = manifest?.version !== void 0 && manifest.version !== "" ? "&v=" + encodeURIComponent(manifest.version) : "";
			const files = /* @__PURE__ */ new Map();
			for (const ref of collectAssetRefs(scene)) {
				if (stub.has(ref.path)) {
					files.set(ref.path, new Blob([TINY_PNG], { type: "image/png" }));
					continue;
				}
				const r = await fetchFn(`${base}/file?id=${encodeURIComponent(id)}&name=${encodeURIComponent(ref.path)}${vq}`);
				if (r.ok) files.set(ref.path, await r.blob());
			}
			return mount(canvas, {
				scene,
				manifest,
				files,
				params: opts.params,
				autoplay: opts.autoplay,
				forceCanvas2D: opts.forceCanvas2D,
				onDegrade: opts.onDegrade
			});
		}
		//#endregion
		//#region src/client/dwp-background.ts
		/**
		* DWP 全局背景层（R4 真实渲染）：一个 fixed 全屏 canvas，用 mountDwp() 把已装 DWP 画成
		* DSH 背景。与 WE 的 scene/video/iframe 层互斥（由 index.ts 的 applyBackground 保证只有一类在跑）。
		* 本模块只管"这一层"的画布生命周期 + 视觉（模糊/缩放），不碰 store，避免与 index.ts 循环引用。
		*/
		var DwpBackgroundLayer = class {
			canvas = null;
			handle = null;
			mountingId = "";
			mountedId = "";
			/**
			* 最新实时变量（按键累积）。不同来源互不覆盖（时钟 vs 工作区脉搏），
			* 每次挂载成功后整表重放一次 —— 于是"切到另一张壁纸""切档位重新挂载"都能立刻拿到当前
			* 时间/档位，而不是干等下一次变量变化（夜间切入日夜壁纸却一直显示白天就是这么来的）。
			*/
			liveVars = {};
			/**
			* 挂载序号：每次 mount/unmount 自增，异步结果只有在序号仍是最新时才允许接管状态。
			* 只比 id 是不够的 —— 同一张壁纸切画质时新旧请求的 id 相同，旧（低清）结果可能后到达并覆盖新的。
			*/
			seq = 0;
			/** 纹理档位：'hd' = 允许拉场景声明的高档纹理，'sd' = 高档资源用占位图顶替（见 dwp-stage.ts） */
			quality = "sd";
			/** 当前正在挂载或已挂载的 DWP id（'' = 无）。 */
			currentId() {
				return this.mountedId !== "" ? this.mountedId : this.mountingId;
			}
			/**
			* 切换纹理档位（渲染模式「增强/完整」→ hd，「预览/捕获」→ sd）。
			* 档位变了必须**重新挂载**：资源集合在 mount 时就定好了（低档位根本没拉 8K 纹理），
			* 光改变量换不出另一档的图。已挂载时这里先卸载再按新档位挂回去。
			*/
			setQuality(q) {
				if (q === this.quality) return;
				this.quality = q;
				const id = this.currentId();
				if (id === "") return;
				this.unmount();
				this.mount(id);
			}
			/** 当前 DOM 中的舞台 canvas（mount 内部 GL→Canvas2D 降级会换新元素，按 data-dwp-stage 定位）。 */
			liveCanvas() {
				return document.querySelector("canvas[data-dwp-stage=\"1\"]");
			}
			ensureCanvas() {
				const live = this.liveCanvas();
				if (live !== null) {
					this.canvas = live;
					return live;
				}
				if (this.canvas === null) {
					const c = document.createElement("canvas");
					c.style.position = "fixed";
					c.style.top = "0";
					c.style.left = "0";
					c.style.width = "100%";
					c.style.height = "100%";
					c.style.zIndex = "-2";
					c.style.pointerEvents = "none";
					c.dataset.dwpStage = "1";
					this.canvas = c;
				}
				if (this.canvas.parentNode === null) document.body.appendChild(this.canvas);
				return this.canvas;
			}
			/** 挂载指定 DWP 为背景。同 id 幂等（除非 force）；换 id / 换档位先销毁旧的。异步（拉 scene+资源）。 */
			async mount(id, opts) {
				if (opts?.force !== true && (this.mountingId === id || this.mountedId === id)) return;
				this.disposeHandle();
				const mySeq = ++this.seq;
				this.mountingId = id;
				const canvas = this.ensureCanvas();
				try {
					const handle = await mountDwp(canvas, id, {
						quality: this.quality,
						onDegrade: (d) => {
							if (d.length) console.warn("[dwp] 降级/告警：", d.join(", "));
						}
					});
					if (mySeq !== this.seq) {
						handle.dispose();
						return;
					}
					this.handle = handle;
					this.mountedId = id;
					this.mountingId = "";
					if (Object.keys(this.liveVars).length > 0) handle.setParams(this.liveVars);
				} catch (e) {
					if (mySeq === this.seq) this.mountingId = "";
					throw e;
				}
			}
			/** 套用与 WE 层一致的视觉（模糊 + 轻微放大，避免模糊边缘露底）。 */
			applyVisuals(blurPx, scale) {
				const c = this.liveCanvas() ?? this.canvas;
				if (c === null) return;
				c.style.filter = blurPx > 0 ? "blur(" + blurPx + "px)" : "none";
				c.style.transform = "scale(" + scale.toFixed(3) + ")";
			}
			/**
			* 实时变量喂食（时钟、工作区脉搏等）。
			* 挂载中/未挂载时先累加到 liveVars（**按键合并**，不同来源互不覆盖），
			* 已挂载则把本次的键立即推给运行时（Handle.setParams 本身也是逐键覆写）。
			*/
			setLiveVars(map) {
				this.liveVars = {
					...this.liveVars,
					...map
				};
				if (this.handle === null) return;
				this.handle.setParams(map);
			}
			/** 当前累积的实时变量（测试/诊断用）。 */
			currentVars() {
				return { ...this.liveVars };
			}
			disposeHandle() {
				if (this.handle !== null) {
					this.handle.dispose();
					this.handle = null;
				}
				this.mountedId = "";
				this.mountingId = "";
			}
			/** 卸载：停渲染 + 移除画布。序号自增 → 任何在途挂载的结果都会被丢弃。 */
			unmount() {
				this.seq++;
				this.disposeHandle();
				const c = this.liveCanvas() ?? this.canvas;
				if (c !== null) c.remove();
				this.canvas = null;
			}
		};
		const GREEN = "#3fb950";
		const RED = "#f85149";
		/** 字节 → 人类可读（1 位小数，去尾零交给 toFixed 的选择） */
		function formatBytes(n) {
			const abs = Math.abs(n);
			if (abs >= 1048576) return (n / 1048576).toFixed(abs >= 10485760 ? 0 : 1) + " MB";
			if (abs >= 1024) return (n / 1024).toFixed(abs >= 10240 ? 0 : 1) + " KB";
			return String(n) + " B";
		}
		/** 文件名过长时保留尾部（扩展名比开头更重要） */
		function truncateName(name, max = 18) {
			if (name.length <= max) return name;
			return "…" + name.slice(name.length - (max - 1));
		}
		/** changes → $var 表（槽位 1..3；不足的槽位 on=0 隐藏） */
		function pulseVars(changes) {
			const vars = {
				ws_count: changes.length,
				idle_on: changes.length > 0 ? 0 : 1
			};
			for (let i = 0; i < 3; i++) {
				const c = changes[i];
				vars[`b${i + 1}_on`] = c !== void 0 ? 1 : 0;
				if (c === void 0) continue;
				const plus = c.sign === "+";
				const mag = Math.abs(c.delta) || c.size;
				vars[`b${i + 1}_name`] = truncateName(c.name);
				vars[`b${i + 1}_glyph`] = plus ? "+" : "−";
				vars[`b${i + 1}_badge`] = plus ? GREEN : RED;
				vars[`b${i + 1}_size`] = (plus ? "+" : "−") + formatBytes(mag);
			}
			return vars;
		}
		const DAY_MINUTES = 1440;
		/** 一天中的分钟数（0..1439.99…，带秒的小数）→ 夜间透明度 0..1。 */
		function nightAlpha(minutesOfDay) {
			const m = (minutesOfDay % DAY_MINUTES + DAY_MINUTES) % DAY_MINUTES;
			const start = 1080;
			const nightLen = 720 % DAY_MINUTES;
			const rel = (m - start + DAY_MINUTES) % DAY_MINUTES;
			const clamp01 = (x) => x < 0 ? 0 : x > 1 ? 1 : x;
			if (rel <= 10) return clamp01(rel / 10);
			if (rel >= 710 && rel <= nightLen) return clamp01((nightLen - rel) / 10);
			return rel < nightLen ? 1 : 0;
		}
		/** 当前时间（+ 纹理档位）→ 变量表（值域收敛到 4 位小数，避免每次轮询都产生"变化"）。 */
		function clockVars(now, opts = {}) {
			const hd = opts.hd === true;
			const minutes = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
			const alpha = Number(nightAlpha(minutes).toFixed(4));
			return {
				hour: now.getHours(),
				night_alpha: alpha,
				night_on: alpha >= .9999 ? 1 : 0,
				day_on: alpha <= 1e-4 ? 1 : 0,
				hd_on: hd ? 1 : 0,
				night_sd: hd ? 0 : alpha,
				night_hd: hd ? alpha : 0
			};
		}
		/** 去重签名：值没变就不喂（避免无谓重绘）。 */
		function clockSig(vars) {
			return Object.keys(vars).sort().map((k) => k + "=" + String(vars[k])).join(",");
		}
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
		/** 插件版本：构建期由 tsdown 的 define 从 package.json 注入（未注入的裸跑为 'dev'）。 */
		const PLUGIN_VERSION = "26.9.11-T";
		/** 插件 GitHub 仓库主页（版本号角标点击跳转）。 */
		const PLUGIN_REPO_URL = "https://github.com/YRN-playmaker/dsh-wallpaper_share";
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
		/** 出厂默认值：无存档、存档损坏或字段越界时的回退基线。 */
		const DEFAULT_SETTINGS = {
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
			approvalPending: false,
			dwpMounted: null
		};
		/** 包内单例 store：apply 循环更新，面板组件订阅渲染。 */
		const store = {
			info: null,
			/** DSH locale 服务同步下来的界面语言（'zh' | 'en'）；null = locale 服务不可用，面板走 DOM 兜底探测。
			*  模块级持久：conversation.view 是 session 作用域插槽，切会话/轨迹会重挂载面板，
			*  重挂载时直接读这里而不是重新探测，语言才不会"弹回英语"。 */
			locale: null,
			/** 用户偏好（同步开关 / 渲染模式 / 显示器锁 / 透明度·模糊·阴影 / 专注·眼动）经 localStorage 持久化：
			*  写即存，刷新或重启 DSH 后自动恢复。实现见 settings.ts —— 包一层 Proxy，所有
			*  `store.settings.x = v` 的既有赋值点无需改动即自动落盘；派生态（taskActive /
			*  approvalPending）与临时视图态（immersive）不在落盘白名单内。 */
			settings: createPersistentSettings(DEFAULT_SETTINGS),
			listeners: /* @__PURE__ */ new Set(),
			actions: {
				applyTheme: () => {},
				applyBackground: () => {},
				applyImmersive: () => {},
				repoll: () => {},
				mountDwp: async (_id) => false,
				unmountDwp: async () => {}
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
			const sessionsNow = () => ctx.get("sessions");
			/** 0.1.2 起 startSession 在 uiWorkspace 上；workspaces 上的同名方法已移除，留作老宿主兜底。 */
			const workspaceNav = () => ctx.get("uiWorkspace") ?? ctx.get("workspaces");
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
			const dwpBg = new DwpBackgroundLayer();
			function stopDwp() {
				dwpBg.unmount();
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
				immersiveStyleTag.textContent = on ? [
					"[data-slot=\"conversation.session.header\"]",
					"[data-phase] > header",
					"[data-conversation-scroll]",
					"[data-composer-seat]"
				].join(", ") + " { opacity: 0 !important; pointer-events: none !important; transition: opacity 0.3s ease !important; }" : "";
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
					const snap = sessionsNow()?.list.getSnapshot();
					const id = snap?.current;
					const isBlank = id === void 0 || snap != null && snap.byId[id]?.blank === true;
					const nav = workspaceNav();
					if (!isBlank && typeof nav?.startSession === "function") nav.startSession();
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
			/** 渲染模式 → DWP 纹理档位：「增强/完整」用高档纹理，其余（预览/捕获）用低档。 */
			function qualityOf(mode) {
				return mode === "enhanced" ? "hd" : "sd";
			}
			function applyBackground() {
				if (store.settings.dwpMounted !== null) {
					const blurPx = store.settings.focus ? 0 : Math.round(effectiveVisuals().blur);
					const scale = 1 + blurPx / 400;
					const shadowAlpha = effectiveVisuals().shadow / 100 * .6;
					stopSceneLayers();
					setMedia(null);
					styleTag.textContent = "html { background-color: #0d0e12; }body::after { content: \"\"; position: fixed; top: 0; left: 0; right: 0; bottom: 0; z-index: -1; background: linear-gradient(rgba(6,8,12," + shadowAlpha.toFixed(3) + "), rgba(6,8,12," + (shadowAlpha * .85).toFixed(3) + ")); }";
					dwpBg.setQuality(qualityOf(store.settings.renderMode));
					dwpBg.mount(store.settings.dwpMounted).then(() => dwpBg.applyVisuals(blurPx, scale)).catch((e) => {
						console.error("[dwp] 背景挂载失败：", e);
					});
					applyImmersive();
					applyFocusLens();
					return;
				}
				stopDwp();
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
			let lastPulseSig = "";
			async function pollWorkspacePulse() {
				if (store.settings.dwpMounted !== "workspace-pulse") {
					lastPulseSig = "";
					return;
				}
				try {
					const res = await fetch("/we-sync/workspace/pulse", { cache: "no-store" });
					if (!res.ok) return;
					const data = await res.json();
					const map = pulseVars(Array.isArray(data.changes) ? data.changes : []);
					const sig = JSON.stringify(map);
					if (sig === lastPulseSig) return;
					lastPulseSig = sig;
					dwpBg.setLiveVars(map);
				} catch {}
			}
			let lastClockSig = "";
			function feedClockVars() {
				if (store.settings.dwpMounted === null) {
					lastClockSig = "";
					return;
				}
				const mounted = store.settings.dwpMounted;
				const vars = clockVars(/* @__PURE__ */ new Date(), { hd: qualityOf(store.settings.renderMode) === "hd" });
				const sig = mounted + "|" + clockSig(vars);
				if (sig === lastClockSig) return;
				lastClockSig = sig;
				dwpBg.setLiveVars(vars);
			}
			async function poll() {
				if (polling) return;
				polling = true;
				try {
					const monitorQuery = store.settings.monitor !== "" ? "?monitor=" + encodeURIComponent(store.settings.monitor) : "";
					const res = await fetch("/we-sync/state" + monitorQuery, { cache: "no-store" });
					if (!res.ok) {
						polling = false;
						return;
					}
					const info = await res.json();
					if (store.settings.monitor !== "" && Array.isArray(info.monitors) && info.monitors.length > 0 && !info.monitors.some((m) => m.key === store.settings.monitor)) store.settings.monitor = "";
					const changed = typeof info.hash === "string" && info.hash !== lastHash;
					const portChanged = typeof info.webPort === "number" && info.webPort !== lastWebPort;
					store.info = info;
					store.notify();
					if (changed || portChanged) {
						lastHash = typeof info.hash === "string" ? info.hash : lastHash;
						lastWebPort = typeof info.webPort === "number" ? info.webPort : lastWebPort;
						applyBackground();
					}
					await pollWorkspacePulse();
					feedClockVars();
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
			let dwpPrevEnabled = true;
			store.actions.mountDwp = async (id) => {
				if (!(await applyDwp((url, init) => fetch(url, init), id)).ok) return false;
				if (store.settings.dwpMounted === null) dwpPrevEnabled = store.settings.enabled;
				store.settings.dwpMounted = id;
				store.settings.enabled = false;
				store.notify();
				applyBackground();
				return true;
			};
			store.actions.unmountDwp = async () => {
				await unapplyDwp((url, init) => fetch(url, init));
				store.settings.dwpMounted = null;
				store.settings.enabled = dwpPrevEnabled;
				store.notify();
				applyBackground();
			};
			fetchApplied((url, init) => fetch(url, init)).then((applied) => {
				if (applied === null) return;
				dwpPrevEnabled = true;
				store.settings.dwpMounted = applied.id;
				store.settings.enabled = false;
				store.notify();
				applyBackground();
			}).catch(() => {});
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
				stopDwp();
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
			ctx.inject(["sessions"], (scope) => {
				const sessions = scope.get("sessions");
				if (sessions === void 0) return;
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
				scope.effect(() => sessions.list.subscribe(updateTaskState));
				updateTaskState();
			});
			applyTheme();
			applyBackground();
			if (store.settings.gazeEnabled) startGaze().then(() => {
				if (!isGazeRunning()) store.settings.gazeEnabled = false;
				store.notify();
			});
			slotsService.inject("conversation.view", () => slotsService.register({
				name: "conversation.view",
				id: "wallpaper_share",
				order: 20,
				label: "wallpaper_share"
			}, WallpaperSharePanel));
		}
		//#endregion
		exports.DEFAULT_SETTINGS = DEFAULT_SETTINGS;
		exports.FOCUS_IDLE = FOCUS_IDLE;
		exports.FOCUS_LENS = FOCUS_LENS;
		exports.FOCUS_WORK = FOCUS_WORK;
		exports.PLUGIN_REPO_URL = PLUGIN_REPO_URL;
		exports.PLUGIN_VERSION = PLUGIN_VERSION;
		exports.apply = apply;
		exports.effectiveVisuals = effectiveVisuals;
		exports.inject = inject;
		exports.store = store;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map