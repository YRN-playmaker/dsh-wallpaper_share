# dsh-wallpaper_share

<!-- Hero -->
<div align="center">
  <b style="font-size: 1.15em;">把 Wallpaper Engine 的壁纸实时同步为 DSH Web 界面背景，并带一个可调面板</b><br /><br />
  <a href="https://www.npmjs.com/package/dsh-wallpaper_share"><img alt="npm version" src="https://img.shields.io/npm/v/dsh-wallpaper_share" /></a>
  <a href="https://www.npmjs.com/package/dsh-wallpaper_share"><img alt="npm downloads" src="https://img.shields.io/npm/dm/dsh-wallpaper_share" /></a>
  <a href="https://github.com/YRN-playmaker/dsh-wallpaper_share/stargazers"><img alt="GitHub stars" src="https://img.shields.io/github/stars/YRN-playmaker/dsh-wallpaper_share" /></a>
  <a href="https://opensource.org/licenses/GPL-3.0"><img alt="License: GPL-3.0" src="https://img.shields.io/badge/License-GPL--3.0-blue.svg" /></a>
  <a href="https://github.com/YRN-playmaker/dsh-wallpaper_share/releases"><img alt="插件版本 v26.9.3-rc（候选版）" src="https://img.shields.io/badge/v26.9.3--rc-4d6bfe" /></a><br /><br />
  <img alt="壁纸同步" src="https://img.shields.io/badge/-%E5%A3%81%E7%BA%B8%E5%90%8C%E6%AD%A5-4d6bfe" /> <img alt="场景渲染" src="https://img.shields.io/badge/-%E5%9C%BA%E6%99%AF%E6%B8%B2%E6%9F%93-4d6bfe" /> <img alt="DWP 市场" src="https://img.shields.io/badge/-DWP%20%E5%B8%82%E5%9C%BA-4d6bfe" /> <img alt="眼动追踪" src="https://img.shields.io/badge/-%E7%9C%BC%E5%8A%A8%E8%BF%BD%E8%B8%AA-4d6bfe" /> <img alt="专注模式" src="https://img.shields.io/badge/-%E4%B8%93%E6%B3%A8%E6%A8%A1%E5%BC%8F-4d6bfe" /> <img alt="多显示器" src="https://img.shields.io/badge/-%E5%A4%9A%E6%98%BE%E7%A4%BA%E5%99%A8-4d6bfe" /><br /><br />
</div>

<div align="center">
  🌏 <a href="#中文"><b>中文</b></a> · <a href="#english">English</a>
</div>

<div align="center">
  <video src="https://github.com/user-attachments/assets/4461d385-de62-42be-8420-7edce5606f44"
         muted autoplay loop playsinline controls width="100%"></video>
</div>
把 Wallpaper Engine 当前显示的壁纸实时同步为 DeepSeek Harness Web 界面的背景，并提供 `wallpaper_share` 标签页用于调整渲染模式、视觉效果、专注模式与壁纸库。支持场景壁纸的完整动效与应用壁纸的导入。

> **纯显示同步**：只读取 WE 状态，不控制 / 不修改桌面壁纸（换壁纸请在 WE 内操作）。
> **无敏感信息**：代码不含 Steam 用户名 / SteamID / 令牌；WE 安装目录运行时自动检测（注册表 `HKCU\Software\WallpaperEngine\installPath` → 常见 Steam 路径），检测不到时才需要手动配置。眼动追踪全程本地推理，摄像头画面不出设备。

---

<a name="中文"></a>
# 中文

## 📑 目录

- [✨ 功能一览](#-功能一览)
- [🎨 渲染模式与兼容矩阵](#-渲染模式与兼容矩阵)
- [🖼️ Scene 渲染与回退](#-scene-渲染与回退)
- [🔍 专注模式与眼动追踪](#-专注模式与眼动追踪)
- [🚀 安装](#-安装)
- [⚙️ 配置](#-配置)
- [📈 性能与已知限制](#-性能与已知限制)
- [📦 项目结构](#-项目结构)
- [🆕 已知问题](#-已知问题)
- [📄 License](#-license)

## ✨ 功能一览

- **实时同步**：在 WE 切换壁纸后，页面背景约 2 秒内自动跟随
- **多显示器**：自动跟随"最新变化"的一台；复数显示器时可手动锁定某台作为背景来源
- **三档渲染模式**：预览 / 捕获 / 完整，详见 [渲染模式与兼容矩阵](#-渲染模式与兼容矩阵)
- **原生 scene 捕获渲染器**：随包内置 Rust 编写的 `we-capture.exe`，用 Windows Graphics Capture 抓取 WE 正在渲染的桌面，镜像 WE 自身输出 → GLSL / SceneScript / 关键帧 / 粒子等**所有 WE 效果天然全覆盖**
- **专注模式**：叠加一个圆心清晰、圆外模糊的阅读窗；默认跟随鼠标，开专注即生效
- **眼动追踪（实验）**：可选，用摄像头推断注视点让透镜跟随视线；9 点校准、文字吸附、抗抖动
- **壁纸库 · 本地 / 市场**：按**本地**与**市场**两大分类浏览。本地一栏管理已装内容——`dwp壁纸`（点击即挂载为全局背景，已挂载再点取消）与 `we 应用`（点击打开所在文件夹），带标题搜索、缩略图与计数；市场一栏浏览 `dwp-registry` 目录，支持名称 / 作者搜索、标签筛选与**安装 / 更新 / 卸载**
- **DWP 壁纸与全局背景渲染**：`dwp/1.0` 协议包（纯文本 / solid / 粒子 / mesh 图层 + 12 种混合模式 + 3 种动画 + 11 种效果，确定性渲染）；挂载后经 WebGL2 真实渲染为 DSH 全局背景（低配 Canvas2D 降级），同时暂停 WE 同步避免冲突，刷新后自动恢复
- **视觉效果**：面板透明度 0–100% / 背景模糊 0–30px / 阴影深度 0–100%，即时生效
- **后台任务可视化**：收纳侧边栏时，用圆形指示感知任务进度（绿 = 空闲 / 蓝 = 进行中 / 黄 = 等待授权）
- **同步开关**：一键启停；挂载 DWP 壁纸期间显示「同步暂停（DWP）」第三态
- **设置持久化**：同步开关、渲染模式、显示器锁、三档渲染模式、专注 / 眼动等偏好写入 `localStorage`（键 `we-sync.settings`），刷新或重启 DSH 后自动恢复；沉浸模式等临时视图态与任务状态一律不落盘
- **自诊断路由** `/we-sync/diag`（仅本机可访问，含 scene renderer 状态与纹理提取结果）

## 🎨 渲染模式与兼容矩阵

面板顶部的三档切换决定壁纸如何呈现（按钮文字为 **预览 / 捕获 / 完整**，概念名 eco / perf / enhanced 用于 flash 提示与配置）：

| 档位 | 含义 | 说明 |
| --- | --- | --- |
| **预览**（eco） | 静态预览图 | 只贴 WE 的预览图，最省资源，不加载动效 |
| **捕获**（perf） | 捕获 WE 桌面 | scene 走**原生捕获器 `we-capture.exe`**，镜像 WE 自己渲染的桌面 → 效果全覆盖；WE 未运行时自动回退浏览器渲染 |
| **完整**（enhanced） | 浏览器解 pkg | scene 走**浏览器子集渲染器**，直接解析 `.pkg` 在浏览器里重绘，不依赖 WE 运行 |

按壁纸类型展开的兼容矩阵（三档的真正差别只在 **scene**；video / web / image 下捕获与完整行为一致，都加载源内容）：

| 壁纸类型 | 预览 | 捕获 | 完整 |
| --- | --- | --- | --- |
| `video` | 静态预览图 | 播放源视频（HTTP Range，可 seek） | 播放源视频 |
| `web` | 静态预览图 | iframe 加载源页面 | iframe 加载源页面 |
| `image` | 静态预览图 | 显示源图 | 显示源图 |
| `scene` | 静态预览图 | **原生捕获 WE 桌面**（效果全覆盖；WE 未运行回退浏览器） | **浏览器解 pkg 渲染**（不依赖 WE，子集效果） |
| `application` / `other` | 静态预览图 | 回退静态预览（可在壁纸库中预览） | 回退静态预览 |

## 🖼️ Scene 渲染与回退

scene 壁纸在捕获 / 完整档下的渲染优先级与回退链：

1. **原生捕获（external）**：探测到 `we-capture.exe` 且 WE 正在渲染 → WS 帧流 live canvas（效果全覆盖）。
2. **浏览器子集渲染（browser）**：解析 `scene.json` 图层树 + transform + 已解码纹理 / 粒子 / puppet 合成进 canvas。
3. **静态纹理**：提取 pkg 内嵌高清纹理垫底。
4. **预览图**：以上皆不可用 → WE 预览图。

**原生捕获器原理**：WE 的 DX11 渲染窗口是 Progman 子窗口、WGC 不接受子窗口，故捕获其顶层根 Progman / WorkerW，BGRA→JPEG 按外部渲染器协议输出到 stdout。因为镜像的是 **WE 自身的渲染结果**，无需在 JS 端复刻那套 ~500KB 软渲染引擎，效果 100% 覆盖。多显示器下顶层根窗横跨整个虚拟桌面，捕获器按锁定的那块 WPE 子窗矩形用 `CopySubresourceRegion` + `D3D11_BOX` 只回读目标屏区域再编码（换算经 `ClientToScreen` / `GetClientRect` 归一化，DPI 缩放非 100% 同样正确）→ 输出严格是单块屏。`bin/we-capture.exe`（约 540KB，Windows-only）随包发布，Rust 源码在 `native/we-capture/`（`cargo build --release` 可重建，含 `--selftest` 诊断模式）；DSH 侧 `probeRenderer` 自动发现，`sceneRenderMode='auto'` 检测到原生渲染器即走 external，否则回退 browser。

完整链路与各层实现见 **[docs/scene-fallback.md](docs/scene-fallback.md)**；pkg / 纹理 / puppet 格式见 **[docs/scene-format.md](docs/scene-format.md)**、**[docs/tex-format-findings.md](docs/tex-format-findings.md)**、**[docs/mdl-skinning-findings.md](docs/mdl-skinning-findings.md)**。

## 🔍 专注模式与眼动追踪

- **专注模式 = 透镜总开关**：开启即在壁纸上叠加一个跟随注视点的透镜（圆心清晰、圆外模糊的阅读窗）。壁纸全局模糊在透镜激活时置 0，模糊全部由透镜层 `backdrop-filter` 承担（避免双重模糊开销）。默认跟随**鼠标**（精确、零延迟）。
- **眼动追踪（可选）**：在专注基础上开启后，惰性从 CDN 加载 [WebGazer.js](https://webgazer.cs.brown.edu)（GPL-3.0，与本项目许可兼容；内含 MediaPipe FaceMesh，首次约下载 ~12MB，不进基础包），用摄像头推断屏幕注视点跟随视线；无脸 / 离开座位（> 1.2s）自动回落鼠标。关闭专注会一并关闭眼动并释放摄像头。
- **校准视线**：9 点引导序列；摄像头画面仅在校准期间投影到页面，平时不显示。训练数据只来自校准点击（追踪时关闭 WebGazer 的鼠标采样，避免"鼠标移动"污染回归拟合）；样本持久化，校准一次即复用。
- **文字吸附**（默认开，UI 按钮文字「文字吸附」）：注视点 Y 锁到最近的文字行中心（用 `Range.getClientRects` 取块内每一视觉行），X 仍跟随滑动，带滞回避免相邻行横跳——读哪行、圆圈稳在哪行。
- **抗抖动**：死区 + EMA，小幅高频抖动忽略、大幅移动才缓动跟随。
- **隐私**：全程本地推理、画面不出设备；关闭时显式 `stopVideo()` 释放摄像头；仅在 `http://127.0.0.1`（安全上下文）可用。

## 🚀 安装

> 前置：兼容 DSH Web `0.1.0-rc.6` 及以上（已在 `0.1.2-alpha.2` 验证，已知适配问题与新功能兼容性见下方「已知问题」），以 `dsh --profile web` 运行。

### 🎯 分档安装（按需选择）

| 档位 | 适合谁 | 安装命令 |
| --- | --- | --- |
| 🟢 **最新（小白）** | 不纠结版本，直接拉当前主流 Harness 环境的推荐版 | `dsh plugin --profile web add dsh-wallpaper_share` |
| 🔵 **rc（候选版）** | 想提前用当前架构的新功能，能接受少量问题 | `dsh plugin --profile web add dsh-wallpaper_share@rc` |
| 🟣 **alpha（未来架构）** | 使用 Harness alpha 架构 / 想提前适配新架构 | `dsh plugin --profile web add dsh-wallpaper_share@alpha` |
| 🟡 **test（开发中）** | 尝鲜 / 参与测试，可能有未完成功能 | `dsh plugin --profile web add dsh-wallpaper_share@test` |

- **小白**：只需上面第一条默认命令，无需了解 tag——`latest` 始终指向当前主流 Harness 环境最稳的推荐版本（当前为现有架构的推荐版；未来 alpha 架构成为主流时 `latest` 会跟随切换）。
- **老炮**：按需在包名后加 `@tag` 拉取对应档位；从 GitHub 安装同理切换分支：`github:YRN-playmaker/dsh-wallpaper_share`（main = latest）／ `#test`（test）／ `#alpha`（alpha，随 alpha 架构发布后开放）。
- **当前 npm 已发布的 tag**：`latest` / `test`；`rc`、`alpha` 随对应版本线发布后开放。

```bash
# 任选其一：
dsh plugin --profile web add github:YRN-playmaker/dsh-wallpaper_share
#   从 GitHub 安装（仓库自带预构建 lib/，不需要构建许可；main = 最新档）
dsh plugin --profile web add dsh-wallpaper_share
#   从 npm 安装（默认 = latest 最新档）
dsh plugin --profile web add ./dsh-wallpaper_share-26.9.3-rc.tgz
#   本地 tarball 安装（26.9.3-rc 候选版）
dsh plugin --profile web add github:YRN-playmaker/dsh-wallpaper_share#test
#   从 GitHub 安装 test 分支（测试档，含壁纸特效优化、页面功能更新等）：
# 重启 dsh（web profile），打开页面即可看到 wallpaper_share 标签页
```

**无需手动编辑任何配置文件**：包内 `dsh.bundle.patch` 指向的 `cordis.patch.yml` 会在安装时自动加入 profile 的 bundle 层，其中一行同时是 host 行（node 半：轮询 + HTTP 路由）和 `dsh.client` roster 行（浏览器半的预构建 `lib/client.js` 由模块系统自动注入页面）。包发布时自带预构建产物，用户侧零构建。

### 从源码构建（开发者）

1. 把本仓库根目录（`package.json` / `src/` / `tsconfig.json` / `tsdown.config.ts`）拷入你的 DSH checkout：`packages/client/we-sync/`；
2. `pnpm install`
3. `pnpm --filter dsh-wallpaper_share exec tsc -b`
4. `pnpm --filter dsh-wallpaper_share bundle`
5. 产物在 `packages/client/we-sync/lib/`（`index.js` node 半 + `client.js` 浏览器半），拷回本仓库 `lib/` 后 `pnpm pack` 出新 tarball。

> 也可以在本仓库根目录直接 `pnpm install && pnpm build`（`tsdown` 独立构建，不依赖 DSH checkout）。
> 原生捕获器：`cd native/we-capture && cargo build --release`（需 `x86_64-pc-windows-gnu` 或 `-msvc` 工具链），产物拷到 `bin/we-capture.exe`。
>
> ⚠️ **中文用户名机器上的 gnu 工具链构建**：MinGW 的 ld 不支持非 ASCII 路径，若 Windows 用户名含中文（如 `C:\Users\倪哥儿`），标准库明明存在也会报 `cannot find crt2.o / libstd-*.rlib / -lkernel32`。解决：给 `.rustup` 和 `.cargo` 各建一个纯 ASCII 路径的目录联接，再用 `--sysroot` 覆盖：
> ```text
> mklink /J C:\Users\Public\rustup-ji "C:\Users\<中文用户名>\.rustup"
> mklink /J C:\Users\Public\cargo-ji  "C:\Users\<中文用户名>\.cargo"
> set CARGO_HOME=C:\Users\Public\cargo-ji
> set RUSTFLAGS=--sysroot=C:/Users/Public/rustup-ji/toolchains/stable-x86_64-pc-windows-gnu
> cargo build --release
> ```

## ⚙️ 配置

包源码 `src/index.ts` 顶部 `CONFIG`：

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `wallpaperEngineDir` | `''`（自动检测） | 检测失败时手动指定安装目录 |
| `workshopContentDir` | `''`（自动推导） | 工作坊内容目录 |
| `pollIntervalMs` | `2000` | 轮询间隔 |
| `previewMaxBytes` | `6291456` | 预览图大小上限 |
| `sceneRendererPath` | `''`（自动发现） | 外部 scene renderer；留空自动发现随包 `bin/we-capture.exe`（或本地 `native/we-capture/target/release/`） |
| `wallpaperEngineAssetsDir` | `''`（自动推导） | WE engine assets 目录（`<weDir>/assets`；缺失时 renderer 不可用） |
| `sceneRenderWidth` | `1920` | 原生捕获器输出宽度（小于壁纸原生分辨率时盒式降采样；4K 想省 CPU 可下调） |
| `sceneRenderHeight` | `1080` | 原生捕获器输出高度 |
| `sceneRenderFps` | `30` | scene renderer 目标帧率 |
| `sceneRenderQuality` | `80` | JPEG 帧质量（0..100） |
| `sceneRenderMode` | `'auto'` | `'auto'`（探测到原生 we-capture 或显式 `sceneRendererPath` 则 external，否则 browser）\| `'browser'` \| `'external'` |
| `particleRateScale` | `1` | 粒子发射率缩放（浏览器子集渲染器） |
| `particleSizeScale` | `1` | 粒子尺寸缩放 |
| `effectStrengthScale` | `1` | 特效强度缩放 |
| `puppetMeshRender` | `true` | puppet 网格渲染开关 |

> 面板里的三档切换（预览 / 捕获 / 完整）是运行时 UI 设置，与上面的 `sceneRenderMode`（后端浏览器 / 外部 renderer 选择）不同。

## 📈 性能与已知限制

**性能**

- 原生捕获：SIMD `jpeg-encoder`，1080p 编码约 11ms；默认 1920×1080@30fps，可在 `CONFIG` 下调分辨率 / 帧率省 CPU。
- 预览档只贴静态预览，开销最低；捕获 / 完整档才加载动效。

**已知限制与边界**

- **平台**：原生捕获器为 Windows-only（依赖 Windows Graphics Capture）；非 Windows 或捕获不可用时 scene 自动回退浏览器子集渲染器。
- **桌面图标**：捕获镜像整个桌面壁纸层，会把桌面图标一并抓入（建议隐藏桌面图标）。
- **全屏应用**：WE 在全屏应用时默认暂停渲染，捕获画面随之定格。
- **眼动精度**：webcam + 线性回归的原生精度约 ±50–150px，行距较小时偶尔可能锁到相邻行；靠大圆 + 滞回缓解。需摄像头 + 联网加载模型；首次开眼动需校准一次。
- **浏览器子集渲染器**：是 WE 渲染引擎的子集复刻，个别复杂 shader / 特效可能不完美；需要 100% 覆盖时用捕获档（原生捕获）。

## 📦 项目结构

- `src/index.ts` — Node 半：WE 状态轮询、HTTP 路由、scene renderer 子进程管理、壁纸库扫描
- `src/scene/` — SceneAdapter 模块（协议 / 能力探测 / renderer 进程 / WebSocket / 回退 / PKGV0001 解析 / SceneModel 图层模型 / .tex 解码 / puppet mdl 解析）
- `src/client/` — 浏览器半（主题覆盖 / 背景层 / SceneCanvas / SceneModelRenderer 子集渲染器 / ParticleRuntime / GazeLens 眼动 / 专注透镜 / wallpaper_share 面板）
- `native/we-capture/` — Rust 原生捕获器源码（Windows Graphics Capture → JPEG）
- `bin/we-capture.exe` — 随包发布的原生捕获器（Windows-only）
- `docs/` — 格式规范与技术文档（`scene-format.md` / `scene-fallback.md` / `tex-format-findings.md` / `mdl-skinning-findings.md`）
- `tools/scene-renderer/` — 内置参考 renderer（实现协议契约；真·原生 renderer 以同协议替换之）
- `lib/` — 预构建产物（用户侧零构建）
- `install.ps1` — 可选一键安装脚本（走官方 `dsh plugin add`）
- `CHANGELOG.md` — 版本历史

## 🆕 已知问题

> 适用版本：插件 `v26.9.3-rc` / Harness `0.1.2-alpha.2`。

### 适配问题（Harness 0.1.2-alpha.2 破坏性变更）

- **`workspaces.startSession` 已移除**：沉浸模式 orb 按钮的"新建会话"功能静默失效。改为调用 `ctx.get("uiWorkspace")?.startSession()`。
- **orb 后台任务变色失效**：插件 inject 声明未包含 `"sessions"`，在 0.1.2-alpha.2 中 `ctx.get("sessions")` 可能返回 undefined，导致 orb 按钮始终显示空闲色（绿色），不随后台任务运行变蓝。
- **沉浸模式仅隐藏输入栏**：`applyImmersive()` 的 CSS 选择器 `[data-phase] > header` 期望 `<header>` 标签，但当前 ConversationRoot 渲染为 `<div>`，选择器失配；对话消息区未被隐藏。修复：改为 `[data-conversation-scroll]`。
- **⏻ 同步按钮图标不显示**：U+23FB 符号在 DSH 字体栈 `--dsw-font-family`（不含 Segoe UI Symbol）中无法渲染。修复：给 `.wesync-btn` 增加 `font-family: 'Segoe UI Symbol', 'Segoe UI Emoji'`。

### 内部逻辑缺陷（已于 26.9.3-rc 修复，详见 CHANGELOG）

- ~~**路径穿越漏洞（安全）**~~：已修复——`webRelPath()` URL 解码 + 拒绝 `..` / 绝对路径，`/we-sync/wallpaper/` 与 sourceServer 两处统一防护。
- ~~**`poll()` 轮询永久锁死**~~：已修复——`!res.ok` 分支先复位 `polling=false` 再返回，非 200 响应不再卡死轮询。
- ~~**DWP 渲染循环遇异常停摆**~~：已修复——GL 异常一次性降级 Canvas2D（换新 canvas 元素原位替换），失败时跳过该帧节流告警、循环继续。
- ~~**`decode()` RAW 帧无长度校验**~~：已修复——先校验 `w*h*4` 长度并截断，不足即跳过坏帧。

### 环境限制

- **预览图不显示**：市场卡片缩略图指向 `raw.githubusercontent.com`，当前环境不可达。图片加载失败后 `onError` 隐藏显示。
- **WE 安装目录不存在**：自动检测到 `F:\SteamLibrary\...\wallpaper_engine` 但目录不存在，壁纸同步不可用（市场功能不受影响）。

## 📄 License

GPL-3.0

---

<a name="english"></a>
# English

## 📑 Table of Contents

- [✨ Features](#-features)
- [🎨 Render Modes & Compatibility Matrix](#-render-modes--compatibility-matrix)
- [🖼️ Scene Rendering & Fallback](#-scene-rendering--fallback)
- [🔍 Focus Mode & Eye Tracking](#-focus-mode--eye-tracking)
- [🚀 Installation](#-installation)
- [⚙️ Configuration](#-configuration)
- [📈 Performance & Known Limitations](#-performance--known-limitations)
- [📦 Project Structure](#-project-structure)
- [🆕 Known Issues](#-known-issues)
- [📄 License](#-license-1)

Syncs the wallpaper Wallpaper Engine is currently showing into the DeepSeek Harness Web UI background, with a `wallpaper_share` tab to tune render mode, visual effects, focus mode and the wallpaper library. Full scene animation and application import are supported.

> **Display-only sync**: it only reads WE state; it never controls or changes your desktop wallpaper (switch wallpapers inside WE).
> **No sensitive data**: the code contains no Steam username / SteamID / token; the WE install dir is auto-detected at runtime (registry `HKCU\Software\WallpaperEngine\installPath` → common Steam paths), manual config only if detection fails. Eye tracking runs fully locally — camera frames never leave the device.

## ✨ Features

- **Real-time sync**: the page background follows WE's current wallpaper within ~2s
- **Multi-monitor**: auto-follows the latest change; can lock a specific monitor
- **3 render modes**: Preview / Capture / Full — see [Render Modes & Compatibility Matrix](#-render-modes--compatibility-matrix)
- **Native scene capture renderer**: bundled Rust `we-capture.exe` uses Windows Graphics Capture to grab WE's rendered desktop, mirroring WE's own output → GLSL / SceneScript / keyframes / particles **all covered natively**
- **Focus mode**: a center-clear, edge-blurred reading window; follows the mouse by default
- **Eye tracking (experimental)**: optional; uses the webcam to follow your gaze; 9-point calibration, text snap, anti-jitter
- **Wallpaper library · Local / Market**: browse by **Local** and **Market**. Local manages what's installed — `dwp壁纸` (click to mount as the global background, click again to unmount) and `we 应用` (click to open its folder), with title search, thumbnails and counts; Market browses the `dwp-registry` catalog with name / author search, tag filters and **install / update / uninstall**
- **DWP wallpapers & global-background rendering**: `dwp/1.0` protocol packages (text / solid / particle / mesh layers + 12 blend modes + 3 animations + 11 effects, deterministic rendering); mounting renders them as the DSH global background via WebGL2 (Canvas2D fallback on weak GPUs) while pausing WE sync to avoid conflicts, auto-restored after a refresh
- **Visual adjustments**: panel opacity 0–100% / background blur 0–30px / shadow depth 0–100%, live
- **Background task indicator**: a circular cue when the sidebar is collapsed (green idle / blue running / yellow needs approval)
- **Sync toggle**: one-click on/off; shows a third "sync paused (DWP)" state while a DWP wallpaper is mounted
- **Settings persistence**: sync toggle, render mode, monitor lock, the three visual sliders, focus and eye-tracking prefs are stored in `localStorage` (key `we-sync.settings`) and restored after a refresh or DSH restart; transient view state such as immersive mode and runtime-derived flags are deliberately not stored
- **Self-diagnostic route** `/we-sync/diag` (localhost only; scene renderer status & texture extraction results)

## 🎨 Render Modes & Compatibility Matrix

The mode switch at the top of the panel controls how the wallpaper is presented (buttons read **Preview / Capture / Full**; the concepts Eco / Perf / Enhanced appear in flash messages & config):

| Mode | Meaning | Notes |
| --- | --- | --- |
| **Preview** (Eco) | Static preview | Only WE's preview image; lowest cost; no animation |
| **Capture** (Perf) | Capture WE desktop | scene uses the **native `we-capture.exe`**, mirroring WE's own rendered desktop → full effect coverage; falls back to browser rendering when WE isn't running |
| **Full** (Enhanced) | Browser pkg render | scene uses the **browser subset renderer**, parsing `.pkg` and redrawing in-browser, independent of WE |

Per-type compatibility matrix (the real difference is only in **scene**; for video / web / image, Capture and Full behave the same — both load source):

| Type | Preview | Capture | Full |
| --- | --- | --- | --- |
| `video` | static preview | plays source video (HTTP Range, seekable) | plays source video |
| `web` | static preview | iframe loads source page | iframe loads source page |
| `image` | static preview | shows source image | shows source image |
| `scene` | static preview | **native WE desktop capture** (full coverage; falls back to browser when WE not running) | **browser pkg render** (WE-independent, subset) |
| `application` / `other` | static preview | static preview (viewable in the library) | static preview |

## 🖼️ Scene Rendering & Fallback

scene wallpapers resolve in this priority order under Capture / Full:

1. **Native capture (external)**: `we-capture.exe` detected and WE actively rendering → WS frame-stream live canvas (full coverage).
2. **Browser subset render (browser)**: parse `scene.json` layer tree + transform + decoded textures / particles / puppet into a canvas.
3. **Static textures**: extracted pkg textures as a base layer.
4. **Preview image**: if none of the above → WE preview.

**Native capture renderer**: WE's DX11 window is a child of Progman and WGC rejects child windows, so it captures the top-level Progman / WorkerW root, converts BGRA→JPEG and emits frames over stdout via the external-renderer protocol. Because it mirrors **WE's own rendering**, no ~500KB JS reimplementation is needed and effects are 100% covered. That top-level root spans the entire virtual desktop, so the capture renderer crops to the locked WPE child window's rect via `CopySubresourceRegion` + `D3D11_BOX` before encoding (mapping through `ClientToScreen` / `GetClientRect`, so it stays correct under non-100% DPI scaling) → output is strictly a single monitor. `bin/we-capture.exe` (~540KB, Windows-only) ships in the npm package; Rust source in `native/we-capture/` (`cargo build --release`, with a `--selftest` diagnostic mode). DSH's `probeRenderer` auto-discovers it; `sceneRenderMode='auto'` uses external when detected, else browser.

Full chain & per-layer implementation in **[docs/scene-fallback.md](docs/scene-fallback.md)**; pkg / texture / puppet formats in **[docs/scene-format.md](docs/scene-format.md)**, **[docs/tex-format-findings.md](docs/tex-format-findings.md)**, **[docs/mdl-skinning-findings.md](docs/mdl-skinning-findings.md)**.

## 🔍 Focus Mode & Eye Tracking

- **Focus = lens master switch**: turning it on overlays a gaze-following lens (center clear, edges blurred). Global wallpaper blur is set to 0 while the lens is active; all blur is done by the lens layer's `backdrop-filter` (avoiding double-blur cost). Follows the **mouse** by default (precise, zero latency).
- **Eye tracking (optional)**: lazily loads [WebGazer.js](https://webgazer.cs.brown.edu) (GPL-3.0, compatible with this project; bundles MediaPipe FaceMesh, ~12MB from CDN on first use, not in the base package) and follows your gaze via the webcam; no face / away (> 1.2s) falls back to the mouse. Turning off focus also stops tracking and releases the camera.
- **Calibration**: a 9-point guided sequence; the camera preview is shown only during calibration. Training data comes solely from calibration clicks (WebGazer's mouse sampling is disabled during tracking so mouse movement can't pollute the regression); samples persist, so you calibrate once.
- **Text snap** (on by default; the UI button reads "Text snap"): the lens Y snaps to the nearest text line (via `Range.getClientRects`), X still follows, with hysteresis to avoid flapping between adjacent lines.
- **Anti-jitter**: deadzone + EMA — small high-frequency jitter is ignored, only large moves ease the lens.
- **Privacy**: fully local inference, frames never leave the device; `stopVideo()` releases the camera on off; only available on `http://127.0.0.1` (secure context).

## 🚀 Installation

> Requires DSH Web `0.1.0-rc.6` or newer (verified on `0.1.2-alpha.2`; known adaptation issues and feature compatibility are listed in the "Known Issues" section below), run with `dsh --profile web`.

### 🎯 Pick your tier (install by need)

| Tier | Who it's for | Install command |
| --- | --- | --- |
| 🟢 **Latest (beginner)** | Just grab the recommended build for the current mainstream Harness | `dsh plugin --profile web add dsh-wallpaper_share` |
| 🔵 **rc (release candidate)** | Want new features for the current architecture early, OK with minor issues | `dsh plugin --profile web add dsh-wallpaper_share@rc` |
| 🟣 **alpha (future architecture)** | On the Harness alpha architecture / want to adapt to it early | `dsh plugin --profile web add dsh-wallpaper_share@alpha` |
| 🟡 **test (in development)** | Early access / testing, some features may be unfinished | `dsh plugin --profile web add dsh-wallpaper_share@test` |

- **Beginners**: use the first default command only — no need to know about tags. `latest` always points to the recommended build for the current mainstream Harness (today that is the current architecture's build; when the alpha architecture becomes mainstream, `latest` will follow it).
- **Power users**: append `@tag` to pull the tier you need; the GitHub equivalent switches branches: `github:YRN-playmaker/dsh-wallpaper_share` (main = latest) / `#test` (test) / `#alpha` (alpha, opens when the alpha line ships).
- **npm tags currently published**: `latest` / `test`; `rc` and `alpha` open when their version lines ship.

```bash
# pick one:
dsh plugin --profile web add github:YRN-playmaker/dsh-wallpaper_share
#   install from GitHub (repo ships prebuilt lib/, no build permission needed; main = latest tier)
dsh plugin --profile web add dsh-wallpaper_share
#   install from npm (default = latest tier)
dsh plugin --profile web add ./dsh-wallpaper_share-26.9.3-rc.tgz
#   install from a local tarball (26.9.3-rc release candidate)
dsh plugin --profile web add github:YRN-playmaker/dsh-wallpaper_share#test
#   install the test branch (test tier, latest dev build):
# restart dsh (web profile); the wallpaper_share tab appears
```

**No manual config editing**: the `cordis.patch.yml` referenced by `dsh.bundle.patch` is auto-added to the profile's bundle layer on install; one line is both the host line (node half: polling + HTTP routes) and the `dsh.client` roster line (the prebuilt `lib/client.js` browser half is auto-injected). The package ships prebuilt artifacts — zero build for users.

### Building from Source (developers)

1. Copy this repo root (`package.json` / `src/` / `tsconfig.json` / `tsdown.config.ts`) into your DSH checkout at `packages/client/we-sync/`;
2. `pnpm install`
3. `pnpm --filter dsh-wallpaper_share exec tsc -b`
4. `pnpm --filter dsh-wallpaper_share bundle`
5. Artifacts land in `packages/client/we-sync/lib/` (`index.js` node half + `client.js` browser half); copy back to this repo's `lib/` and `pnpm pack`.

> You can also run `pnpm install && pnpm build` at this repo root (`tsdown` builds standalone, no DSH checkout needed).
> Native capture: `cd native/we-capture && cargo build --release` (needs an `x86_64-pc-windows-gnu` or `-msvc` toolchain); copy the output to `bin/we-capture.exe`.
>
> ⚠️ **gnu toolchain on machines with a non-ASCII username**: MinGW's ld rejects non-ASCII paths, so a Chinese Windows username (e.g. `C:\Users\倪哥儿`) reports `cannot find crt2.o / libstd-*.rlib / -lkernel32` even though the stdlib exists. Fix: create pure-ASCII directory junctions for `.rustup` and `.cargo`, then override `--sysroot`:
> ```text
> mklink /J C:\Users\Public\rustup-ji "C:\Users\<chinese-username>\.rustup"
> mklink /J C:\Users\Public\cargo-ji  "C:\Users\<chinese-username>\.cargo"
> set CARGO_HOME=C:\Users\Public\cargo-ji
> set RUSTFLAGS=--sysroot=C:/Users/Public/rustup-ji/toolchains/stable-x86_64-pc-windows-gnu
> cargo build --release
> ```

## ⚙️ Configuration

`CONFIG` at the top of `src/index.ts`:

| Key | Default | Notes |
| --- | --- | --- |
| `wallpaperEngineDir` | `''` (auto-detect) | set manually if detection fails |
| `workshopContentDir` | `''` (auto) | workshop content dir |
| `pollIntervalMs` | `2000` | polling interval |
| `previewMaxBytes` | `6291456` | preview size cap |
| `sceneRendererPath` | `''` (auto-discover) | external scene renderer; empty auto-discovers bundled `bin/we-capture.exe` (or local `native/we-capture/target/release/`) |
| `wallpaperEngineAssetsDir` | `''` (auto) | WE engine assets dir (`<weDir>/assets`; renderer unavailable if missing) |
| `sceneRenderWidth` | `1920` | native capture output width (box-downsample below native; lower for 4K to save CPU) |
| `sceneRenderHeight` | `1080` | native capture output height |
| `sceneRenderFps` | `30` | target fps |
| `sceneRenderQuality` | `80` | JPEG frame quality (0..100) |
| `sceneRenderMode` | `'auto'` | `'auto'` (external if native we-capture or explicit `sceneRendererPath` detected, else browser) \| `'browser'` \| `'external'` |
| `particleRateScale` | `1` | particle emission-rate scale (browser subset renderer) |
| `particleSizeScale` | `1` | particle size scale |
| `effectStrengthScale` | `1` | effect strength scale |
| `puppetMeshRender` | `true` | puppet mesh rendering toggle |

> The panel's 3-mode switch (Preview / Capture / Full) is a runtime UI setting, distinct from `sceneRenderMode` (backend browser/external selection).

## 📈 Performance & Known Limitations

**Performance**

- Native capture: SIMD `jpeg-encoder`, ~11ms per 1080p frame; defaults to 1920×1080@30fps, tunable in `CONFIG`.
- Preview only pastes a static preview (lowest cost); Capture / Full load animation.

**Known limitations & boundaries**

- **Platform**: the native capture renderer is Windows-only (uses Windows Graphics Capture); elsewhere or when capture is unavailable, scene falls back to the browser subset renderer.
- **Desktop icons**: capture mirrors the desktop wallpaper layer, so icons are included (hide them for a clean background).
- **Fullscreen apps**: WE pauses rendering behind fullscreen apps, so the captured frame freezes.
- **Eye-tracking accuracy**: webcam + linear regression is ~±50–150px natively; with tight line spacing it may occasionally lock an adjacent line — mitigated by a large lens + hysteresis. Needs a camera + network to load the model; first use requires one calibration.
- **Browser subset renderer**: a subset reimplementation of WE's engine; some complex shaders/effects may be imperfect — use Capture (native capture) for 100% coverage.

## 📦 Project Structure

- `src/index.ts` — node half: WE polling, HTTP routes, scene renderer subprocess, library scan
- `src/scene/` — SceneAdapter modules (protocol / capability probe / renderer process / WebSocket / fallback / PKGV0001 parsing / SceneModel layer model / .tex decoding / puppet mdl parsing)
- `src/client/` — browser half (theme overrides / background layers / SceneCanvas / SceneModelRenderer / ParticleRuntime / GazeLens / focus lens / wallpaper_share panel)
- `native/we-capture/` — Rust native capture renderer source (Windows Graphics Capture → JPEG)
- `bin/we-capture.exe` — shipped native capture renderer (Windows-only)
- `docs/` — format & implementation docs (`scene-format.md` / `scene-fallback.md` / `tex-format-findings.md` / `mdl-skinning-findings.md`)
- `tools/scene-renderer/` — built-in reference renderer (implements the protocol contract; real renderers replace it)
- `lib/` — prebuilt artifacts (zero build for users)
- `install.ps1` — optional one-shot installer (official `dsh plugin add`)
- `CHANGELOG.md` — release notes

## 🆕 Known Issues

> Applies to plugin `v26.9.3-rc` / Harness `0.1.2-alpha.2`.

### Adaptation issues (breaking changes in Harness 0.1.2-alpha.2)

- **`workspaces.startSession` was removed**: the "new session" action of the immersive orb button silently fails. Use `ctx.get("uiWorkspace")?.startSession()` instead.
- **Orb task-status color does not update**: the plugin's `inject` declaration omits `"sessions"`, so on 0.1.2-alpha.2 `ctx.get("sessions")` may return `undefined` and the orb stays idle-green instead of turning blue while background tasks run.
- **Immersive mode only hides the input bar**: `applyImmersive()` targets `[data-phase] > header`, but ConversationRoot renders a `<div>` there, so the selector misses and the transcript stays visible. Fix: target `[data-conversation-scroll]` instead.
- **The ⏻ sync-toggle glyph does not render**: U+23FB has no glyph in DSH's `--dsw-font-family` (no Segoe UI Symbol). Fix: add `font-family: 'Segoe UI Symbol', 'Segoe UI Emoji'` to `.wesync-btn`.

### Internal logic defects (fixed in 26.9.3-rc, see CHANGELOG)

- ~~**Path traversal (security)**~~: fixed — `webRelPath()` URL-decodes and rejects `..` / absolute paths; both `/we-sync/wallpaper/` and the source server are guarded.
- ~~**`poll()` permanently deadlocks**~~: fixed — the `!res.ok` branch now resets `polling = false` before returning, so a non-200 response no longer stops sync forever.
- ~~**DWP render loop freezes on runtime errors**~~: fixed — a GL exception triggers a one-time Canvas2D fallback (fresh canvas element swapped in place); on failure the frame is skipped with throttled warnings and the loop continues.
- ~~**`decode()` RAW frames lack length validation**~~: fixed — payload length is checked and truncated to `w*h*4` first; short frames are skipped.

### Environment limits

- **Market thumbnails do not load**: catalog thumbnails point at `raw.githubusercontent.com`, unreachable in some environments; the `onError` handler hides them.
- **Wallpaper Engine directory missing**: auto-detection found `F:\SteamLibrary\...\wallpaper_engine` but the directory does not exist, so wallpaper sync is unavailable (the market feature is unaffected).

## 📄 License

GPL-3.0
