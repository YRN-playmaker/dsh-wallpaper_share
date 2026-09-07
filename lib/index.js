import { appendFileSync, closeSync, cpSync, createReadStream, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync, writeSync } from "node:fs";
import { execFile, execFileSync, spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { basename, dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { EventEmitter } from "node:events";
import { createCipheriv, createDecipheriv, createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";
import { deflateSync, gunzipSync, inflateRawSync } from "node:zlib";
//#region src/scene/SceneCapabilities.ts
/**
* Scene renderer 能力探测。
* 只负责回答"是否存在可用的 renderer"与"assets 是否齐备"，
* 不做任何渲染。被 SceneAdapter 调用并缓存结果。
*/
/** 内置参考 renderer 的静态标识（真 renderer 通过 [VERSION] 行自报，不走到这里） */
const REFERENCE_VERSION = "reference-0.1.0";
/** 内置参考 renderer 支持的格式（RGBA 动画测试画面） */
const REFERENCE_FORMATS = ["rgba"];
/** 探测 renderer 二进制是否存在；存在则返回解析后的 {path, args, version} */
function probeRenderer(config, weDir) {
	if (config.sceneRendererPath.trim() !== "") {
		const path = config.sceneRendererPath.trim();
		if (existsSync(path)) return {
			path,
			args: [],
			version: probeVersion(path)
		};
		return null;
	}
	const cap = resolveBundledCapture();
	if (cap !== null) return {
		path: cap,
		args: [],
		version: probeVersion(cap)
	};
	const ref = resolveReferenceRenderer();
	if (ref !== null && existsSync(ref)) return {
		path: process.execPath,
		args: [ref],
		version: REFERENCE_VERSION
	};
	return null;
}
/** 定位原生捕获器 we-capture.exe：随包 bin/ 或本地构建 native/we-capture/target/release/ */
function resolveBundledCapture() {
	try {
		const here = fileURLToPath(import.meta.url);
		const pkgRoot = resolve(dirname(here), "..");
		const name = process.platform === "win32" ? "we-capture.exe" : "we-capture";
		const cands = [resolve(pkgRoot, "bin", name), resolve(pkgRoot, "native", "we-capture", "target", "release", name)];
		for (const c of cands) if (existsSync(c)) return c;
		return null;
	} catch {
		return null;
	}
}
/** 定位随包发布的内置参考 renderer（<包根>/tools/scene-renderer/scene-renderer.mjs，与 lib/ 同级） */
function resolveReferenceRenderer() {
	try {
		const here = fileURLToPath(import.meta.url);
		return resolve(dirname(here), "..", "tools", "scene-renderer", "scene-renderer.mjs");
	} catch {
		return resolve(process.cwd(), "tools", "scene-renderer", "scene-renderer.mjs");
	}
}
/** 尝试读取 renderer 的 --version 输出；失败返回空串（真 renderer 可稍后经 [VERSION] 自报） */
function probeVersion(path) {
	try {
		const first = execFileSync(path, ["--version"], {
			encoding: "utf8",
			timeout: 3e3,
			windowsHide: true
		}).split(/\r?\n/).find((l) => l.trim() !== "");
		return first !== void 0 ? first.trim().slice(0, 64) : "";
	} catch {
		return "";
	}
}
/** 探测 WE engine assets 目录：显式 > 自动 <weDir>/assets */
function resolveAssetsDir(config, weDir) {
	if (config.wallpaperEngineAssetsDir.trim() !== "") return config.wallpaperEngineAssetsDir.trim();
	return weDir.replace(/[\\/]+$/, "") + "/assets";
}
/** 汇总 renderer 能力与 assets 齐备情况（结果被 SceneAdapter 缓存） */
function detectSceneRenderer(config, weDir) {
	const assetsDir = resolveAssetsDir(config, weDir);
	const assetsFound = existsSync(assetsDir + "/shaders") || existsSync(assetsDir);
	const probe = probeRenderer(config, weDir);
	if (probe === null) return {
		available: false,
		version: "",
		rendererPath: config.sceneRendererPath.trim(),
		bin: "",
		args: [],
		assetsDir,
		assetsFound,
		formats: [],
		reason: "Scene renderer not found：请设置 CONFIG.sceneRendererPath，或安装内置参考 renderer"
	};
	const isReference = probe.version === REFERENCE_VERSION;
	return {
		available: true,
		version: probe.version !== "" ? probe.version : isReference ? REFERENCE_VERSION : "",
		rendererPath: probe.path + (probe.args.length > 0 ? " " + probe.args.join(" ") : ""),
		bin: probe.path,
		args: probe.args,
		assetsDir,
		assetsFound,
		formats: isReference ? REFERENCE_FORMATS : [
			"jpeg",
			"webp",
			"rgba",
			"bgra"
		]
	};
}
/** 是否为真·原生 renderer（非内置参考 renderer）：参考 renderer 仅支持 rgba，原生捕获器支持 jpeg */
function isNativeRenderer(cap) {
	return cap !== null && cap.available && cap.version !== REFERENCE_VERSION && cap.formats.includes("jpeg");
}
/** 计算 scene 指纹：绝对路径 + size + mtime，避免旧 scene 缓存串台 */
function sceneFingerprint(pkgPath) {
	try {
		const st = statSync(pkgPath);
		return pkgPath + "|" + st.size + "|" + Math.floor(st.mtimeMs);
	} catch {
		return pkgPath + "|unknown";
	}
}
//#endregion
//#region src/scene/SceneProtocol.ts
/** 反向映射（0..3 → 格式名；未知返回 undefined） */
const FORMAT_CODE_NAME = {
	0: "jpeg",
	1: "webp",
	2: "rgba",
	3: "bgra"
};
//#endregion
//#region src/scene/SceneRendererProcess.ts
/**
* 单个 scene renderer 子进程的管理：spawn、stdin 命令写入、stdout 帧解析、
* stderr 日志/[STATUS] 解析、退出/崩溃事件、健康心跳、带超时的优雅停止。
*
* stdout 帧格式（renderer → Node）：
*   [4B LE uint32 payloadLen][payload]
*   payload = [1B format][4B LE width][4B LE height][编码/像素字节]
*
* stdin 命令（Node → renderer）：换行分隔 JSON，见 SceneProtocol。
* stderr：人类日志 + 可选 `[STATUS]{"fps":..,"frame":..}` 心跳行 + `[VERSION]x` 自报版本。
*/
/** 优雅停止：先发 {"cmd":"stop"}，超时后 SIGKILL */
const STOP_GRACE_MS = 1500;
var SceneRendererProcess = class extends EventEmitter {
	child = null;
	stdoutBuf = Buffer.alloc(0);
	stderrBuf = "";
	stopped = false;
	stopTimer = null;
	path;
	args;
	logPrefix;
	pid = null;
	lastFrameAt = 0;
	/** 最近一次 [STATUS] 心跳时间：静态/暂停壁纸可能长时间无新帧，但心跳证明 renderer 存活 */
	lastBeatAt = 0;
	lastFrame = null;
	version = "";
	constructor(opts) {
		super();
		this.path = opts.path;
		this.args = opts.args;
		this.logPrefix = opts.logPrefix ?? "[SceneRenderer]";
	}
	get running() {
		return this.child !== null && this.stopped === false && this.child.exitCode === null;
	}
	start(request) {
		if (this.running) return;
		this.stopped = false;
		this.child = spawn(this.path, this.args, {
			stdio: [
				"pipe",
				"pipe",
				"pipe"
			],
			windowsHide: true
		});
		this.pid = this.child.pid ?? null;
		this.log(this.logPrefix + " Starting renderer " + this.path + " " + this.args.join(" "));
		this.child.stdout.on("data", (chunk) => this.onStdout(chunk));
		this.child.stderr.on("data", (chunk) => this.onStderr(chunk.toString("utf8")));
		this.child.on("error", (err) => {
			this.log(this.logPrefix + " Renderer spawn error: " + String(err.message ?? err));
			this.emit("exit", null, null);
		});
		this.child.on("exit", (code, signal) => {
			this.log(this.logPrefix + " Renderer exited unexpectedly (code=" + String(code) + ", signal=" + String(signal) + ")");
			this.cleanup();
			this.emit("exit", code, signal);
		});
		this.send({
			cmd: "load",
			...request
		});
	}
	send(command) {
		if (this.child === null || this.stopped || this.child.stdin.destroyed) return;
		try {
			this.child.stdin.write(JSON.stringify(command) + "\n");
		} catch (err) {
			this.log(this.logPrefix + " stdin write failed: " + String(err.message ?? err));
		}
	}
	/** 优雅停止：先 stop 命令，超时强杀 */
	stop() {
		if (this.child === null) return;
		if (this.stopped) return;
		try {
			this.send({ cmd: "stop" });
		} catch {}
		this.stopped = true;
		this.stopTimer = setTimeout(() => {
			if (this.child !== null && this.child.exitCode === null) {
				this.log(this.logPrefix + " Force-killing renderer after grace timeout");
				try {
					this.child.kill("SIGKILL");
				} catch {}
			}
		}, STOP_GRACE_MS);
	}
	/** 立即强制终止（用于 dispose / 切换壁纸的硬清理） */
	kill() {
		this.stopped = true;
		if (this.stopTimer !== null) {
			clearTimeout(this.stopTimer);
			this.stopTimer = null;
		}
		if (this.child !== null) {
			try {
				this.child.kill("SIGKILL");
			} catch {}
			this.cleanup();
		}
	}
	cleanup() {
		if (this.stopTimer !== null) {
			clearTimeout(this.stopTimer);
			this.stopTimer = null;
		}
		this.child = null;
		this.pid = null;
		this.stdoutBuf = Buffer.alloc(0);
	}
	log(line) {
		this.emit("log", line);
	}
	onStdout(chunk) {
		this.stdoutBuf = Buffer.concat([this.stdoutBuf, chunk]);
		for (;;) {
			if (this.stdoutBuf.length < 4) return;
			const len = this.stdoutBuf.readUInt32LE(0);
			if (len <= 0 || len > 16777216) {
				this.stdoutBuf = this.stdoutBuf.subarray(1);
				continue;
			}
			if (this.stdoutBuf.length < 4 + len) return;
			const payload = this.stdoutBuf.subarray(4, 4 + len);
			this.stdoutBuf = this.stdoutBuf.subarray(4 + len);
			const frame = this.decodePayload(payload);
			if (frame !== null) {
				this.lastFrame = frame;
				this.lastFrameAt = Date.now();
				this.emit("frame", frame);
			}
		}
	}
	decodePayload(payload) {
		if (payload.length < 9) return null;
		const formatCode = payload[0];
		const format = FORMAT_CODE_NAME[formatCode];
		if (format === void 0) return null;
		const width = payload.readUInt32LE(1);
		const height = payload.readUInt32LE(5);
		if (width < 1 || height < 1 || width > 16384 || height > 16384) return null;
		return {
			format,
			width,
			height,
			data: Uint8Array.from(payload.subarray(9)),
			ts: Date.now()
		};
	}
	onStderr(text) {
		this.stderrBuf += text;
		let nl = this.stderrBuf.indexOf("\n");
		while (nl >= 0) {
			const line = this.stderrBuf.slice(0, nl).replace(/\r$/, "");
			this.stderrBuf = this.stderrBuf.slice(nl + 1);
			this.handleStderrLine(line);
			nl = this.stderrBuf.indexOf("\n");
		}
	}
	handleStderrLine(line) {
		if (line.trim() === "") return;
		const statusIdx = line.indexOf("[STATUS]");
		if (statusIdx >= 0) try {
			const json = JSON.parse(line.slice(statusIdx + 8).trim());
			this.lastBeatAt = Date.now();
			this.emit("status", json);
			return;
		} catch {}
		const verIdx = line.indexOf("[VERSION]");
		if (verIdx >= 0) {
			const v = line.slice(verIdx + 9).trim();
			if (v !== "") this.version = v;
			this.emit("version", this.version);
			return;
		}
		this.emit("log", line.startsWith(this.logPrefix) ? line : this.logPrefix + " " + line);
	}
};
//#endregion
//#region src/scene/SceneWebSocket.ts
/**
* 极简 RFC 6455 WebSocket 服务端（仅服务端→浏览器推送二进制帧），
* 用于把 SceneAdapter 的最新帧广播给 SceneCanvas。
*
* 不依赖任何第三方 ws 库：DSH 的 webServer 提供 `registerUpgrade` 路由，
* 回调收到已协商前的 (req, socket, head)，这里完成握手与后续帧收发。
* 客户端只消费二进制帧（opcode 0x2），服务端只需解析 close/ping/pong。
*
* WS 消息负载（Node → 浏览器）：`[1B format][4B LE width][4B LE height][payload]`
*/
/** RFC 6455 握手魔数 GUID */
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
var SceneFrameHub = class {
	clients = /* @__PURE__ */ new Set();
	logFn;
	onClientsChanged;
	constructor(logFn, onClientsChanged) {
		this.logFn = logFn ?? (() => {});
		this.onClientsChanged = onClientsChanged ?? (() => {});
	}
	get clientCount() {
		return this.clients.size;
	}
	/** 作为 webServer.registerUpgrade 的 handler 使用 */
	handleUpgrade = (req, socket, head) => {
		const monitor = this.monitorFromQuery(req.url ?? "");
		if (!this.accept(req, socket)) return;
		const client = {
			socket,
			monitor,
			buffer: Buffer.alloc(0),
			closed: false
		};
		this.clients.add(client);
		this.onClientsChanged(this.clients.size);
		this.logFn("[SceneRenderer] Scene stream client connected (monitor=" + (monitor === "" ? "auto" : monitor) + ", total=" + this.clients.size + ")");
		socket.on("data", (chunk) => this.onData(client, chunk));
		socket.on("error", () => this.drop(client));
		socket.on("close", () => this.drop(client));
		if (head.length > 0) this.onData(client, head);
	};
	/** 广播一帧给匹配 monitor 的客户端（monitor='' 的客户端视为 auto，接受所有） */
	broadcast(monitor, frame) {
		const msg = this.encodeFrameMessage(frame);
		for (const c of this.clients) {
			if (c.closed) continue;
			if (c.monitor !== "" && c.monitor !== monitor) continue;
			try {
				c.socket.write(msg);
			} catch {
				this.drop(c);
			}
		}
	}
	closeAll() {
		for (const c of [...this.clients]) {
			try {
				c.socket.destroy();
			} catch {}
			c.closed = true;
		}
		this.clients.clear();
	}
	monitorFromQuery(url) {
		const m = /[?&]monitor=([^&]+)/.exec(url);
		if (m === null || m[1] === void 0) return "";
		try {
			return decodeURIComponent(m[1]);
		} catch {
			return "";
		}
	}
	accept(req, socket) {
		const key = req.headers["sec-websocket-key"];
		if (typeof key !== "string") {
			socket.destroy();
			return false;
		}
		const accept = createHash("sha1").update(key + WS_GUID).digest("base64");
		try {
			socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + accept + "\r\n\r\n");
			return true;
		} catch {
			socket.destroy();
			return false;
		}
	}
	onData(client, chunk) {
		if (client.closed) return;
		client.buffer = Buffer.concat([client.buffer, chunk]);
		for (;;) {
			const parsed = this.parseClientFrame(client.buffer);
			if (parsed === null) return;
			if (parsed.needMore) return;
			client.buffer = parsed.rest;
			this.handleClientFrame(client, parsed.opcode, parsed.payload);
		}
	}
	parseClientFrame(buf) {
		if (buf.length < 2) return {
			opcode: 0,
			payload: Buffer.alloc(0),
			rest: buf,
			needMore: true
		};
		const b0 = buf[0];
		const b1 = buf[1];
		const opcode = b0 & 15;
		const masked = (b1 & 128) !== 0;
		let len = b1 & 127;
		let offset = 2;
		if (len === 126) {
			if (buf.length < 4) return {
				opcode,
				payload: Buffer.alloc(0),
				rest: buf,
				needMore: true
			};
			len = buf.readUInt16BE(2);
			offset = 4;
		} else if (len === 127) {
			if (buf.length < 10) return {
				opcode,
				payload: Buffer.alloc(0),
				rest: buf,
				needMore: true
			};
			const big = buf.readBigUInt64BE(2);
			if (big > BigInt(16777216)) return null;
			len = Number(big);
			offset = 10;
		}
		let maskKey = null;
		if (masked) {
			if (buf.length < offset + 4) return {
				opcode,
				payload: Buffer.alloc(0),
				rest: buf,
				needMore: true
			};
			maskKey = buf.subarray(offset, offset + 4);
			offset += 4;
		}
		if (buf.length < offset + len) return {
			opcode,
			payload: Buffer.alloc(0),
			rest: buf,
			needMore: true
		};
		let payload = buf.subarray(offset, offset + len);
		if (maskKey !== null) {
			const out = Buffer.alloc(len);
			for (let i = 0; i < len; i++) out[i] = payload[i] ^ maskKey[i & 3];
			payload = out;
		}
		return {
			opcode,
			payload,
			rest: buf.subarray(offset + len),
			needMore: false
		};
	}
	handleClientFrame(client, opcode, payload) {
		if (opcode === 8) {
			try {
				client.socket.write(this.encodeServerFrame(Buffer.alloc(0), 8));
			} catch {}
			this.drop(client);
			return;
		}
		if (opcode === 9) {
			try {
				client.socket.write(this.encodeServerFrame(payload, 10));
			} catch {
				this.drop(client);
			}
			return;
		}
	}
	drop(client) {
		if (client.closed) return;
		client.closed = true;
		this.clients.delete(client);
		try {
			client.socket.destroy();
		} catch {}
		this.onClientsChanged(this.clients.size);
		this.logFn("[SceneRenderer] Scene stream client disconnected (total=" + this.clients.size + ")");
	}
	/** 服务端→客户端二进制帧：opcode 0x2，FIN=1，无掩码 */
	encodeServerFrame(payload, opcode) {
		const len = payload.length;
		let header;
		if (len < 126) {
			header = Buffer.alloc(2);
			header[1] = len;
		} else if (len < 65536) {
			header = Buffer.alloc(4);
			header[1] = 126;
			header.writeUInt16BE(len, 2);
		} else {
			header = Buffer.alloc(10);
			header[1] = 127;
			header.writeBigUInt64BE(BigInt(len), 2);
		}
		header[0] = 128 | opcode;
		return Buffer.concat([header, payload]);
	}
	/** 把 SceneFrame 编码为 WS 二进制消息负载 */
	encodeFrameMessage(frame) {
		const header = Buffer.alloc(9);
		header[0] = frame.format === "jpeg" ? 0 : frame.format === "webp" ? 1 : frame.format === "rgba" ? 2 : 3;
		header.writeUInt32LE(frame.width, 1);
		header.writeUInt32LE(frame.height, 5);
		return this.encodeServerFrame(Buffer.concat([header, Buffer.from(frame.data)]), 2);
	}
};
//#endregion
//#region src/scene/SceneFallback.ts
function resolveSceneFallback(opts) {
	const { kind, rendererRunning, rendererAvailable, hasTexture, hasPreview, renderMode } = opts;
	if (kind !== "scene") return {
		level: "generic",
		reason: "not a scene wallpaper (" + kind + ")"
	};
	if (renderMode !== "source") return hasPreview ? {
		level: "preview",
		reason: "render mode is preview (static preview image)"
	} : {
		level: "generic",
		reason: "no preview and render mode is preview"
	};
	if (rendererRunning) return {
		level: "renderer",
		reason: "live scene renderer streaming frames"
	};
	if (hasTexture) return {
		level: "texture",
		reason: rendererAvailable ? "renderer not running (crashed/unavailable) → extracted scene texture" : "renderer not found → extracted scene texture"
	};
	if (hasPreview) return {
		level: "preview",
		reason: "no renderer and no extractable texture → preview image"
	};
	return {
		level: "generic",
		reason: "no renderer, no texture, no preview → generic background"
	};
}
/** 把状态收敛成一句话日志（供 diag 与 stderr） */
function describeSceneStatus(status, fallback) {
	if (status === null) return "renderer unavailable → " + fallback.level;
	return status.state + (status.fps !== void 0 ? " @" + status.fps.toFixed(1) + "fps" : "") + " → " + fallback.level;
}
//#endregion
//#region src/scene/SceneAdapter.ts
/**
* SceneAdapter —— scene 壁纸动态渲染的统一编排层。
*
* 职责（与任务十一致）：
*   renderer detection / startup / shutdown、scene.pkg 路径、engine assets 路径、
*   输出分辨率、FPS、帧传输（→ SceneFrameHub）、renderer 健康检查、自动重启一次、
*   fallback 信号、缓存（指纹）、诊断。
*
* 活动模型（按需渲染，避免空转）：
*   - 只有「目标显示器是 scene」且「至少有一个浏览器 WS 客户端」时才运行 renderer；
*   - 浏览器切到性能模式 / 关闭同步 / 关闭页面 → WS 断开 → renderer 停止；
*   - 切换壁纸 / 显示器 → 旧 renderer 停止 → 新 renderer 启动；
*   - 崩溃 → 自动重启一次 → 仍失败 → 由浏览器走 texture/preview fallback。
*/
/** renderer 崩溃后最多自动重启次数 */
const MAX_RESTARTS = 1;
/** 无帧心跳超过该毫秒视为 stalled（触发一次重启） */
const STALL_MS = 4e3;
/** 崩溃后重启前的退避 */
const RESTART_DELAY_MS = 500;
/** 健康轮询间隔 */
const HEALTH_INTERVAL_MS = 1e3;
/** 从显示器 key（如 "Monitor2"）提取序号；无法解析返回 undefined（renderer 自行挑选） */
function monitorIndexOf(key) {
	const m = /(\d+)/.exec(key);
	if (m === null) return void 0;
	const n = Number(m[1]);
	return Number.isInteger(n) && n >= 1 ? n : void 0;
}
var SceneAdapter = class {
	hub;
	config;
	weDir;
	logFn;
	capabilities = null;
	process = null;
	target = null;
	fingerprint = "";
	status = {
		state: "idle",
		restarts: 0
	};
	restarts = 0;
	disposed = false;
	healthTimer = null;
	constructor(opts) {
		this.config = opts.config;
		this.weDir = opts.weDir;
		this.logFn = opts.log;
		this.capabilities = detectSceneRenderer(opts.config, opts.weDir);
		this.log("[SceneRenderer] " + (this.capabilities.available ? "Renderer found: " + this.capabilities.rendererPath + " (assets " + (this.capabilities.assetsFound ? "ok" : "missing") + ")" : "Renderer not found: " + (this.capabilities.reason ?? "")));
		this.hub = new SceneFrameHub((line) => this.log(line), () => this.syncActivity());
		this.healthTimer = setInterval(() => this.checkHealth(), HEALTH_INTERVAL_MS);
		if (typeof this.healthTimer.unref === "function") this.healthTimer.unref();
	}
	/** 目标显示器/壁纸变化时调用；kind 非 scene 或文件变化会重启 renderer */
	setTarget(target) {
		if (target === null || target.kind !== "scene") {
			if (this.target !== null) {
				this.stopProcess();
				this.target = null;
				this.fingerprint = "";
				this.status = {
					state: "idle",
					restarts: this.restarts
				};
			}
			return;
		}
		const fp = sceneFingerprint(target.file);
		if (this.target !== null && this.target.key === target.key && this.fingerprint === fp) return;
		this.log("[SceneRenderer] Scene changed → restarting renderer (" + target.file + ")");
		this.stopProcess();
		this.target = target;
		this.fingerprint = fp;
		this.restarts = 0;
		this.syncActivity();
	}
	/** 按需启动/停止：目标为 scene 且有客户端才运行 */
	syncActivity() {
		if (this.disposed) return;
		if (this.target === null) return;
		if (this.hub.clientCount > 0) {
			if (this.process === null || !this.process.running) this.start(this.target);
		} else this.stopProcess();
	}
	/** 停止进程但不改变 target（客户端断开时调用，保持可重新启动） */
	stopProcess() {
		if (this.process !== null) {
			this.process.kill();
			this.process = null;
		}
		if (this.status.state !== "idle" && this.status.state !== "stopped") this.status = {
			state: "idle",
			restarts: this.restarts
		};
	}
	/** 显式完全停止（dispose） */
	stop() {
		this.disposed = true;
		this.stopProcess();
		this.target = null;
		this.fingerprint = "";
		this.status = {
			state: "stopped",
			restarts: this.restarts
		};
	}
	/** 切换渲染分辨率（供未来多显示器 / 分辨率调整） */
	resize(width, height) {
		this.config.width = width;
		this.config.height = height;
		if (this.process !== null && this.process.running) this.process.send({
			cmd: "resize",
			width,
			height
		});
	}
	pause() {
		if (this.process !== null && this.process.running) {
			this.process.send({ cmd: "pause" });
			this.status = {
				...this.status,
				state: "paused"
			};
		}
	}
	resume() {
		if (this.process !== null && this.process.running) {
			this.process.send({ cmd: "resume" });
			this.status = {
				...this.status,
				state: "running"
			};
		}
	}
	/** 帧 → 广播给浏览器（经 SceneFrameHub） */
	onFrame = (frame) => {
		if (this.target !== null) this.hub.broadcast(this.target.key, frame);
		if (this.status.state !== "running" && this.status.state !== "paused") this.status = {
			state: "running",
			pid: this.process?.pid ?? void 0,
			restarts: this.restarts,
			resolution: this.status.resolution
		};
	};
	start(target) {
		if (this.capabilities === null || !this.capabilities.available) {
			this.status = {
				state: "crashed",
				restarts: this.restarts,
				lastError: this.capabilities?.reason ?? "Renderer not found"
			};
			this.log("[SceneRenderer] Renderer not available, falling back to extracted scene texture");
			return;
		}
		if (!this.capabilities.assetsFound) {
			this.status = {
				state: "crashed",
				restarts: this.restarts,
				lastError: "Wallpaper Engine assets dir missing: " + this.capabilities.assetsDir
			};
			this.log("[SceneRenderer] Assets dir missing (" + this.capabilities.assetsDir + "), falling back to texture");
			return;
		}
		this.status = {
			state: "starting",
			restarts: this.restarts,
			resolution: {
				width: this.config.width,
				height: this.config.height
			}
		};
		this.log("[SceneRenderer] Starting renderer");
		const proc = new SceneRendererProcess({
			path: this.capabilities.bin,
			args: this.capabilities.args
		});
		proc.on("frame", this.onFrame);
		proc.on("status", (s) => this.onStatus(s));
		proc.on("version", (v) => {
			this.log("[SceneRenderer] Renderer version: " + v);
		});
		proc.on("log", (line) => this.log(line));
		proc.on("exit", (code, signal) => this.onExit(proc, code, signal));
		this.process = proc;
		proc.start({
			scene: target.file,
			assets: resolveAssetsDir(this.config, this.weDir),
			width: this.config.width,
			height: this.config.height,
			fps: this.config.fps,
			quality: this.config.quality,
			monitor: monitorIndexOf(target.key)
		});
	}
	onStatus(s) {
		const fps = typeof s.fps === "number" ? s.fps : this.status.fps;
		const frameIndex = typeof s.frame === "number" ? s.frame : this.status.frameIndex;
		this.status = {
			state: "running",
			pid: this.process?.pid ?? void 0,
			fps,
			frameIndex,
			resolution: this.status.resolution,
			restarts: this.restarts
		};
	}
	onExit(proc, code, signal) {
		if (this.process !== proc) return;
		this.process = null;
		if (this.disposed || this.hub.clientCount === 0 || this.target === null) {
			this.status = {
				state: "idle",
				restarts: this.restarts
			};
			return;
		}
		this.log("[SceneRenderer] Renderer exited unexpectedly (code=" + String(code) + ", signal=" + String(signal) + ")");
		if (this.restarts < MAX_RESTARTS) {
			this.restarts += 1;
			this.log("[SceneRenderer] Auto-restarting renderer (attempt " + this.restarts + "/1)");
			this.status = {
				state: "starting",
				restarts: this.restarts
			};
			setTimeout(() => {
				if (!this.disposed && this.hub.clientCount > 0 && this.target !== null && this.process === null) this.start(this.target);
			}, RESTART_DELAY_MS);
		} else {
			this.status = {
				state: "crashed",
				restarts: this.restarts,
				lastError: "Renderer crashed after " + this.restarts + " restart(s)"
			};
			this.log("[SceneRenderer] Fallback to extracted scene texture");
		}
	}
	checkHealth() {
		const proc = this.process;
		if (proc === null || !proc.running || this.disposed) return;
		const lastAlive = Math.max(proc.lastFrameAt, proc.lastBeatAt);
		if (lastAlive > 0 && Date.now() - lastAlive > STALL_MS) {
			this.log("[SceneRenderer] No frame or heartbeat for 4000ms — restarting renderer");
			proc.kill();
		}
	}
	getCapabilities() {
		return this.capabilities;
	}
	/** 当前 renderer 正在渲染的目标（浏览器经 WS 锁定后可能与 auto 显示器不同） */
	getTarget() {
		return this.target;
	}
	getStatus() {
		const s = this.status;
		if (s.pid === void 0 && this.process?.pid != null) s.pid = this.process.pid;
		return s;
	}
	/** 是否正在出帧（浏览器据此决定是否走 live canvas） */
	isRunning() {
		return this.process !== null && this.process.running && this.hub.clientCount > 0;
	}
	getFallback(opts) {
		return resolveSceneFallback({
			kind: opts.kind,
			rendererRunning: this.isRunning(),
			rendererAvailable: this.capabilities?.available === true,
			hasTexture: opts.hasTexture,
			hasPreview: opts.hasPreview,
			renderMode: opts.renderMode
		});
	}
	describe() {
		return describeSceneStatus(this.getStatus(), this.getFallback({
			kind: this.target?.kind ?? "scene",
			hasTexture: false,
			hasPreview: false,
			renderMode: "source"
		}));
	}
	dispose() {
		this.disposed = true;
		if (this.healthTimer !== null) clearInterval(this.healthTimer);
		this.stopProcess();
		this.hub.closeAll();
	}
	log(line) {
		this.logFn(line);
	}
};
//#endregion
//#region src/scene/ScenePkg.ts
function parseScenePkg(buf) {
	const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
	let pos = 0;
	const readI32 = () => {
		const v = view.getInt32(pos, true);
		pos += 4;
		return v;
	};
	const magicLen = readI32();
	const magic = utf8Slice(buf, pos, pos + Math.max(0, Math.min(magicLen, 64)));
	pos += magicLen;
	const version = readI32();
	const entries = [];
	let guard = 0;
	while (pos + 8 <= buf.length && guard++ < 1e5) {
		const nameLen = readI32();
		if (nameLen <= 0 || nameLen > 2048 || pos + nameLen + 8 > buf.length) break;
		const name = utf8Slice(buf, pos, pos + nameLen);
		pos += nameLen;
		const offset = readI32();
		const size = readI32();
		if (offset < 0 || size < 0 || offset + size > buf.length) break;
		entries.push({
			name,
			offset,
			size
		});
	}
	const dataStart = pos;
	const read = (name) => {
		const e = entries.find((x) => x.name === name);
		if (e === void 0) return null;
		return buf.subarray(dataStart + e.offset, dataStart + e.offset + e.size);
	};
	return {
		magic,
		version,
		entries,
		dataStart,
		read,
		has: (name) => entries.some((x) => x.name === name)
	};
}
/** 读取并解析 scene.json（WE 怪癖：缺头括号 + 尾部垃圾） */
function readSceneJson(pkg) {
	const buf = pkg.read("scene.json");
	if (buf === null) return null;
	try {
		return parseJsonLike(buf);
	} catch {
		return null;
	}
}
/** 解析 WE 的"类 JSON"文本：补 { 并截断到最后一个未引用 } */
function parseJsonLike(buf) {
	const raw = utf8Slice(buf, 0, buf.length);
	const last = lastUnquotedBrace(raw);
	if (last < 0) throw new Error("no closing brace");
	let text = raw.slice(0, last + 1).trim();
	if (!text.startsWith("{")) text = "{" + text;
	return JSON.parse(text);
}
function lastUnquotedBrace(text) {
	let inStr = false;
	let esc = false;
	let last = -1;
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (inStr) {
			if (esc) esc = false;
			else if (c === "\\") esc = true;
			else if (c === "\"") inStr = false;
		} else if (c === "\"") inStr = true;
		else if (c === "}") last = i;
	}
	return last;
}
function utf8Slice(buf, start, end) {
	let out = "";
	const bytes = buf.subarray(start, end);
	for (let i = 0; i < bytes.length; i++) {
		const b = bytes[i];
		if (b < 128) out += String.fromCharCode(b);
		else if (b >= 192 && b < 224 && i + 1 < bytes.length) {
			out += String.fromCharCode((b & 31) << 6 | bytes[i + 1] & 63);
			i++;
		} else if (b >= 224 && b < 240 && i + 2 < bytes.length) {
			out += String.fromCharCode((b & 15) << 12 | (bytes[i + 1] & 63) << 6 | bytes[i + 2] & 63);
			i += 2;
		} else out += String.fromCharCode(b);
	}
	return out;
}
/** 解析 "x y z" 形式的字符串向量（含小数/负数/多余空格），失败返回默认 */
function parseVec3(text, def = [
	0,
	0,
	0
]) {
	if (typeof text !== "string") return def;
	const parts = text.trim().split(/\s+/).map(Number);
	if (parts.length < 2 || parts.some((n) => !Number.isFinite(n))) return def;
	return [
		parts[0] ?? def[0],
		parts[1] ?? def[1],
		parts[2] ?? def[2]
	];
}
function parseVec2(text, def = [0, 0]) {
	if (typeof text !== "string") return def;
	const parts = text.trim().split(/\s+/).map(Number);
	if (parts.length < 2 || parts.some((n) => !Number.isFinite(n))) return def;
	return [parts[0] ?? def[0], parts[1] ?? def[1]];
}
/** 解析 visible：true / {user|script, value} / undefined → 默认 true */
function resolveVisible(v, def = true) {
	if (v === void 0 || v === null) return def;
	if (typeof v === "boolean") return v;
	if (typeof v === "object" && v.value !== void 0) {
		const val = v.value;
		return typeof val === "boolean" ? val : def;
	}
	return def;
}
//#endregion
//#region src/scene/ScenePuppet.ts
const f32At = (bytes, q) => {
	const v = bytes[q] | bytes[q + 1] << 8 | bytes[q + 2] << 16 | bytes[q + 3] << 24 | 0;
	return new Float32Array(new Int32Array([v]).buffer)[0];
};
const u32At = (bytes, q) => {
	return (bytes[q] | bytes[q + 1] << 8 | bytes[q + 2] << 16 | bytes[q + 3] << 24) >>> 0;
};
const i32At = (bytes, q) => {
	return bytes[q] | bytes[q + 1] << 8 | bytes[q + 2] << 16 | bytes[q + 3] << 24 | 0;
};
const u16At = (bytes, q) => {
	return bytes[q] | bytes[q + 1] << 8;
};
/** 读取 [start, end) 区间 UTF-8 字符串（MDAT/MDLA 名字可为非 ASCII） */
const utf8At = (bytes, start, end) => {
	return new TextDecoder("utf-8").decode(bytes.subarray(start, end));
};
/** 解析 mdl；失败返回 null */
function parsePuppetMdl(bytes) {
	try {
		const len = bytes.length;
		const find = (tag, from) => {
			const t = new Uint8Array(tag.length);
			for (let i = 0; i < tag.length; i++) t[i] = tag.charCodeAt(i);
			let i = from;
			while (i < len - tag.length) {
				let ok = true;
				for (let k = 0; k < tag.length; k++) if (bytes[i + k] !== t[k]) {
					ok = false;
					break;
				}
				if (ok) return i;
				i++;
			}
			return -1;
		};
		if (bytes.length < 16) return null;
		let material = "";
		let p = 0;
		const magic1 = (() => {
			let s = "";
			while (p < len && bytes[p] !== 0 && s.length < 32) {
				s += String.fromCharCode(bytes[p]);
				p++;
			}
			p++;
			return s;
		})();
		if (!magic1.startsWith("0023") && !magic1.startsWith("0021") && !magic1.startsWith("0020") && !magic1.startsWith("0013")) return null;
		p += 12;
		if (p < len) {
			let s = "";
			let q = p;
			while (q < len && bytes[q] !== 0 && s.length < 4096) {
				s += String.fromCharCode(bytes[q]);
				q++;
			}
			if (s.includes("\"name\"") || s.includes("{")) material = s;
			p = q + 1;
		}
		const mdls4 = find("MDLS0004", 0);
		const mdls3 = find("MDLS0003", 0);
		const mdls1 = find("MDLS0001", 0);
		const mdls = mdls4 >= 0 ? mdls4 : mdls3 >= 0 ? mdls3 : mdls1;
		const mdlsIs3 = mdls >= 0 && mdls4 < 0;
		const mdat = find("MDAT0001", 0);
		const mdla6 = find("MDLA0006", 0);
		const mdla1 = find("MDLA0001", 0);
		const mdla = mdla6 >= 0 ? mdla6 : mdla1;
		const mdle = find("MDLE0002", 0);
		const isOld13 = magic1.startsWith("0013");
		let mesh = null;
		{
			const mdlsOffset = mdls >= 0 ? mdls : len;
			const strides = isOld13 ? [52] : [80, 64];
			for (const stride of strides) {
				if (mesh !== null) break;
				for (let offset = 9; offset + 12 < mdlsOffset; offset++) {
					const candidateVertexBytes = u32At(bytes, offset + 4);
					const verticesOffset = offset + 8;
					const indexLengthOffset = verticesOffset + candidateVertexBytes;
					if (candidateVertexBytes === 0 || candidateVertexBytes % stride !== 0 || indexLengthOffset + 4 > mdlsOffset) continue;
					const candidateIndexBytes = u32At(bytes, indexLengthOffset);
					const indicesOffset = indexLengthOffset + 4;
					if (candidateIndexBytes === 0 || candidateIndexBytes % 6 !== 0 || indicesOffset + candidateIndexBytes > mdlsOffset) continue;
					const vc = candidateVertexBytes / stride;
					const idxCount = candidateIndexBytes / 2;
					let valid = true;
					let minX = Infinity;
					for (let i = 0; i < vc; i++) {
						const vp = verticesOffset + i * stride;
						const x = f32At(bytes, vp);
						if (!Number.isFinite(x)) {
							valid = false;
							break;
						}
						if (x < minX) minX = x;
					}
					if (!valid || !Number.isFinite(minX)) continue;
					const maxIdx = vc - 1;
					for (let i = 0; i < idxCount && valid; i++) if (u16At(bytes, indicesOffset + i * 2) > maxIdx) valid = false;
					if (!valid) continue;
					const vertices = [];
					for (let i = 0; i < vc; i++) {
						const vp = verticesOffset + i * stride;
						if (isOld13) {
							const weights = [];
							for (let w = 0; w < 4; w++) weights.push(f32At(bytes, vp + 28 + w * 4));
							const boneIndices = [];
							for (let b = 0; b < 4; b++) boneIndices.push(u32At(bytes, vp + 12 + b * 4));
							vertices.push({
								pos: [
									f32At(bytes, vp),
									f32At(bytes, vp + 4),
									f32At(bytes, vp + 8)
								],
								weights,
								boneIndices,
								uv: [f32At(bytes, vp + 44), f32At(bytes, vp + 48)]
							});
						} else {
							const weights = [];
							for (let w = 0; w < 4; w++) weights.push(f32At(bytes, vp + 56 + w * 4));
							const boneIndices = [];
							for (let b = 0; b < 4; b++) boneIndices.push(u16At(bytes, vp + 48 + b * 2));
							vertices.push({
								pos: [
									f32At(bytes, vp),
									f32At(bytes, vp + 4),
									f32At(bytes, vp + 8)
								],
								weights,
								boneIndices,
								uv: [f32At(bytes, vp + 72), f32At(bytes, vp + 76)]
							});
						}
					}
					const indices = [];
					for (let i = 0; i < idxCount; i++) indices.push(u16At(bytes, indicesOffset + i * 2));
					let sy = 0;
					let sv = 0;
					let syv = 0;
					let sy2 = 0;
					let sv2 = 0;
					const vn = vertices.length;
					for (const v of vertices) {
						const y = v.pos[1];
						const vv = v.uv[1];
						sy += y;
						sv += vv;
						syv += y * vv;
						sy2 += y * y;
						sv2 += vv * vv;
					}
					const denom = Math.sqrt(Math.max(1e-9, (vn * sy2 - sy * sy) * (vn * sv2 - sv * sv)));
					mesh = {
						vertices,
						indices,
						flipV: (vn * syv - sy * sv) / denom > 0
					};
					break;
				}
			}
		}
		let boneCount = 0;
		const mdlsBones = [];
		if (mdls >= 0 && mdls + 18 + 76 <= len) {
			boneCount = u32At(bytes, mdls + 13);
			if (boneCount > 512) boneCount = 0;
			if (mdlsIs3) {
				let q = mdls + 17;
				for (let i = 0; i < boneCount && q + 77 <= len; i++) {
					const parent = i32At(bytes, q + 5);
					const mp = q + 13;
					const bind = [];
					for (let k = 0; k < 16; k++) bind.push(f32At(bytes, mp + k * 4));
					mdlsBones.push({
						parent,
						bind
					});
					let j = mp + 64;
					while (j < len && bytes[j] !== 0 && j < q + 4096) j++;
					q = j + 1;
				}
			} else {
				let p = mdls + 17;
				for (let i = 0; i < boneCount && p + 12 <= len; i++) {
					let headExtra = 0;
					let parent = i32At(bytes, p + 5);
					let entryLen = u32At(bytes, p + 9);
					if (entryLen === 0 || entryLen > 4096) {
						parent = i32At(bytes, p + 6);
						entryLen = u32At(bytes, p + 10);
						headExtra = 1;
						if (entryLen === 0 || entryLen > 4096) break;
					}
					p += 9 + headExtra + 4;
					const bind = [];
					for (let k = 0; k < 16; k++) bind.push(f32At(bytes, p + k * 4));
					mdlsBones.push({
						parent: parent === -1 ? -1 : parent,
						bind
					});
					p += entryLen;
					let j = p;
					while (j < len && bytes[j] !== 0) j++;
					p = j + 1;
				}
			}
		}
		let poseMatrices = null;
		if (mdle >= 0 && mdle + 17 + 64 <= len) {
			const count = u32At(bytes, mdle + 13) / 64;
			if (count >= 1 && count <= 512 && mdle + 17 + count * 64 <= len) {
				const mats = [];
				for (let i = 0; i < count * 16; i++) mats.push(f32At(bytes, mdle + 17 + i * 4));
				poseMatrices = mats;
			}
		}
		const boneAnchors = [];
		if (mdat >= 0) {
			const mdatEnd = (() => {
				let e = len;
				if (mdla >= 0 && mdla > mdat) e = Math.min(e, mdla);
				if (mdle >= 0 && mdle > mdat) e = Math.min(e, mdle);
				return e;
			})();
			const mdatCount = u16At(bytes, mdat + 13);
			if (mdatCount > 0 && mdatCount <= 256) {
				let q = mdat + 15;
				for (let i = 0; i < mdatCount && q + 2 <= mdatEnd; i++) {
					const boneIdx = u16At(bytes, q);
					q += 2;
					let s = q;
					while (s < mdatEnd && bytes[s] !== 0) s++;
					if (s >= mdatEnd) break;
					const nm = utf8At(bytes, q, s);
					if (nm.length < 1) break;
					const mp = s + 1;
					if (mp + 64 > mdatEnd) break;
					const m = [];
					for (let k = 0; k < 16; k++) m.push(f32At(bytes, mp + k * 4));
					boneAnchors.push({
						name: nm,
						boneIdx,
						m
					});
					q = mp + 64;
				}
			} else {
				let q = mdat + 15;
				let guard = 0;
				while (q + 66 <= mdatEnd && guard++ < 256) {
					const boneIdx = u16At(bytes, q);
					q += 2;
					let s = q;
					while (s < mdatEnd && bytes[s] !== 0) s++;
					if (s >= mdatEnd) break;
					const nm = utf8At(bytes, q, s);
					if (nm.length < 1) break;
					const mp = s + 1;
					if (mp + 64 > mdatEnd) break;
					const m = [];
					for (let k = 0; k < 16; k++) m.push(f32At(bytes, mp + k * 4));
					boneAnchors.push({
						name: nm,
						boneIdx,
						m
					});
					q = mp + 64;
				}
			}
		}
		const bones = [];
		const total = Math.max(boneCount, poseMatrices !== null ? poseMatrices.length / 16 : 0);
		for (let i = 0; i < total; i++) {
			const mdlsB = mdlsBones[i];
			const pose = poseMatrices !== null && i * 16 + 15 < poseMatrices.length ? poseMatrices.slice(i * 16, i * 16 + 16) : null;
			bones.push({
				name: "",
				parent: mdlsB !== void 0 ? mdlsB.parent : -1,
				bind: mdlsB !== void 0 ? mdlsB.bind : null,
				pose
			});
		}
		const mdlaIs1 = mdla >= 0 && mdla6 < 0;
		const animations = [];
		if (mdla >= 0 && mdla + 17 <= len) {
			const animCount = Math.max(0, Math.min(64, u32At(bytes, mdla + 13)));
			let q = mdla + 17;
			for (let a = 0; a < animCount && q + 8 <= len; a++) {
				const id = u32At(bytes, q);
				q += 4;
				q += 4;
				let nm = "";
				while (q < len && bytes[q] !== 0 && nm.length < 128) {
					nm += String.fromCharCode(bytes[q]);
					q++;
				}
				q++;
				let lp = "";
				while (q < len && bytes[q] !== 0 && lp.length < 128) {
					lp += String.fromCharCode(bytes[q]);
					q++;
				}
				q++;
				if (nm === "" || q + 20 > len) break;
				const duration = f32At(bytes, q);
				q += 4;
				const bc = u32At(bytes, q);
				q += 4;
				q += 4;
				const bc2 = u32At(bytes, q);
				q += 4;
				q += 4;
				const dataLen = u32At(bytes, q);
				q += 4;
				if (dataLen <= 0 || dataLen > len - q) break;
				if (!mdlaIs1) q++;
				let kf;
				if (mdlaIs1) {
					const frames = Math.floor(dataLen / 36);
					const kfs = [];
					if (frames > 0 && q + 36 <= len) for (let f = 0; f < frames && q + (f + 1) * 36 <= len; f++) {
						const fp = q + f * 36;
						const values = [];
						let bad = false;
						for (let k = 0; k < 9; k++) {
							const v = f32At(bytes, fp + k * 4);
							if (!Number.isFinite(v)) {
								bad = true;
								break;
							}
							values.push(v);
						}
						if (bad) break;
						kfs.push({
							t: f,
							values
						});
					}
					const boneKeyframes = [kfs];
					let bq = q + kfs.length * 36;
					const realBoneCount = Math.min(bc2 > 0 ? bc2 : bc, 64);
					for (let b = 1; b < realBoneCount && bq + 8 <= len; b++) {
						const h0 = u32At(bytes, bq);
						const h1 = u32At(bytes, bq + 4);
						if (h0 !== 0 || h1 !== dataLen) break;
						const bData = bq + 8;
						const bk = [];
						for (let f = 0; f < frames && bData + (f + 1) * 36 <= len; f++) {
							const fp = bData + f * 36;
							const values = [];
							let bad = false;
							for (let k = 0; k < 9; k++) {
								const v = f32At(bytes, fp + k * 4);
								if (!Number.isFinite(v)) {
									bad = true;
									break;
								}
								values.push(v);
							}
							if (bad) break;
							bk.push({
								t: f,
								values
							});
						}
						boneKeyframes.push(bk);
						bq = bData + bk.length * 36;
					}
					kf = {
						keyframes: kfs,
						offset: bq - q
					};
					animations.push({
						id,
						name: nm,
						loop: lp === "loop",
						boneCount: realBoneCount,
						duration,
						keyframes: kfs,
						old13: mdlaIs1,
						boneKeyframes
					});
					q += kf.offset;
					continue;
				} else kf = parseKeyframes(bytes, q, dataLen);
				q += kf.offset;
				animations.push({
					id,
					name: nm,
					loop: lp === "loop",
					boneCount: bc,
					duration,
					keyframes: kf.keyframes,
					old13: mdlaIs1
				});
			}
		}
		const animsV2 = [];
		if (mdla6 >= 0) try {
			let p = mdla6 + 9;
			p += 4;
			const animCount = Math.max(0, Math.min(64, u32At(bytes, p)));
			p += 4;
			for (let a = 0; a < animCount && p + 12 <= len; a++) {
				const id = u32At(bytes, p);
				p += 4;
				p += 4;
				let s = p;
				while (s < len && bytes[s] !== 0 && s - p < 128) s++;
				if (s >= len) break;
				const nm = utf8At(bytes, p, s);
				p = s + 1;
				while (p < len && bytes[p] !== 0) p++;
				if (p >= len) break;
				p++;
				while (p + 1 < len && !(bytes[p] === 240 && bytes[p + 1] === 65)) p++;
				p += 2;
				const frameCount = u16At(bytes, p);
				p += 2;
				p += 2;
				p += 4;
				const boneCount = u32At(bytes, p);
				p += 4;
				p += 4;
				const segBytes = u32At(bytes, p);
				p += 4;
				if (boneCount > 512 || segBytes === 0 || segBytes > 1048576) break;
				const segs = [];
				for (let b = 0; b < boneCount && p + (b + 1) * segBytes <= len; b++) segs.push(p + b * segBytes);
				if (segs.length === 0) break;
				const totalFrames = Math.max(1, Math.min(frameCount, 4096));
				const localFrames = new Array(boneCount * totalFrames * 3).fill(0);
				for (let b = 0; b < boneCount; b++) {
					const segStart = segs[b];
					const b2 = 2 * b;
					const posShift = Math.floor(b2 / 9);
					const posCol = b2 % 9;
					const rotShift = Math.floor((b2 + 5) / 9);
					const rotCol = (b2 + 5) % 9;
					for (let f = 0; f < totalFrames; f++) {
						const o = segStart + (f + posShift) % totalFrames * 36 + posCol * 4;
						const o2 = segStart + (f + posShift + rotShift) % totalFrames * 36 + rotCol * 4;
						let px = NaN;
						let py = NaN;
						let rotZ = NaN;
						if (o + 4 <= bytes.length && o2 + 4 <= bytes.length) {
							px = f32At(bytes, o);
							py = f32At(bytes, o + 4);
							rotZ = f32At(bytes, o2);
						}
						const base = b * totalFrames * 3 + f * 3;
						localFrames[base] = px;
						localFrames[base + 1] = py;
						localFrames[base + 2] = rotZ;
					}
				}
				animsV2.push({
					id,
					name: nm,
					frameCount: totalFrames,
					boneCount,
					localFrames
				});
				p += segBytes * boneCount;
			}
		} catch {}
		return {
			material,
			bones,
			mesh,
			animations,
			animsV2,
			boneAnchors
		};
	} catch {
		return null;
	}
}
/**
* 解析关键帧数据区：每帧 36B = [t:3B LE][8×f32][1B]。
* 偏移探测：尝试 0..8 字节偏移，选质量最高的解析；
* 质量 = t 单调峰得分 − 帧值合理性惩罚（NaN/巨大值 = 错位解析）。
* 返回探测到的数据起点偏移（供调用方前进游标）。
*/
function parseKeyframes(bytes, dataStart, dataLen) {
	const len = bytes.length;
	const frameCount = Math.floor(dataLen / 36);
	if (frameCount <= 0) return {
		keyframes: [],
		offset: 0
	};
	let best = [];
	let bestOff = 0;
	let bestScore = -Infinity;
	for (let off = 0; off <= 8 && dataStart + off + 36 <= len; off++) {
		const kf = [];
		let bad = false;
		let penalty = 0;
		for (let f = 0; f < frameCount; f++) {
			const fp = dataStart + off + f * 36;
			if (fp + 36 > len) {
				bad = true;
				break;
			}
			const t = (bytes[fp] | bytes[fp + 1] << 8 | bytes[fp + 2] << 16) >>> 0;
			const values = [];
			for (let k = 0; k < 8; k++) {
				const v = f32At(bytes, fp + 3 + k * 4);
				values.push(v);
				if (!Number.isFinite(v) || Math.abs(v) > 1e7) penalty += 10;
				else if (Math.abs(v) > 1e5) penalty += 1;
			}
			kf.push({
				t,
				values
			});
		}
		if (bad) continue;
		let peak = 0;
		for (let i = 1; i < kf.length; i++) if (kf[i].t > kf[peak].t) peak = i;
		let score = 0;
		for (let i = 1; i <= peak; i++) if (kf[i].t >= kf[i - 1].t) score++;
		for (let i = peak + 1; i < kf.length; i++) if (kf[i].t <= kf[i - 1].t) score++;
		let tMin = Infinity;
		let tMax = -Infinity;
		for (const k of kf) {
			if (k.t < tMin) tMin = k.t;
			if (k.t > tMax) tMax = k.t;
		}
		if (tMin === tMax) score -= frameCount * .5;
		if (score - penalty > bestScore) {
			bestScore = score - penalty;
			best = kf;
			bestOff = off;
		}
	}
	return {
		keyframes: best,
		offset: bestOff
	};
}
//#endregion
//#region src/scene/SceneModel.ts
/**
* SceneModel —— scene.json + pkg 条目 → 归一化图层模型（Phase 1 最小切片）。
*
* 纯数据转换（无 IO、无 node API），node 半构建后经 HTTP 交给浏览器渲染；
* 类型定义同时供浏览器侧 SceneModelRenderer 使用。
*
* 覆盖范围（诚实标注）：
*   - 图层树 + transform（origin/angles/scale/parallaxDepth）✅
*   - visible 解析（bool / {user|script,value}）✅
*   - 模型→材质→纹理引用链解析（best-effort）✅
*   - 纹理（pkg 内嵌图片 + .tex 容器含 LZ4/DXT）✅（Phase 2a）
*   - 粒子系统描述解析（发射器/初始化器/算子/渲染器/材质）✅（Phase C）
*   - keyframe 动画 / shader / SceneScript 渲染：后续
*/
/** 从 scene.pkg 构建归一化图层模型；失败返回 null（调用方走 fallback） */
function buildSceneModel(pkgBuf, opts) {
	const particleRateScale = opts?.particleRateScale ?? 1;
	const particleSizeScale = opts?.particleSizeScale ?? 1;
	const effectStrengthScale = opts?.effectStrengthScale ?? 1;
	const puppetMeshRender = opts?.puppetMeshRender ?? false;
	let pkg;
	try {
		pkg = parseScenePkg(pkgBuf);
	} catch {
		return null;
	}
	const scene = readSceneJson(pkg);
	if (scene === null || typeof scene !== "object") return null;
	const objects = Array.isArray(scene.objects) ? scene.objects : [];
	const general = scene.general ?? {};
	const cameraRaw = scene.camera ?? {};
	const proj = general.orthogonalprojection;
	const width = toInt(proj?.width, 1920);
	const height = toInt(proj?.height, 1080);
	const fovRad = numOr(general.fov, 50) * Math.PI / 180;
	const perspectiveFocal = height / 2 / Math.tan(fovRad / 2);
	const clearRaw = typeof general.clearcolor === "string" ? general.clearcolor : null;
	const clearColor = clearRaw !== null ? parseColor3(clearRaw) : null;
	const camera = {
		center: parseVec3(cameraRaw.center, [
			0,
			0,
			-1
		]),
		eye: parseVec3(cameraRaw.eye, [
			0,
			0,
			0
		]),
		up: parseVec3(cameraRaw.up, [
			0,
			1,
			0
		])
	};
	const layers = [];
	for (const o of objects) {
		const image = typeof o.image === "string" ? o.image : void 0;
		const kind = resolveKind(o, image);
		const refs = image !== void 0 ? resolveTextureRefs(pkg, image) : {
			materials: [],
			textures: [],
			decodable: null
		};
		const decodable = refs.decodable;
		const puppet = image !== void 0 ? resolvePuppet(pkg, image) : null;
		const particle = typeof o.particle === "string" ? resolveParticleSystem(pkg, o.particle, o, perspectiveFocal) : null;
		layers.push({
			id: toInt(o.id, 0),
			name: typeof o.name === "string" ? o.name : "",
			kind,
			visible: resolveVisible(o.visible, true),
			parent: typeof o.parent === "number" ? o.parent : null,
			size: parseSize(o.size),
			alpha: numOr(o.alpha, 1),
			dayNight: parseDayNightAlpha(o.alpha),
			origin: parseVec3(o.origin, [
				0,
				0,
				0
			]),
			angles: parseVec3(o.angles, [
				0,
				0,
				0
			]),
			scale: parseVec3(o.scale, [
				1,
				1,
				1
			]),
			parallaxDepth: parseVec2(o.parallaxDepth, [1, 1]),
			copybackground: typeof o.copybackground === "boolean" ? o.copybackground : void 0,
			image,
			materialRefs: refs.materials,
			textureRefs: refs.textures,
			decodableTexture: decodable,
			puppet,
			animationIds: parseAnimationIds(o.animationlayers),
			animationLayers: parseAnimationLayers(o.animationlayers),
			attachment: typeof o.attachment === "string" ? o.attachment : null,
			particle,
			effects: parseLayerEffects(o)
		});
	}
	const textures = [];
	for (const e of pkg.entries) if (/\.(tex|png|jpe?g)$/i.test(e.name)) textures.push({
		name: e.name,
		decodable: /\.(png|jpe?g)$/i.test(e.name),
		size: e.size
	});
	return {
		width,
		height,
		camera,
		clearColor,
		layers,
		textures,
		layerCount: layers.length,
		decodableTextureCount: textures.filter((t) => t.decodable).length,
		particleRateScale,
		particleSizeScale,
		effectStrengthScale,
		puppetMeshRender
	};
}
function resolveKind(o, image) {
	if (image !== void 0) return "image";
	const keys = Object.keys(o);
	if (keys.some((k) => /particle/i.test(k))) return "particle";
	if (keys.some((k) => k === "effect" || k === "effects")) return "effect";
	return "unknown";
}
/** 沿 image → material → textures 解析纹理引用链（best-effort，容错） */
function resolveTextureRefs(pkg, imagePath) {
	const materials = [];
	const textures = [];
	try {
		const modelBuf = pkg.read(imagePath);
		if (modelBuf !== null) {
			const model = parseJsonLike(modelBuf);
			if (typeof model.material === "string") {
				materials.push(model.material);
				const matBuf = pkg.read(model.material);
				if (matBuf !== null) {
					const mat = parseJsonLike(matBuf);
					if (Array.isArray(mat.passes)) {
						for (const pass of mat.passes) if (Array.isArray(pass.textures)) for (const t of pass.textures) {
							if (typeof t !== "string") continue;
							for (const cand of [
								"materials/" + t + ".tex",
								"materials/" + t + ".png",
								t
							]) if (pkg.has(cand)) {
								textures.push(cand);
								break;
							}
						}
					}
				}
			}
		}
	} catch {}
	return {
		materials,
		textures,
		decodable: textures.find((t) => /\.(png|jpe?g)$/i.test(t)) ?? null
	};
}
/** 解析图层尺寸 "w h"（正数）；无/非法返回 null */
function parseSize(v) {
	if (typeof v !== "string") return null;
	const parts = v.trim().split(/\s+/).map(Number);
	if (parts.length < 2 || !parts.slice(0, 2).every((n) => Number.isFinite(n) && n > 0)) return null;
	return [parts[0], parts[1]];
}
/** 解析 animationlayers → 动画 id 列表 */
function parseAnimationIds(v) {
	if (!Array.isArray(v)) return [];
	const ids = [];
	for (const a of v) if (a !== null && typeof a === "object" && typeof a.animation === "number") ids.push(a.animation);
	return ids;
}
/** 解析 animationlayers → 全结构（name/blend/rate/additive/visible/animation） */
function parseAnimationLayers(v) {
	if (!Array.isArray(v)) return [];
	const out = [];
	for (const a of v) {
		if (a === null || typeof a !== "object") continue;
		const o = a;
		const vis = o.visible;
		const visible = vis === true || vis !== null && typeof vis === "object" && vis.value === true;
		out.push({
			name: typeof o.name === "string" ? o.name : null,
			animation: typeof o.animation === "number" ? o.animation : null,
			blend: typeof o.blend === "number" && o.blend >= 0 && o.blend <= 1 ? o.blend : 1,
			rate: typeof o.rate === "number" && o.rate > 0 ? o.rate : 1,
			additive: o.additive === true,
			visible
		});
	}
	return out;
}
/** 解析 puppet 骨骼模型：模型 json 的 puppet 字段 → _puppet.mdl → PuppetModel */
function resolvePuppet(pkg, imagePath) {
	try {
		const modelBuf = pkg.read(imagePath);
		if (modelBuf === null) return null;
		const model = parseJsonLike(modelBuf);
		if (typeof model.puppet !== "string") return null;
		const mdlBuf = pkg.read(model.puppet);
		if (mdlBuf === null) return null;
		return parsePuppetMdl(mdlBuf);
	} catch {
		return null;
	}
}
function parseColor3(text) {
	const parts = text.trim().split(/\s+/).map(Number);
	if (parts.length < 3 || parts.some((n) => !Number.isFinite(n))) return [
		0,
		0,
		0
	];
	const scale = Math.max(...parts) > 1.01 ? 1 / 255 : 1;
	return [
		parts[0] * scale,
		parts[1] * scale,
		parts[2] * scale
	];
}
/** 解析图层效果（o.effects：waterwaves/shake/opacity/bloom，取 passes[0].constantshadervalues）。
*  visible 语义：布尔 false / value:false → 不应用；SceneScript 脚本控制（无明确 value）→
*  无法评估，默认不应用（如 3151551777 的 shownight 条件效果）；缺失或 true → 应用。 */
function parseLayerEffects(o) {
	const raw = o.effects;
	if (!Array.isArray(raw)) return [];
	const out = [];
	for (const e of raw) {
		if (e === null || typeof e !== "object") continue;
		const obj = e;
		const vis = obj.visible;
		if (typeof vis === "boolean") {
			if (!vis) continue;
		} else if (vis !== null && typeof vis === "object") {
			const vobj = vis;
			if (vobj.script !== void 0) continue;
			const vval = vobj.value;
			if (typeof vval === "boolean" && !vval) continue;
		}
		const file = typeof obj.file === "string" ? obj.file : "";
		const pass0 = (Array.isArray(obj.passes) ? obj.passes : [])[0] ?? {};
		const csv = pass0.constantshadervalues ?? {};
		const textures = Array.isArray(pass0.textures) ? pass0.textures : [];
		const mask = textures.length > 1 && typeof textures[1] === "string" && textures[1] !== "" ? textures[1] : null;
		const n = (v, d) => {
			const x = Number(v);
			return Number.isFinite(x) ? x : d;
		};
		const v2 = (v, d) => {
			if (typeof v === "string") {
				const p = v.trim().split(/\s+/).map(Number);
				if (p.length >= 2 && p.every((x) => Number.isFinite(x))) return [p[0], p[1]];
			}
			return d;
		};
		if (file.includes("waterwaves")) out.push({
			type: "waterwaves",
			direction: n(csv.direction, 0),
			speed: n(csv.speed, 5),
			scale: n(csv.scale, 200),
			strength: n(csv.strength, .1),
			exponent: n(csv.exponent, 1),
			mask
		});
		else if (file.includes("shake")) out.push({
			type: "shake",
			bounds: v2(csv.bounds, [0, 1]),
			friction: v2(csv.friction, [1, 1]),
			speed: n(csv.speed, 1),
			strength: n(csv.strength, .1),
			mask
		});
		else if (file.includes("opacity")) out.push({
			type: "opacity",
			alpha: n(csv.alpha, 1)
		});
		else if (file.includes("bloom")) out.push({
			type: "bloom",
			gamma: n(csv.gamma, 1),
			opacity: n(csv.opacity, 1),
			radius: n(csv.radius, 5),
			strength: n(csv.strength, .3),
			threshold: n(csv.threshold, 0)
		});
		else if (file.includes("nitro")) {
			const noise = textures.length > 1 && typeof textures[1] === "string" && textures[1] !== "" ? textures[1] : null;
			const mask = textures.length > 2 && typeof textures[2] === "string" && textures[2] !== "" ? textures[2] : null;
			const v2 = (v, d) => {
				if (typeof v === "string") {
					const p = v.trim().split(/\s+/).map(Number);
					if (p.length >= 2 && p.every((x) => Number.isFinite(x))) return [p[0], p[1]];
				}
				return d;
			};
			const v4 = (v, d) => {
				if (typeof v === "string") {
					const p = v.trim().split(/\s+/).map(Number);
					if (p.length >= 4 && p.every((x) => Number.isFinite(x))) return [
						p[0],
						p[1],
						p[2],
						p[3]
					];
				}
				return d;
			};
			out.push({
				type: "nitro",
				colorStart: parseColor3(typeof csv.colorstart === "string" ? csv.colorstart : "0 0.5 1"),
				colorEnd: parseColor3(typeof csv.colorend === "string" ? csv.colorend : "1 1 1"),
				multiply: n(csv.multiply, 1),
				ranges: v2(csv.bounds, [.3, .25]),
				scales: v2(csv.scale, [1, 2]),
				speeds: v4(csv.speed, [
					-.1,
					.7,
					.1,
					-.5
				]),
				smoothness: n(csv.smoothness, 1),
				mask,
				noise
			});
		} else out.push({ type: "unknown" });
	}
	return out;
}
/** 解析粒子预设（particles/*.json）→ 归一化粒子系统描述（best-effort 容错） */
function resolveParticleSystem(pkg, ref, obj, perspectiveFocal) {
	try {
		const buf = pkg.read(ref);
		if (buf === null) return null;
		const preset = parseJsonLike(buf);
		const override = obj.instanceoverride ?? {};
		const matRef = typeof preset.material === "string" ? preset.material : "";
		const textureNames = [];
		let blending = "translucent";
		let overbright = 1;
		let refract = false;
		let refractAmount = 0;
		let hasAlpharandom = false;
		if (matRef !== "") try {
			const mat = parseJsonLike(pkg.read(matRef));
			if (Array.isArray(mat.passes)) for (const pass of mat.passes) {
				if (typeof pass.blending === "string" && pass.blending !== "") blending = pass.blending;
				if (pass.combos !== void 0 && typeof pass.combos === "object" && pass.combos.REFRACT === 1) refract = true;
				const csv = pass.constantshadervalues;
				if (csv !== void 0 && typeof csv === "object") {
					const ob = Number(csv.ui_editor_properties_overbright);
					if (Number.isFinite(ob) && ob > 0) overbright = ob;
					const ra = Number(csv.ui_editor_properties_refract_amount);
					if (Number.isFinite(ra)) refractAmount = ra;
				}
				if (Array.isArray(pass.textures)) {
					for (const t of pass.textures) if (typeof t === "string" && !textureNames.includes(t)) textureNames.push(t);
				}
			}
		} catch {}
		const em = (Array.isArray(preset.emitter) ? preset.emitter : [])[0] ?? {};
		const maxcount = Math.min(toInt(preset.maxcount, 40), 5e3);
		let rate = em.rate !== void 0 ? numOr(em.rate, 1) : Math.max(1, Math.round(maxcount / 15));
		if (typeof override.rate === "number" && override.rate > 0) rate *= override.rate;
		const emitter = {
			type: typeof em.name === "string" ? em.name : "sphererandom",
			rate,
			instantaneous: toInt(em.instantaneous, 0),
			directions: parseVec3(em.directions, [
				1,
				1,
				0
			]),
			distanceMin: numOr(em.distancemin, 0),
			distanceMax: typeof em.distancemax === "string" && em.distancemax.includes(" ") ? parseVec3(em.distancemax, [
				1,
				1,
				1
			]) : numOr(em.distancemax, 1),
			origin: parseVec3(em.origin, [
				0,
				0,
				0
			]),
			speedMin: em.speedmin !== void 0 ? numOr(em.speedmin, 0) : void 0,
			speedMax: em.speedmax !== void 0 ? numOr(em.speedmax, 0) : void 0,
			sign: em.sign !== void 0 ? parseVec3(em.sign, [
				0,
				0,
				0
			]) : void 0
		};
		const initializers = {};
		const ops = {};
		const inits = Array.isArray(preset.initializer) ? preset.initializer : [];
		for (const init of inits) {
			const name = typeof init.name === "string" ? init.name : "";
			const mn = numOr(init.min, 0);
			const mx = numOr(init.max, 0);
			if (name === "lifetimerandom") initializers.lifetime = [mn, mx];
			else if (name === "sizerandom") {
				initializers.size = [mn, mx];
				initializers.sizeExponent = numOr(init.exponent, 1);
			} else if (name === "alpharandom") {
				initializers.alphaMin = mn;
				initializers.alphaMax = mx;
				hasAlpharandom = true;
			} else if (name === "velocityrandom") {
				initializers.velocityMin = parseVec3(init.min, [
					0,
					0,
					0
				]);
				initializers.velocityMax = parseVec3(init.max, [
					0,
					0,
					0
				]);
			} else if (name === "colorrandom") {
				const cmn = parseVec3(init.min, [
					1,
					1,
					1
				]);
				initializers.colorMin = cmn;
				initializers.colorMax = init.max !== void 0 ? parseVec3(init.max, cmn) : cmn;
			} else if (name === "turbulentvelocityrandom") {
				const smin = init.speedmin !== void 0 ? numOr(init.speedmin, 0) : void 0;
				const smax = init.speedmax !== void 0 ? numOr(init.speedmax, 0) : void 0;
				initializers.turbulentVelocity = {
					offset: init.offset !== void 0 ? numOr(init.offset, .5) : .5,
					scale: init.scale !== void 0 ? numOr(init.scale, .1) : .1,
					speedMin: smin,
					speedMax: smax,
					phaseMin: init.phasemin !== void 0 ? numOr(init.phasemin, 0) : void 0,
					phaseMax: init.phasemax !== void 0 ? numOr(init.phasemax, 1) : void 0,
					timescale: init.timescale !== void 0 ? numOr(init.timescale, .1) : void 0
				};
			} else if (name === "rotationrandom") {
				const rmn = parseVec3(init.min, [
					0,
					0,
					0
				]);
				const rmx = parseVec3(init.max, [
					0,
					0,
					0
				]);
				const rz = rmx[2] !== 0 ? rmx[2] : Math.PI * 2;
				initializers.rotation = [rmn[2] !== 0 ? rmn[2] : 0, Math.max(rz, rmn[2])];
			} else if (name === "angularvelocityrandom") {
				const v = parseVec3(init.min, [
					0,
					0,
					0
				]);
				const w = parseVec3(init.max, [
					0,
					0,
					0
				]);
				initializers.angularVelocity = [v[2], w[2]];
			}
		}
		const operators = Array.isArray(preset.operator) ? preset.operator : [];
		for (const op of operators) {
			const name = typeof op.name === "string" ? op.name : "";
			if (name === "movement") {
				ops.gravity = parseVec3(op.gravity, [
					0,
					0,
					0
				]);
				ops.drag = numOr(op.drag, 0);
			} else if (name === "angularmovement") {
				ops.angularDrag = numOr(op.drag, 0);
				ops.angularForce = parseVec3(op.force, [
					0,
					0,
					0
				]);
			} else if (name === "alphafade") ops.alphaFade = {
				fadeIn: numOr(op.fadeintime, 0),
				fadeOut: numOr(op.fadeouttime, 0)
			};
			else if (name === "turbulence") ops.turbulence = {
				scale: numOr(op.scale, .002),
				speedMin: numOr(op.speedmin, 100),
				speedMax: numOr(op.speedmax, 150),
				phaseMax: numOr(op.phasemax, 5),
				mask: typeof op.mask === "string" ? op.mask : "1 0 0"
			};
			else if (name === "oscillatealpha") ops.oscillateAlpha = {
				frequencyMax: numOr(op.frequencymax, 20),
				scaleMin: numOr(op.scalemin, .7)
			};
			else if (name === "oscillateposition") ops.oscillatePosition = {
				frequencyMin: numOr(op.frequencymin, 1),
				frequencyMax: numOr(op.frequencymax, 1),
				scaleMin: numOr(op.scalemin, 1),
				scaleMax: numOr(op.scalemax, 1),
				mask: parseVec3(op.mask, [
					1,
					1,
					0
				])
			};
			else if (name === "sizechange") (ops.sizeChanges ??= []).push({
				startTime: numOr(op.starttime, 0),
				endTime: op.endtime !== void 0 ? numOr(op.endtime, 1) : void 0,
				startValue: numOr(op.startvalue, 1),
				endValue: numOr(op.endvalue, 1)
			});
			else if (name === "remapvalue" && typeof op.output === "string" && op.output === "velocity") ops.velocityRemap = {
				min: parseVec3(op.outputrangemin, [
					0,
					0,
					0
				]),
				max: parseVec3(op.outputrangemax, [
					0,
					0,
					0
				])
			};
		}
		const rd = (Array.isArray(preset.renderer) ? preset.renderer : [])[0] ?? {};
		const renderer = {
			type: typeof rd.name === "string" ? rd.name : "sprite",
			length: numOr(rd.length, void 0),
			maxlength: numOr(rd.maxlength, void 0),
			minlength: numOr(rd.minlength, void 0)
		};
		const seqMultRaw = preset.sequencemultiplier;
		const sequenceMultiplier = typeof seqMultRaw === "number" && Number.isFinite(seqMultRaw) && seqMultRaw > 0 ? seqMultRaw : 1;
		const children = [];
		if (Array.isArray(preset.children)) {
			for (const c of preset.children) if (c !== null && typeof c === "object" && typeof c.name === "string") {
				const child = resolveParticleSystem(pkg, c.name, obj, perspectiveFocal);
				if (child !== null) children.push({
					desc: child,
					type: typeof c.type === "string" ? c.type : null
				});
			}
		}
		if (typeof override.colorn === "string") {
			const c = parseColor3(override.colorn);
			initializers.colorMin = [
				c[0] * 255,
				c[1] * 255,
				c[2] * 255
			];
			initializers.colorMax = [
				c[0] * 255,
				c[1] * 255,
				c[2] * 255
			];
		}
		if (typeof override.alpha === "number") {
			const f = Math.max(0, override.alpha);
			if (initializers.alphaMin !== void 0 && initializers.alphaMax !== void 0) {
				initializers.alphaMin *= f;
				initializers.alphaMax *= f;
			} else {
				initializers.alphaMin = f;
				initializers.alphaMax = f;
			}
		}
		if (typeof override.lifetime === "number") {
			const f = override.lifetime;
			if (initializers.lifetime !== void 0) initializers.lifetime = [initializers.lifetime[0] * f, initializers.lifetime[1] * f];
			else initializers.lifetime = [f, f];
		}
		if (typeof override.size === "number") {
			const f = override.size;
			if (initializers.size !== void 0) initializers.size = [initializers.size[0] * f, initializers.size[1] * f];
			else initializers.size = [32 * f, 32 * f];
		}
		if (typeof override.speed === "number") {
			const f = override.speed;
			if (initializers.velocityMin !== void 0 && initializers.velocityMax !== void 0) {
				initializers.velocityMin = [
					initializers.velocityMin[0] * f,
					initializers.velocityMin[1] * f,
					initializers.velocityMin[2] * f
				];
				initializers.velocityMax = [
					initializers.velocityMax[0] * f,
					initializers.velocityMax[1] * f,
					initializers.velocityMax[2] * f
				];
			}
		}
		if (typeof override.count === "number" && override.count > 0) emitter.rate *= override.count;
		let controlPointLine = null;
		let sequenceCount = 0;
		let sequenceMirror = false;
		const cp1 = (Array.isArray(preset.controlpoint) ? preset.controlpoint : []).find((c) => c.id === 1);
		if (cp1 !== void 0) {
			const flags = numOr(cp1.flags, 0);
			const rawOff = override.controlpoint1 !== void 0 ? override.controlpoint1 : cp1.offset;
			if (typeof rawOff === "string") {
				const off = parseVec3(rawOff, [
					0,
					0,
					0
				]);
				if ((flags & 2) !== 0) {
					const originW = parseVec3(obj.origin, [
						0,
						0,
						0
					]);
					controlPointLine = [off[0] - originW[0], off[1] - originW[1]];
				} else controlPointLine = [off[0], off[1]];
			}
		}
		for (const init of inits) if (typeof init.name === "string" && init.name === "mapsequencebetweencontrolpoints") {
			sequenceCount = numOr(init.count, 0);
			sequenceMirror = init.limitbehavior === "mirror";
		}
		return {
			particleRef: ref,
			materialRef: matRef,
			blending,
			refract,
			refractAmount,
			animationMode: typeof preset.animationmode === "string" ? preset.animationmode : null,
			overbright,
			textureNames,
			maxCount: maxcount,
			hasAlpharandom,
			startTime: numOr(preset.starttime, 0),
			worldSpace: (numOr(preset.flags, 0) & 1) !== 0,
			perspective: (numOr(preset.flags, 0) & 4) !== 0,
			perspectiveFocal,
			emitter,
			initializers,
			operators: ops,
			renderer,
			sequenceMultiplier,
			children,
			controlPointLine,
			sequenceCount,
			sequenceMirror
		};
	} catch {
		return null;
	}
}
function numOr(v, def) {
	if (v === void 0) return def;
	const n = Number(v);
	return Number.isFinite(n) ? n : def;
}
/**
* 检测图层 alpha 的 SceneScript：若依赖 engine.timeOfDay 且含 START_HOUR/END_HOUR，
* 提取日出/日落小时作为昼夜自动切换（auto 模式）依据。
*
* 模式（WE 常见 day/night 脚本）：
*   Math.max(WEMath.smoothStep(START_HOUR/24, (START_HOUR-ε)/24, engine.timeOfDay),
*            WEMath.smoothStep((END_HOUR-ε)/24,  END_HOUR/24,  engine.timeOfDay))
*   语义：夜间（<START 或 >END）→ 1（夜空层显示），白天（START..END）→ 0（夜空层隐藏）。
*
* 返回 null = 无昼夜脚本（用静态 alpha）；否则给出日出/日落小时与两端是夜还是昼。
*/
function parseDayNightAlpha(v) {
	if (typeof v !== "object" || v === null) return void 0;
	const script = v.script;
	if (typeof script !== "string") return void 0;
	if (!script.includes("engine") || !script.includes("timeOfDay")) return void 0;
	let startH = 7;
	let endH = 18;
	let hasStart = false;
	let hasEnd = false;
	const sh = /START_HOUR\s*=\s*([0-9.]+)/.exec(script);
	if (sh !== null) {
		startH = Number(sh[1]);
		hasStart = true;
	}
	const eh = /END_HOUR\s*=\s*([0-9.]+)/.exec(script);
	if (eh !== null) {
		endH = Number(eh[1]);
		hasEnd = true;
	}
	if (!hasStart || !hasEnd) return void 0;
	if (startH < 0 || startH > 24 || endH < 0 || endH > 24) return void 0;
	const negated = /1\s*-\s*WEMath\.smoothStep/.test(script);
	return {
		dayStartH: startH,
		dayEndH: endH,
		nightWhenStart: !negated,
		nightWhenEnd: !negated
	};
}
function toInt(v, def) {
	const n = Number(v);
	return Number.isFinite(n) && n > 0 ? Math.round(n) : def;
}
//#endregion
//#region src/scene/TexDecode.ts
/** 从 4×4 块解码一整个 mip（宽高任意，块不足补边处按块边界取整） */
function decodeMip(format, data, dataOffset, width, height) {
	const out = new Uint8ClampedArray(width * height * 4);
	switch (format) {
		case "rgba8888":
			for (let i = 0; i < width * height; i++) {
				const s = dataOffset + i * 4;
				out[i * 4] = data[s];
				out[i * 4 + 1] = data[s + 1];
				out[i * 4 + 2] = data[s + 2];
				out[i * 4 + 3] = data[s + 3];
			}
			return out;
		case "rgba16f":
			for (let i = 0; i < width * height; i++) {
				const s = dataOffset + i * 8;
				out[i * 4] = halfToByte(data, s);
				out[i * 4 + 1] = halfToByte(data, s + 2);
				out[i * 4 + 2] = halfToByte(data, s + 4);
				out[i * 4 + 3] = halfToByte(data, s + 6);
			}
			return out;
		case "r16f":
			for (let i = 0; i < width * height; i++) {
				const v = halfToByte(data, dataOffset + i * 2);
				out[i * 4] = v;
				out[i * 4 + 1] = v;
				out[i * 4 + 2] = v;
				out[i * 4 + 3] = 255;
			}
			return out;
		case "l8":
			for (let i = 0; i < width * height; i++) {
				const v = data[dataOffset + i];
				out[i * 4] = v;
				out[i * 4 + 1] = v;
				out[i * 4 + 2] = v;
				out[i * 4 + 3] = 255;
			}
			return out;
		case "r8":
			for (let i = 0; i < width * height; i++) {
				const v = data[dataOffset + i];
				out[i * 4] = 255;
				out[i * 4 + 1] = 255;
				out[i * 4 + 2] = 255;
				out[i * 4 + 3] = v;
			}
			return out;
		case "rg88":
			for (let i = 0; i < width * height; i++) {
				const r = data[dataOffset + i * 2];
				const g = data[dataOffset + i * 2 + 1];
				out[i * 4] = r;
				out[i * 4 + 1] = r;
				out[i * 4 + 2] = r;
				out[i * 4 + 3] = g;
			}
			return out;
		case "dxt1": {
			const bw = Math.max(1, Math.ceil(width / 4));
			const bh = Math.max(1, Math.ceil(height / 4));
			for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
				const blockOffset = dataOffset + (by * bw + bx) * 8;
				if (blockOffset + 8 > data.length) break;
				decodeDxt1Block(data, blockOffset, out, bx * 4, by * 4, width, height);
			}
			return out;
		}
		case "dxt5": {
			const bw = Math.max(1, Math.ceil(width / 4));
			const bh = Math.max(1, Math.ceil(height / 4));
			for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
				const blockOffset = dataOffset + (by * bw + bx) * 16;
				if (blockOffset + 16 > data.length) break;
				decodeDxt5Block(data, blockOffset, out, bx * 4, by * 4, width, height);
			}
			return out;
		}
		case "dxt3": {
			const bw = Math.max(1, Math.ceil(width / 4));
			const bh = Math.max(1, Math.ceil(height / 4));
			for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
				const blockOffset = dataOffset + (by * bw + bx) * 16;
				if (blockOffset + 16 > data.length) break;
				decodeDxt3Block(data, blockOffset, out, bx * 4, by * 4, width, height);
			}
			return out;
		}
		case "bc7": throw new Error("BC7 decode not implemented yet");
	}
}
/** 单个 DXT1 块（8 字节）解码到输出（px,py 为该块左上角） */
function decodeDxt1Block(data, off, out, px, py, width, height) {
	const c0v = data[off] | data[off + 1] << 8;
	const c1v = data[off + 2] | data[off + 3] << 8;
	const c0 = rgb565(c0v);
	const c1 = rgb565(c1v);
	let c2;
	let c3;
	let transparent = false;
	if (c0v > c1v) {
		c2 = [
			Math.round((2 * c0[0] + c1[0]) / 3),
			Math.round((2 * c0[1] + c1[1]) / 3),
			Math.round((2 * c0[2] + c1[2]) / 3)
		];
		c3 = [
			Math.round((c0[0] + 2 * c1[0]) / 3),
			Math.round((c0[1] + 2 * c1[1]) / 3),
			Math.round((c0[2] + 2 * c1[2]) / 3)
		];
	} else {
		c2 = [
			Math.round((c0[0] + c1[0]) / 2),
			Math.round((c0[1] + c1[1]) / 2),
			Math.round((c0[2] + c1[2]) / 2)
		];
		c3 = [
			0,
			0,
			0
		];
		transparent = true;
	}
	for (let y = 0; y < 4; y++) {
		const row = data[off + 4 + y];
		for (let x = 0; x < 4; x++) {
			const idx = row >> x * 2 & 3;
			const tx = px + x;
			const ty = py + y;
			if (tx >= width || ty >= height) continue;
			let r, g, b, a = 255;
			if (idx === 0) {
				r = c0[0];
				g = c0[1];
				b = c0[2];
			} else if (idx === 1) {
				r = c1[0];
				g = c1[1];
				b = c1[2];
			} else if (idx === 2) {
				r = c2[0];
				g = c2[1];
				b = c2[2];
			} else {
				r = c3[0];
				g = c3[1];
				b = c3[2];
				if (transparent) a = 0;
			}
			const o = (ty * width + tx) * 4;
			out[o] = r;
			out[o + 1] = g;
			out[o + 2] = b;
			out[o + 3] = a;
		}
	}
}
/** 单个 DXT5 块（16 字节）解码 */
function decodeDxt5Block(data, off, out, px, py, width, height) {
	const a0 = data[off];
	const a1 = data[off + 1];
	const alphas = [a0, a1];
	if (a0 > a1) for (let i = 2; i < 8; i++) alphas[i] = Math.round(((8 - i) * a0 + (i - 1) * a1) / 7);
	else {
		for (let i = 2; i < 6; i++) alphas[i] = Math.round(((6 - i) * a0 + (i - 1) * a1) / 5);
		alphas[6] = 0;
		alphas[7] = 255;
	}
	const alphaIdx = [];
	for (let p = 0; p < 16; p++) {
		const bit = p * 3;
		const byte = off + 2 + (bit >> 3);
		const shift = bit & 7;
		const lo = data[byte];
		const hi = byte + 1 < data.length ? data[byte + 1] : 0;
		alphaIdx.push((lo | hi << 8) >> shift & 7);
	}
	const c0v = data[off + 8] | data[off + 9] << 8;
	const c1v = data[off + 10] | data[off + 11] << 8;
	const c0 = rgb565(c0v);
	const c1 = rgb565(c1v);
	const c2 = [
		Math.round((2 * c0[0] + c1[0]) / 3),
		Math.round((2 * c0[1] + c1[1]) / 3),
		Math.round((2 * c0[2] + c1[2]) / 3)
	];
	const c3 = [
		Math.round((c0[0] + 2 * c1[0]) / 3),
		Math.round((c0[1] + 2 * c1[1]) / 3),
		Math.round((c0[2] + 2 * c1[2]) / 3)
	];
	for (let y = 0; y < 4; y++) {
		const row = data[off + 12 + y];
		for (let x = 0; x < 4; x++) {
			const ci = row >> x * 2 & 3;
			const tx = px + x;
			const ty = py + y;
			if (tx >= width || ty >= height) continue;
			let r, g, b;
			if (ci === 0) {
				r = c0[0];
				g = c0[1];
				b = c0[2];
			} else if (ci === 1) {
				r = c1[0];
				g = c1[1];
				b = c1[2];
			} else if (ci === 2) {
				r = c2[0];
				g = c2[1];
				b = c2[2];
			} else {
				r = c3[0];
				g = c3[1];
				b = c3[2];
			}
			const o = (ty * width + tx) * 4;
			const a = alphas[alphaIdx[y * 4 + x]];
			out[o] = r;
			out[o + 1] = g;
			out[o + 2] = b;
			out[o + 3] = a;
		}
	}
}
/** 单个 DXT3 块（16 字节）：8 字节 4-bit alpha + DXT1 4-color 颜色 */
function decodeDxt3Block(data, off, out, px, py, width, height) {
	const c0v = data[off + 8] | data[off + 9] << 8;
	const c1v = data[off + 10] | data[off + 11] << 8;
	const c0 = rgb565(c0v);
	const c1 = rgb565(c1v);
	const c2 = [
		Math.round((2 * c0[0] + c1[0]) / 3),
		Math.round((2 * c0[1] + c1[1]) / 3),
		Math.round((2 * c0[2] + c1[2]) / 3)
	];
	const c3 = [
		Math.round((c0[0] + 2 * c1[0]) / 3),
		Math.round((c0[1] + 2 * c1[1]) / 3),
		Math.round((c0[2] + 2 * c1[2]) / 3)
	];
	for (let y = 0; y < 4; y++) {
		const row = data[off + 12 + y];
		const alphaRow = data[off + y * 2] | data[off + y * 2 + 1] << 8;
		for (let x = 0; x < 4; x++) {
			const ci = row >> x * 2 & 3;
			const tx = px + x;
			const ty = py + y;
			if (tx >= width || ty >= height) continue;
			let r, g, b;
			if (ci === 0) {
				r = c0[0];
				g = c0[1];
				b = c0[2];
			} else if (ci === 1) {
				r = c1[0];
				g = c1[1];
				b = c1[2];
			} else if (ci === 2) {
				r = c2[0];
				g = c2[1];
				b = c2[2];
			} else {
				r = c3[0];
				g = c3[1];
				b = c3[2];
			}
			const a = (alphaRow >> x * 4 & 15) * 17;
			const o = (ty * width + tx) * 4;
			out[o] = r;
			out[o + 1] = g;
			out[o + 2] = b;
			out[o + 3] = a;
		}
	}
}
/** RGB565 → [r,g,b] 0-255 */
function rgb565(v) {
	return [
		Math.round((v >> 11 & 31) * 255 / 31),
		Math.round((v >> 5 & 63) * 255 / 63),
		Math.round((v & 31) * 255 / 31)
	];
}
/** IEEE 754 半精度浮点 → 0-255 字节 */
function halfToByte(data, off) {
	const h = data[off] | data[off + 1] << 8;
	const sign = h >> 15 & 1;
	const exp = h >> 10 & 31;
	const mant = h & 1023;
	let f;
	if (exp === 0) f = mant * 2 ** -24;
	else if (exp === 31) f = mant === 0 ? Infinity : NaN;
	else f = (1 + mant / 1024) * 2 ** (exp - 15);
	if (sign) f = -f;
	if (!Number.isFinite(f)) return 0;
	const v = Math.round(f * 255);
	return v < 0 ? 0 : v > 255 ? 255 : v;
}
//#endregion
//#region src/scene/SceneTex.ts
/**
* SceneTex —— Wallpaper Engine .tex 纹理容器完整解码器。
*
* 格式（已实测破解 + repkg(MIT, notscuffed) 源码语义确认，参考文件见
* _dev/reference/）：
*   Magic1 "0005\0" + Magic2 "TEXI0001\0"（null 终止字符串）
*   Header（7 × int32 raw）：
*     Format（TexFormat：0=RGBA8888, 4=DXT5, 6=DXT3, 7=DXT1, 8=RG88, 9=R8）
*     Flags（TexFlags：2=ClampUVs …）、TextureWidth、TextureHeight、
*     ImageWidth、ImageHeight、UnkInt0
*   ImageContainer：
*     "TEXB0003\0" / "TEXB0004\0" + imageCount（int32）
*     TEXB0003：ImageFormat（FreeImageFormat：13=PNG, 2=JPEG, -1=raw）
*     TEXB0004：ImageFormat + isVideoMp4
*     每个 image：mipmapCount + 每级 [W][H][IsLZ4][DecompressedBytesCount]
*       [byteCount][bytes]
*       - ImageFormat 为图片格式：bytes = 完整 PNG/JPEG 文件
*       - ImageFormat 为 raw：bytes = LZ4 压缩流 → 解压为 Header.Format
*         的像素数据（DXT1/DXT3/DXT5/RGBA8888/RG88/R8）
*
* 本模块仅被 node 半使用（路由），因此可依赖 node:zlib（PNG 编码）。
*/
/** Header.Format（TexFormat） */
const TEX_FORMAT = {
	RGBA8888: 0,
	DXT5: 4,
	DXT3: 6,
	DXT1: 7,
	RG88: 8,
	R8: 9
};
/** 容器 ImageFormat（FreeImageFormat 子集） */
const FIF = {
	UNKNOWN: -1,
	JPEG: 2,
	PNG: 13
};
/** 解析 .tex 容器；返回 null 表示无法解析 */
function decodeTex(bytes) {
	try {
		let pos = 0;
		const readNString = () => {
			let s = "";
			while (pos < bytes.length) {
				const c = bytes[pos++];
				if (c === 0) break;
				s += String.fromCharCode(c);
			}
			return s;
		};
		const readI32 = () => {
			const v = bytes[pos] | bytes[pos + 1] << 8 | bytes[pos + 2] << 16 | bytes[pos + 3] << 24;
			pos += 4;
			return v;
		};
		const magic1 = readNString();
		const magic2 = readNString();
		if (magic1 !== "0005" && magic1 !== "TEXV0005" || magic2 !== "TEXI0001") return null;
		const format = readI32();
		const flags = readI32();
		const textureWidth = readI32();
		const textureHeight = readI32();
		const imageWidth = readI32();
		const imageHeight = readI32();
		readI32();
		const containerMagic = readNString();
		if (containerMagic !== "TEXB0001" && containerMagic !== "TEXB0002" && containerMagic !== "TEXB0003" && containerMagic !== "TEXB0004") return null;
		const imageCount = readI32();
		let imageFormat = FIF.UNKNOWN;
		if (containerMagic === "TEXB0003") imageFormat = readI32();
		else if (containerMagic === "TEXB0004") {
			imageFormat = readI32();
			readI32();
		}
		if (imageCount <= 0 || imageCount > 100) return null;
		const readMip = () => {
			if (pos + 20 > bytes.length) return null;
			const mw = readI32();
			const mh = readI32();
			const lz = readI32();
			const dc = readI32();
			const bc = readI32();
			if (mw <= 0 || mh <= 0 || mw > 16384 || mh > 16384 || bc < 0 || pos + bc > bytes.length) return null;
			const d = bytes.subarray(pos, pos + bc);
			pos += bc;
			return {
				w: mw,
				h: mh,
				isLz4: lz,
				dec: dc,
				data: d
			};
		};
		const mipCount = readI32();
		if (mipCount <= 0 || mipCount > 32) return null;
		const page0 = readMip();
		if (page0 === null) return null;
		const dataOffset = pos - page0.data.length;
		const pages = [page0];
		for (let mm = 1; mm < mipCount; mm++) if (readMip() === null) return null;
		for (let img = 1; img < imageCount; img++) {
			const mc = readI32();
			if (mc <= 0 || mc > 32) return null;
			const pm = readMip();
			if (pm === null) return null;
			pages.push(pm);
			for (let mm = 1; mm < mc; mm++) if (readMip() === null) return null;
		}
		let kind;
		if (imageFormat === FIF.PNG) kind = "image-png";
		else if (imageFormat === FIF.JPEG) kind = "image-jpeg";
		else kind = "raw";
		const parsedFrames = (() => {
			if (pos + 9 > bytes.length) return null;
			const magic3 = String.fromCharCode(bytes[pos], bytes[pos + 1], bytes[pos + 2], bytes[pos + 3], bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7], bytes[pos + 8]);
			if (magic3 !== "TEXS0001\0" && magic3 !== "TEXS0002\0" && magic3 !== "TEXS0003\0") return null;
			let fp = pos + 9;
			const readU32 = () => {
				const v = (bytes[fp] | bytes[fp + 1] << 8 | bytes[fp + 2] << 16 | bytes[fp + 3] << 24) >>> 0;
				fp += 4;
				return v;
			};
			const readF32 = () => {
				const v = bytes[fp] | bytes[fp + 1] << 8 | bytes[fp + 2] << 16 | bytes[fp + 3] << 24;
				fp += 4;
				return new Float32Array(new Int32Array([v]).buffer)[0];
			};
			const frameCount = readU32();
			if (frameCount <= 1 || frameCount > 4096) return null;
			if (magic3 === "TEXS0003\0") {
				readU32();
				readU32();
			}
			const out = [];
			for (let f = 0; f < frameCount && fp + 32 <= bytes.length; f++) {
				const page = readU32();
				const t = readF32();
				if (magic3 === "TEXS0001\0") {
					const fx = readU32();
					const fy = readU32();
					const fw = readU32();
					readU32();
					readU32();
					const fh = readU32();
					out.push({
						x: fx,
						y: fy,
						w: fw,
						h: fh,
						t,
						page
					});
				} else {
					const fx = readF32();
					const fy = readF32();
					const w1 = readF32();
					const w2 = readF32();
					const h2 = readF32();
					const h1 = readF32();
					const fw = Math.max(Math.abs(w1), Math.abs(w2));
					const fh = Math.max(Math.abs(h1), Math.abs(h2));
					if (fw <= 0 || fh <= 0) return null;
					out.push({
						x: fx,
						y: fy,
						w: fw,
						h: fh,
						t,
						page
					});
				}
			}
			return out.length > 1 ? out : null;
		})();
		const decodePageRgba = (p) => {
			let d = p.data;
			if (p.isLz4 === 1) {
				const raw = lz4Decompress(d, p.dec);
				if (raw === null) return null;
				d = raw;
			}
			return kind === "raw" ? decodeRawPixels(format, p.w, p.h, d) : null;
		};
		const multiPage = kind === "raw" && pages.length > 1 && parsedFrames !== null && parsedFrames.some((f) => f.page > 0);
		let w;
		let h;
		let rgba;
		let data;
		let frames = null;
		if (multiPage && parsedFrames !== null) {
			const pageRgba = pages.map(decodePageRgba);
			if (pageRgba.some((r) => r === null)) return null;
			w = Math.max(...pages.map((p) => p.w));
			const yOff = [];
			let acc = 0;
			for (const p of pages) {
				yOff.push(acc);
				acc += p.h;
			}
			h = acc;
			rgba = new Uint8ClampedArray(w * h * 4);
			for (let i = 0; i < pages.length; i++) {
				const pr = pageRgba[i];
				const pw = pages[i].w;
				const ph = pages[i].h;
				for (let y = 0; y < ph; y++) rgba.set(pr.subarray(y * pw * 4, (y + 1) * pw * 4), (yOff[i] + y) * w * 4);
			}
			data = page0.data;
			frames = parsedFrames.map((f) => ({
				x: f.x,
				y: f.y + (f.page < yOff.length ? yOff[f.page] : 0),
				w: f.w,
				h: f.h,
				t: f.t
			}));
		} else {
			const p0 = pages[0];
			w = p0.w;
			h = p0.h;
			let d = p0.data;
			if (p0.isLz4 === 1) {
				const raw = lz4Decompress(d, p0.dec);
				if (raw === null) return null;
				d = raw;
			}
			data = d;
			rgba = kind === "raw" ? decodeRawPixels(format, w, h, d) : null;
			if (kind === "raw" && rgba === null) return null;
			frames = parsedFrames === null ? null : parsedFrames.map((f) => ({
				x: f.x,
				y: f.y,
				w: f.w,
				h: f.h,
				t: f.t
			}));
		}
		if (frames !== null) {
			const isBlankFrame = (fr) => {
				if (rgba === null) return false;
				if (fr.x < 0 || fr.y < 0 || fr.x + fr.w > w || fr.y + fr.h > h) return true;
				let opaque = 0;
				let total = 0;
				for (let y = 0; y < fr.h; y += 3) for (let x = 0; x < fr.w; x += 3) {
					const s = ((fr.y + y) * w + (fr.x + x)) * 4;
					if (rgba[s + 3] > 16) opaque++;
					total++;
				}
				return total === 0 || opaque / total < .05;
			};
			const kept = frames.filter((fr) => !isBlankFrame(fr));
			frames = kept.length > 1 ? kept : null;
		}
		return {
			format,
			flags,
			textureWidth,
			textureHeight,
			imageWidth,
			imageHeight,
			containerMagic,
			imageFormat,
			mipCount,
			mip0: {
				width: w,
				height: h,
				kind,
				data,
				dataOffset,
				rgba
			},
			frames
		};
	} catch {
		return null;
	}
}
/** raw 像素解码：DXT1/DXT3/DXT5/RGBA8888/R8 → RGBA8888 */
function decodeRawPixels(format, w, h, data) {
	let fmt;
	switch (format) {
		case TEX_FORMAT.DXT1:
			fmt = "dxt1";
			break;
		case TEX_FORMAT.DXT3:
			fmt = "dxt3";
			break;
		case TEX_FORMAT.DXT5:
			fmt = "dxt5";
			break;
		case TEX_FORMAT.RGBA8888:
			fmt = "rgba8888";
			break;
		case TEX_FORMAT.R8:
			fmt = "r8";
			break;
		case TEX_FORMAT.RG88:
			fmt = "rg88";
			break;
		default: return null;
	}
	try {
		return decodeMip(fmt, data, 0, w, h);
	} catch {
		return null;
	}
}
/**
* 把 mip0 转成可直接伺服/解码的字节：
*   image-png → 原 PNG 字节；image-jpeg → 原 JPEG 字节；raw → RGBA → PNG
*/
function texMipToPng(tex) {
	const m0 = tex.mip0;
	if (m0 === null) return null;
	if (m0.kind === "image-png" || m0.kind === "image-jpeg") return m0.data;
	if (m0.rgba === null) return null;
	return rgbaToPng(m0.rgba, m0.width, m0.height);
}
/** mip0 的 MIME（image 类型返回图片 MIME；raw 返回 image/png） */
function texMimeOf(tex) {
	const m0 = tex.mip0;
	if (m0 === null) return null;
	if (m0.kind === "image-png") return "image/png";
	if (m0.kind === "image-jpeg") return "image/jpeg";
	return "image/png";
}
function lz4Decompress(src, expectedLen) {
	const out = new Uint8Array(expectedLen);
	let ip = 0;
	let op = 0;
	const end = src.length;
	while (ip < end) {
		const token = src[ip++];
		let litLen = token >> 4;
		if (litLen === 15) {
			let b;
			do {
				if (ip >= end) return null;
				b = src[ip++];
				litLen += b;
			} while (b === 255);
		}
		if (op + litLen > expectedLen || ip + litLen > end) return null;
		for (let i = 0; i < litLen; i++) out[op++] = src[ip++];
		if (ip >= end) break;
		if (ip + 2 > end) return null;
		const offset = src[ip] | src[ip + 1] << 8;
		ip += 2;
		if (offset === 0 || offset > op) return null;
		let matchLen = token & 15;
		if (matchLen === 15) {
			let b;
			do {
				if (ip >= end) return null;
				b = src[ip++];
				matchLen += b;
			} while (b === 255);
		}
		matchLen += 4;
		for (let i = 0; i < matchLen; i++) {
			out[op] = out[op - offset];
			op++;
			if (op > expectedLen) return null;
		}
	}
	if (op !== expectedLen) return null;
	return out;
}
const CRC_TABLE$2 = (() => {
	const t = /* @__PURE__ */ new Int32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 3988292384 ^ c >>> 1 : c >>> 1;
		t[n] = c;
	}
	return t;
})();
function crc32$1(buf) {
	let c = 4294967295;
	for (let i = 0; i < buf.length; i++) c = CRC_TABLE$2[(c ^ buf[i]) & 255] ^ c >>> 8;
	return (c ^ 4294967295) >>> 0;
}
function pngChunk(type, data) {
	const len = /* @__PURE__ */ new Uint8Array(4);
	len[0] = data.length >>> 24 & 255;
	len[1] = data.length >>> 16 & 255;
	len[2] = data.length >>> 8 & 255;
	len[3] = data.length & 255;
	const td = new Uint8Array(4 + data.length);
	for (let i = 0; i < 4; i++) td[i] = type.charCodeAt(i);
	td.set(data, 4);
	const crc = /* @__PURE__ */ new Uint8Array(4);
	const c = crc32$1(td);
	crc[0] = c >>> 24 & 255;
	crc[1] = c >>> 16 & 255;
	crc[2] = c >>> 8 & 255;
	crc[3] = c & 255;
	const out = new Uint8Array(4 + td.length + 4);
	out.set(len, 0);
	out.set(td, 4);
	out.set(crc, 4 + td.length);
	return out;
}
function rgbaToPng(rgba, w, h) {
	const ihdr = /* @__PURE__ */ new Uint8Array(13);
	ihdr[0] = w >>> 24 & 255;
	ihdr[1] = w >>> 16 & 255;
	ihdr[2] = w >>> 8 & 255;
	ihdr[3] = w & 255;
	ihdr[4] = h >>> 24 & 255;
	ihdr[5] = h >>> 16 & 255;
	ihdr[6] = h >>> 8 & 255;
	ihdr[7] = h & 255;
	ihdr[8] = 8;
	ihdr[9] = 6;
	ihdr[10] = 0;
	ihdr[11] = 0;
	ihdr[12] = 0;
	const raw = new Uint8Array(h * (1 + w * 4));
	for (let y = 0; y < h; y++) {
		raw[y * (1 + w * 4)] = 0;
		for (let x = 0; x < w; x++) {
			const s = (y * w + x) * 4;
			const d = y * (1 + w * 4) + 1 + x * 4;
			raw[d] = rgba[s];
			raw[d + 1] = rgba[s + 1];
			raw[d + 2] = rgba[s + 2];
			raw[d + 3] = rgba[s + 3];
		}
	}
	const idat = deflateSync(Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength), { level: 6 });
	const sig = new Uint8Array([
		137,
		80,
		78,
		71,
		13,
		10,
		26,
		10
	]);
	const ih = pngChunk("IHDR", ihdr);
	const id = pngChunk("IDAT", new Uint8Array(idat));
	const ie = pngChunk("IEND", /* @__PURE__ */ new Uint8Array(0));
	const out = new Uint8Array(sig.length + ih.length + id.length + ie.length);
	out.set(sig, 0);
	out.set(ih, sig.length);
	out.set(id, sig.length + ih.length);
	out.set(ie, sig.length + ih.length + id.length);
	return out;
}
//#endregion
//#region src/market/catalog.ts
const defaultFetch = (url) => fetch(url);
/** 拉取并粗校验 catalog.json。 */
async function fetchCatalog(url, fetchFn = defaultFetch) {
	const res = await fetchFn(url);
	if (!res.ok) throw new Error(`catalog 拉取失败 ${url}: ${res.status}`);
	const raw = await res.json();
	if (typeof raw !== "object" || raw === null || !Array.isArray(raw.entries)) throw new Error("catalog 形状非法：缺 entries 数组");
	if (raw.schemaVersion !== 1) throw new Error(`catalog schemaVersion 不支持: ${raw.schemaVersion}`);
	return {
		schemaVersion: 1,
		generatedAt: raw.generatedAt ?? "",
		count: raw.entries.length,
		entries: raw.entries
	};
}
/** 免费包可自动安装；付费包需先经销售平台授权。 */
const canAutoInstall = (e) => e.license.commercial === false;
//#endregion
//#region src/market/integrity.ts
/**
* 完整性校验（R4 market 拉取）：npm 风格 "sha512-<base64>"。
* 下载字节必须匹配注册表声明的 integrity，否则拒绝安装（防篡改/半包）。
*/
/** Node crypto Hash.update 的 data 长度是 int32（上限 2 GiB-1），>2GiB 报 "data is too long"——分块喂。 */
const HASH_CHUNK = 2147483647;
function hashBytes(hash, bytes, chunkSize = HASH_CHUNK) {
	for (let off = 0; off < bytes.length; off += chunkSize) hash.update(bytes.subarray(off, Math.min(off + chunkSize, bytes.length)));
}
function sha512Base64(bytes, chunkSize) {
	const hash = createHash("sha512");
	hashBytes(hash, bytes, chunkSize);
	return hash.digest("base64");
}
/** 计算某字节流的规范 integrity 串。 */
function integrityOf(bytes, chunkSize) {
	return "sha512-" + sha512Base64(bytes, chunkSize);
}
/** 校验字节流是否匹配 integrity（"sha512-…"）。 */
function verifyIntegrity(bytes, integrity) {
	const m = /^sha512-([A-Za-z0-9+/=]+)$/.exec(integrity.trim());
	if (!m) return false;
	const want = m[1];
	const got = sha512Base64(bytes);
	if (want.length !== got.length) return false;
	let diff = 0;
	for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ got.charCodeAt(i);
	return diff === 0;
}
//#endregion
//#region src/market/store.ts
/**
* 已安装壁纸本地存储（R4 market）：dir/installed.json 记录状态，dir/packages/<id>.dwp 存包。
* 纯 fs + JSON，注入 dir 便于测试用临时目录。
*/
var InstalledStore = class {
	dir;
	file;
	packagesDir;
	constructor(dir) {
		this.dir = dir;
		this.file = join(dir, "installed.json");
		this.packagesDir = join(dir, "packages");
	}
	ensureDir() {
		if (!existsSync(this.packagesDir)) mkdirSync(this.packagesDir, { recursive: true });
	}
	load() {
		try {
			const parsed = JSON.parse(readFileSync(this.file, "utf8"));
			return Array.isArray(parsed) ? parsed : [];
		} catch {
			return [];
		}
	}
	save(list) {
		this.ensureDir();
		writeFileSync(this.file, JSON.stringify(list, null, 2) + "\n", "utf8");
	}
	get(id) {
		return this.load().find((r) => r.id === id);
	}
	list() {
		return this.load();
	}
	has(id) {
		return this.get(id) !== void 0;
	}
	upsert(rec) {
		const list = this.load().filter((r) => r.id !== rec.id);
		list.push(rec);
		this.save(list);
	}
	remove(id) {
		const rec = this.get(id);
		this.save(this.load().filter((r) => r.id !== id));
		if (rec) try {
			rmSync(join(this.dir, rec.path), { force: true });
		} catch {}
	}
	packagePath(id) {
		return join(this.packagesDir, id + ".dwp");
	}
	ensurePackagesDir() {
		this.ensureDir();
	}
};
//#endregion
//#region src/market/pull.ts
/**
* MarketClient（R4 market 拉取核心）：catalog → 下载 → 校验 → 安装 → 已装状态 → 更新检测。
* 依赖注入 fetchFn/dir/now，Node 测试用假 fetch + 临时目录跑通全流程。
* 付费包（commercial=true）拒绝自动下载，抛 NeedsPurchase（客户端据此打开销售页）。
*/
var NeedsPurchaseError = class extends Error {
	salesUrl;
	platform;
	constructor(salesUrl, platform) {
		super(`付费壁纸需经销售平台获取（${platform}）：${salesUrl}`);
		this.name = "NeedsPurchaseError";
		this.salesUrl = salesUrl;
		this.platform = platform;
	}
};
var MarketClient = class {
	store;
	fetchFn;
	now;
	constructor(deps) {
		this.store = new InstalledStore(deps.dir);
		this.fetchFn = deps.fetchFn ?? ((url) => fetch(url));
		this.now = deps.now ?? (() => (/* @__PURE__ */ new Date()).toISOString());
	}
	catalog(url) {
		return fetchCatalog(url, this.fetchFn);
	}
	/** 下载并校验一个免费包字节（size + sha512 integrity）。付费抛 NeedsPurchase。 */
	async download(entry) {
		if (!canAutoInstall(entry)) throw new NeedsPurchaseError(entry.sales?.url ?? entry.dwp.package.url, entry.sales?.platform ?? "other");
		const res = await this.fetchFn(entry.dwp.package.url);
		if (!res.ok) throw new Error(`下载失败 ${entry.id}: HTTP ${res.status}`);
		const bytes = new Uint8Array(await res.arrayBuffer());
		if (bytes.length !== entry.dwp.package.size) throw new Error(`大小不符 ${entry.id}: 期望 ${entry.dwp.package.size} 实得 ${bytes.length}`);
		if (!verifyIntegrity(bytes, entry.dwp.package.integrity)) throw new Error(`完整性校验失败 ${entry.id}: sha512 不匹配（包被篡改或损坏）`);
		return bytes;
	}
	/** 安装：下载校验 → 写 packages/<id>.dwp → 记 installed.json。幂等（覆盖同 id）。 */
	async install(entry) {
		const bytes = await this.download(entry);
		this.store.ensurePackagesDir();
		const rel = "packages/" + entry.id + ".dwp";
		writeFileSync(join(this.store.dir, rel), bytes);
		const rec = {
			id: entry.id,
			version: entry.dwp.package.version,
			integrity: entry.dwp.package.integrity,
			sourceUrl: entry.dwp.package.url,
			path: rel,
			installedAt: this.now(),
			commercial: entry.license.commercial
		};
		this.store.upsert(rec);
		return rec;
	}
	uninstall(id) {
		this.store.remove(id);
	}
	installed() {
		return this.store.list();
	}
	isInstalled(id) {
		return this.store.has(id);
	}
	/** catalog 中比已装版本新的条目（更新检测；版本串不等即视为可更新）。 */
	updates(catalog) {
		const byId = new Map(this.installed().map((r) => [r.id, r]));
		return catalog.entries.filter((e) => {
			const rec = byId.get(e.id);
			return rec !== void 0 && rec.version !== e.dwp.package.version && canAutoInstall(e);
		});
	}
};
//#endregion
//#region src/market/routes.ts
function query$2(req) {
	return new URL(req.url ?? "/", "http://localhost").searchParams;
}
function json$2(res, code, body) {
	res.statusCode = code;
	res.setHeader("Content-Type", "application/json; charset=utf-8");
	res.end(JSON.stringify(body));
}
function createMarketRoutes(deps) {
	const base = deps.base ?? "/we-sync/dwp/market";
	let cache = null;
	const ensureCatalog = async () => cache ??= await deps.market.catalog(deps.catalogUrl);
	return [
		{
			kind: "exact",
			path: base + "/catalog",
			handler: async (_req, res) => {
				try {
					json$2(res, 200, await ensureCatalog());
				} catch (e) {
					json$2(res, 502, { error: String(e.message ?? e) });
				}
			}
		},
		{
			kind: "exact",
			path: base + "/installed",
			handler: (_req, res) => {
				json$2(res, 200, { installed: deps.market.installed() });
			}
		},
		{
			kind: "exact",
			path: base + "/install",
			handler: async (req, res) => {
				const id = query$2(req).get("id");
				if (!id) return json$2(res, 400, { error: "缺 id" });
				let entry;
				try {
					entry = (await ensureCatalog()).entries.find((e) => e.id === id);
				} catch (e) {
					return json$2(res, 502, { error: String(e.message ?? e) });
				}
				if (!entry) return json$2(res, 404, { error: `catalog 无此 id: ${id}` });
				try {
					json$2(res, 200, {
						ok: true,
						record: await deps.market.install(entry)
					});
				} catch (e) {
					if (e instanceof NeedsPurchaseError) return json$2(res, 402, {
						error: "needs-purchase",
						salesUrl: e.salesUrl,
						platform: e.platform
					});
					return json$2(res, 500, { error: String(e.message ?? e) });
				}
			}
		},
		{
			kind: "exact",
			path: base + "/uninstall",
			handler: (req, res) => {
				const id = query$2(req).get("id");
				if (!id) return json$2(res, 400, { error: "缺 id" });
				deps.market.uninstall(id);
				json$2(res, 200, { ok: true });
			}
		},
		{
			kind: "exact",
			path: base + "/updates",
			handler: async (_req, res) => {
				try {
					json$2(res, 200, { updates: deps.market.updates(await ensureCatalog()) });
				} catch (e) {
					json$2(res, 502, { error: String(e.message ?? e) });
				}
			}
		}
	];
}
//#endregion
//#region src/market/unzip.ts
/**
* 最小 zip 读取器（R4 渲染面）：解析 .dwp（zip）中央目录，抽出各条目字节。
* 支持 stored(0) 与 deflate(8)（deflate 用 node:zlib inflateRawSync）。
* 与 make-demo-dwp.mjs 的 stored 写入器配对；真实包多用 deflate，两者都覆盖。
* 纯函数，Node 可测。
*/
const SIG_EOCD$1 = 101010256;
const SIG_CD$1 = 33639248;
const SIG_LFH = 67324752;
/** 从 zip 字节读出全部条目（目录项以 / 结尾，跳过）。 */
function readZip(bytes) {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let eocd = -1;
	const min = Math.max(0, bytes.length - 65557);
	for (let i = bytes.length - 22; i >= min; i--) if (view.getUint32(i, true) === SIG_EOCD$1) {
		eocd = i;
		break;
	}
	if (eocd < 0) throw new Error("不是合法 zip：找不到 EOCD");
	const total = view.getUint16(eocd + 10, true);
	let p = view.getUint32(eocd + 16, true);
	const entries = [];
	for (let n = 0; n < total; n++) {
		if (view.getUint32(p, true) !== SIG_CD$1) throw new Error("中央目录签名错误 @" + p);
		const method = view.getUint16(p + 10, true);
		const compSize = view.getUint32(p + 20, true);
		const nameLen = view.getUint16(p + 28, true);
		const extraLen = view.getUint16(p + 30, true);
		const commentLen = view.getUint16(p + 32, true);
		const localOff = view.getUint32(p + 42, true);
		const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
		p += 46 + nameLen + extraLen + commentLen;
		if (name.endsWith("/")) continue;
		if (view.getUint32(localOff, true) !== SIG_LFH) throw new Error("本地头签名错误 @" + localOff);
		const lfhNameLen = view.getUint16(localOff + 26, true);
		const lfhExtraLen = view.getUint16(localOff + 28, true);
		const dataStart = localOff + 30 + lfhNameLen + lfhExtraLen;
		const raw = bytes.subarray(dataStart, dataStart + compSize);
		let data;
		if (method === 0) data = raw.slice();
		else if (method === 8) data = new Uint8Array(inflateRawSync(Buffer.from(raw)));
		else throw new Error(`不支持的压缩方法 ${method}: ${name}`);
		entries.push({
			name,
			data
		});
	}
	return entries;
}
/** 条目名 → 字节 的 Map（重名后者覆盖前者）。 */
function readZipMap(bytes) {
	const m = /* @__PURE__ */ new Map();
	for (const e of readZip(bytes)) m.set(e.name, e.data);
	return m;
}
//#endregion
//#region src/market/serve.ts
/**
* DWP 内容伺服 + 应用路由（R4 渲染面 node 半）。
* 把已装 .dwp 解包，按需提供 scene.json / wallpaper.json / 单个资源，供 client 半
* 用 @dwp/web 的 mount() 组装渲染；并管理"当前应用"状态。
* 与 routes.ts 同构（本地 Req/Res/Route，兼容 share 的 WebServer.register）。
*/
const MIME = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".webp": "image/webp",
	".gif": "image/gif",
	".json": "application/json",
	".txt": "text/plain",
	".svg": "image/svg+xml"
};
const mimeOf = (name) => MIME[extname(name).toLowerCase()] ?? "application/octet-stream";
function query$1(req) {
	return new URL(req.url ?? "/", "http://localhost").searchParams;
}
function json$1(res, code, body) {
	res.statusCode = code;
	res.setHeader("Content-Type", "application/json; charset=utf-8");
	res.end(JSON.stringify(body));
}
function createDwpServeRoutes(deps) {
	const base = deps.base ?? "/we-sync/dwp";
	const cache = /* @__PURE__ */ new Map();
	const unzipped = (id) => {
		const rec = deps.store.get(id);
		if (!rec) return null;
		const key = id + "@" + rec.version;
		let m = cache.get(key);
		if (!m) {
			m = readZipMap(new Uint8Array(readFileSync(join(deps.store.dir, rec.path))));
			cache.set(key, m);
		}
		return m;
	};
	const pick = (m, want) => {
		if (m.has(want)) return m.get(want);
		const norm = want.replace(/^\.\//, "").replace(/^\/+/, "");
		if (m.has(norm)) return m.get(norm);
	};
	const applied = {
		kind: "exact",
		path: base + "/applied",
		handler: (_q, res) => {
			json$1(res, 200, { applied: deps.apply.get() });
		}
	};
	const apply = {
		kind: "exact",
		path: base + "/apply",
		handler: (req, res) => {
			const id = query$1(req).get("id");
			if (!id) return json$1(res, 400, { error: "缺 id" });
			const rec = deps.store.get(id);
			if (!rec) return json$1(res, 404, { error: `未安装: ${id}` });
			json$1(res, 200, {
				ok: true,
				applied: deps.apply.set(id, rec.version)
			});
		}
	};
	const unapply = {
		kind: "exact",
		path: base + "/unapply",
		handler: (_q, res) => {
			deps.apply.clear();
			json$1(res, 200, { ok: true });
		}
	};
	const files = {
		kind: "exact",
		path: base + "/files",
		handler: (req, res) => {
			const m = unzipped(query$1(req).get("id") ?? "");
			if (!m) return json$1(res, 404, { error: "未安装" });
			json$1(res, 200, { files: [...m.keys()] });
		}
	};
	const file = {
		kind: "exact",
		path: base + "/file",
		handler: (req, res) => {
			const q = query$1(req);
			const m = unzipped(q.get("id") ?? "");
			if (!m) return json$1(res, 404, { error: "未安装" });
			const name = q.get("name");
			if (!name) return json$1(res, 400, { error: "缺 name" });
			const data = pick(m, name);
			if (!data) return json$1(res, 404, { error: `包内无此文件: ${name}` });
			res.statusCode = 200;
			res.setHeader("Content-Type", mimeOf(name));
			res.setHeader("Cache-Control", "public, max-age=31536000");
			res.end(Buffer.from(data));
		}
	};
	const jsonEntry = (path, defaultName) => ({
		kind: "exact",
		path: base + path,
		handler: (req, res) => {
			const q = query$1(req);
			const m = unzipped(q.get("id") ?? "");
			if (!m) return json$1(res, 404, { error: "未安装" });
			const want = q.get("name") ?? defaultName;
			const data = pick(m, want);
			if (!data) return json$1(res, 404, { error: `包内无 ${want}` });
			res.statusCode = 200;
			res.setHeader("Content-Type", "application/json; charset=utf-8");
			res.end(new TextDecoder().decode(data));
		}
	});
	return [
		applied,
		apply,
		unapply,
		files,
		file,
		jsonEntry("/manifest", "wallpaper.json"),
		jsonEntry("/scene", "scene.json")
	];
}
//#endregion
//#region src/market/apply.ts
/**
* "当前应用的 DWP 壁纸"状态（R4 渲染面）：dir/applied.json 记录哪个已装包被设为壁纸。
* 与 InstalledStore 同目录；纯 fs + JSON，Node 可测。
*/
var ApplyState = class {
	file;
	constructor(dir) {
		this.file = join(dir, "applied.json");
	}
	get() {
		try {
			const v = JSON.parse(readFileSync(this.file, "utf8"));
			return v && typeof v.id === "string" ? v : null;
		} catch {
			return null;
		}
	}
	set(id, version, now = (/* @__PURE__ */ new Date()).toISOString()) {
		const s = {
			id,
			version,
			appliedAt: now
		};
		const dir = dirname(this.file);
		if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
		writeFileSync(this.file, JSON.stringify(s, null, 2) + "\n", "utf8");
		return s;
	}
	clear() {
		if (existsSync(this.file)) try {
			writeFileSync(this.file, "", "utf8");
		} catch {}
	}
};
//#endregion
//#region src/launcher/crypt-zip.ts
/**
* 加密 zip 读取器（launcher）：传统 ZipCrypto + WinZip AES（AE-1/AE-2）。
* 与 market/unzip.ts（无加密的最小读取器）并列：本模块先扫中央目录，
* 无加密条目直接委托 readZipMap；有加密条目则逐条解密（密码流式只过内存）。
*
* ZipCrypto：12 字节加密头（末字节为校验字节）+ 数据，流密码三密钥。
*   校验字节仅 8bit，弱判定；密码对错最终以解压后 CRC32 定论（AE-1 同理）。
* WinZip AES（method 99）：extra 0x9901 给出强度（1/2/3 = 128/192/256）与真实方法；
*   PBKDF2-HMAC-SHA1 1000 轮派生 加密钥+鉴权钥+2B 校验值；AES-CTR（计数器 LE 从 1 起）；
*   尾部 10 字节 HMAC-SHA1(密文) 截断——AE-2 无 CRC，HMAC 是唯一密码/完整性判据。
* 密码只作为函数参数存在，不落盘、不进任何记录。
*/
/** 密码相关错误：code 供路由映射为 password_required / wrong_password。 */
var CryptZipError = class extends Error {
	code;
	constructor(code, msg) {
		super(msg);
		this.name = "CryptZipError";
		this.code = code;
	}
};
const CRC_TABLE$1 = (() => {
	const t = /* @__PURE__ */ new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = (c & 1) !== 0 ? 3988292384 ^ c >>> 1 : c >>> 1;
		t[n] = c >>> 0;
	}
	return t;
})();
function crc32Update(crc, byte) {
	return (CRC_TABLE$1[(crc ^ byte) & 255] ^ crc >>> 8) >>> 0;
}
function crc32Of(bytes) {
	let c = 4294967295;
	for (let i = 0; i < bytes.length; i++) c = crc32Update(c, bytes[i]);
	return (c ^ 4294967295) >>> 0;
}
const CRC32_UPDATE = crc32Update;
function zipCryptoStream(password, data) {
	let key0 = 305419896;
	let key1 = 591751049;
	let key2 = 878082192;
	const pw = Buffer.from(password, "utf-8");
	const update = (b) => {
		key0 = CRC32_UPDATE(key0, b);
		key1 = key1 + (key0 & 255) >>> 0;
		key1 = Math.imul(key1, 134775813) + 1 >>> 0;
		key2 = CRC32_UPDATE(key2, key1 >>> 24);
	};
	for (let i = 0; i < pw.length; i++) update(pw[i]);
	const out = new Uint8Array(data.length);
	for (let i = 0; i < data.length; i++) {
		const temp = (key2 | 2) >>> 0;
		const d = (data[i] ^ Math.imul(temp, temp ^ 1) >>> 8 & 255) & 255;
		update(d);
		out[i] = d;
	}
	return out;
}
const SIG_EOCD = 101010256;
const SIG_CD = 33639248;
/**
* 定位 EOCD 并计算 concat 偏移。复合文件（视频+zip polyglot）在 zip 前垫了任意数据，
* 中央目录的 cdOfs 是相对「zip 自身起点」的：真实位置 = cdOfs + concat，其中
* concat = (EOCD 位置 - 中央目录总长) - cdOfs。从文件尾向前扫，逐候选校验 CD 签名。
*/
function locateEocd(bytes) {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const min = Math.max(0, bytes.length - 65557);
	for (let i = bytes.length - 22; i >= min; i--) {
		if (view.getUint32(i, true) !== SIG_EOCD) continue;
		const total = view.getUint16(i + 10, true);
		const cdSize = view.getUint32(i + 12, true);
		const cdOfs = view.getUint32(i + 16, true);
		const actualCdStart = i - cdSize;
		if (total === 0) return {
			eocd: i,
			total,
			concat: 0
		};
		if (actualCdStart < 0 || actualCdStart + 4 > bytes.length) continue;
		if (view.getUint32(actualCdStart, true) === SIG_CD) return {
			eocd: i,
			total,
			concat: actualCdStart - cdOfs
		};
	}
	return null;
}
function parseCentralDirectory(bytes) {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const loc = locateEocd(bytes);
	if (loc === null) throw new Error("不是合法 zip：找不到 EOCD");
	const { eocd, total, concat } = loc;
	let p = eocd - view.getUint32(eocd + 12, true);
	const dec = new TextDecoder();
	const entries = [];
	for (let n = 0; n < total; n++) {
		if (p < 0 || p + 46 > bytes.length || view.getUint32(p, true) !== SIG_CD) throw new Error("中央目录签名错误 @" + p);
		const flags = view.getUint16(p + 8, true);
		const method = view.getUint16(p + 10, true);
		const crc = view.getUint32(p + 16, true);
		const compSize = view.getUint32(p + 20, true);
		const nameLen = view.getUint16(p + 28, true);
		const extraLen = view.getUint16(p + 30, true);
		const commentLen = view.getUint16(p + 32, true);
		const localOff = view.getUint32(p + 42, true) + concat;
		const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
		let aes = null;
		const extraStart = p + 46 + nameLen;
		const extraEnd = extraStart + extraLen;
		for (let q = extraStart; q + 4 <= extraEnd;) {
			const id = view.getUint16(q, true);
			const sz = view.getUint16(q + 2, true);
			if (id === 39169 && sz >= 7) aes = {
				version: view.getUint16(q + 4, true),
				strength: bytes[q + 8],
				method: view.getUint16(q + 9, true)
			};
			q += 4 + sz;
		}
		entries.push({
			name,
			flags,
			method,
			crc,
			compSize,
			localOff,
			aes
		});
		p = extraEnd + commentLen;
	}
	return {
		entries,
		concat
	};
}
/** 尾部存在可解析的 zip 中央目录（含视频+zip 复合结构）→ true。 */
function hasZipTrailer(bytes) {
	try {
		return locateEocd(bytes) !== null;
	} catch {
		return false;
	}
}
function decryptZipCrypto(e, data, password, lfhTime) {
	if (data.length < 12) throw new CryptZipError("wrong_password", "加密数据过短");
	const plain = zipCryptoStream(password, data);
	const check = (e.flags & 8) !== 0 ? lfhTime >>> 8 & 255 : e.crc >>> 24 & 255;
	if (plain[11] !== check) throw new CryptZipError("wrong_password", "密码错误（校验字节不符）");
	return { payload: plain.subarray(12) };
}
function decryptAes(e, data, password) {
	if (e.aes === null) throw new CryptZipError("wrong_password", "AES 条目缺少 0x9901 extra");
	const bits = e.aes.strength === 1 ? 128 : e.aes.strength === 2 ? 192 : e.aes.strength === 3 ? 256 : 0;
	if (bits === 0) throw new CryptZipError("wrong_password", `未知 AES 强度: ${e.aes.strength}`);
	const keyLen = bits / 8;
	const saltLen = keyLen / 2;
	if (data.length < saltLen + 2 + 10) throw new CryptZipError("wrong_password", "AES 数据过短");
	const salt = data.subarray(0, saltLen);
	const pvHeader = data.subarray(saltLen, saltLen + 2);
	const cipherData = data.subarray(saltLen + 2, data.length - 10);
	const authFooter = data.subarray(data.length - 10);
	const derived = pbkdf2Sync(Buffer.from(password, "utf-8"), Buffer.from(salt), 1e3, keyLen * 2 + 2, "sha1");
	const encKey = derived.subarray(0, keyLen);
	const authKey = derived.subarray(keyLen, keyLen * 2);
	const pvDerived = derived.subarray(keyLen * 2);
	if (pvDerived[0] !== pvHeader[0] || pvDerived[1] !== pvHeader[1]) throw new CryptZipError("wrong_password", "密码错误（PV 校验不符）");
	const mac = createHmac("sha1", Buffer.from(authKey)).update(Buffer.from(cipherData)).digest();
	for (let i = 0; i < 10; i++) if (mac[i] !== authFooter[i]) throw new CryptZipError("wrong_password", "密码错误（HMAC 校验不符）");
	const cipher = createCipheriv(`aes-${bits}-ecb`, Buffer.from(encKey), null);
	cipher.setAutoPadding(false);
	const out = new Uint8Array(cipherData.length);
	const counter = /* @__PURE__ */ new Uint8Array(16);
	for (let off = 0; off < cipherData.length; off += 16) {
		const ctr = BigInt(Math.floor(off / 16) + 1);
		for (let i = 0; i < 8; i++) counter[i] = 0;
		for (let i = 0; i < 8; i++) counter[8 + i] = Number(ctr >> BigInt(i * 8) & 255n);
		const ks = cipher.update(Buffer.from(counter));
		for (let i = 0; off + i < cipherData.length && i < 16; i++) out[off + i] = cipherData[off + i] ^ ks[i];
	}
	return { payload: out };
}
/** 单条加密条目 → 原始（未压缩）内容，含 CRC 校验（AE-2 除外）。 */
function decryptEntry(e, bytes, password) {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const lo = e.localOff;
	const lfhNameLen = view.getUint16(lo + 26, true);
	const lfhExtraLen = view.getUint16(lo + 28, true);
	const lfhTime = view.getUint16(lo + 10, true);
	const dataStart = lo + 30 + lfhNameLen + lfhExtraLen;
	const data = bytes.subarray(dataStart, dataStart + e.compSize);
	let raw;
	if (e.aes !== null || e.method === 99) raw = decryptAes(e, data, password).payload;
	else raw = decryptZipCrypto(e, data, password, lfhTime).payload;
	let payload;
	const realMethod = e.aes !== null ? e.aes.method : e.method;
	if (realMethod === 0) payload = raw.slice();
	else if (realMethod === 8) payload = new Uint8Array(inflateRawSync(Buffer.from(raw)));
	else throw new CryptZipError("wrong_password", `不支持的压缩方法 ${realMethod}: ${e.name}`);
	if (!(e.aes !== null && e.aes.version >= 2)) {
		if (crc32Of(payload) !== e.crc) throw new CryptZipError("wrong_password", "密码错误或文件已损坏（CRC 不符）");
	}
	return payload;
}
/**
* 打开 zip：普通包（无加密无前置数据）→ 委托 market/unzip 的 readZipMap；
* 加密包 → 必须给密码（缺 → password_required），逐条解密；
* 复合包（视频+zip，concat≠0）即使无加密也走自有解析（readZipMap 不认偏移）。
*/
function openZipMap(bytes, password) {
	const { entries, concat } = parseCentralDirectory(bytes);
	const encrypted = entries.filter((e) => (e.flags & 1) !== 0 || e.method === 99);
	if (encrypted.length === 0 && concat === 0) return readZipMap(bytes);
	const pwd = password ?? "";
	if (encrypted.length > 0 && pwd === "") throw new CryptZipError("password_required", "压缩包已加密，需要解压密码");
	const map = /* @__PURE__ */ new Map();
	for (const e of entries) {
		if (e.name.endsWith("/")) continue;
		if ((e.flags & 1) !== 0 || e.method === 99) map.set(e.name, decryptEntry(e, bytes, pwd));
		else {
			const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
			const lo = e.localOff;
			const lfhNameLen = view.getUint16(lo + 26, true);
			const lfhExtraLen = view.getUint16(lo + 28, true);
			const dataStart = lo + 30 + lfhNameLen + lfhExtraLen;
			const data = bytes.subarray(dataStart, dataStart + e.compSize);
			let payload;
			if (e.method === 0) payload = data.slice();
			else if (e.method === 8) payload = new Uint8Array(inflateRawSync(Buffer.from(data)));
			else throw new CryptZipError("wrong_password", `不支持的压缩方法 ${e.method}: ${e.name}`);
			map.set(e.name, payload);
		}
	}
	return map;
}
//#endregion
//#region src/launcher/png.ts
/**
* 最小 PNG 编码器（launcher 兜底预览卡）：纯 node:zlib，零依赖。
* 只服务一条链路：launcher 安装完成而客户端没有回传 canvas 预览时，
* 服务端本地合成一张渐变卡（无文字渲染能力，客户端版才有标题字）。
* 输入 RGBA 像素 → 输出合法 PNG 字节（color type 6, 8bit, filter 0）。
*/
const CRC_TABLE = (() => {
	const t = /* @__PURE__ */ new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = (c & 1) !== 0 ? 3988292384 ^ c >>> 1 : c >>> 1;
		t[n] = c >>> 0;
	}
	return t;
})();
function crc32(bytes) {
	let c = 4294967295;
	for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 255] ^ c >>> 8;
	return (c ^ 4294967295) >>> 0;
}
function chunk(type, data) {
	const out = new Uint8Array(12 + data.length);
	const view = new DataView(out.buffer);
	view.setUint32(0, data.length, false);
	for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
	out.set(data, 8);
	const crcInput = out.subarray(4, 8 + data.length);
	view.setUint32(8 + data.length, crc32(crcInput), false);
	return out;
}
/** RGBA 像素 → PNG 字节。rgba.length 必须 === width*height*4。 */
function encodePngRgba(width, height, rgba) {
	if (rgba.length !== width * height * 4) throw new Error(`PNG 编码失败: 像素长度不符 (期望 ${width * height * 4}, 实得 ${rgba.length})`);
	const stride = width * 4;
	const raw = new Uint8Array((stride + 1) * height);
	for (let y = 0; y < height; y++) {
		raw[y * (stride + 1)] = 0;
		raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
	}
	const ihdr = /* @__PURE__ */ new Uint8Array(13);
	const iv = new DataView(ihdr.buffer);
	iv.setUint32(0, width, false);
	iv.setUint32(4, height, false);
	ihdr[8] = 8;
	ihdr[9] = 6;
	const sig = new Uint8Array([
		137,
		80,
		78,
		71,
		13,
		10,
		26,
		10
	]);
	const idat = new Uint8Array(deflateSync(Buffer.from(raw)));
	return new Uint8Array(Buffer.concat([
		Buffer.from(sig),
		Buffer.from(chunk("IHDR", ihdr)),
		Buffer.from(chunk("IDAT", idat)),
		Buffer.from(chunk("IEND", /* @__PURE__ */ new Uint8Array(0)))
	]));
}
/** hsl(0..360, 0..1, 0..1) → [r,g,b] 0..255 */
function hslToRgb(h, s, l) {
	const c = (1 - Math.abs(2 * l - 1)) * s;
	const hp = (h % 360 + 360) % 360 / 60;
	const x = c * (1 - Math.abs(hp % 2 - 1));
	let r = 0, g = 0, b = 0;
	if (hp < 1) {
		r = c;
		g = x;
	} else if (hp < 2) {
		r = x;
		g = c;
	} else if (hp < 3) {
		g = c;
		b = x;
	} else if (hp < 4) {
		g = x;
		b = c;
	} else if (hp < 5) {
		r = x;
		b = c;
	} else {
		r = c;
		b = x;
	}
	const m = l - c / 2;
	return [
		Math.round((r + m) * 255),
		Math.round((g + m) * 255),
		Math.round((b + m) * 255)
	];
}
function hashHue(text) {
	let h = 0;
	for (let i = 0; i < text.length; i++) h = h * 31 + text.charCodeAt(i) >>> 0;
	return h % 360;
}
/**
* 服务端兜底预览卡：640x360 渐变底 + 大圆形徽章（按标题 hash 取色）。
* 无文字（服务端没有字体栈）；客户端安装流程默认会回传带标题的 canvas 卡覆盖它。
*/
function fallbackCardPng(title, width = 640, height = 360) {
	const hue = hashHue(title);
	const [r1, g1, b1] = hslToRgb(hue, .55, .22);
	const [r2, g2, b2] = hslToRgb(hue + 40, .6, .42);
	const rgba = new Uint8Array(width * height * 4);
	const cx = width * .5;
	const cy = height * .44;
	const rad = Math.min(width, height) * .3;
	for (let y = 0; y < height; y++) {
		const ty = y / height;
		for (let x = 0; x < width; x++) {
			const k = x / width * .6 + ty * .4;
			let r = Math.round(r1 + (r2 - r1) * k);
			let g = Math.round(g1 + (g2 - g1) * k);
			let b = Math.round(b1 + (b2 - b1) * k);
			const dx = x - cx, dy = y - cy;
			const dist = Math.sqrt(dx * dx + dy * dy);
			const alpha = Math.min(1, Math.max(0, (rad - dist) / 2));
			if (alpha > 0) {
				r = Math.round(r * (1 - alpha) + Math.min(255, r + 60) * alpha);
				g = Math.round(g * (1 - alpha) + Math.min(255, g + 60) * alpha);
				b = Math.round(b * (1 - alpha) + Math.min(255, b + 60) * alpha);
			}
			const o = (y * width + x) * 4;
			rgba[o] = r;
			rgba[o + 1] = g;
			rgba[o + 2] = b;
			rgba[o + 3] = 255;
		}
	}
	return encodePngRgba(width, height, rgba);
}
//#endregion
//#region src/launcher/installer.ts
/**
* launcher installer：直链下载 → 解包 → exe 入口探测 → 类 WE app 封装 → 入库。
* 目标形态（与 WE workshop application 条目同构，保持与现有 scanApps 零改动兼容）：
*   <root>/<slug>/
*     project.json  { title, type:"application", file:"<入口相对路径>", preview:"preview.png",
*                     general.properties.schemecolor…（与 WE 对齐的占位）,
*                     source:{ url, fileName, size, sha512, installedAt } }
*     preview.png   客户端 canvas 卡回传优先；缺省服务端 fallbackCardPng
*     <软件本体>
* 安全边界：仅接受 http(s) 直链；Content-Length 与实收字节数双查，超限即弃；
* sha512 记账（可选传入期望值，不符即拒装）；解包条目数/总字节/路径穿越全防。
*/
/** 从 fetch 抛出的错误里挖真实原因（undici 把解析错误藏在 cause 里）。 */
function fetchCauseText(e) {
	const err = e;
	const parts = [typeof err.message === "string" ? err.message : String(e)];
	const cause = err.cause;
	if (cause !== void 0 && cause !== null) {
		parts.push(typeof cause.message === "string" ? cause.message : String(cause));
		if (cause.code !== void 0) parts.push(String(cause.code));
	}
	return parts.filter((s) => s !== "").join(" ← ");
}
/** CDN 返回了 HTTP 解析器无法容忍的头（如 Content-Length 非法 / 与 Transfer-Encoding 冲突）。 */
function isHttpHeaderParseError(text) {
	return /content-length|invalid header|parse error|hpe_/i.test(text);
}
/** Node fs.writeSync 的 length 是 int32：单次写上限 2 GiB-1。 */
const MAX_WRITE_CHUNK = 2147483647;
/** 分块写整块字节（writeFileSync 对 >2GiB 的 Uint8Array 直接 RangeError——Node fs.writeSync 的 length 是 int32）。
*  chunkSize 仅供测试注入小分块验证多块路径。 */
function writeBytesSafe(target, bytes, chunkSize = MAX_WRITE_CHUNK) {
	if (bytes.length <= chunkSize) {
		writeFileSync(target, bytes);
		return;
	}
	const fd = openSync(target, "w");
	try {
		for (let off = 0; off < bytes.length; off += chunkSize) writeSync(fd, bytes, off, Math.min(chunkSize, bytes.length - off));
	} finally {
		closeSync(fd);
	}
}
/** 在大文件字节里找 7z 段起点（37 7A BC AF 27 1C）：头部命中 → 0；否则 1MB 之后全量扫
*  （Buffer.indexOf 走原生 memmem、视图共享零拷贝，GB 级文件亚秒级）；非 7z → -1。
*  场景：「视频垫底 + 7z 追加」复合文件——头部是媒体数据，7z 签名埋在文件中部。 */
function find7zOffset(bytes) {
	if (bytes.length > 6 && bytes[0] === 55 && bytes[1] === 122 && bytes[2] === 188 && bytes[3] === 175 && bytes[4] === 39 && bytes[5] === 28) return 0;
	if (bytes.length < 1048576) return -1;
	const idx = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).indexOf(SEVEN_ZIP_SIG, 1024);
	return idx >= 0 ? idx : -1;
}
const SEVEN_ZIP_SIG = Buffer.from([
	55,
	122,
	188,
	175,
	39,
	28
]);
/** 两家解压器的命令行参数风格（纯函数，测试可直接断言）。 */
function buildArchiveArgs(kind, tmpArchive, destDir, password) {
	if (kind === "bandizip") {
		const args = [
			"x",
			"-y",
			"-o:" + destDir
		];
		if (password !== void 0 && password !== "") args.push("-p:" + password);
		args.push(tmpArchive);
		return args;
	}
	return [
		"x",
		"-y",
		"-p" + (password ?? ""),
		"-o" + destDir,
		tmpArchive
	];
}
/** 解压器输出是否指向密码问题（7z/Bandizip 实测输出 + 中文 UI 都覆盖）。 */
function isPasswordErrorOutput(out, password) {
	const pwdEmpty = password === void 0 || password === "";
	if (/wrong password|invalid password|incorrect password|password required|enter password/i.test(out)) return true;
	return pwdEmpty ? /密码/.test(out) : /密码错误|密码不正确|密码不符/.test(out);
}
var LauncherError = class extends Error {
	constructor(msg) {
		super(msg);
		this.name = "LauncherError";
	}
};
const MAX_DOWNLOAD_BYTES = 4294967296;
const MAX_ZIP_ENTRIES = 2e4;
const MAX_ZIP_UNPACKED = 6442450944;
const PREVIEW_EXT = {
	"image/png": "png",
	"image/jpeg": "jpg",
	"image/gif": "gif",
	"image/webp": "webp"
};
const EXECUTABLE_EXTS = /* @__PURE__ */ new Set([
	".exe",
	".bat",
	".cmd"
]);
/** zip 常见噪声目录 */
const NOISE_DIRS = /* @__PURE__ */ new Set([
	"__MACOSX",
	".git",
	"node_modules"
]);
/** 拒绝盘符/绝对路径/路径穿越，返回规范化后的相对路径（posix 分隔）。 */
function assertSafeRelPath(rel) {
	if (/^[a-zA-Z]:/.test(rel) || rel.startsWith("/") || rel.startsWith("\\") || rel.split(/[\\/]/).includes("..")) throw new LauncherError(`zip 条目路径可疑，拒绝解包: ${rel}`);
	return normalize(rel).replace(/\\/g, "/");
}
/** 目标路径必须落在 destDir 内（防 join 后逃逸）。 */
function assertInside(destDir, target) {
	const normDest = normalize(destDir);
	const normTarget = normalize(target);
	if (normTarget !== normDest && !normTarget.startsWith(normDest + sep)) throw new LauncherError(`落盘目标逃逸: ${target}`);
}
/** 安装根规范化：去引号/空白，必须绝对路径（盘符或 UNC 或 / 开头），尾部去分隔符。 */
function normalizeRoot(next) {
	const trimmed = next.trim().replace(/^["']|["']$/g, "");
	if (trimmed === "") throw new LauncherError("安装位置不能为空");
	if (!/^[a-zA-Z]:[\\/]/.test(trimmed) && !trimmed.startsWith("//") && !trimmed.startsWith("/")) throw new LauncherError(`安装位置必须是绝对路径（如 D:\\Games\\WeApps）: ${trimmed}`);
	return normalize(trimmed).replace(/[\\/]+$/, "");
}
/** 去掉 zip 常见的单一顶层包装目录（"My Game v1.2/game.exe" → 直接展开到根）。
*  仅当所有条目都在同一个顶层目录下（无根级散文件）时才扁平化；保持与 orig 的配对。 */
function stripTopWrapper(pairs) {
	const tops = new Set(pairs.map((p) => p.safe.includes("/") ? p.safe.slice(0, p.safe.indexOf("/")) : ""));
	if (tops.size !== 1) return pairs;
	const top = [...tops][0];
	if (top === "") return pairs;
	return pairs.map((p) => ({
		orig: p.orig,
		safe: p.safe.slice(top.length + 1)
	})).filter((p) => p.safe !== "");
}
var LauncherInstaller = class {
	/** 安装根（面板可运行时更换；每个 app 一个子目录） */
	root;
	/** 可替换的下载实现（测试注入假响应）；带 init 的真实 fetch 兼容 */
	fetchFn;
	/** 7z/7za.exe 显式路径（CONFIG 注入）；空 = 自动探测 */
	sevenZipPath;
	now;
	/** 30s 内存索引缓存（与 index.ts appsCache 同风格） */
	indexCache = null;
	constructor(deps) {
		this.root = deps.root;
		this.fetchFn = deps.fetchFn ?? (async (url, init) => await fetch(url, init));
		this.sevenZipPath = deps.sevenZipPath ?? "";
		this.now = deps.now ?? (() => (/* @__PURE__ */ new Date()).toISOString());
	}
	/** 运行时更换安装根（面板「安装位置」）。目录自动创建；索引缓存失效（旧根的记录全部失效）。
	*  记录不迁移——旧根原样保留，想迁移由上层调 moveToRoot。 */
	setRoot(next) {
		const root = normalizeRoot(next);
		if (root === this.root) return;
		mkdirSync(root, { recursive: true });
		this.root = root;
		this.indexCache = null;
	}
	/** 移动已装应用到新根（按记录的 slug 整目录搬；目标同名先删——安装语义本就是覆盖）。
	*  跨盘 rename 会 EXDEV → 回落 cpSync 复制后删源。迁移成功后把记录的 sha512 清掉吗？不——
	*  sha512 是安装时记账值，与位置无关，保留。记录本身随新根 installed.json 重建。
	*  返回成功迁移的记录数；失败的应用跳过并在结果里报告。 */
	moveToRoot(next) {
		const oldRoot = this.root;
		const list = this.list();
		this.setRoot(next);
		const failed = [];
		const kept = [];
		let moved = 0;
		for (const rec of list) {
			const from = join(oldRoot, rec.slug);
			const to = join(this.root, rec.slug);
			if (!existsSync(from)) continue;
			try {
				if (existsSync(to)) rmSync(to, {
					recursive: true,
					force: true
				});
				mkdirSync(dirname(to), { recursive: true });
				try {
					renameSync(from, to);
				} catch {
					cpSync(from, to, { recursive: true });
					rmSync(from, {
						recursive: true,
						force: true
					});
				}
				moved++;
				kept.push(rec);
			} catch {
				failed.push(rec.title || rec.slug);
			}
		}
		try {
			writeFileSync(this.indexFile(), JSON.stringify(kept, null, 2) + "\n", "utf8");
		} catch {}
		this.indexCache = null;
		return {
			moved,
			failed
		};
	}
	indexFile() {
		return join(this.root, "installed.json");
	}
	list() {
		if (this.indexCache !== null && Date.now() - this.indexCache.at < 3e4) return this.indexCache.list;
		let list = [];
		try {
			const parsed = JSON.parse(readFileSync(this.indexFile(), "utf8"));
			if (Array.isArray(parsed)) list = parsed.filter((x) => x !== null && typeof x === "object" && typeof x.id === "string" && typeof x.slug === "string");
		} catch {}
		this.indexCache = {
			at: Date.now(),
			list
		};
		return list;
	}
	get(id) {
		return this.list().find((r) => r.id === id);
	}
	has(id) {
		return this.get(id) !== void 0;
	}
	saveIndex(list) {
		mkdirSync(this.root, { recursive: true });
		writeFileSync(this.indexFile(), JSON.stringify(list, null, 2) + "\n", "utf8");
		this.indexCache = null;
	}
	upsert(rec) {
		this.saveIndex(this.list().filter((r) => r.id !== rec.id).concat(rec));
	}
	remove(id) {
		const rec = this.get(id);
		if (rec === void 0) return;
		this.saveIndex(this.list().filter((r) => r.id !== id));
		try {
			rmSync(join(this.root, rec.slug), {
				recursive: true,
				force: true
			});
		} catch {}
	}
	/** 下载直链：仅 http(s)，大小上限双查（Content-Length + 实收）。
	*  已知边界：139 CDN 偶发返回让 Node HTTP 解析器崩溃的头（如 Content-Length 与
	*  Transfer-Encoding 冲突，undici 报 "Parse Error … invalid content-length"，
	*  面板只能看到笼统的「不合法的 length」）。这类错误对同 URL 的重试往往自愈，
	*  故命中特征时自动带 Range 头重试一次；Range（206）响应不含 Content-Length，
	*  解析器不会再踩同一个坑。Range 重试也失败才把真实错误链抛给上层。 */
	async download(url) {
		let parsed;
		try {
			parsed = new URL(url);
		} catch {
			throw new LauncherError(`URL 非法: ${url}`);
		}
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new LauncherError(`仅支持 http(s) 直链: ${parsed.protocol}`);
		let res;
		let lastErrText = "";
		try {
			res = await this.fetchFn(url);
		} catch (e) {
			lastErrText = fetchCauseText(e);
			if (isHttpHeaderParseError(lastErrText)) try {
				res = await this.fetchFn(url, { headers: { Range: "bytes=0-" } });
			} catch (e2) {
				throw new LauncherError(`下载请求失败（含 Range 重试）: ${fetchCauseText(e2)}`);
			}
			else throw new LauncherError(`下载请求失败: ${lastErrText}`);
		}
		if (!res.ok) throw new LauncherError(`下载失败: HTTP ${res.status}`);
		const cl = res.headers.get("content-length");
		if (cl !== null && cl !== "") {
			const declared = Number(cl);
			if (Number.isFinite(declared) && declared > MAX_DOWNLOAD_BYTES) throw new LauncherError(`文件超过大小上限 (${Math.round(MAX_DOWNLOAD_BYTES / 1048576)} MiB): ${declared}`);
		}
		let buf;
		try {
			buf = await res.arrayBuffer();
		} catch (e) {
			throw new LauncherError(`下载中断: ${fetchCauseText(e)}`);
		}
		if (buf.byteLength > MAX_DOWNLOAD_BYTES) throw new LauncherError(`文件超过大小上限 (${Math.round(MAX_DOWNLOAD_BYTES / 1048576)} MiB): ${buf.byteLength}`);
		if (buf.byteLength === 0) throw new LauncherError("下载内容为空");
		const fileName = fileNameFromUrl(url, res.headers.get("content-disposition"));
		return {
			bytes: new Uint8Array(buf),
			fileName
		};
	}
	/** zip → 目录。路径穿越/条目数/总字节三防；单一顶层包装目录自动扁平化；密码包走 crypt-zip 解密。返回写入的相对路径列表。 */
	unzipToDir(bytes, destDir, password) {
		const map = openZipMap(bytes, password);
		const names = [...map.keys()].filter((n) => !n.endsWith("/")).filter((n) => !n.split("/").some((seg) => NOISE_DIRS.has(seg)));
		if (names.length > MAX_ZIP_ENTRIES) throw new LauncherError(`zip 条目数过多: ${names.length}`);
		const pairs = names.map((n) => ({
			orig: n,
			safe: assertSafeRelPath(n)
		}));
		let total = 0;
		for (const p of pairs) {
			total += map.get(p.orig).length;
			if (total > MAX_ZIP_UNPACKED) throw new LauncherError(`zip 解包总量超限: ${total}`);
		}
		const flat = stripTopWrapper(pairs);
		const written = [];
		for (const p of flat) {
			if (p.safe === "") continue;
			const target = join(destDir, ...p.safe.split("/"));
			assertInside(destDir, target);
			const data = map.get(p.orig);
			mkdirSync(dirname(target), { recursive: true });
			writeBytesSafe(target, data);
			written.push(p.safe);
		}
		return written;
	}
	/** 单文件直落（exe/安装包）。返回写入的相对路径。 */
	writeFileToDir(bytes, destDir, fileName) {
		const safe = assertSafeRelPath(fileName);
		const target = join(destDir, ...safe.split("/"));
		assertInside(destDir, target);
		mkdirSync(dirname(target), { recursive: true });
		writeBytesSafe(target, bytes);
		return safe;
	}
	/** 7z 魔数：37 7A BC AF 27 1C。 */
	is7zBytes(bytes) {
		return bytes.length > 6 && bytes[0] === 55 && bytes[1] === 122 && bytes[2] === 188 && bytes[3] === 175 && bytes[4] === 39 && bytes[5] === 28;
	}
	/** 7z 段起点（含「视频垫底 + 7z 追加」复合文件的中部签名）：0=头部，>0=偏移，-1=非 7z。 */
	find7zStart(bytes) {
		return find7zOffset(bytes);
	}
	/** zip 识别：扩展名之外，兼容「视频+zip 复合文件」（zip 数据垫在媒体数据后，头部非 PK）。 */
	isZipBytes(bytes) {
		return bytes.length > 4 && bytes[0] === 80 && bytes[1] === 75 || hasZipTrailer(bytes);
	}
	/** 7z/7za.exe 探测链：CONFIG → 插件 bin/ → Program Files。 */
	resolveSevenZip() {
		const candidates = [
			this.sevenZipPath,
			fileURLToPath(new URL("../../bin/7za.exe", import.meta.url)),
			fileURLToPath(new URL("../bin/7za.exe", import.meta.url)),
			"C:/Program Files/7-Zip/7z.exe",
			"C:/Program Files (x86)/7-Zip/7z.exe"
		].filter((p) => p !== "");
		for (const p of candidates) try {
			if (existsSync(p)) return p;
		} catch {}
		return null;
	}
	/** Bandizip bz.exe 探测：标准安装路径（Bandizip 7+ 自带命令行版 bz.exe）。 */
	resolveBandizip() {
		const candidates = [
			"C:/Program Files/Bandizip/bz.exe",
			"C:/Program Files (x86)/Bandizip/bz.exe",
			join(homedir(), "AppData/Local/Programs/Bandizip/bz.exe")
		];
		for (const p of candidates) try {
			if (existsSync(p)) return p;
		} catch {}
		return null;
	}
	/**
	* .7z（含加密 7z）解包：依次尝试 7-Zip（7z.exe/7za.exe）→ Bandizip（bz.exe），
	* 谁在用谁。参数风格两家不同：7z 用 `-p<pwd>` / `-o<dir>` 连写；Bandizip 用
	* `-p:<pwd>` / `-o:<dir>` 冒号风格。密码经命令行传递——均无 stdin 密码通道；
	* 本机单用户场景下进程列表短暂可见属可接受妥协（文档已注明）。
	*/
	extract7z(bytes, destDir, password, offset = 0) {
		const tools = [];
		const sevenZip = this.resolveSevenZip();
		if (sevenZip !== null) tools.push({
			exe: sevenZip,
			kind: "7z"
		});
		const bandizip = this.resolveBandizip();
		if (bandizip !== null) tools.push({
			exe: bandizip,
			kind: "bandizip"
		});
		if (tools.length === 0 && this.sevenZipPath !== "") {
			const kind = /bz(\.exe)?$/i.test(this.sevenZipPath) ? "bandizip" : "7z";
			tools.push({
				exe: this.sevenZipPath,
				kind
			});
		}
		if (tools.length === 0) throw new LauncherError("未找到 7z/7za 或 Bandizip（bz.exe）：请安装 7-Zip 或 Bandizip，或将 7za.exe 放入插件 bin/ 目录（CONFIG.launcherSevenZipPath 可指定路径）");
		mkdirSync(destDir, { recursive: true });
		const tmpArchive = join(destDir, "__archive__.7z");
		writeBytesSafe(tmpArchive, offset > 0 ? bytes.subarray(offset) : bytes);
		try {
			let lastOutput = "";
			for (const tool of tools) {
				const args = buildArchiveArgs(tool.kind, tmpArchive, destDir, password);
				const r = spawnSync(tool.exe, args, {
					timeout: 6e5,
					windowsHide: true
				});
				if (r.status === 0) return this.listFiles(destDir);
				lastOutput = Buffer.concat([Buffer.from(r.stdout ?? Buffer.alloc(0)), Buffer.from(r.stderr ?? Buffer.alloc(0))]).toString("utf-8");
				if (isPasswordErrorOutput(lastOutput, password)) {
					const pwdEmpty = password === void 0 || password === "";
					throw new CryptZipError(pwdEmpty ? "password_required" : "wrong_password", pwdEmpty ? "压缩包已加密，需要解压密码" : "密码错误（解压器报告密码不符）");
				}
				if (lastOutput.trim() !== "" && r.error === void 0) break;
			}
			throw new LauncherError(`7z 解压失败: ${lastOutput.slice(-300) || "(无输出)"}`);
		} finally {
			try {
				rmSync(tmpArchive, { force: true });
			} catch {}
		}
	}
	/** 递归列出 app 目录内全部文件（相对路径，posix 分隔）。 */
	listFiles(dir, rel = "") {
		const out = [];
		let entries;
		try {
			entries = readdirSync(dir);
		} catch {
			return out;
		}
		for (const name of entries) {
			if (NOISE_DIRS.has(name)) continue;
			const abs = join(dir, name);
			const relPath = rel === "" ? name : rel + "/" + name;
			let st;
			try {
				st = statSync(abs);
			} catch {
				continue;
			}
			if (st.isDirectory()) out.push(...this.listFiles(abs, relPath));
			else out.push(relPath);
		}
		return out;
	}
	/** 从解包产物中探测可执行入口候选：浅层优先、根目录加分、安装器噪声名降权。首个为默认选中项。 */
	detectEntryCandidates(files) {
		const exes = files.filter((f) => EXECUTABLE_EXTS.has(extname(f).toLowerCase()));
		const score = (p) => {
			const d = p.split("/").length;
			const base = basename(p).toLowerCase();
			let s = 100 - d * 10;
			if (d === 1) s += 20;
			if (/setup|install|update|dxsetup|vcredist|dotnet|redist/.test(base)) s -= 40;
			if (base.startsWith("un")) s -= 30;
			return s;
		};
		return exes.sort((a, b) => score(b) - score(a));
	}
	/**
	* 嵌套压缩包处理（分享圈常见「视频+zip → 内含 .7z 安装包」的套娃结构）：
	* 解包产物没有可执行入口、且恰好只有一个内层压缩包（.zip/.7z）时，解开它并删除包体，
	* 重新列目录；最多递归 3 层。密码透传给内层（提取码/解压密码复用密码框同值）。
	*/
	settleNested(dir, files, password) {
		let current = files;
		for (let depth = 0; depth < 3; depth++) {
			if (this.detectEntryCandidates(current).length > 0) return current;
			const archives = current.filter((f) => /\.(zip|7z)$/i.test(f));
			if (archives.length !== 1) return current;
			const inner = archives[0];
			const innerPath = join(dir, ...inner.split("/"));
			let bytes;
			try {
				bytes = new Uint8Array(readFileSync(innerPath));
			} catch {
				return current;
			}
			try {
				rmSync(innerPath, { force: true });
			} catch {}
			if (this.is7zBytes(bytes)) this.extract7z(bytes, dir, password);
			else this.unzipToDir(bytes, dir, password);
			current = this.listFiles(dir);
		}
		return current;
	}
	/** 标题/文件名 → 文件系统安全目录名。 */
	slugify(text) {
		const s = text.trim().toLowerCase().replace(/[\u0000-\u001f<>:"/\\|?*]+/g, "").replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
		return s === "" ? "app" : s.slice(0, 64);
	}
	/** 生成类 WE project.json + 预览图，写 installed.json。返回记录。 */
	finalize(opts) {
		const rec = {
			id: opts.slug,
			title: opts.title,
			slug: opts.slug,
			file: opts.entry,
			preview: "preview.png",
			sourceUrl: opts.url,
			sourceName: opts.fileName,
			size: opts.size,
			sha512: opts.sha512,
			installedAt: this.now()
		};
		const pvExt = PREVIEW_EXT[opts.previewMime ?? ""];
		const pv = opts.previewBytes !== void 0 && pvExt !== void 0 ? opts.previewBytes : fallbackCardPng(opts.title);
		if (pvExt !== void 0) rec.preview = "preview." + pvExt;
		writeFileSync(join(opts.dir, rec.preview), pv);
		const project = {
			title: opts.title,
			type: "application",
			file: opts.entry,
			preview: rec.preview,
			general: { properties: { schemecolor: {
				order: 0,
				text: "ui_browse_properties_scheme_color",
				type: "color",
				value: "0.5 0.5 0.5"
			} } },
			source: {
				url: opts.url,
				fileName: opts.fileName,
				size: opts.size,
				sha512: opts.sha512,
				installedAt: rec.installedAt
			}
		};
		writeFileSync(join(opts.dir, "project.json"), JSON.stringify(project, null, 2) + "\n", "utf8");
		this.upsert(rec);
		return rec;
	}
	/** 多候选时用户选定入口：更新记录 + 重写 project.json 的 file 字段。 */
	setEntry(id, file) {
		const rec = this.get(id);
		if (rec === void 0) throw new LauncherError(`未安装: ${id}`);
		const dir = join(this.root, rec.slug);
		const target = join(dir, ...file.split("/"));
		if (!existsSync(target)) throw new LauncherError(`入口不存在: ${file}`);
		const updated = {
			...rec,
			file
		};
		this.rewriteProject(dir, (p) => {
			p.file = file;
		});
		this.upsert(updated);
		return updated;
	}
	/** 用客户端回传的图片更新预览（按 mime 定扩展名，同步 project.json 与记录）。 */
	writePreview(id, bytes, mime) {
		const rec = this.get(id);
		if (rec === void 0) throw new LauncherError(`未安装: ${id}`);
		const ext = PREVIEW_EXT[mime];
		if (ext === void 0) throw new LauncherError(`不支持的预览类型: ${mime}`);
		const dir = join(this.root, rec.slug);
		const name = "preview." + ext;
		if (rec.preview !== name) try {
			rmSync(join(dir, rec.preview), { force: true });
		} catch {}
		writeFileSync(join(dir, name), bytes);
		const updated = {
			...rec,
			preview: name
		};
		this.rewriteProject(dir, (p) => {
			p.preview = name;
		});
		this.upsert(updated);
	}
	/** 局部重写 app 目录下的 project.json（损坏时静默跳过，索引仍更新）。 */
	rewriteProject(dir, mutate) {
		const pp = join(dir, "project.json");
		try {
			const project = JSON.parse(readFileSync(pp, "utf8"));
			mutate(project);
			writeFileSync(pp, JSON.stringify(project, null, 2) + "\n", "utf8");
		} catch {}
	}
};
function fileNameFromUrl(url, contentDisposition) {
	if (contentDisposition !== null && contentDisposition !== "") {
		const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(contentDisposition);
		if (m !== null && m[1] !== void 0 && m[1] !== "") try {
			return decodeURIComponent(m[1]);
		} catch {
			return m[1];
		}
	}
	const path = new URL(url).pathname;
	const last = path.slice(path.lastIndexOf("/") + 1);
	try {
		return decodeURIComponent(last);
	} catch {
		return last;
	}
}
//#endregion
//#region src/launcher/yun139.ts
/**
* 中国移动云盘（139）分享链接适配器 v2 —— 契约经真实流量逆向验证（2026-09）。
*
* 链接形态：https://yun.139.com/shareweb/#/w/i/<linkID>
* API 网关：https://share-kd-njs.yun.139.com/yun-share/richlifeApp/devapp/IOutLink/*
* 传输加密：请求/响应整体 AES-128-CBC（密钥 PVGDwmcvfs1uV3d1，随机 16B IV 前置，
*           PKCS7，base64；响应可能 gzip）——契约与 Alist/OpenList 139 驱动一致。
*
* 实测结论（真实分享链接验证）：
*  - getOutLinkInfoV6（元数据）：匿名可调，带提取码 passwd 字段；无/错提取码 → resultCode 9188
*  - dlFromOutLinkV3（原始文件直链）：必须登录态——Authorization: Basic b64("<pre>:<手机号>:<token>")
*    + account=手机号；无登录态 → 200000401「IP鉴权失败、用户账号鉴权失败」
* 登录态由用户从浏览器 F12 复制一次，存 ~/.dsh/storages/we-sync-139-auth.json（与 Alist 同款做法）。
*/
const GATEWAY = "https://share-kd-njs.yun.139.com";
const CRYPTO_KEY = Buffer.from("PVGDwmcvfs1uV3d1", "utf-8");
const UA = "Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0";
const DEVICE_INFO = "||9|12.27.0|firefox|140.0|12b780037221ab547c682223327dc9cd||linux unknow|1920X526|zh-CN|||";
function parse139ShareUrl(url) {
	const m = /yun\.139\.com\/shareweb\/#\/w\/i\/([A-Za-z0-9]+)/.exec(url.trim());
	return m !== null ? m[1] : null;
}
var Yun139Error = class extends LauncherError {
	code;
	constructor(code, msg) {
		super(msg);
		this.name = "Yun139Error";
		this.code = code;
	}
};
function envelopeEncrypt(obj) {
	const data = Buffer.from(JSON.stringify(obj), "utf-8");
	const pad = 16 - data.length % 16;
	const padded = Buffer.concat([data, Buffer.alloc(pad, pad)]);
	const iv = randomBytes(16);
	const cipher = createCipheriv("aes-128-cbc", CRYPTO_KEY, iv);
	return Buffer.concat([
		iv,
		cipher.update(padded),
		cipher.final()
	]).toString("base64");
}
function envelopeDecrypt(b64) {
	const raw = Buffer.from(String(b64).replace(/\s+/g, ""), "base64");
	if (raw.length <= 16) throw new Yun139Error("share_api_error", "139 响应过短，解密失败");
	const decipher = createDecipheriv("aes-128-cbc", CRYPTO_KEY, raw.subarray(0, 16));
	let out = Buffer.concat([decipher.update(raw.subarray(16)), decipher.final()]);
	if (out.length > 2 && out[0] === 31 && out[1] === 139) try {
		out = gunzipSync(out);
	} catch {}
	const pad = out[out.length - 1];
	if (pad >= 1 && pad <= 16 && pad < out.length) {
		let valid = true;
		for (let i = out.length - pad; i < out.length; i++) if (out[i] !== pad) {
			valid = false;
			break;
		}
		if (valid) out = out.subarray(0, out.length - pad);
	}
	return out.toString("utf-8");
}
/**
* 登录态解析：接受「Basic <b64>」/ 裸 b64 / 已解码 "<pre>:<手机号>:<token>" 三种形态。
* 返回 { header, account }：header 是可直接放进 Authorization 的完整值。
*/
function normalize139Authorization(raw) {
	let s = raw.trim();
	if (s === "") throw new Yun139Error("share_auth_required", "139 登录态为空");
	if (/^basic\s/i.test(s)) s = s.replace(/^basic\s+/i, "");
	if (s.includes("%")) {
		try {
			const urlDecoded = decodeURIComponent(s);
			if (urlDecoded !== s) s = urlDecoded;
		} catch {}
		if (/^basic\s/i.test(s)) s = s.replace(/^basic\s+/i, "");
	}
	let decoded = "";
	try {
		decoded = Buffer.from(s, "base64").toString("utf-8");
		if (!/^\w+:[^:]*:.+/.test(decoded)) decoded = s;
	} catch {
		decoded = s;
	}
	const splits = decoded.split(":");
	if (!(splits.length === 3 && /^\w{1,32}$/.test(splits[0]) && splits[1].length >= 4 && /^[\d@.a-zA-Z_-]+$/.test(splits[1]) && splits[2].length > 0)) throw new Yun139Error("share_auth_required", "不是有效的 139 登录态（应形如 Basic b64(\"basic:手机号:token\")）");
	return {
		header: "Basic " + Buffer.from(decoded, "utf-8").toString("base64"),
		account: splits[1]
	};
}
function fileCredStore(path) {
	return {
		read() {
			try {
				const j = JSON.parse(readFileSync(path, "utf8"));
				return typeof j.authorization === "string" ? j.authorization : "";
			} catch {
				return "";
			}
		},
		write(v) {
			writeFileSync(path, JSON.stringify({ authorization: v }, null, 2), "utf8");
		}
	};
}
var Yun139Client = class {
	fetchFn;
	/** 登录态来源（每请求实时读，改完即生效）；空 = 匿名（只能解析元数据） */
	getAuth;
	constructor(opts = {}) {
		this.fetchFn = opts.fetchFn ?? (async (u, init) => await fetch(u, init));
		this.getAuth = opts.getAuth ?? (() => "");
	}
	headers(auth) {
		return {
			"User-Agent": UA,
			"Accept": "application/json, text/plain, */*",
			"Content-Type": "application/json;charset=UTF-8",
			"X-Deviceinfo": DEVICE_INFO,
			"hcy-cool-flag": "1",
			"CMS-DEVICE": "default",
			"x-m4c-caller": "PC",
			"X-Yun-Api-Version": "v1",
			"Origin": "https://yun.139.com",
			"Referer": "https://yun.139.com/",
			...auth !== void 0 ? { Authorization: auth } : {}
		};
	}
	/** 加密 POST → 解密响应 → 业务码校验。失败错误信息带 resultCode/desc 原文。 */
	async post(path, body, auth) {
		const res = await this.fetchFn(GATEWAY + path, {
			method: "POST",
			headers: this.headers(auth),
			body: envelopeEncrypt(body)
		});
		const text = await res.text();
		if (!res.ok) throw new Yun139Error("share_api_error", `139 API ${path} HTTP ${res.status}: ${text.slice(0, 200)}`);
		let plain;
		try {
			plain = envelopeDecrypt(text);
		} catch {
			throw new Yun139Error("share_api_error", `139 API ${path} 响应解密失败: ${text.slice(0, 160)}`);
		}
		let parsed;
		try {
			parsed = JSON.parse(plain);
		} catch {
			throw new Yun139Error("share_api_error", `139 API ${path} 解密后非 JSON: ${plain.slice(0, 160)}`);
		}
		const code = typeof parsed.resultCode === "string" ? parsed.resultCode : String(parsed.resultCode ?? "");
		if (code !== "0") {
			const desc = typeof parsed.desc === "string" ? parsed.desc : "";
			if (code === "9188") throw new Yun139Error("share_passcode_wrong", `提取码错误（9188 ${desc}）`);
			if (code === "200000401") throw new Yun139Error("share_auth_required", `需要 139 登录态（200000401 ${desc}）`);
			throw new Yun139Error("share_api_error", `139 API ${path} code=${code}: ${desc || plain.slice(0, 160)}`);
		}
		return parsed.data !== null && typeof parsed.data === "object" ? parsed.data : {};
	}
	/** 元数据（匿名 + 提取码）。返回文件条目列表（含文件夹）。 */
	async listOutLink(linkID, passwd) {
		const data = await this.post("/yun-share/richlifeApp/devapp/IOutLink/getOutLinkInfoV6", { getOutLinkInfoReq: {
			account: "",
			linkID,
			pCaID: "root",
			...passwd !== void 0 && passwd !== "" ? { passwd } : {}
		} });
		const ca = Array.isArray(data.caLst) ? data.caLst : [];
		const co = Array.isArray(data.coLst) ? data.coLst : [];
		return {
			folders: ca.filter((x) => typeof x.caID === "string").map((x) => ({
				id: String(x.caID),
				name: String(x.caName ?? "?")
			})),
			files: co.filter((x) => typeof x.coID === "string").map((x) => ({
				id: String(x.coID),
				name: String(x.coName ?? "?"),
				size: typeof x.coSize === "number" ? x.coSize : 0
			}))
		};
	}
	/** 原始文件下载直链（必须登录态）。 */
	async getDownloadUrl(linkID, coID) {
		const auth = this.getAuth();
		if (auth === "") throw new Yun139Error("share_auth_required", "139 原始文件下载需要登录态：请在面板「139 登录态」里粘贴 Authorization，或安装登录态同步助手（打开 yun.139.com 自动同步）");
		let norm;
		try {
			norm = normalize139Authorization(auth);
		} catch (e) {
			throw new Yun139Error("share_auth_required", `已配置的 139 登录态无效，请重装/更新登录态同步助手后打开 yun.139.com 重新同步（详情：${e.message}）`);
		}
		let data;
		try {
			data = await this.post("/yun-share/richlifeApp/devapp/IOutLink/dlFromOutLinkV3", { dlFromOutLinkReqV3: {
				linkID,
				account: norm.account,
				coIDLst: { item: [coID] }
			} }, norm.header);
		} catch (e) {
			if (e instanceof Yun139Error && e.code === "share_auth_required") throw new Yun139Error("share_auth_required", "已配置的 139 登录态被服务端拒绝（可能已过期）：重新登录 yun.139.com 后助手会自动同步，或在面板手动重新粘贴");
			throw e;
		}
		const ext = data.extInfo !== null && typeof data.extInfo === "object" ? data.extInfo : {};
		const url = typeof data.downloadURL === "string" && data.downloadURL !== "" ? data.downloadURL : typeof data.redrUrl === "string" && data.redrUrl !== "" ? data.redrUrl : typeof ext.cdnDownloadUrl === "string" && ext.cdnDownloadUrl !== "" ? ext.cdnDownloadUrl : "";
		if (url === "") throw new Yun139Error("share_api_error", `139 下载响应无直链: ${JSON.stringify(data).slice(0, 200)}`);
		return url;
	}
	/** 分享链接 → 直链 + 元数据（提取码即用户在密码框输入的值）。 */
	async resolve(shareUrl, passcode) {
		const linkID = parse139ShareUrl(shareUrl);
		if (linkID === null) throw new Yun139Error("share_api_error", `无法解析 139 分享链接: ${shareUrl}`);
		let entries;
		try {
			entries = await this.listOutLink(linkID, passcode);
		} catch (e) {
			if (e instanceof Yun139Error && e.code === "share_passcode_wrong" && (passcode === void 0 || passcode === "")) throw new Yun139Error("share_passcode_required", "该分享需要提取码：请在密码框填入提取码重试");
			throw e;
		}
		if (entries.folders.length > 0 || entries.files.length > 1) throw new Yun139Error("share_not_file", `139 分享根目录不是单个文件（暂不支持文件夹分享）: ${[...entries.folders.map((f) => f.name), ...entries.files.map((f) => f.name)].slice(0, 5).join(", ")}`);
		if (entries.files.length === 0) throw new Yun139Error("share_not_file", "139 分享内容为空");
		const file = entries.files[0];
		return {
			downloadUrl: await this.getDownloadUrl(linkID, file.id),
			fileName: file.name,
			size: file.size
		};
	}
};
//#endregion
//#region src/launcher/helper139.ts
/**
* 139 登录态同步助手（Tampermonkey 用户脚本）v1.1.0。
* v1.0 的教训：按 cookie 名 `authorization` 读取会被 Kaspersky 注入的同名 cookie 污染
* （实测同步进去的是 gc.kis.v2.scr.kaspersky-labs.com 的 URL）。
* v1.1 改为**拦截 139 页面自己的 API 请求**（hook XHR setRequestHeader / fetch），
* 从真实 Authorization 头捕获登录态，配合格式校验，杂讯无法混入；
* cookie / GM_cookie 仅作兜底且同样过校验。
*/
const HELPER_139_URL = "/we-sync/139-helper.user.js";
const HELPER_139_SCRIPT = `// ==UserScript==
// @name         DSH 壁纸插件 · 139 登录态同步助手
// @namespace    dsh-wallpaper-share
// @version      1.1.0
// @description  装一次即忘：拦截中国移动云盘(yun.139.com)页面自身的 API 请求，把 Authorization 登录态自动同步到本机 DSH 壁纸插件。之后在 DSH 面板粘贴 139 分享链接即可直接安装，无需 F12。
// @author       dsh-wallpaper_share
// @match        https://yun.139.com/*
// @match        https://caiyun.139.com/*
// @connect      127.0.0.1
// @connect      localhost
// @grant        GM_xmlhttpRequest
// @grant        GM_cookie
// @grant        GM_registerMenuCommand
// @run-at       document-start
// @noframes
// ==/UserScript==

(function () {
  'use strict'
  var DSH = 'http://127.0.0.1:3080/we-sync/launcher/139auth'
  var last = '' // 本次页面已发送过的值（去重）
  var told = false // 成功/失败提示只弹一次

  // 形如 b64("<pre>:<账号>:<token>") 或明文三元组；卡巴斯基 URL 等杂讯一律拒绝
  function plausible(v) {
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

  function send(value, src) {
    if (!plausible(value) || value === last) return
    last = value
    GM_xmlhttpRequest({
      method: 'POST',
      url: DSH,
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify({ authorization: String(value).trim() }),
      timeout: 8000,
      onload: function (res) {
        if (res.status === 200 && !told) { told = true; toast('✔ 已同步 139 登录态到 DSH（来源：' + src + '）', true) }
        else if (res.status !== 200 && !told) { told = true; toast('✘ 同步被 DSH 拒绝：HTTP ' + res.status, false) }
      },
      onerror: function () { if (!told) { told = true; toast('✘ 同步失败：本机 DSH (127.0.0.1:3080) 未运行？', false) } },
      ontimeout: function () { if (!told) { told = true; toast('✘ 同步超时：本机 DSH 未响应', false) } },
    })
  }

  // ① 拦截页面自身的 XHR 请求头（139 SPA 走 axios/XHR 带 Authorization）
  function hookXHR() {
    try {
      var orig = XMLHttpRequest.prototype.setRequestHeader
      XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
        try { if (String(name).toLowerCase() === 'authorization') send(value, '页面请求头') } catch (e) { /* 不影响页面 */ }
        return orig.apply(this, arguments)
      }
    } catch (e) { /* 忽略 */ }
  }

  // ② 拦截 fetch（部分调用走 fetch）
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
              if (a) send(a, '页面请求头')
            } else {
              for (var k in headers) {
                if (String(k).toLowerCase() === 'authorization') send(headers[k], '页面请求头')
              }
            }
          }
        } catch (e) { /* 不影响页面 */ }
        return orig.apply(this, arguments)
      }
    } catch (e) { /* 忽略 */ }
  }

  // ③ cookie 兜底（同样过校验，Kaspersky 同名 cookie 会被拒）
  function fromCookie() {
    var hit = document.cookie.split(';').map(function (s) { return s.trim() })
      .find(function (s) { return s.indexOf('authorization=') === 0 })
    return hit ? hit.slice('authorization='.length) : ''
  }
  function fromGM() {
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
  function pollFallback() {
    var v = fromCookie()
    if (v) { send(v, 'cookie'); return }
    fromGM().then(function (v2) { if (v2) send(v2, 'cookie(httpOnly)') })
  }

  GM_registerMenuCommand('立即同步登录态到 DSH', pollFallback)
  hookXHR()
  hookFetch()
  setTimeout(pollFallback, 2000)
  setInterval(pollFallback, 10000)
})()
`;
//#endregion
//#region src/launcher/routes.ts
/**
* launcher 的 HTTP 路由（node 半）：注册到 share 的 WebServer，与 market/routes.ts 同契约。
* 控制面 API（localhost）：
*   GET  <base>/installed                 → 已装应用列表
*   POST <base>/install   JSON{url,title?,password?,integrity?,previewDataUrl?}
*                                         → 下载→解包（zip 含加密 / 7z 含加密）→探测→封装→入库
*                                           （422 = 无入口；422 code=password_required/wrong_password）
*                                           url 为 139 分享页时先经 yun139 适配器换直链
*   POST <base>/entry     JSON{id,file}   → 多候选时用户选定入口（重写 project.json + 索引）
*   POST <base>/preview   JSON{id,dataUrl}→ 用客户端 canvas 卡更新预览图
*   GET  <base>/uninstall?id=<id>         → 卸载（删目录 + 索引）
* 纯 handler，Node 用 EventEmitter 假 req 可测。
*/
const MAX_BODY_BYTES = 4194304;
function query(req) {
	return new URL(req.url ?? "/", "http://localhost").searchParams;
}
function json(res, code, body) {
	res.statusCode = code;
	res.setHeader("Content-Type", "application/json; charset=utf-8");
	res.end(JSON.stringify(body));
}
/** 读取请求体（raw 字节），超限即弃。 */
function readBody(req) {
	const stream = req;
	if (typeof stream.on !== "function") return Promise.resolve(/* @__PURE__ */ new Uint8Array(0));
	return new Promise((resolve, reject) => {
		const chunks = [];
		let size = 0;
		let settled = false;
		const done = (fn) => {
			if (!settled) {
				settled = true;
				fn();
			}
		};
		stream.on("data", (c) => {
			size += c.length;
			if (size > MAX_BODY_BYTES) {
				done(() => reject(/* @__PURE__ */ new Error(`请求体超过上限 (${Math.round(MAX_BODY_BYTES / 1024)} KiB)`)));
				return;
			}
			chunks.push(c);
		});
		stream.on("end", () => done(() => resolve(new Uint8Array(Buffer.concat(chunks)))));
		stream.on("error", (e) => done(() => reject(e)));
	});
}
/** dataURL → 字节（仅 data:image/*;base64,）。非法返回 null。 */
function dataUrlToBytes(dataUrl) {
	const m = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl.trim());
	if (m === null) return null;
	try {
		const buf = Buffer.from(m[2].replace(/\s+/g, ""), "base64");
		if (buf.length === 0) return null;
		return {
			bytes: new Uint8Array(buf),
			mime: m[1]
		};
	} catch {
		return null;
	}
}
function createLauncherRoutes(deps) {
	const base = deps.base ?? "/we-sync/launcher";
	const installer = deps.installer;
	const yun139 = deps.yun139 ?? new Yun139Client();
	const cred139 = deps.cred139 ?? {
		read: () => "",
		write: () => {}
	};
	const onRootChanged = deps.onRootChanged ?? (() => {});
	const installed = {
		kind: "exact",
		path: base + "/installed",
		handler: (_req, res) => {
			json(res, 200, { installed: installer.list() });
		}
	};
	const rootRoute = {
		kind: "exact",
		path: base + "/root",
		handler: async (req, res) => {
			if (req.method === "GET") return json(res, 200, { root: installer.root });
			let body;
			try {
				const raw = await readBody(req);
				body = JSON.parse(new TextDecoder().decode(raw));
			} catch (e) {
				return json(res, 400, { error: `请求体非法: ${e.message ?? e}` });
			}
			const opts = body;
			if (typeof opts.root !== "string" || opts.root.trim() === "") return json(res, 400, { error: "缺 root" });
			try {
				const r = opts.move === true ? installer.moveToRoot(opts.root) : (installer.setRoot(opts.root), {
					moved: 0,
					failed: []
				});
				onRootChanged(installer.root);
				return json(res, 200, {
					ok: true,
					root: installer.root,
					moved: r.moved,
					failed: r.failed
				});
			} catch (e) {
				const msg = e instanceof LauncherError ? e.message : `${e.name}: ${e.message}`;
				return json(res, e instanceof LauncherError ? 400 : 500, { error: msg });
			}
		}
	};
	return [
		installed,
		{
			kind: "exact",
			path: base + "/install",
			handler: async (req, res) => {
				let body;
				try {
					const raw = await readBody(req);
					body = JSON.parse(new TextDecoder().decode(raw));
				} catch (e) {
					return json(res, 400, { error: `请求体非法: ${e.message ?? e}` });
				}
				const opts = body;
				if (typeof opts.url !== "string" || opts.url.trim() === "") return json(res, 400, { error: "缺 url" });
				const title = typeof opts.title === "string" && opts.title.trim() !== "" ? opts.title.trim() : void 0;
				const password = typeof opts.password === "string" && opts.password !== "" ? opts.password : void 0;
				const passcode = typeof opts.passcode === "string" && opts.passcode !== "" ? opts.passcode : password;
				const integrity = typeof opts.integrity === "string" && opts.integrity.trim() !== "" ? opts.integrity.trim() : void 0;
				let previewBytes;
				let previewMime;
				if (typeof opts.previewDataUrl === "string" && opts.previewDataUrl !== "") {
					const pv = dataUrlToBytes(opts.previewDataUrl);
					if (pv === null) return json(res, 400, { error: "previewDataUrl 非法（仅支持 data:image/*;base64）" });
					previewBytes = pv.bytes;
					previewMime = pv.mime;
				}
				try {
					let url = opts.url;
					let shareFileName;
					if (parse139ShareUrl(url) !== null) try {
						const meta = await yun139.resolve(url, passcode);
						url = meta.downloadUrl;
						shareFileName = meta.fileName;
					} catch (e) {
						if (e instanceof Yun139Error) return json(res, 422, {
							error: e.message,
							code: e.code
						});
						throw e;
					}
					const dl = await installer.download(url);
					const bytes = dl.bytes;
					const fileName = shareFileName ?? dl.fileName;
					if (integrity !== void 0 && !verifyIntegrity(bytes, integrity)) return json(res, 400, { error: "完整性校验失败: sha512 不匹配（包被篡改或损坏）" });
					const baseName = fileName.replace(/\.(zip|exe|bat|cmd|7z|rar|tar|gz)$/i, "");
					const name = title ?? baseName;
					const slug = installer.slugify(name);
					const dir = join(installer.root, slug);
					if (existsSync(dir)) rmSync(dir, {
						recursive: true,
						force: true
					});
					const isZip = /\.zip$/i.test(fileName) || installer.isZipBytes(bytes);
					const z7off = installer.is7zBytes(bytes) ? 0 : installer.find7zStart(bytes);
					const is7z = z7off >= 0;
					let files;
					try {
						if (is7z) files = installer.extract7z(bytes, dir, password, z7off);
						else if (isZip) files = installer.unzipToDir(bytes, dir, password);
						else files = [installer.writeFileToDir(bytes, dir, fileName)];
						files = installer.settleNested(dir, files, password);
					} catch (e) {
						if (e instanceof CryptZipError) {
							try {
								rmSync(dir, {
									recursive: true,
									force: true
								});
							} catch {}
							return json(res, 422, {
								error: e.message,
								code: e.code
							});
						}
						throw e;
					}
					const candidates = installer.detectEntryCandidates(files);
					if (candidates.length === 0) {
						try {
							rmSync(dir, {
								recursive: true,
								force: true
							});
						} catch {}
						return json(res, 422, {
							error: "包内未找到可执行入口（.exe/.bat/.cmd）",
							files: files.slice(0, 50)
						});
					}
					json(res, 200, {
						ok: true,
						record: installer.finalize({
							url: opts.url,
							fileName,
							slug,
							title: name,
							dir,
							entry: candidates[0],
							size: bytes.length,
							sha512: integrityOf(bytes),
							previewBytes,
							previewMime
						}),
						candidates
					});
				} catch (e) {
					const err = e;
					try {
						appendFileSync(join(installer.root, "..", "we-sync-install-errors.log"), `[${(/* @__PURE__ */ new Date()).toISOString()}] url=${opts.url ?? "?"}\n${err.name}: ${err.message}\n${err.stack ?? ""}\n\n`, "utf8");
					} catch {}
					const msg = e instanceof LauncherError ? e.message : `${err.name}: ${err.message}`;
					json(res, e instanceof LauncherError ? 400 : 500, { error: msg });
				}
			}
		},
		{
			kind: "exact",
			path: base + "/entry",
			handler: async (req, res) => {
				let body;
				try {
					const raw = await readBody(req);
					body = JSON.parse(new TextDecoder().decode(raw));
				} catch (e) {
					return json(res, 400, { error: `请求体非法: ${e.message ?? e}` });
				}
				const opts = body;
				if (typeof opts.id !== "string" || typeof opts.file !== "string" || opts.file === "") return json(res, 400, { error: "缺 id / file" });
				const rec = installer.get(opts.id);
				if (rec === void 0) return json(res, 404, { error: `未安装: ${opts.id}` });
				if (!installer.listFiles(join(installer.root, rec.slug)).includes(opts.file)) return json(res, 400, { error: `入口不在包内: ${opts.file}` });
				try {
					json(res, 200, {
						ok: true,
						record: installer.setEntry(rec.id, opts.file)
					});
				} catch (e) {
					json(res, 500, { error: String(e.message ?? e) });
				}
			}
		},
		{
			kind: "exact",
			path: base + "/preview",
			handler: async (req, res) => {
				let body;
				try {
					const raw = await readBody(req);
					body = JSON.parse(new TextDecoder().decode(raw));
				} catch (e) {
					return json(res, 400, { error: `请求体非法: ${e.message ?? e}` });
				}
				const opts = body;
				if (typeof opts.id !== "string" || typeof opts.dataUrl !== "string") return json(res, 400, { error: "缺 id / dataUrl" });
				const rec = installer.get(opts.id);
				if (rec === void 0) return json(res, 404, { error: `未安装: ${opts.id}` });
				const pv = dataUrlToBytes(opts.dataUrl);
				if (pv === null) return json(res, 400, { error: "dataUrl 非法（仅支持 data:image/*;base64）" });
				try {
					installer.writePreview(rec.id, pv.bytes, pv.mime);
					json(res, 200, { ok: true });
				} catch (e) {
					json(res, 500, { error: String(e.message ?? e) });
				}
			}
		},
		{
			kind: "exact",
			path: base + "/uninstall",
			handler: (req, res) => {
				const id = query(req).get("id");
				if (!id) return json(res, 400, { error: "缺 id" });
				if (!installer.has(id)) return json(res, 404, { error: `未安装: ${id}` });
				installer.remove(id);
				json(res, 200, { ok: true });
			}
		},
		{
			kind: "exact",
			path: base + "/preview-file",
			handler: (req, res) => {
				const id = query(req).get("id");
				if (id === null || id === "") return json(res, 400, { error: "缺 id" });
				const rec = installer.get(id);
				if (rec === void 0) {
					res.statusCode = 404;
					res.end();
					return;
				}
				const mime = rec.preview.endsWith(".png") ? "image/png" : rec.preview.endsWith(".gif") ? "image/gif" : rec.preview.endsWith(".webp") ? "image/webp" : "image/jpeg";
				try {
					const bytes = readFileSync(join(installer.root, rec.slug, rec.preview));
					res.statusCode = 200;
					res.setHeader("Content-Type", mime);
					res.end(new Uint8Array(bytes));
				} catch {
					res.statusCode = 404;
					res.end();
				}
			}
		},
		{
			kind: "exact",
			path: base + "/139auth",
			handler: async (req, res) => {
				if (req.method === "GET") {
					const v = cred139.read();
					const mask = v === "" ? "" : (() => {
						try {
							const s = v.replace(/^basic\s+/i, "");
							const acct = Buffer.from(s, "base64").toString("utf-8").split(":")[1] ?? "?";
							return acct.length > 4 ? acct.slice(0, 3) + "****" + acct.slice(-2) : acct;
						} catch {
							return "已配置";
						}
					})();
					return json(res, 200, {
						present: v !== "",
						account: mask
					});
				}
				let body;
				try {
					const raw = await readBody(req);
					body = JSON.parse(new TextDecoder().decode(raw));
				} catch (e) {
					return json(res, 400, { error: `请求体非法: ${e.message ?? e}` });
				}
				const opts = body;
				if (typeof opts.authorization !== "string") return json(res, 400, { error: "缺 authorization" });
				const v = opts.authorization.trim();
				if (v !== "") try {
					normalize139Authorization(v);
				} catch (e) {
					return json(res, 422, { error: `拒绝保存，不是有效的 139 登录态：${e.message}` });
				}
				cred139.write(v);
				json(res, 200, {
					ok: true,
					present: v !== ""
				});
			}
		},
		{
			kind: "exact",
			path: HELPER_139_URL,
			handler: (_req, res) => {
				res.statusCode = 200;
				res.setHeader("Content-Type", "text/javascript; charset=utf-8");
				res.end(HELPER_139_SCRIPT);
			}
		},
		rootRoute
	];
}
//#endregion
//#region src/index.ts
/**
* dsh-wallpaper_share · node half（内部 id / 路由前缀仍为 we-sync）
* Wallpaper Engine ↔ DSH 壁纸同步（纯显示）：轮询 WE 的 config.json，
* 通过 HTTP 路由提供当前壁纸状态、预览图与增强模式源文件。
* 多显示器：跟踪所有条目，默认跟随"最近变化"的一台；客户端可用
* ?monitor= 参数锁定某台。
*
* 无敏感信息。安装目录运行时自动检测（注册表 → 常见 Steam 路径），
* 检测不到时在下方 CONFIG.wallpaperEngineDir 手动指定。
*/
const inject = ["webServer"];
const CONFIG = {
	/** Wallpaper Engine 安装目录；留空 = 自动检测（注册表 HKCU\Software\WallpaperEngine\installPath → 常见 Steam 路径） */
	wallpaperEngineDir: "",
	/** 工作坊内容目录；留空自动推导为 <Steam库>/steamapps/workshop/content/431960 */
	workshopContentDir: "",
	/** 轮询间隔（毫秒） */
	pollIntervalMs: 2e3,
	/** 预览图大小上限（字节） */
	previewMaxBytes: 6291456,
	/** 外部 scene renderer 可执行文件；留空 = 使用内置参考 renderer（诊断动画，非真实渲染） */
	sceneRendererPath: "",
	/** Wallpaper Engine engine assets 目录；留空自动推导为 <weDir>/assets */
	wallpaperEngineAssetsDir: "",
	/** scene 原生捕获器（we-capture）的输出分辨率：小于壁纸原生分辨率时按盒式降采样。
	*  编码器已换成 SIMD 的 jpeg-encoder（1080p 编码仅 ~11ms），默认按原生 1920x1080 全清晰度输出；
	*  若在 4K 等高刷屏想省 CPU 可下调（会把高分辨率桌面降采样到该尺寸）。参考 renderer 会自行 clamp。 */
	sceneRenderWidth: 1920,
	sceneRenderHeight: 1080,
	/** scene renderer 目标帧率 */
	sceneRenderFps: 30,
	/** JPEG/WebP 帧质量（0..100） */
	sceneRenderQuality: 80,
	/** scene 渲染模式：'auto'（默认：浏览器子集渲染器为主；显式配置 sceneRendererPath 则 external）| 'browser'（强制浏览器子集渲染器）| 'external'（强制外部 renderer 子进程） */
	sceneRenderMode: "auto",
	/** 粒子发射率缩放（视觉校准项；WE rate 为每秒粒子数，稳态 ≈ rate × lifetime，默认 1） */
	particleRateScale: 1,
	/** 粒子尺寸缩放（视觉校准项，默认 1） */
	particleSizeScale: 1,
	/** 图层效果强度缩放（waterwaves/shake 幅度全局系数；原版参数普遍偏强，默认 0.6） */
	effectStrengthScale: .6,
	/** puppet 网格蒙皮渲染（部件按顶点网格渲染；buildMeshCanvas 已与参考 v2 渲染逐像素一致） */
	puppetMeshRender: true,
	/** DWP market 注册表 catalog.json 地址（dwp-registry 构建产物；可换镜像源） */
	dwpMarketCatalogUrl: "https://raw.githubusercontent.com/YRN-playmaker/dwp-registry/main/data/catalog.json",
	/** DWP market 本地存储目录（installed.json + packages/）；留空 = ~/.dsh-dwp-market */
	dwpMarketDir: "",
	/** 应用启动器安装根（类 WE app 目录：project.json + preview + 软件本体）；留空 = ~/.dsh/storages/we-sync-apps */
	launcherDir: "",
	/** 7z/7za.exe 路径（.7z 包含加密包的解压）；留空 = 自动探测（插件 bin/ → Program Files） */
	launcherSevenZipPath: ""
};
function apply(ctx) {
	const webServer = ctx.get("webServer");
	if (webServer === void 0) return;
	const state = {
		version: 0,
		snapshot: null,
		latestMonitor: "",
		monitors: [],
		previews: {},
		lastError: "",
		weDir: "",
		/** 客户端经 WS ?monitor= 锁定的 scene 显示器 key（'' = 自动跟随最新变化）。
		*  刷新/换壁纸时 syncSceneTarget 必须尊重它，不能悄悄重置为 auto。 */
		sceneLock: ""
	};
	/** Scene renderer 编排器（在 detectWeDir 成功后实例化） */
	let sceneAdapter = null;
	/** SceneModel 缓存（key=指纹；避免每次轮询重新解析 scene.pkg） */
	let sceneModelCache = null;
	const disposers = [];
	ctx.effect(() => () => {
		for (const d of disposers) d();
	});
	function normalize(path) {
		return path.replace(/\\/g, "/");
	}
	function detectWeDir() {
		if (CONFIG.wallpaperEngineDir.trim() !== "") return normalize(CONFIG.wallpaperEngineDir.trim());
		try {
			const out = execFileSync("reg", [
				"query",
				"HKCU\\Software\\WallpaperEngine",
				"/v",
				"installPath"
			], {
				encoding: "utf8",
				windowsHide: true,
				timeout: 5e3
			});
			const match = /REG_SZ\s+(.+)/.exec(out);
			if (match !== null) {
				const installPath = match[1];
				if (installPath !== void 0) return normalize(installPath.trim()).replace(/\/wallpaper(64|32)\.exe$/i, "");
			}
		} catch {}
		for (const dir of [
			"C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine",
			"D:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine",
			"C:/Steam/steamapps/common/wallpaper_engine",
			"D:/Steam/steamapps/common/wallpaper_engine"
		]) if (existsSync(dir + "/wallpaper64.exe")) return dir;
		return null;
	}
	function resolveWorkshopDir(weDir) {
		if (CONFIG.workshopContentDir.trim() !== "") return normalize(CONFIG.workshopContentDir.trim());
		const idx = weDir.indexOf("/steamapps/common/");
		if (idx >= 0) return weDir.slice(0, idx) + "/steamapps/workshop/content/431960";
		return weDir.replace(/\/common\/[^/]+$/, "") + "/workshop/content/431960";
	}
	function readText(path) {
		return readFileSync(path, "utf8");
	}
	function readBytes(path) {
		const buf = readFileSync(path);
		if (buf.byteLength > CONFIG.previewMaxBytes) throw new Error("preview exceeds " + CONFIG.previewMaxBytes + " bytes");
		return new Uint8Array(buf);
	}
	function exists(path) {
		return existsSync(path);
	}
	function dirOf(file) {
		const slash = normalize(file);
		const idx = slash.lastIndexOf("/");
		return idx >= 0 ? slash.slice(0, idx) : slash;
	}
	/** 读取所有显示器的壁纸条目 + 最近选中的显示器 */
	function readEntries(weDir) {
		const root = JSON.parse(readText(weDir + "/config.json").replace(/^\uFEFF/, ""));
		let cfg = null;
		for (const key of Object.keys(root)) {
			const value = root[key];
			if (value !== null && typeof value === "object" && value.general !== void 0) {
				cfg = value;
				break;
			}
		}
		const general = cfg?.general ?? {};
		const sel = (general.wallpaperconfig ?? {}).selectedwallpapers ?? {};
		const entries = {};
		for (const key of Object.keys(sel)) {
			if (!key.startsWith("Monitor")) continue;
			const value = sel[key];
			if (value === null || typeof value !== "object") continue;
			const file = value.file;
			if (typeof file === "string" && file.length > 0) entries[key] = { file };
		}
		const browser = general.browser ?? {};
		return {
			entries,
			last: typeof browser.lastselectedmonitor === "string" ? browser.lastselectedmonitor : ""
		};
	}
	/** workshopcache 的 workshopid → {title, type} 映射（一次解析，全体复用） */
	function readCacheMeta(weDir) {
		const map = /* @__PURE__ */ new Map();
		try {
			const cache = JSON.parse(readText(weDir + "/bin/workshopcache.json"));
			for (const w of cache.wallpapers ?? []) if (w.workshopid !== void 0 && w.workshopid !== null) map.set(String(w.workshopid), {
				title: String(w.title ?? ""),
				type: String(w.type ?? "")
			});
		} catch {}
		return map;
	}
	function resolveMeta(file, workshopDir, cacheMap) {
		const slash = normalize(file);
		const match = /431960\/(\d+)/.exec(slash);
		const id = (match !== null ? match[1] : "") ?? "";
		let title = "";
		let type = "";
		const cached = id !== "" ? cacheMap.get(id) : void 0;
		if (cached !== void 0) {
			title = cached.title;
			type = cached.type;
		}
		if (title === "") try {
			const base = id !== "" ? workshopDir + "/" + id : dirOf(slash);
			const project = JSON.parse(readText(base + "/project.json"));
			if (project !== null && typeof project === "object") {
				if (project.title !== void 0) title = String(project.title);
				if (type === "" && project.type !== void 0) type = String(project.type);
			}
		} catch {}
		if (title === "") title = id !== "" ? id : slash.slice(slash.lastIndexOf("/") + 1);
		return {
			title,
			type,
			id
		};
	}
	function probePreview(dir) {
		for (const [name, mime] of [
			["preview.jpg", "image/jpeg"],
			["preview.png", "image/png"],
			["preview.gif", "image/gif"]
		]) {
			const path = dir + "/" + name;
			try {
				if (exists(path)) return {
					path,
					mime
				};
			} catch {}
		}
		return null;
	}
	/** 按扩展名判断源文件能否被浏览器直接渲染 */
	function sourceKindOf(file) {
		const lower = normalize(file).toLowerCase();
		if (lower.endsWith(".mp4")) return {
			kind: "video",
			mime: "video/mp4"
		};
		if (lower.endsWith(".webm")) return {
			kind: "video",
			mime: "video/webm"
		};
		if (lower.endsWith(".mov")) return {
			kind: "video",
			mime: "video/quicktime"
		};
		if (lower.endsWith(".avi")) return {
			kind: "video",
			mime: "video/x-msvideo"
		};
		if (lower.endsWith(".mkv")) return {
			kind: "video",
			mime: "video/x-matroska"
		};
		if (lower.endsWith(".html") || lower.endsWith(".htm")) return {
			kind: "web",
			mime: "text/html"
		};
		if (lower.endsWith(".pkg")) return {
			kind: "scene",
			mime: ""
		};
		if (lower.endsWith(".exe")) return {
			kind: "application",
			mime: ""
		};
		if (lower.endsWith(".png")) return {
			kind: "image",
			mime: "image/png"
		};
		if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return {
			kind: "image",
			mime: "image/jpeg"
		};
		if (lower.endsWith(".gif")) return {
			kind: "image",
			mime: "image/gif"
		};
		if (lower.endsWith(".webp")) return {
			kind: "image",
			mime: "image/webp"
		};
		return {
			kind: "other",
			mime: ""
		};
	}
	/** 判断某 .tex 条目是否被「声明 spritesheet combo 的材质」引用。
	*  只有这类材质的纹理才按 spritesheet 动画裁剪；其余（含 TEXS 帧表的
	*  GIF/场景动画纹理）保持整图显示，避免误判导致显示异常。 */
	function isSpritesheetTex(pkg, texEntryName) {
		let base = texEntryName.replace(/^materials\//, "").replace(/\.(tex|png|jpe?g)$/i, "");
		if (base === texEntryName) base = texEntryName;
		for (const e of pkg.entries) {
			if (!e.name.startsWith("materials/") || !e.name.endsWith(".json")) continue;
			try {
				const buf = pkg.read(e.name);
				if (buf === null) continue;
				let text;
				try {
					text = Buffer.from(buf).toString("utf8");
				} catch {
					continue;
				}
				if (!/"spritesheet"\s*:\s*[1-9]/.test(text)) continue;
				const texBase = /* @__PURE__ */ new Set();
				for (const m of text.matchAll(/"textures"\s*:\s*\[\s*([^\]]*)\]/g)) for (const tm of m[1].matchAll(/"([^"]+)"/g)) texBase.add(tm[1].replace(/\.(tex|png|jpe?g)$/i, ""));
				if (texBase.has(base)) return true;
			} catch {}
		}
		return false;
	}
	/** 从 scene.pkg（Wallpaper Engine 私有 PKGV 容器）中扫描最大的一张 JPEG/PNG 纹理。
	*  scene 壁纸的真实画面由 WE 引擎（shader / 粒子 / 纹理）渲染，浏览器无法执行；
	*  这里提取内嵌背景纹理的 mipmap 链中最高清的一张，作为增强模式的近似背景。 */
	function scanPkgImage(file) {
		let buf;
		try {
			buf = readFileSync(file);
		} catch {
			return null;
		}
		let best = null;
		const consider = (start, end, mime, w, h) => {
			if (w < 64 || h < 64 || w > 16384 || h > 16384) return;
			const area = w * h;
			if (best === null || area > best.width * best.height) best = {
				start,
				end,
				mime,
				width: w,
				height: h
			};
		};
		let pos = 0;
		while (pos < buf.length - 4) {
			if (buf[pos] === 255 && buf[pos + 1] === 216 && buf[pos + 2] === 255) {
				let scan = pos + 2;
				let w = 0;
				let h = 0;
				for (let guard = 0; scan < buf.length - 9 && guard < 64; guard++) {
					if (buf[scan] !== 255) {
						scan++;
						continue;
					}
					const marker = buf[scan + 1];
					if (marker === 216 || marker >= 208 && marker <= 215) {
						scan += 2;
						continue;
					}
					const len = buf.readUInt16BE(scan + 2);
					if (len < 2) break;
					if (marker >= 192 && marker <= 207 && marker !== 196 && marker !== 200 && marker !== 204) {
						h = buf.readUInt16BE(scan + 5);
						w = buf.readUInt16BE(scan + 7);
						break;
					}
					scan += 2 + len;
				}
				if (w > 0 && h > 0) {
					const eoi = buf.indexOf(Buffer.from([255, 217]), scan);
					const end = eoi >= 0 ? eoi + 1 : buf.length - 1;
					consider(pos, end, "image/jpeg", w, h);
					pos = end;
					continue;
				}
			}
			if (buf[pos] === 137 && buf[pos + 1] === 80 && buf[pos + 2] === 78 && buf[pos + 3] === 71 && buf.readUInt32BE(pos + 12) === 1229472850) {
				const w = buf.readUInt32BE(pos + 16);
				const h = buf.readUInt32BE(pos + 20);
				const iend = buf.indexOf(Buffer.from("49454e44ae426082", "hex"), pos);
				const end = iend >= 0 ? iend + 7 : buf.length - 1;
				consider(pos, end, "image/png", w, h);
				pos = end;
				continue;
			}
			pos++;
		}
		return best;
	}
	function mimeOfPath(path) {
		const lower = normalize(path).toLowerCase();
		if (lower.endsWith(".html") || lower.endsWith(".htm")) return "text/html; charset=utf-8";
		if (lower.endsWith(".css")) return "text/css; charset=utf-8";
		if (lower.endsWith(".js")) return "application/javascript; charset=utf-8";
		if (lower.endsWith(".json")) return "application/json; charset=utf-8";
		if (lower.endsWith(".png")) return "image/png";
		if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
		if (lower.endsWith(".gif")) return "image/gif";
		if (lower.endsWith(".webp")) return "image/webp";
		if (lower.endsWith(".svg")) return "image/svg+xml";
		if (lower.endsWith(".woff2")) return "font/woff2";
		if (lower.endsWith(".woff")) return "font/woff";
		if (lower.endsWith(".ttf")) return "font/ttf";
		if (lower.endsWith(".mp4")) return "video/mp4";
		if (lower.endsWith(".webm")) return "video/webm";
		if (lower.endsWith(".mp3")) return "audio/mpeg";
		if (lower.endsWith(".wav")) return "audio/wav";
		return "application/octet-stream";
	}
	/** 读取壁纸 project.json 的 general.properties 默认值，构造 WE applyUserProperties 入参 */
	function buildWallpaperProps(dir) {
		try {
			const project = JSON.parse(readText(dir + "/project.json"));
			const props = {};
			for (const key of Object.keys(project?.general?.properties ?? {})) {
				const p = project.general?.properties?.[key];
				if (p !== void 0 && "value" in p) props[key] = { value: p.value };
			}
			if (project?.general?.properties?.modelresolution !== void 0) {
				for (const res of [
					"2k",
					"4k",
					"8k"
				]) if (exists(dir + "/assets/" + res)) {
					props.modelresolution = { value: res };
					break;
				}
			}
			if (Object.keys(props).length > 0) return props;
		} catch {}
		return { introanimation: { value: true } };
	}
	/** 注入到壁纸页面里的 WE 环境 shim：复刻 WE 默认环境（html/body 铺满黑底 + 主 canvas 全屏），
	*  并等 wallpaperPropertyListener 注册后自动调用 applyUserProperties */
	function wallpaperShim(props) {
		return "<style>html,body{width:100%;height:100%;overflow:hidden;background:#000;margin:0;padding:0}</style><script>(function(){var c=document.getElementById(\"canvas\");if(c&&getComputedStyle(c).position===\"static\"){c.style.position=\"fixed\";c.style.top=\"0\";c.style.left=\"0\";c.style.width=\"100%\";c.style.height=\"100%\"};" + ("var p=" + JSON.stringify(props).replace(/</g, "\\u003c") + ";var f=function(){if(window.wallpaperPropertyListener&&typeof window.wallpaperPropertyListener.applyUserProperties===\"function\"){window.wallpaperPropertyListener.applyUserProperties(p);return true}return false};if(!f()){var n=0;var t=setInterval(function(){n++;if(f()||n>200)clearInterval(t)},50)}") + "})();<\\/script>";
	}
	/** 伺服 web 壁纸文件；HTML 注入 WE 属性 shim（否则 introAnimation 等属性永远 undefined，渲染被卡住） */
	function serveWebFile(dir, target, req, res) {
		const lower = target.toLowerCase();
		if (lower.endsWith(".html") || lower.endsWith(".htm")) try {
			const html = readText(target);
			const shim = wallpaperShim(buildWallpaperProps(dir));
			const injected = html.replace(/<\/body>/i, shim + "</body>");
			const out = injected === html ? html + shim : injected;
			res.statusCode = 200;
			res.setHeader("Content-Type", "text/html; charset=utf-8");
			res.setHeader("Cache-Control", "no-store");
			res.end(out);
			return;
		} catch {}
		serveFile(target, mimeOfPath(target), req, res);
	}
	/** 解析 HTTP Range 头；返回 undefined=无 Range，null=非法范围，否则为闭区间 */
	function parseRange(header, total) {
		if (typeof header !== "string") return void 0;
		const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
		if (m === null) return void 0;
		const left = m[1] ?? "";
		const right = m[2] ?? "";
		if (left === "" && right === "") return null;
		let start;
		let end;
		if (left === "") {
			const n = Number(right);
			if (!Number.isFinite(n) || n <= 0) return null;
			start = Math.max(0, total - n);
			end = total - 1;
		} else {
			start = Number(left);
			if (!Number.isFinite(start) || start < 0 || start >= total) return null;
			end = right === "" ? total - 1 : Math.min(Number(right), total - 1);
			if (!Number.isFinite(end) || end < start) return null;
		}
		return {
			start,
			end
		};
	}
	/** 流式返回文件（视频等大文件不能整读进内存），支持 HTTP Range 以便视频可 seek/播放 */
	function serveFile(path, mime, req, res) {
		let info;
		try {
			info = statSync(path);
		} catch {
			res.statusCode = 404;
			res.end("not found");
			return;
		}
		if (!info.isFile()) {
			res.statusCode = 404;
			res.end("not found");
			return;
		}
		const total = info.size;
		res.setHeader("Accept-Ranges", "bytes");
		res.setHeader("Content-Type", mime);
		res.setHeader("Cache-Control", "no-store");
		const range = parseRange(req.headers?.range, total);
		if (range === null) {
			res.statusCode = 416;
			res.setHeader("Content-Range", "bytes */" + total);
			res.end();
			return;
		}
		if (range !== void 0) {
			res.statusCode = 206;
			res.setHeader("Content-Range", "bytes " + range.start + "-" + range.end + "/" + total);
			res.setHeader("Content-Length", String(range.end - range.start + 1));
			const stream = createReadStream(path, {
				start: range.start,
				end: range.end
			});
			stream.on("error", () => {
				try {
					res.end();
				} catch {}
			});
			stream.pipe(res);
			return;
		}
		res.statusCode = 200;
		res.setHeader("Content-Length", String(total));
		const stream = createReadStream(path);
		stream.on("error", () => {
			try {
				res.end();
			} catch {}
		});
		stream.pipe(res);
	}
	/** 流式返回文件的一个字节切片（用于从 scene.pkg 内提取纹理），支持 HTTP Range */
	function serveSlice(path, start, end, mime, req, res) {
		const total = end - start + 1;
		res.setHeader("Accept-Ranges", "bytes");
		res.setHeader("Content-Type", mime);
		res.setHeader("Cache-Control", "no-store");
		const range = parseRange(req.headers?.range, total);
		if (range === null) {
			res.statusCode = 416;
			res.setHeader("Content-Range", "bytes */" + total);
			res.end();
			return;
		}
		if (range !== void 0) {
			res.statusCode = 206;
			res.setHeader("Content-Range", "bytes " + range.start + "-" + range.end + "/" + total);
			res.setHeader("Content-Length", String(range.end - range.start + 1));
			const stream = createReadStream(path, {
				start: start + range.start,
				end: start + range.end
			});
			stream.on("error", () => {
				try {
					res.end();
				} catch {}
			});
			stream.pipe(res);
			return;
		}
		res.statusCode = 200;
		res.setHeader("Content-Length", String(total));
		const stream = createReadStream(path, {
			start,
			end
		});
		stream.on("error", () => {
			try {
				res.end();
			} catch {}
		});
		stream.pipe(res);
	}
	/** 重建全量显示器信息 + 每台预览缓存；识别"最近变化"的显示器 */
	function refresh(entries, last, weDir, workshopDir) {
		state.lastError = "";
		const prev = state.snapshot;
		state.snapshot = entries;
		let changedKey = null;
		for (const key of Object.keys(entries)) {
			const entry = entries[key];
			if (entry === void 0) continue;
			const prevEntry = prev === null ? void 0 : prev[key];
			if (prevEntry === void 0 || prevEntry.file !== entry.file) {
				changedKey = key;
				break;
			}
		}
		if (changedKey === null && prev !== null) {
			for (const key of Object.keys(prev)) if (entries[key] === void 0) {
				changedKey = key;
				break;
			}
		}
		if (changedKey !== null) state.latestMonitor = changedKey;
		if (state.latestMonitor === "" || entries[state.latestMonitor] === void 0) state.latestMonitor = entries[last] !== void 0 ? last : Object.keys(entries)[0] ?? "";
		const cacheMap = readCacheMeta(weDir);
		state.monitors = Object.keys(entries).flatMap((key) => {
			const entry = entries[key];
			if (entry === void 0) return [];
			const meta = resolveMeta(entry.file, workshopDir, cacheMap);
			const src = sourceKindOf(entry.file);
			let kind = src.kind;
			let mime = src.mime;
			let sourceFile = entry.file;
			let sceneImage = null;
			if (kind === "other") {
				const index = dirOf(entry.file) + "/index.html";
				if (exists(index)) {
					kind = "web";
					mime = "text/html";
					sourceFile = index;
				}
			}
			if (kind === "scene") sceneImage = scanPkgImage(entry.file);
			return [{
				key,
				file: entry.file,
				title: meta.title,
				type: meta.type,
				kind,
				mime,
				sourceFile,
				sceneImage
			}];
		});
		const previews = {};
		for (const monitor of state.monitors) {
			let info = {
				bytes: null,
				mime: "",
				kind: "none"
			};
			if (!/^https?:\/\//i.test(monitor.file)) {
				const preview = probePreview(dirOf(monitor.file));
				if (preview !== null) try {
					info = {
						bytes: readBytes(preview.path),
						mime: preview.mime,
						kind: "image"
					};
				} catch (e) {
					state.lastError = String(e.message ?? e);
				}
			} else info = {
				bytes: null,
				mime: "",
				kind: "web"
			};
			previews[monitor.key] = info;
		}
		state.previews = previews;
		state.version += 1;
		syncSceneTarget();
	}
	function poll(weDir) {
		if (weDir === "") return;
		try {
			const { entries, last } = readEntries(weDir);
			if (JSON.stringify(entries) !== JSON.stringify(state.snapshot)) refresh(entries, last, weDir, resolveWorkshopDir(weDir));
		} catch (e) {
			state.lastError = String(e.message ?? e);
		}
	}
	function sendJson(res, body) {
		res.statusCode = 200;
		res.setHeader("Content-Type", "application/json; charset=utf-8");
		res.setHeader("Cache-Control", "no-store");
		res.end(JSON.stringify(body));
	}
	function monitorFromQuery(req) {
		const match = /[?&]monitor=([^&]+)/.exec(req.url ?? "");
		if (match === null || match[1] === void 0) return "";
		try {
			return decodeURIComponent(match[1]);
		} catch {
			return "";
		}
	}
	function effectiveKey(locked) {
		const keys = state.monitors.map((m) => m.key);
		if (keys.includes(locked)) return locked;
		if (state.latestMonitor !== "" && keys.includes(state.latestMonitor)) return state.latestMonitor;
		return keys[0] ?? "";
	}
	/** 由显示器 key 构造 SceneAdapter 目标（仅 scene 壁纸；非 scene 返回 null） */
	function sceneTargetFor(key) {
		const monitor = state.monitors.find((m) => m.key === key);
		if (monitor === void 0 || monitor.kind !== "scene") return null;
		return {
			key: monitor.key,
			file: monitor.file,
			kind: monitor.kind
		};
	}
	/** 让 renderer 跟随当前生效的 scene 显示器（在 monitors 重建后调用）。
	*  优先尊重客户端锁定的显示器（key 失效时 effectiveKey 自动回退 latest/首个）。 */
	function syncSceneTarget() {
		if (sceneAdapter === null) return;
		sceneAdapter.setTarget(sceneTargetFor(effectiveKey(state.sceneLock)));
	}
	/** 汇总某台显示器的 scene renderer 状态（供 /we-sync/state 与 /we-sync/diag） */
	function sceneInfoFor(key) {
		const monitor = state.monitors.find((m) => m.key === key);
		if (monitor === void 0 || monitor.kind !== "scene") return null;
		const cap = sceneAdapter?.getCapabilities() ?? null;
		const status = sceneAdapter?.getStatus() ?? null;
		const hasPreview = state.previews[key]?.kind === "image";
		const fallback = sceneAdapter?.getFallback({
			kind: "scene",
			hasTexture: monitor.sceneImage !== null,
			hasPreview,
			renderMode: "source"
		}) ?? null;
		return {
			live: sceneAdapter?.isRunning() === true,
			available: cap?.available === true,
			version: cap?.version ?? "",
			status,
			texture: monitor.sceneImage !== null,
			fallback: fallback?.level ?? "generic",
			capabilities: cap,
			mode: resolveSceneMode(),
			model: getSceneModel(key) !== null
		};
	}
	/** 解析当前 scene 渲染模式：
	*  'external' → 外部 renderer；'browser' → 浏览器子集渲染器；
	*  'auto' → 显式配置 sceneRendererPath 或探测到真·原生 renderer（we-capture）则 external，否则 browser */
	function resolveSceneMode() {
		if (CONFIG.sceneRenderMode === "external") return "external";
		if (CONFIG.sceneRenderMode === "browser") return "browser";
		if (CONFIG.sceneRendererPath.trim() !== "") return "external";
		return isNativeRenderer(sceneAdapter?.getCapabilities() ?? null) ? "external" : "browser";
	}
	/** 构建（并缓存）某显示器的 SceneModel；非 scene 或解析失败返回 null */
	function getSceneModel(key) {
		const monitor = state.monitors.find((m) => m.key === key);
		if (monitor === void 0 || monitor.kind !== "scene") return null;
		const fp = sceneFingerprint(monitor.file);
		if (sceneModelCache !== null && sceneModelCache.fp === fp) return sceneModelCache.model;
		let model = null;
		try {
			model = buildSceneModel(new Uint8Array(readFileSync(monitor.file)), {
				particleRateScale: CONFIG.particleRateScale,
				particleSizeScale: CONFIG.particleSizeScale,
				effectStrengthScale: CONFIG.effectStrengthScale,
				puppetMeshRender: CONFIG.puppetMeshRender
			});
		} catch {
			model = null;
		}
		sceneModelCache = {
			fp,
			model
		};
		return model;
	}
	disposers.push(webServer.register({
		kind: "exact",
		path: "/we-sync/state",
		handler(req, res) {
			const key = effectiveKey(monitorFromQuery(req));
			const monitor = state.monitors.find((m) => m.key === key);
			const preview = key !== "" ? state.previews[key] : void 0;
			sendJson(res, {
				version: state.version,
				kind: preview !== void 0 ? preview.kind : "none",
				hash: monitor !== void 0 ? key + "|" + monitor.file : "none",
				monitor: key,
				latestMonitor: state.latestMonitor,
				monitors: state.monitors.length > 1 ? state.monitors : [],
				wallpaper: monitor !== void 0 ? {
					title: monitor.title,
					type: monitor.type
				} : null,
				source: monitor !== void 0 ? {
					kind: monitor.kind,
					mime: monitor.mime,
					scene: monitor.sceneImage !== null
				} : {
					kind: "",
					mime: "",
					scene: false
				},
				scene: sceneInfoFor(key),
				webPort
			});
		}
	}));
	disposers.push(webServer.register({
		kind: "exact",
		path: "/we-sync/source",
		handler(req, res) {
			const key = effectiveKey(monitorFromQuery(req));
			const monitor = state.monitors.find((m) => m.key === key);
			if (monitor === void 0) {
				res.statusCode = 404;
				res.end("no wallpaper");
				return;
			}
			if (monitor.kind === "video" || monitor.kind === "image") {
				serveFile(monitor.sourceFile, monitor.mime !== "" ? monitor.mime : "application/octet-stream", req, res);
				return;
			}
			if (monitor.kind === "web") {
				serveFile(monitor.sourceFile, "text/html; charset=utf-8", req, res);
				return;
			}
			res.statusCode = 415;
			res.end("source not renderable: " + monitor.kind);
		}
	}));
	disposers.push(webServer.register({
		kind: "exact",
		path: "/we-sync/scene",
		handler(req, res) {
			const key = effectiveKey(monitorFromQuery(req));
			const monitor = state.monitors.find((m) => m.key === key);
			if (monitor === void 0 || monitor.kind !== "scene" || monitor.sceneImage === null) {
				res.statusCode = 404;
				res.end("no scene image");
				return;
			}
			const img = monitor.sceneImage;
			serveSlice(monitor.sourceFile, img.start, img.end, img.mime, req, res);
		}
	}));
	/** 解析 web 壁纸目录下的相对子路径（安全）：
	*  URL 解码 + 反斜杠归一 + 拒绝绝对路径与任何 `..` 段；非法返回 null。
	*  rel 只含普通文件名/子目录段 → 拼进 dir 后不可能逃逸（无需再做 resolve）。 */
	function webRelPath(raw, prefix) {
		if (!raw.startsWith(prefix)) return null;
		let rel = raw.slice(prefix.length).split("?")[0];
		try {
			rel = decodeURIComponent(rel);
		} catch {
			return null;
		}
		rel = rel.replace(/\\/g, "/");
		if (rel.startsWith("/")) return null;
		const parts = rel.split("/");
		if (parts.some((p) => p === "..")) return null;
		return parts.join("/");
	}
	disposers.push(webServer.register({
		kind: "prefix",
		path: "/we-sync/wallpaper",
		handler(req, res) {
			const key = effectiveKey(monitorFromQuery(req));
			const monitor = state.monitors.find((m) => m.key === key);
			if (monitor === void 0 || monitor.kind !== "web") {
				res.statusCode = 404;
				res.end("no web wallpaper");
				return;
			}
			const dir = normalize(dirOf(monitor.sourceFile));
			const rel = webRelPath(req.url ?? "", "/we-sync/wallpaper/");
			if (rel === null) {
				res.statusCode = 403;
				res.end("forbidden");
				return;
			}
			const target = normalize(dir + "/" + rel);
			if (!target.startsWith(dir + "/") || target.length <= dir.length + 1) {
				res.statusCode = 403;
				res.end("forbidden");
				return;
			}
			serveWebFile(dir, target, req, res);
		}
	}));
	disposers.push(webServer.register({
		kind: "exact",
		path: "/we-sync/diag",
		handler(_req, res) {
			const effKey = effectiveKey("");
			const effMonitor = state.monitors.find((m) => m.key === effKey);
			const adapterTarget = sceneAdapter?.getTarget() ?? null;
			const sceneKey = adapterTarget !== null ? adapterTarget.key : effKey;
			sendJson(res, {
				version: state.version,
				latestMonitor: state.latestMonitor,
				monitorCount: state.monitors.length,
				monitors: state.monitors.map((m) => ({
					key: m.key,
					file: m.file,
					kind: m.kind,
					sceneImage: m.sceneImage !== null ? {
						width: m.sceneImage.width,
						height: m.sceneImage.height,
						mime: m.sceneImage.mime
					} : null
				})),
				scene: sceneInfoFor(sceneKey),
				sceneTarget: effMonitor !== void 0 && effMonitor.kind === "scene" ? {
					key: effKey,
					file: effMonitor.file
				} : null,
				sceneAdapterTarget: adapterTarget !== null ? {
					key: adapterTarget.key,
					file: adapterTarget.file
				} : null,
				sceneModel: (() => {
					const m = getSceneModel(sceneKey);
					return m === null ? null : {
						width: m.width,
						height: m.height,
						layers: m.layerCount,
						textures: m.textures.length,
						decodableTextures: m.decodableTextureCount
					};
				})(),
				sceneMode: resolveSceneMode(),
				lastError: state.lastError,
				weDir: state.weDir
			});
		}
	}));
	/** project.json 的 type 归一化为筛选分类：scene / video / image / application / web / other */
	function normalizeWallpaperType(raw) {
		const t = raw.trim().toLowerCase();
		if (t === "scene") return "scene";
		if (t === "video") return "video";
		if (t === "slideshow" || t === "image" || t === "picture" || t === "pictures") return "image";
		if (t === "application" || t === "app") return "application";
		if (t === "web") return "web";
		return "other";
	}
	let appsCache = null;
	let appsCacheMtime = 0;
	/** 用户自定义壁纸读取目录（持久化到 $DSH_HOME/storages/we-sync-app-dirs.json）。
	*  支持两种形态：目录本身是一个壁纸（内含 project.json），或是一个集合目录（子目录各为壁纸）。 */
	let appDirs = [];
	function appDirsFile() {
		return (process.env.DSH_HOME ?? process.env.USERPROFILE ?? "") + "/.dsh/storages/we-sync-app-dirs.json";
	}
	function loadAppDirs() {
		try {
			const parsed = JSON.parse(readText(appDirsFile()));
			if (Array.isArray(parsed)) return parsed.filter((x) => typeof x === "string").map(normalize);
		} catch {}
		return [];
	}
	function saveAppDirs() {
		try {
			const file = appDirsFile();
			mkdirSync(file.slice(0, file.lastIndexOf("/")), { recursive: true });
			writeFileSync(file, JSON.stringify(appDirs, null, 2), "utf8");
		} catch (e) {
			console.log("[we-sync] 保存自定义壁纸目录失败:", e.message ?? e);
		}
	}
	appDirs = loadAppDirs();
	function scanApps(weDir, workshopDir) {
		const roots = [];
		try {
			roots.push(workshopDir);
		} catch {}
		try {
			const proj = weDir + "/projects/myprojects";
			if (exists(proj)) roots.push(proj);
			const defaults = weDir + "/projects/defaultprojects";
			if (exists(defaults)) roots.push(defaults);
		} catch {}
		for (let d of appDirs) {
			d = normalize(d);
			try {
				if (d !== "" && exists(d)) roots.push(d);
			} catch {}
		}
		const out = [];
		const seen = /* @__PURE__ */ new Set();
		/** 处理单个壁纸目录（该目录必须有 project.json） */
		const visitWallpaperDir = (dir) => {
			if (seen.has(dir)) return;
			seen.add(dir);
			const projectPath = dir + "/project.json";
			let title = dir.slice(dir.lastIndexOf("/") + 1);
			let type = "";
			let file = "";
			let preview = null;
			try {
				const project = JSON.parse(readText(projectPath));
				if (project !== null && typeof project === "object") {
					if (project.title !== void 0) title = String(project.title);
					if (project.type !== void 0) type = String(project.type);
					if (project.file !== void 0) file = String(project.file);
					if (typeof project.preview === "string" && project.preview !== "") {
						const p = normalize(dir + "/" + project.preview);
						if (exists(p)) preview = p;
					}
				}
			} catch {
				return;
			}
			type = normalizeWallpaperType(type);
			if (preview === null) {
				const probed = probePreview(dir);
				preview = probed !== null ? probed.path : null;
			}
			out.push({
				id: dir,
				title,
				dir,
				file,
				preview,
				type
			});
		};
		/** 遍历集合目录下的每个子目录（每个子目录当壁纸扫） */
		const visitCollectionDir = (root) => {
			let entries;
			try {
				entries = readdirSync(root);
			} catch {
				return;
			}
			for (const name of entries) {
				const dir = normalize(root + "/" + name);
				if (exists(dir + "/project.json")) visitWallpaperDir(dir);
			}
		};
		for (const root of roots) if (exists(root + "/project.json")) visitWallpaperDir(root);
		else visitCollectionDir(root);
		out.sort((a, b) => a.title.localeCompare(b.title, void 0, {
			numeric: true,
			sensitivity: "base"
		}));
		return out;
	}
	/** 缓存读取：所有 apps 路由共用同一 30s 缓存，避免每次请求全量扫描 100+ 目录的 project.json */
	function getCachedApps(weDir, workshopDir) {
		const now = Date.now();
		if (appsCache === null || now - appsCacheMtime > 3e4) {
			appsCache = scanApps(weDir, workshopDir);
			appsCacheMtime = now;
		}
		return appsCache;
	}
	disposers.push(webServer.register({
		kind: "exact",
		path: "/we-sync/apps/dirs",
		handler(_req, res) {
			sendJson(res, { dirs: appDirs });
		}
	}));
	disposers.push(webServer.register({
		kind: "exact",
		path: "/we-sync/apps/dirs/add",
		handler(req, res) {
			const url = req.url ?? "";
			const q = url.indexOf("?");
			const norm = normalize((q >= 0 ? decodeURIComponent(url.slice(q + 1).replace(/^dir=/, "")) : "").trim());
			if (norm === "" || !exists(norm)) {
				res.statusCode = 400;
				sendJson(res, {
					error: "目录不存在",
					dirs: appDirs
				});
				return;
			}
			if (!appDirs.includes(norm)) {
				appDirs.push(norm);
				saveAppDirs();
				appsCache = null;
			}
			sendJson(res, { dirs: appDirs });
		}
	}));
	disposers.push(webServer.register({
		kind: "exact",
		path: "/we-sync/apps/dirs/remove",
		handler(req, res) {
			const url = req.url ?? "";
			const q = url.indexOf("?");
			const norm = normalize((q >= 0 ? decodeURIComponent(url.slice(q + 1).replace(/^dir=/, "")) : "").trim());
			if (norm.replace(/\\/g, "/").toLowerCase() === launcherRoot.replace(/\\/g, "/").toLowerCase()) {
				sendJson(res, {
					dirs: appDirs,
					error: "该目录是应用启动器安装位置，不可移除（可对它点「更改」换位置）"
				});
				return;
			}
			const idx = appDirs.indexOf(norm);
			if (idx >= 0) {
				appDirs.splice(idx, 1);
				saveAppDirs();
				appsCache = null;
			}
			sendJson(res, { dirs: appDirs });
		}
	}));
	disposers.push(webServer.register({
		kind: "exact",
		path: "/we-sync/apps",
		handler(_req, res) {
			if (state.weDir === "") {
				sendJson(res, {
					error: "we not detected",
					apps: []
				});
				return;
			}
			const workshopDir = resolveWorkshopDir(state.weDir);
			const apps = getCachedApps(state.weDir, workshopDir);
			const counts = {
				all: apps.length,
				scene: 0,
				video: 0,
				image: 0,
				application: 0,
				web: 0,
				other: 0
			};
			for (const a of apps) counts[a.type] = (counts[a.type] ?? 0) + 1;
			sendJson(res, {
				apps: apps.map((a) => ({
					id: a.id,
					title: a.title,
					file: a.file,
					type: a.type,
					source: (normalize(a.dir) + "/").startsWith(normalize(launcherRoot) + "/") ? "launcher" : "",
					hasPreview: a.preview !== null
				})),
				counts
			});
		}
	}));
	disposers.push(webServer.register({
		kind: "exact",
		path: "/we-sync/apps/preview",
		handler(req, res) {
			if (state.weDir === "") {
				res.statusCode = 404;
				res.end();
				return;
			}
			const url = req.url ?? "";
			const q = url.indexOf("?");
			const id = q >= 0 ? decodeURIComponent(url.slice(q + 1).replace(/^id=/, "")) : "";
			const workshopDir = resolveWorkshopDir(state.weDir);
			const app = getCachedApps(state.weDir, workshopDir).find((a) => a.id === id);
			if (app === null || app === void 0 || app.preview === null) {
				res.statusCode = 404;
				res.end("no preview");
				return;
			}
			serveFile(app.preview, mimeOfPath(app.preview), req, res);
		}
	}));
	disposers.push(webServer.register({
		kind: "exact",
		path: "/we-sync/apps/open",
		handler(req, res) {
			const url = req.url ?? "";
			const q = url.indexOf("?");
			const id = q >= 0 ? decodeURIComponent(url.slice(q + 1).replace(/^id=/, "")) : "";
			if (state.weDir === "" || id === "") {
				res.statusCode = 400;
				res.end("bad request");
				return;
			}
			const workshopDir = resolveWorkshopDir(state.weDir);
			const app = getCachedApps(state.weDir, workshopDir).find((a) => a.id === id);
			if (app === void 0) {
				res.statusCode = 404;
				res.end("app not found");
				return;
			}
			execFile("powershell.exe", [
				"-NoProfile",
				"-Command",
				"Invoke-Item -LiteralPath '" + app.dir.replace(/'/g, "''") + "'"
			], { windowsHide: true }, (err) => {
				if (err !== null) console.log("[we-sync] apps/open 打开文件夹失败:", err.message);
			});
			sendJson(res, {
				opened: true,
				dir: app.dir
			});
		}
	}));
	disposers.push(webServer.register({
		kind: "exact",
		path: "/we-sync/apps/launch",
		handler(req, res) {
			const url = req.url ?? "";
			const q = url.indexOf("?");
			const id = q >= 0 ? decodeURIComponent(url.slice(q + 1).replace(/^id=/, "")) : "";
			if (id === "") {
				res.statusCode = 400;
				sendJson(res, { error: "bad request" });
				return;
			}
			const workshopDir = state.weDir !== "" ? resolveWorkshopDir(state.weDir) : "";
			let app = getCachedApps(state.weDir, workshopDir).find((a) => a.id === id);
			if (app === void 0) {
				const rec = launcher.get(id);
				if (rec !== void 0) app = {
					id: rec.id,
					title: rec.title,
					dir: normalize(launcherRoot + "/" + rec.slug),
					file: rec.file,
					preview: null,
					type: "application"
				};
			}
			if (app === void 0) {
				res.statusCode = 404;
				sendJson(res, { error: "app not found" });
				return;
			}
			if (app.type !== "application" || app.file.trim() === "") {
				res.statusCode = 400;
				sendJson(res, { error: "该壁纸没有可启动的可执行文件" });
				return;
			}
			const exe = normalize(app.dir + "/" + app.file);
			if (!exe.startsWith(app.dir + "/") || !exists(exe)) {
				res.statusCode = 404;
				sendJson(res, { error: "可执行文件不存在或不在壁纸目录内: " + app.file });
				return;
			}
			const lower = exe.toLowerCase();
			const exeDir = exe.slice(0, exe.lastIndexOf("/"));
			try {
				if (lower.endsWith(".exe")) spawn(exe, [], {
					cwd: exeDir,
					detached: true,
					stdio: "ignore"
				}).unref();
				else if (lower.endsWith(".bat") || lower.endsWith(".cmd")) spawn("cmd.exe", ["/c", exe], {
					cwd: exeDir,
					detached: true,
					stdio: "ignore",
					windowsHide: true
				}).unref();
				else {
					res.statusCode = 400;
					sendJson(res, { error: "不支持的入口类型: " + app.file });
					return;
				}
				sendJson(res, {
					launched: true,
					file: app.file,
					dir: app.dir
				});
			} catch (e) {
				res.statusCode = 500;
				sendJson(res, { error: "启动失败: " + (e.message ?? e) });
			}
		}
	}));
	const launcherRootFile = normalize(homedir() + "/.dsh/storages/we-sync-apps-root.json");
	let launcherRoot = normalize(CONFIG.launcherDir !== "" ? CONFIG.launcherDir : homedir() + "/.dsh/storages/we-sync-apps");
	try {
		const saved = JSON.parse(readText(launcherRootFile));
		if (typeof saved.root === "string" && saved.root.trim() !== "") launcherRoot = normalize(saved.root.trim());
	} catch {}
	try {
		mkdirSync(launcherRoot, { recursive: true });
	} catch {}
	const launcher = new LauncherInstaller({
		root: launcherRoot,
		sevenZipPath: CONFIG.launcherSevenZipPath
	});
	const cred139 = fileCredStore(normalize(homedir() + "/.dsh/storages/we-sync-139-auth.json"));
	const yun139 = new Yun139Client({ getAuth: () => cred139.read() });
	for (const route of createLauncherRoutes({
		installer: launcher,
		yun139,
		cred139,
		onRootChanged: (next) => {
			try {
				writeFileSync(launcherRootFile, JSON.stringify({ root: next }, null, 2) + "\n", "utf8");
			} catch {}
			const i = appDirs.indexOf(launcherRoot);
			if (i >= 0) appDirs[i] = next;
			else if (!appDirs.includes(next)) appDirs.push(next);
			launcherRoot = next;
			saveAppDirs();
			appsCache = null;
		}
	})) disposers.push(webServer.register(route));
	if (!appDirs.includes(launcherRoot)) {
		appDirs.push(launcherRoot);
		saveAppDirs();
		appsCache = null;
	}
	disposers.push(webServer.register({
		kind: "exact",
		path: "/we-sync/preview",
		handler(req, res) {
			const key = effectiveKey(monitorFromQuery(req));
			const preview = key !== "" ? state.previews[key] : void 0;
			if (preview === void 0 || preview.bytes === null) {
				res.statusCode = 404;
				res.end("no preview: " + state.lastError);
				return;
			}
			res.statusCode = 200;
			res.setHeader("Content-Type", preview.mime);
			res.setHeader("Cache-Control", "no-store");
			res.end(Buffer.from(preview.bytes));
		}
	}));
	/** SceneModel JSON：浏览器子集渲染器（SceneModelRenderer）的数据源。
	*  返回归一化图层树（transform/visible/纹理引用链），并按指纹缓存。 */
	disposers.push(webServer.register({
		kind: "exact",
		path: "/we-sync/scene/model",
		handler(req, res) {
			const model = getSceneModel(effectiveKey(monitorFromQuery(req)));
			if (model === null) {
				res.statusCode = 404;
				res.end("no scene model");
				return;
			}
			sendJson(res, model);
		}
	}));
	/** SceneModel 纹理字节：仅提供 pkg 内可解码（jpg/png）条目，防止路径穿越 */
	disposers.push(webServer.register({
		kind: "exact",
		path: "/we-sync/scene/texture",
		handler(req, res) {
			const key = effectiveKey(monitorFromQuery(req));
			const monitor = state.monitors.find((m) => m.key === key);
			if (monitor === void 0 || monitor.kind !== "scene") {
				res.statusCode = 404;
				res.end("no scene wallpaper");
				return;
			}
			const match = /[?&]name=([^&]+)/.exec(req.url ?? "");
			if (match === null || match[1] === void 0) {
				res.statusCode = 400;
				res.end("missing name");
				return;
			}
			let name;
			try {
				name = decodeURIComponent(match[1]);
			} catch {
				name = "";
			}
			if (!/\.(tex|png|jpe?g)$/i.test(name)) {
				res.statusCode = 415;
				res.end("unsupported texture entry: " + name);
				return;
			}
			try {
				const pkg = parseScenePkg(new Uint8Array(readFileSync(monitor.file)));
				const entry = pkg.entries.find((e) => e.name === name);
				if (entry === void 0) {
					res.statusCode = 404;
					res.end("no such texture entry");
					return;
				}
				const absStart = pkg.dataStart + entry.offset;
				const absEnd = absStart + entry.size;
				if (/\.(png|jpe?g)$/i.test(name)) {
					const mime = /\.png$/i.test(name) ? "image/png" : "image/jpeg";
					serveSlice(monitor.file, absStart, absEnd, mime, req, res);
					return;
				}
				const tex = decodeTex(new Uint8Array(readFileSync(monitor.file).subarray(absStart, absEnd)));
				if (tex !== null && tex.mip0 !== null) {
					if (tex.imageWidth > 0 && tex.imageHeight > 0) {
						res.setHeader("X-WE-Image-W", String(tex.imageWidth));
						res.setHeader("X-WE-Image-H", String(tex.imageHeight));
					}
					const spr = tex.frames;
					if (spr !== null && spr.length > 1 && isSpritesheetTex(pkg, name)) {
						const fw = Math.round(spr[0].w);
						const fh = Math.round(spr[0].h);
						if (fw > 0 && fh > 0) {
							res.setHeader("X-Sprite-Frames", String(spr.length));
							res.setHeader("X-Sprite-Width", String(fw));
							res.setHeader("X-Sprite-Height", String(fh));
							res.setHeader("X-Sprite-Duration", String(spr.reduce((a, f) => a + f.t, 0) || 0));
							if (spr.length <= 256) res.setHeader("X-Sprite-Rects", spr.map((f) => `${f.x},${f.y},${Math.round(f.w)},${Math.round(f.h)}`).join(";"));
						}
					}
					const mime = texMimeOf(tex) ?? "image/png";
					if (tex.mip0.kind === "image-png" || tex.mip0.kind === "image-jpeg") serveSlice(monitor.file, absStart + tex.mip0.dataOffset, absStart + tex.mip0.dataOffset + tex.mip0.data.length, mime, req, res);
					else {
						const png = texMipToPng(tex);
						if (png === null) {
							res.statusCode = 500;
							res.end("tex decode failed: " + name);
							return;
						}
						res.statusCode = 200;
						res.setHeader("Content-Type", mime);
						res.setHeader("Cache-Control", "no-store");
						res.end(Buffer.from(png));
					}
					return;
				}
				res.statusCode = 415;
				res.end("tex decode failed: " + name);
			} catch {
				res.statusCode = 500;
				res.end("pkg read failed");
			}
		}
	}));
	/** 引擎资产纹理（粒子等）：<weDir>/assets/materials/<name>.tex → 解码为 PNG。
	*  name 如 particle/fog/fog1（材质 textures 的相对路径） */
	disposers.push(webServer.register({
		kind: "exact",
		path: "/we-sync/asset/texture",
		handler(req, res) {
			const match = /[?&]name=([^&]+)/.exec(req.url ?? "");
			if (match === null || match[1] === void 0) {
				res.statusCode = 400;
				res.end("missing name");
				return;
			}
			let name;
			try {
				name = decodeURIComponent(match[1]);
			} catch {
				name = "";
			}
			if (!/^[a-zA-Z0-9_\/\-\.\s\u4e00-\u9fff]+$/.test(name) || name.includes("..") || state.weDir === "") {
				res.statusCode = 403;
				res.end("forbidden");
				return;
			}
			let bytes = null;
			let metaText = null;
			try {
				const key = effectiveKey(monitorFromQuery(req));
				const monitor = state.monitors.find((m) => m.key === key);
				if (monitor !== void 0 && monitor.kind === "scene") {
					const pkg = parseScenePkg(new Uint8Array(readFileSync(monitor.file)));
					const entry = pkg.entries.find((e) => e.name === "materials/" + name + ".tex");
					if (entry !== void 0) {
						const fileBuf = readFileSync(monitor.file);
						bytes = new Uint8Array(fileBuf.subarray(pkg.dataStart + entry.offset, pkg.dataStart + entry.offset + entry.size));
						const metaEntry = pkg.entries.find((e) => e.name === "materials/" + name + ".tex-json");
						if (metaEntry !== void 0) metaText = fileBuf.subarray(pkg.dataStart + metaEntry.offset, pkg.dataStart + metaEntry.offset + metaEntry.size).toString("utf8");
					}
				}
				if (bytes === null) bytes = new Uint8Array(readFileSync(state.weDir + "/assets/materials/" + name + ".tex"));
				if (metaText === null) try {
					metaText = readFileSync(state.weDir + "/assets/materials/" + name + ".tex-json", "utf8");
				} catch {}
			} catch {
				res.statusCode = 404;
				res.end("no such asset texture: " + name);
				return;
			}
			const tex = decodeTex(bytes);
			const png = tex !== null ? texMipToPng(tex) : null;
			if (png === null) {
				res.statusCode = 415;
				res.end("asset tex decode failed: " + name);
				return;
			}
			res.statusCode = 200;
			res.setHeader("Content-Type", "image/png");
			res.setHeader("Cache-Control", "no-store");
			let framesH = 0;
			let fwH = 0;
			let fhH = 0;
			if (metaText !== null) try {
				const meta = JSON.parse(metaText);
				const seq = Array.isArray(meta.spritesheetsequences) ? meta.spritesheetsequences[0] : void 0;
				if (seq !== void 0) {
					const frames = Number(seq.frames);
					const fw = Number(seq.width);
					const fh = Number(seq.height);
					if (Number.isFinite(frames) && frames > 1 && Number.isFinite(fw) && fw > 0 && Number.isFinite(fh) && fh > 0) {
						framesH = frames;
						fwH = fw;
						fhH = fh;
					}
				}
			} catch {}
			if (framesH <= 1 || fwH <= 0 || fhH <= 0) {
				const m = /(\d{2,4})x(\d{2,4})/.exec(name);
				if (m !== null) {
					const a = Number(m[1]);
					const b = Number(m[2]);
					const small = Math.min(a, b);
					const large = Math.max(a, b);
					const count = large / small;
					if (Number.isInteger(count) && count >= 2 && count <= 64 && small >= 32 && tex !== null) {
						const iw = tex.imageWidth > 0 ? tex.imageWidth : tex.textureWidth;
						const ih = tex.imageHeight > 0 ? tex.imageHeight : tex.textureHeight;
						if (iw === small || ih === small || iw === large || ih === large) {
							framesH = count;
							fwH = small;
							fhH = small;
						}
					}
				}
			}
			if (framesH > 1 && fwH > 0 && fhH > 0) {
				res.setHeader("X-Sprite-Frames", String(framesH));
				res.setHeader("X-Sprite-Width", String(fwH));
				res.setHeader("X-Sprite-Height", String(fhH));
			}
			res.end(Buffer.from(png));
		}
	}));
	/** scene 帧流 WebSocket：SceneCanvas 连到此路由接收二进制帧。
	*  连接时按 ?monitor= 锁定渲染目标（空 = 跟随生效显示器）。
	*  锁定是服务端状态：此后 refresh/换壁纸不会把它重置回 auto，
	*  直到客户端以不带 monitor 的连接重新接入。 */
	disposers.push(webServer.registerUpgrade({
		path: "/we-sync/scene/stream",
		handler(req, socket, head) {
			if (sceneAdapter === null) {
				try {
					socket.destroy();
				} catch {}
				return;
			}
			state.sceneLock = monitorFromQuery(req);
			syncSceneTarget();
			sceneAdapter.hub.handleUpgrade(req, socket, head);
		}
	}));
	/** DWP market：注册表拉取 + 本地安装管理（读 dwp-registry catalog.json，下载校验 sha512 后装到本地）。
	*  控制面路由供 client 半的"壁纸市场"UI 调用；付费包返回 402 + 销售页，由 UI 打开创作者平台。 */
	const marketDir = CONFIG.dwpMarketDir || homedir() + "/.dsh-dwp-market";
	const market = new MarketClient({ dir: marketDir });
	for (const route of createMarketRoutes({
		market,
		catalogUrl: CONFIG.dwpMarketCatalogUrl
	})) disposers.push(webServer.register(route));
	/** DWP 渲染面伺服：把已装 .dwp 解包，按需提供 scene/manifest/资源 + 管理"当前应用"。
	*  client 半用 @dwp/web 的 mount() 拉这些端点组装背景层。 */
	const dwpApply = new ApplyState(marketDir);
	for (const route of createDwpServeRoutes({
		store: market.store,
		apply: dwpApply
	})) disposers.push(webServer.register(route));
	/** 壁纸源服务器：把当前 web 壁纸目录作为独立源伺服（127.0.0.1 临时端口）。
	*  Spine/WebGL 类壁纸在 iframe 里需要"自己的同源"才能渲染（贴图不 tainted、
	*  ES module / fetch / import() 全通），且与 DSH 主源（3080）隔离，无安全后门。 */
	let sourceServer = null;
	let webPort = 0;
	try {
		sourceServer = createServer((req, res) => {
			const key = effectiveKey(monitorFromQuery(req));
			const monitor = state.monitors.find((m) => m.key === key);
			if (monitor === void 0 || monitor.kind !== "web") {
				res.statusCode = 404;
				res.end("no web wallpaper");
				return;
			}
			const dir = normalize(dirOf(monitor.sourceFile));
			const rel = webRelPath(req.url ?? "", "/");
			if (rel === null) {
				res.statusCode = 403;
				res.end("forbidden");
				return;
			}
			const target = normalize(dir + "/" + rel);
			if (!target.startsWith(dir + "/") || target.length <= dir.length + 1) {
				res.statusCode = 403;
				res.end("forbidden");
				return;
			}
			serveWebFile(dir, target, req, res);
		});
		sourceServer.listen(0, "127.0.0.1", () => {
			const addr = sourceServer?.address();
			if (addr !== null && typeof addr === "object") webPort = addr.port;
		});
		disposers.push(() => {
			if (sourceServer !== null) try {
				sourceServer.close();
			} catch {}
		});
	} catch {
		webPort = 0;
	}
	const detected = detectWeDir();
	if (detected === null) {
		state.lastError = "未找到 Wallpaper Engine 安装目录：请在 dsh-wallpaper_share 包源码的 CONFIG.wallpaperEngineDir 手动指定";
		return;
	}
	state.weDir = detected;
	sceneAdapter = new SceneAdapter({
		config: {
			sceneRendererPath: CONFIG.sceneRendererPath,
			wallpaperEngineAssetsDir: CONFIG.wallpaperEngineAssetsDir,
			width: CONFIG.sceneRenderWidth,
			height: CONFIG.sceneRenderHeight,
			fps: CONFIG.sceneRenderFps,
			quality: CONFIG.sceneRenderQuality
		},
		weDir: detected,
		log: (line) => console.log(line)
	});
	disposers.push(() => {
		sceneAdapter?.dispose();
		sceneAdapter = null;
	});
	ctx.effect(() => {
		const timer = setInterval(() => poll(detected), CONFIG.pollIntervalMs);
		poll(detected);
		return () => clearInterval(timer);
	});
}
//#endregion
export { apply, inject };
