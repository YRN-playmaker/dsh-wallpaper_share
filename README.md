# dsh-wallpaper_share
# Wallpaper Engine ↔ DeepSeek Harness 壁纸同步


https://github.com/user-attachments/assets/4461d385-de62-42be-8420-7edce5606f44



[中文](#中文) | [English](#english)

把 Wallpaper Engine 当前显示的壁纸实时同步为 DeepSeek Harness Web 界面的背景，并提供 `wallpaper_share` 会话视图标签页用于控制显示器来源、透明度 / 模糊 / 阴影、渲染模式与专注模式。

> **纯显示同步**：只读取 WE 状态，不控制 / 不修改桌面壁纸（换壁纸请在 WE 内操作）。
> **无敏感信息**：代码不含 Steam 用户名 / SteamID / 令牌；WE 安装目录运行时自动检测（注册表 `HKCU\Software\WallpaperEngine\installPath` → 常见 Steam 路径），检测不到时才需要手动配置。

---

<a name="中文"></a>
# 中文

## 增强模式兼容矩阵

| 壁纸类型 | 增强模式 | 性能模式
| --- | --- | --- |
| `video` | 播放源视频（支持 HTTP Range，可正常 seek） | 显示静态预览图或gif |
| `web` | iframe 加载源页面 | 显示静态预览图或gif |
| `image` | 显示源图 | 显示源图 |
| `scene` | **浏览器渲染器**逆向渲染 | 显示pkg静态纹理 |
| `application` | 可从wallpaper_share预览 |

> scene 增强的完整 fallback 链与各层实现（渲染模式 / 纹理解码 / 粒子 / puppet）见 **[docs/scene-fallback.md](docs/scene-fallback.md)**。

## 功能

- **实时同步**：在 Wallpaper Engine 中应用壁纸后，页面背景约 2 秒内自动跟随
- **多显示器**：自动跟随"最近变化"的一台；复数显示器时可手动锁定某台作为背景来源
- **视觉效果滑块**：面板透明度 0–100% / 背景模糊 0–30px / 阴影深度 0–100%
- **渲染模式切换**：性能（静态预览图，默认）⇄ 增强（加载壁纸源内容）
- **Scene 实时渲染（实验内容）**：scene 壁纸增强模式默认走**浏览器子集渲染器**（真实 `scene.json` 图层树 + transform + 已解码纹理合成进 canvas，含粒子与 puppet 动画）；显式配置 `sceneRendererPath` 后走独立 renderer 子进程（offscreen，不弹窗）→ WebSocket 帧流；完整回退链见 [docs/scene-fallback.md](docs/scene-fallback.md)
- **专注模式**：任务进行中自动切换为 30% / 15px / 90%，任务完成后自动切换为 9% / 6px / 40%
- **同步开关** ⏻ 一键启停
- 自诊断路由 `/we-sync/diag`（仅本机可访问，含 scene renderer 状态与纹理提取结果）

## 安装（官方 `dsh plugin` 通道，零手工配置）

> 前置：DSH 已用 `dsh --profile web` 验证。

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
# 安装 test 分支（最新开发版，含 Scene 渲染 / 粒子 / puppet 动画）：
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
Sync the wallpaper currently displayed by Wallpaper Engine onto the DeepSeek Harness Web UI as a frosted-glass page background (display-only), with a `wallpaper_share` conversation-view tab for monitor selection, transparency / blur / shadow sliders, render-mode, and focus mode.

> **Display-only**: reads WE state only — never controls or changes your desktop wallpaper.
> **No sensitive data**: no Steam username / SteamID / tokens. The WE install dir is auto-detected at runtime (registry `HKCU\Software\WallpaperEngine\installPath` → common Steam paths); manual config is only a fallback.

## Enhanced-mode compatibility matrix

| Wallpaper type | Enhanced-mode behavior |
| --- | --- |
| `video` | plays the source video (HTTP Range supported, so seeking works) |
| `web` | loads the source page in an iframe |
| `image` | shows the source image |
| `scene` | **browser subset renderer** (default): real layer tree + transforms + decoded textures / particles / puppet animations composited into canvas; or **external renderer** (`sceneRendererPath` + WS frame stream); renderer unavailable/failed → extracted pkg texture → preview |
| `application` / `other` | falls back to the static preview |

> The full scene fallback chain and per-layer implementation (render modes / texture decoding / particles / puppet) is documented in **[docs/scene-fallback.md](docs/scene-fallback.md)**.

## Features

- **Live sync**: after applying a wallpaper in Wallpaper Engine, the page background follows within ~2 seconds
- **Multi-monitor**: follows the "most recently changed" monitor automatically; lock one as the background source when several monitors exist
- **Instant visual sliders**: panel transparency 0–100% / background blur 0–30px / shadow depth 0–100%
- **Render-mode toggle**: Performance (static preview, default) ⇄ Enhanced (loads the wallpaper source)
- **Scene live rendering (new)**: scene wallpapers in enhanced mode use the **browser subset renderer** by default (real `scene.json` layer tree + transforms + decoded textures composited into canvas, including particles and puppet animations); with `sceneRendererPath` configured it runs a standalone renderer subprocess (offscreen, no window) → WebSocket frame stream; full fallback chain in [docs/scene-fallback.md](docs/scene-fallback.md)
- **Focus mode 🎯**: auto-switches to 30% / 15px / 90% while a task runs, then 9% / 6px / 40% when all tasks finish
- **Sync toggle** ⏻ one-click on/off
- Self-diagnostic route `/we-sync/diag` (localhost only, includes scene renderer status and texture extraction results)

## Install (official `dsh plugin` flow, zero manual config)

> Prerequisite: DSH has been started at least once with `dsh --profile web`.

```bash
# Pick one:
dsh plugin --profile web add github:YRN-playmaker/dsh-wallpaper_share
#   install from GitHub (the repo ships prebuilt lib/, no build allowance needed)
dsh plugin --profile web add dsh-wallpaper_share
#   install from npm (once published)
dsh plugin --profile web add ./dsh-wallpaper_share-0.2.0.tgz
#   install from the local tarball
```

```bash
# Install the test branch (latest dev build: Scene rendering / particles / puppet animations):
dsh plugin --profile web add github:YRN-playmaker/dsh-wallpaper_share#test
```

```bash
# Restart dsh (web profile) and open the page — the wallpaper_share tab appears
```

**No config files to edit by hand**: the `cordis.patch.yml` referenced by `dsh.bundle.patch` is added to the profile's bundle layers automatically on install. Its single row is both a host row (node half: polling + HTTP routes) and a `dsh.client` roster row (the prebuilt browser half `lib/client.js` is injected into the page by the module system). The published package ships **prebuilt artifacts**, so users never build anything.

## Build from source (developers)

1. Copy the repo root (`package.json` / `src/` / `tsconfig.json` / `tsdown.config.ts`) into your DSH checkout as `packages/client/we-sync/`;
2. `pnpm install`
3. `pnpm --filter dsh-wallpaper_share exec tsc -b`
4. `pnpm --filter dsh-wallpaper_share bundle`
5. Artifacts land in `packages/client/we-sync/lib/` (`index.js` node half + `client.js` browser half); copy them back to the repo `lib/` and run `pnpm pack` for a new tarball.

> You can also run `pnpm install && pnpm build` directly in this repo root (`tsdown` standalone build, no DSH checkout required).

## Configuration

`CONFIG` at the top of `src/index.ts`:

| Key | Default | Meaning |
| --- | --- | --- |
| `wallpaperEngineDir` | `''` (auto-detect) | Manual install dir when detection fails |
| `workshopContentDir` | `''` (auto-derived) | Workshop content directory |
| `pollIntervalMs` | `2000` | Polling interval |
| `previewMaxBytes` | `6291456` | Preview size cap |
| `sceneRendererPath` | `''` (built-in reference renderer) | External scene renderer executable; empty = built-in reference renderer (diagnostic animation) |
| `wallpaperEngineAssetsDir` | `''` (auto-derived) | WE engine assets dir (`<weDir>/assets`; renderer unavailable when missing) |
| `sceneRenderWidth` | `1920` | Scene renderer output width |
| `sceneRenderHeight` | `1080` | Scene renderer output height |
| `sceneRenderFps` | `30` | Scene renderer target FPS |
| `sceneRenderQuality` | `80` | JPEG/WebP frame quality (0..100) |
| `sceneRenderMode` | `'auto'` | `'auto'` (browser subset renderer by default; external when `sceneRendererPath` set) \| `'browser'` \| `'external'` |
| `particleRateScale` | `1` | Particle emission rate scale (WE rate unit = particles per second) |
| `particleSizeScale` | `1` | Particle size scale |

## Troubleshooting

- `http://127.0.0.1:3080/we-sync/diag`: internal state (`kind` / `fingerprint` / `weDir` / `lastError` / per-monitor `sceneImage` extraction results / scene renderer capabilities / status / fallback layer);
- `lastError` says the install dir was not found → set `CONFIG.wallpaperEngineDir` manually and rebuild / reinstall;
- Scene enhanced mode shows no dynamic footage → check `scene.available`: `false` means the renderer or assets dir is missing (`reason` is shown in `/we-sync/diag`);
- Nothing changes on the page → refresh, and confirm the `wallpaper_share` tab exists.

## Known limitations

- For scene wallpapers, the "real dynamic footage" depends on the render mode: the default browser subset renderer composites the layer tree + transforms + decoded textures/particles/puppet animations (shader effects / SceneScript / keyframe animations are future work); the external renderer (`sceneRendererPath`) provides true rendering but must be provided by the user (e.g. a WSL2-wrapped headless linux-wallpaperengine, GPL, standalone);
- The reference renderer transmits full 1920×1080 RGBA frames — CPU-heavy (~24-27fps @960×540 measured locally); a real renderer should output JPEG/WebP to reduce bandwidth;
- Multi-monitor setups use `lastselectedmonitor` (or the first monitor);
- Visual settings live in page memory only and reset on refresh (72% / 6px / 30%).

## Contents

- `package.json` — manifest: `dsh.bundle.patch` → `cordis.patch.yml`, `dsh.client` → browser half, `exports["./client"]` → prebuilt `lib/client.js`
- `cordis.patch.yml` — the bundle patch layer (host row + dsh.client roster row)
- `src/index.ts` — node half source (polling / HTTP routes / scene-texture extraction / HTTP Range / SceneAdapter / SceneModel routes / WebSocket frame stream)
- `src/scene/` — SceneAdapter modules (protocol / capability probe / renderer process / WebSocket / fallback / PKGV0001 parsing / SceneModel layer model / .tex decoding / puppet mdl parsing)
- `src/client/` — browser half source (theme overrides / background layers / SceneCanvas / SceneModelRenderer subset renderer / ParticleRuntime / wallpaper_share panel)
- `docs/` — format & implementation docs (`tex-format-findings.md` / `mdl-skinning-findings.md` / `scene-fallback.md`)
- `tools/scene-renderer/` — built-in reference renderer (protocol contract implementation; real renderers replace it with the same protocol)
- `lib/` — prebuilt artifacts (zero build for users; GitHub installs need no build allowance)
- `dsh-wallpaper_share-0.2.0.tgz` — release tarball (attach it to GitHub Releases)
- `install.ps1` — optional one-shot installer (uses the official `dsh plugin add` flow)
- `CHANGELOG.md` — release notes

## License

gplv3.
