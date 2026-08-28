# dsh-wallpaper_share
# Wallpaper Engine ↔ DeepSeek Harness 壁纸同步


https://github.com/user-attachments/assets/4461d385-de62-42be-8420-7edce5606f44



[中文](#中文) | [English](#english)

把 Wallpaper Engine 当前显示的壁纸实时同步为 DeepSeek Harness Web 界面的背景，并提供 `wallpaper_share` 标签页用于调整壁纸表现。支持场景壁纸的完整动效与应用壁纸的导入。

> **纯显示同步**：只读取 WE 状态，不控制 / 不修改桌面壁纸（换壁纸请在 WE 内操作）。
> **无敏感信息**：代码不含 Steam 用户名 / SteamID / 令牌；WE 安装目录运行时自动检测（注册表 `HKCU\Software\WallpaperEngine\installPath` → 常见 Steam 路径），检测不到时才需要手动配置。

---

<a name="中文"></a>
# 中文

## 兼容矩阵

| 壁纸类型 | 增强模式 | 性能模式
| --- | --- | --- |
| `video` | 播放源视频（支持 HTTP Range，可正常 seek） | 显示静态预览图或gif |
| `web` | iframe 加载源页面 | 显示静态预览图或gif |
| `image` | 显示源图 | 显示源图 |
| `scene` | 读取pkg并由**浏览器渲染器** | 显示pkg静态纹理 |
| `application` | 可从wallpaper_share预览 | 可从wallpaper_share预览

> scene 增强的完整 fallback 链与各层实现（渲染模式 / 纹理解码 / 粒子 / puppet）见 **[docs/scene-fallback.md](docs/scene-fallback.md)**。

## 功能

- **实时同步**：在 Wallpaper Engine 切换壁纸后，harness页面背景自动跟随
- **多显示器**：复数显示器时可手动锁定某台作为背景来源
- **视觉效果滑块**：支持面板透明度/ 背景模糊/ 阴影深度调整
- **渲染模式切换**：性能（静态预览图）⇄ 增强（加载包括特效动画在内的所有壁纸内容）
- **Scene 实时渲染（实验内容）**：scene 壁纸增强模式默认走**浏览器子集渲染器**（真实 `scene.json` 图层树 + transform + 已解码纹理合成进 canvas，含粒子与 puppet 动画）；显式配置 `sceneRendererPath` 后走独立 renderer 子进程（offscreen，不弹窗）→ WebSocket 帧流；完整回退链见 [docs/scene-fallback.md](docs/scene-fallback.md)
- **专注模式**：随任务启停变化背景的复杂度以专注于当前任务内容
- **后台任务可视化** 收纳侧边栏时，通过圆形ui感知任务进度：绿-空闲；蓝-任务进行；橙-需要手动介入
- **同步开关** ⏻ 一键启停
- 自诊断路由 `/we-sync/diag`（仅本机可访问，含 scene renderer 状态与纹理提取结果）

## 安装（官方 `dsh plugin` 通道，零手工配置）

> 前置：兼容 DSH Web `0.1.0-rc.6` 及以上（已在 0.1.0-rc.6 实机验证），以 `dsh --profile web` 运行。

```bash
# 任选其一：
dsh plugin --profile web add github:YRN-playmaker/dsh-wallpaper_share
#   从 GitHub 安装（仓库自带预构建 lib/，不需要构建许可）
dsh plugin --profile web add dsh-wallpaper_share
#   从 npm 安装（发布后）
dsh plugin --profile web add ./dsh-wallpaper_share-0.2.0.tgz
#   本地 tarball 安装
```

```bash
# 安装 test 分支（测试版本，包括：壁纸特效优化，页面功能更新等）：
dsh plugin --profile web add github:YRN-playmaker/dsh-wallpaper_share#test
```

```bash
# 重启 dsh（web profile），打开页面即可看到 wallpaper_share 标签页
```

**无需手动编辑任何配置文件**：包内 `dsh.bundle.patch` 指向的 `cordis.patch.yml` 会在安装时自动加入 profile 的 bundle 层，其中一行同时是 host 行（node 半：轮询 + HTTP 路由）和 `dsh.client` roster 行（浏览器半的预构建 `lib/client.js` 由模块系统自动注入页面）。包发布时**自带预构建产物**，用户侧零构建。

## 从源码构建（开发者）

1. 把本仓库根目录（`package.json` / `src/` / `tsconfig.json` / `tsdown.config.ts`）拷入你的 DSH checkout：`packages/client/we-sync/`；
2. `pnpm install`
3. `pnpm --filter dsh-wallpaper_share exec tsc -b`
4. `pnpm --filter dsh-wallpaper_share bundle`
5. 产物在 `packages/client/we-sync/lib/`（`index.js` node 半 + `client.js` 浏览器半），拷回本仓库 `lib/` 后 `pnpm pack` 出新 tarball。

> 也可以在本仓库根目录直接 `pnpm install && pnpm build`（`tsdown` 独立构建，不依赖 DSH checkout）。

## 配置

包源码 `src/index.ts` 顶部 `CONFIG`：

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `wallpaperEngineDir` | `''`（自动检测） | 检测失败时手动指定安装目录 |
| `workshopContentDir` | `''`（自动推导） | 工作坊内容目录 |
| `pollIntervalMs` | `2000` | 轮询间隔 |
| `previewMaxBytes` | `6291456` | 预览图大小上限 |
| `sceneRendererPath` | `''`（内置参考 renderer） | 外部 scene renderer 可执行文件；留空用内置参考 renderer（诊断动画） |
| `wallpaperEngineAssetsDir` | `''`（自动推导） | WE engine assets 目录（自动为 `<weDir>/assets`；缺失时 renderer 不可用） |
| `sceneRenderWidth` | `1920` | scene renderer 输出宽度 |
| `sceneRenderHeight` | `1080` | scene renderer 输出高度 |
| `sceneRenderFps` | `30` | scene renderer 目标帧率 |
| `sceneRenderQuality` | `80` | JPEG/WebP 帧质量（0..100） |
| `sceneRenderMode` | `'auto'` | `'auto'`（浏览器子集渲染器为主；配置了 `sceneRendererPath` 则 external）\| `'browser'` \| `'external'` |
| `particleRateScale` | `1` | 粒子发射率缩放（WE rate 单位 = 每秒粒子数） |
| `particleSizeScale` | `1` | 粒子尺寸缩放 |

## 排查

- `http://127.0.0.1:3080/we-sync/diag`：内部状态（`kind` / `fingerprint` / `weDir` / `lastError` / 每台显示器的 `sceneImage` 提取结果 / **scene renderer 的 capabilities / status / fallback 层**）；
- `lastError` 提示未找到安装目录 → 在包源码 `CONFIG.wallpaperEngineDir` 手动指定后重新构建 / 重新安装；
- scene 增强无动态画面 → 看 `scene.available`：`false` 表示 renderer 缺失或 assets 目录缺失（`/we-sync/diag` 里有 `reason`）；
- 页面没变化 → 刷新页面，确认标签栏出现 `wallpaper_share`。

## 已知限制

- scene 增强的"真实动态画面"取决于渲染模式：默认浏览器子集渲染器做**图层树 + transform + 纹理/粒子/puppet 动画合成**（shader effect / SceneScript / keyframe 动画为后续）；外部 renderer（`sceneRendererPath`）可提供真实渲染，但需用户自备（如 WSL2 封装的 linux-wallpaperengine 离屏封装，GPL，独立组件）；
- 参考 renderer 为 1920×1080 RGBA 全帧传输，CPU 占用偏高（本机实测 ~24-27fps @960×540）；真 renderer 建议输出 JPEG/WebP 以降低带宽；
- 多显示器时取 `lastselectedmonitor`（无则第一台）；
- 视觉参数仅保存在页面内存，刷新回到默认值（72% / 6px / 30%）。

## 目录

- `package.json` — 包清单：`dsh.bundle.patch` → `cordis.patch.yml`，`dsh.client` → 浏览器半，`exports["./client"]` → 预构建 `lib/client.js`
- `cordis.patch.yml` — bundle 补丁层（host 行 + dsh.client roster 行）
- `src/index.ts` — node 半源码（轮询 / HTTP 路由 / scene 纹理提取 / HTTP Range / SceneAdapter 接入 / SceneModel 路由 / WebSocket 帧流）
- `src/scene/` — SceneAdapter 模块（协议 / 能力探测 / renderer 进程 / WebSocket / fallback / **PKGV0001 解析 / SceneModel 图层模型 / .tex 解码 / puppet mdl 解析**）
- `src/client/` — 浏览器半源码（主题覆盖 / 背景层 / SceneCanvas / **SceneModelRenderer 子集渲染器 / ParticleRuntime** / wallpaper_share 面板）
- `docs/` — 格式与实现文档（`tex-format-findings.md` / `mdl-skinning-findings.md` / **`scene-fallback.md`**）
- `tools/scene-renderer/` — 内置参考 renderer（协议契约实现；真 renderer 按同协议替换）
- `lib/` — 预构建产物（用户零构建；GitHub 安装也无需构建许可）
- `dsh-wallpaper_share-0.2.0.tgz` — 发布 tarball（GitHub Release 附件）
- `install.ps1` — 可选的一键安装脚本（走官方 `dsh plugin add` 通道）
- `CHANGELOG.md` — 更新记录

## 许可证

gplv3

---

<a name="english"></a>



# English
<img width="1920" height="1080" alt="deepseek21" src="https://github.com/user-attachments/assets/4edaa26e-c5da-4801-b7b3-5ba04cd28184" />
Real-time synchronization of the wallpaper currently displayed in Wallpaper Engine to the background of the DeepSeek Harness Web interface, along with a `wallpaper_share` session view tab to control monitor source, transparency / blur / shadow, render modes, and focus mode.

> **Display-Only Sync**: Only reads WE status; does not control or modify desktop wallpapers (please change wallpapers within WE).  
> **No Sensitive Data**: Code contains no Steam usernames / SteamIDs / tokens; WE installation directory is auto-detected at runtime (Registry `HKCU\Software\WallpaperEngine\installPath` → common Steam paths), requiring manual configuration only when detection fails.

---

## Compatibility Matrix

| Wallpaper Type | Enhanced Mode | Performance Mode |
| --- | --- | --- |
| `video` | Plays source video (HTTP Range supported, seekable) | Shows static preview image or GIF |
| `web` | Loads source page in iframe | Shows static preview image or GIF |
| `image` | Displays source image | Displays source image |
| `scene` | Reads PKG and rendered by the **browser renderer** | Displays PKG static texture |
| `application` | Previewable via `wallpaper_share` | Previewable via `wallpaper_share` |

> See **[docs/scene-fallback.md](docs/scene-fallback.md)** for the complete fallback chain and layer-by-layer implementations (render modes / texture decoding / particles / puppet) for Scene enhanced mode.

## Features

- **Real-Time Sync**: Background updates automatically within ~2 seconds after applying a wallpaper in Wallpaper Engine.
- **Multi-Monitor Support**: Automatically follows the "most recently changed" monitor; manually lock a specific monitor as the background source when multiple displays are connected.
- **Visual Effect Sliders**: Panel opacity (0–100%) / Background blur (0–30px) / Shadow depth (0–100%).
- **Render Mode Toggle**: Performance (static preview, default) ⇄ Enhanced (loads wallpaper source content).
- **Scene Live Rendering (Experimental)**: Scene wallpapers in enhanced mode default to the **browser subset renderer** (real `scene.json` layer tree + transforms + decoded textures composited into canvas, including particles and puppet animations); falls back to a standalone renderer subprocess (offscreen, no popups) → WebSocket frame stream when `sceneRendererPath` is explicitly configured. Full fallback chain documented in [docs/scene-fallback.md](docs/scene-fallback.md).
- **Focus Mode**: Automatically switches to 30% / 15px / 90% while tasks are running, and restores to 9% / 6px / 40% upon completion.
- **Sync Toggle** ⏻: One-click start/stop.
- Self-diagnostic route `/we-sync/diag` (localhost only, includes scene renderer status and texture extraction results).

## Installation (Official `dsh plugin` Channel, Zero Manual Config)

> Prerequisite: DSH has been verified with `dsh --profile web`.

```bash
# Choose one of the following:
dsh plugin --profile web add github:YRN-playmaker/dsh-wallpaper_share
#   Install from GitHub (includes prebuilt lib/, no build toolchain required)
dsh plugin --profile web add dsh-wallpaper_share
#   Install from npm (after release)
dsh plugin --profile web add ./dsh-wallpaper_share-0.2.0.tgz
#   Install from local tarball
```

```bash
# Install test branch (latest dev build with Scene rendering / particles / puppet animation):
dsh plugin --profile web add github:YRN-playmaker/dsh-wallpaper_share#test
```

```bash
# Restart dsh (web profile) and open the page to see the wallpaper_share tab
```

**No manual configuration required**: The `cordis.patch.yml` specified by `dsh.bundle.patch` is automatically added to the profile's bundle layer during installation. Its entry acts simultaneously as a host entry (Node side: polling + HTTP routing) and a `dsh.client` roster entry (browser side: prebuilt `lib/client.js` automatically injected by the module system). The package **ships with prebuilt artifacts**, requiring zero user-side builds.

## Build from Source (Developers)

1. Copy this repository root (`package.json` / `src/` / `tsconfig.json` / `tsdown.config.ts`) into your DSH checkout at `packages/client/we-sync/`;
2. Run `pnpm install`;
3. Run `pnpm --filter dsh-wallpaper_share exec tsc -b`;
4. Run `pnpm --filter dsh-wallpaper_share bundle`;
5. Outputs will be in `packages/client/we-sync/lib/` (`index.js` for Node + `client.js` for browser). Copy them back to this repository's `lib/` and run `pnpm pack` to generate a new tarball.

> You can also run `pnpm install && pnpm build` directly in this repository root (`tsdown` standalone build, independent of DSH checkout).

## Configuration

Top of `src/index.ts` under `CONFIG`:

| Option | Default | Description |
| --- | --- | --- |
| `wallpaperEngineDir` | `''` (Auto-detect) | Manually specify installation directory if auto-detection fails |
| `workshopContentDir` | `''` (Auto-derived) | Steam Workshop content directory |
| `pollIntervalMs` | `2000` | Polling interval in ms |
| `previewMaxBytes` | `6291456` | Maximum preview file size limit |
| `sceneRendererPath` | `''` (Built-in reference renderer) | External scene renderer executable; leave empty to use built-in reference renderer (diagnostic animation) |
| `wallpaperEngineAssetsDir` | `''` (Auto-derived) | WE engine assets directory (defaults to `<weDir>/assets`; renderer unavailable if missing) |
| `sceneRenderWidth` | `1920` | Scene renderer output width |
| `sceneRenderHeight` | `1080` | Scene renderer output height |
| `sceneRenderFps` | `30` | Scene renderer target FPS |
| `sceneRenderQuality` | `80` | JPEG/WebP frame quality (0..100) |
| `sceneRenderMode` | `'auto'` | `'auto'` (browser subset renderer first; external if `sceneRendererPath` is configured) | `'browser'` | `'external'` |
| `particleRateScale` | `1` | Particle emission rate scale (WE rate unit = particles per second) |
| `particleSizeScale` | `1` | Particle size scale |

## Troubleshooting

- `http://127.0.0.1:3080/we-sync/diag`: View internal status (`kind` / `fingerprint` / `weDir` / `lastError` / per-monitor `sceneImage` extraction results / **scene renderer capabilities / status / fallback layer**).
- `lastError` indicates installation directory not found → Manually specify `CONFIG.wallpaperEngineDir` in source and rebuild/reinstall.
- Scene enhanced mode has no dynamic visuals → Check `scene.available`: `false` indicates missing renderer or assets directory (refer to `reason` in `/we-sync/diag`).
- No UI changes → Refresh the page and confirm the `wallpaper_share` tab is present in the tab bar.

## Known Limitations

- "True dynamic rendering" for Scene wallpapers depends on the render mode: the default browser subset renderer handles **layer tree + transforms + texture / particle / puppet animation compositing** (shader effects / SceneScript / keyframe animations are planned for future updates); an external renderer (`sceneRendererPath`) provides full native rendering but must be provided separately (e.g., WSL2-wrapped headless linux-wallpaperengine, GPL, standalone).
- The reference renderer transmits full 1920×1080 RGBA frames, resulting in higher CPU usage (~24–27 fps @ 960×540 benchmarked locally); dedicated renderers should stream JPEG/WebP to reduce bandwidth.
- Multi-monitor setups default to `lastselectedmonitor` (or display 1 if unavailable).
- Visual slider parameters are stored in page memory only and reset to defaults (72% / 6px / 30%) on reload.

## Directory Structure

- `package.json` — Package manifest: `dsh.bundle.patch` → `cordis.patch.yml`, `dsh.client` → browser side, `exports["./client"]` → prebuilt `lib/client.js`
- `cordis.patch.yml` — Bundle patch layer (host entry + dsh.client roster entry)
- `src/index.ts` — Node-side source (polling / HTTP routes / scene texture extraction / HTTP Range / SceneAdapter integration / SceneModel routing / WebSocket frame streaming)
- `src/scene/` — SceneAdapter module (protocol / capability probing / renderer process / WebSocket / fallback / **PKGV0001 parsing / SceneModel layer model / .tex decoding / puppet mdl parsing**)
- `src/client/` — Browser-side source (theme overrides / background layer / SceneCanvas / **SceneModelRenderer subset renderer / ParticleRuntime** / wallpaper_share panel)
- `docs/` — Format specifications & technical docs (`tex-format-findings.md` / `mdl-skinning-findings.md` / **`scene-fallback.md`**)
- `tools/scene-renderer/` — Built-in reference renderer (implements protocol contract; drop-in replacement target for native renderers)
- `lib/` — Prebuilt distribution artifacts (zero-build for end users; GitHub direct install requires no build pipeline)
- `dsh-wallpaper_share-0.2.0.tgz` — Release tarball (GitHub Releases asset)
- `install.ps1` — Optional one-click install script (via official `dsh plugin add` flow)
- `CHANGELOG.md` — Release history & changelog

## License

GPL-3.0
