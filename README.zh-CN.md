# dsh-wallpaper_share

**Wallpaper Engine ↔ DeepSeek Harness 壁纸同步**

<div align="center">
  <a href="https://www.npmjs.com/package/dsh-wallpaper_share"><img alt="npm version" src="https://img.shields.io/npm/v/dsh-wallpaper_share" /></a>
  <a href="https://opensource.org/licenses/GPL-3.0"><img alt="License: GPL-3.0" src="https://img.shields.io/badge/License-GPL--3.0-blue.svg" /></a>
  <a href="https://github.com/YRN-playmaker/dsh-wallpaper_share/releases"><img alt="插件版本 v26.9.4" src="https://img.shields.io/badge/v26.9.4-4d6bfe" /></a>
</div>

[中文](README.zh-CN.md) | [English → README.md](README.md#english)

<div align="center">
  <video src="https://github.com/user-attachments/assets/4461d385-de62-42be-8420-7edce5606f44"
         muted autoplay loop playsinline controls width="100%"></video>
</div>

把 Wallpaper Engine 当前显示的壁纸实时同步为 DeepSeek Harness Web 界面的背景，并提供 `wallpaper_share` 标签页用于调整渲染模式、视觉效果、专注透镜与壁纸库。支持场景壁纸的完整动效与应用壁纸的导入。

> **纯显示同步**：只读取 WE 状态，不控制 / 不修改桌面壁纸（换壁纸请在 WE 内操作）。
> **无敏感信息**：代码不含 Steam 用户名 / SteamID / 令牌；WE 安装目录运行时自动检测（注册表 `HKCU\Software\WallpaperEngine\installPath` → 常见 Steam 路径），检测不到时才需要手动配置。眼动追踪全程本地推理，摄像头画面不出设备。

> 本文件是纯中文长文版，内容与 [`README.md`](README.md) 的中文段逐节对齐；英文见 [`README.md#english`](README.md#english)。

## 📑 目录

- [⚡ 30 秒上手](#-30-秒上手)
- [✨ 功能一览](#-功能一览)
- [🧭 面板导览](#-面板导览)
- [🎨 渲染模式与兼容矩阵](#-渲染模式与兼容矩阵)
- [🖼️ Scene 渲染与回退](#-scene-渲染与回退)
- [🔍 专注模式与眼动追踪](#-专注模式与眼动追踪)
- [🌌 沉浸模式与任务指示](#-沉浸模式与任务指示)
- [🚀 安装](#-安装)
- [⚙️ 配置](#-配置)
- [📈 性能与已知限制](#-性能与已知限制)
- [📦 项目结构](#-项目结构)
- [🆕 已知问题](#-已知问题)
- [📄 License](#-license)

## ⚡ 30 秒上手

```bash
dsh plugin --profile web add dsh-wallpaper_share   # 或见下方「安装」选档
# 重启 dsh（web profile），浏览器打开 http://127.0.0.1:3080
```

装完你会看到三样东西：

1. **页面背景**变成 WE 当前壁纸（约 2 秒内跟随切换），面板与卡片浮在其上；
2. 会话区顶部多出一个 **`wallpaper_share` 标签页**（与「对话记录」「轨迹」并列），所有开关都在这里；
3. **收纳侧边栏**时，左缘出现一个圆形状态灯（绿 / 蓝 / 黄），点它进沉浸模式。

需要 WE 正在运行且已应用壁纸；否则背景留空、面板显示"尚未应用壁纸"。诊断入口：`http://127.0.0.1:3080/we-sync/diag`（仅本机可访问；端口以启动日志为准，默认 3080）。

> **零配置**：无需 API Key、无需注册、无需任何额外配置，安装即用。（注意：开头「无敏感信息」是隐私声明——代码中不含 Steam 用户名 / 令牌，并非需要你提供这些信息。）

## ✨ 功能一览

- **实时同步**：在 WE 切换壁纸后，页面背景约 2 秒内自动跟随
- **多显示器**：自动跟随"最近变化"的一台；复数显示器时可手动锁定某台作为背景来源
- **三档渲染模式**：预览 / 捕获 / 完整，详见 [渲染模式与兼容矩阵](#-渲染模式与兼容矩阵)
- **原生 scene 捕获渲染器**：随包内置 Rust 编写的 `we-capture.exe`，用 Windows Graphics Capture 抓取 WE 正在渲染的桌面，镜像 WE 自身输出 → GLSL / SceneScript / 关键帧 / 粒子等**所有 WE 效果天然全覆盖**
- **专注透镜**：叠加一个圆心清晰、圆外模糊的阅读窗；默认跟随鼠标，开专注即生效
- **眼动追踪（实验）**：可选，用摄像头推断注视点让透镜跟随视线；9 点校准、文字吸附、抗抖动
- **壁纸库 · 本地 / 市场**：按**本地**与**市场**两大分类浏览。本地一栏管理已装内容——`dwp壁纸`（点击即挂载为全局背景，已挂载再点取消）与 `we 应用`（点击打开所在文件夹），带标题搜索、缩略图与计数；市场一栏浏览 `dwp-registry` 目录，支持名称 / 作者搜索、标签筛选与**安装 / 更新 / 卸载**
- **DWP 壁纸与全局背景渲染**：`dwp/1.0` 协议包（纯文本 / solid / 粒子 / mesh 图层 + 12 种混合模式 + 3 种动画 + 11 种效果，确定性渲染）；挂载后经 WebGL2 真实渲染为 DSH 全局背景（低配 Canvas2D 降级），同时暂停 WE 同步避免冲突，刷新后自动恢复
- **沉浸模式**：一键隐去会话头部、正文与输入栏，让壁纸独占视野；网页 / 应用类壁纸在沉浸下可直接鼠标交互（详见[沉浸模式](#-沉浸模式与任务指示)）
- **视觉效果滑块**：面板透明度 0–100% / 背景模糊 0–30px / 阴影深度 0–100%，即时生效
- **后台任务可视化**：收纳侧边栏时，用圆形指示感知任务进度（绿 = 空闲 / 蓝 = 进行中 / 黄 = 等待授权）
- **同步开关**：一键启停；挂载 DWP 壁纸期间显示「同步暂停（DWP）」第三态
- **设置持久化**：同步开关、渲染模式、显示器锁、三档滑块、专注 / 眼动等偏好写入 `localStorage`（键 `we-sync.settings`），刷新或重启 DSH 后自动恢复；沉浸模式等临时视图态与任务状态一律不落盘
- **自诊断路由** `/we-sync/diag`（仅本机可访问，含 scene renderer 状态与纹理提取结果）

## 🧭 面板导览

`wallpaper_share` 标签页自上而下三张卡片，所有操作即时生效、无需保存：

| 卡片 | 内容 |
| --- | --- |
| **壁纸状态** | 壁纸名（标题行**右缘为插件版本号**，一键整段选中便于反馈问题）；下方副标题只承载诊断信息——scene 壁纸显示当前渲染通路（`场景 · 预览图 / 捕获 live 30fps / 浏览器模型渲染 / 回退：<原因>`），未应用壁纸时显示引导文案，其余类型整行不占；多显示器时出现「背景显示器」下拉；`⏻ 同步开启 / 关闭 / 暂停（DWP）` 三态按钮 |
| **视觉效果** | 三档渲染模式分段按钮；「专注模式」及其展开条（眼动追踪 / 校准视线 / 文字吸附 / 实时状态）；透明度 · 模糊 · 阴影三个滑块（**专注开启时滑块隐藏**，改由任务态与透镜接管） |
| **壁纸库** | 「壁纸读取位置」可添加自定义壁纸目录（指向单个壁纸目录或集合文件夹）；「本地 / 市场」两栏切换，本地按 `dwp壁纸` / `we 应用` 筛选 + 标题搜索 + 分页（显示更多 +60），市场支持安装 / 更新 / 卸载 |

两点与宿主 UI 的约定：

- **本标签页禁用正文宽度拖拽**：会话正文两侧那对拖拽把手在 `wallpaper_share`（与「轨迹」页一样）不出现，切回「对话记录」仍可用。
- 标签页是 session 作用域插槽，切换会话会重挂载面板；语言与开关状态从模块级 store 恢复，不会"弹回英语"。

## 🎨 渲染模式与兼容矩阵

面板顶部的三档切换决定壁纸如何呈现（按钮文字为 **预览 / 捕获 / 完整**，概念名 eco / perf / enhanced 用于 flash 提示与配置，默认 **捕获**）：

| 档位 | 含义 | 说明 |
| --- | --- | --- |
| **预览**（eco） | 静态预览图 | 只贴 WE 的预览图，最省资源，不加载动效 |
| **捕获**（perf） | 捕获 WE 桌面 | scene 走**原生捕获器 `we-capture.exe`**，镜像 WE 自己渲染的桌面 → 效果全覆盖；WE 未运行时自动回退浏览器渲染 |
| **完整**（enhanced） | 浏览器解 pkg | scene 走**浏览器子集渲染器**，直接解析 `.pkg` 在浏览器里重绘，不依赖 WE 运行 |

> 对 video / web / image，捕获与完整行为一致（都加载源内容）；三档的真正差别在 **scene**：捕获 = 捕获 WE 桌面（全覆盖、需 WE 运行），完整 = 浏览器解 pkg（独立、覆盖子集）。

按壁纸类型展开的兼容矩阵：

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

当前走的是哪一层，直接显示在面板副标题上（见[面板导览](#-面板导览)）；更细的状态在 `/we-sync/diag`。

**原生捕获器原理**：WE 的 DX11 渲染窗口是 Progman 子窗口、WGC 不接受子窗口，故捕获其顶层根 Progman / WorkerW，BGRA→JPEG 按外部渲染器协议输出到 stdout。因为镜像的是 **WE 自身的渲染结果**，无需在 JS 端复刻对面那套 ~500KB 软渲染引擎，效果 100% 覆盖。多显示器下顶层根窗横跨整个虚拟桌面，捕获器按锁定的那块 WPE 子窗矩形用 `CopySubresourceRegion` + `D3D11_BOX` 只回读目标屏区域再编码（换算经 `ClientToScreen` / `GetClientRect` 归一化，DPI 缩放非 100% 同样正确）→ 输出严格是单块屏。`bin/we-capture.exe`（约 540KB，Windows-only）随 npm 包发布，Rust 源码在 `native/we-capture/`（`cargo build --release` 可重建，含 `--selftest` 诊断模式）；DSH 侧 `probeRenderer` 自动发现，`sceneRenderMode='auto'` 检测到原生渲染器即走 external（捕获档），否则回退 browser。JPEG 编码器用 SIMD 的 `jpeg-encoder`，1080p 编码仅约 11ms。

完整链路与各层实现见 **[docs/scene-fallback.md](docs/scene-fallback.md)**；pkg / 纹理 / puppet 格式见 **[docs/scene-format.md](docs/scene-format.md)**、**[docs/tex-format-findings.md](docs/tex-format-findings.md)**、**[docs/mdl-skinning-findings.md](docs/mdl-skinning-findings.md)**。

## 🔍 专注模式与眼动追踪

- **专注模式 = 透镜总开关**：开启即在壁纸上叠加一个跟随注视点的透镜（圆心清晰、圆外模糊的阅读窗）。壁纸全局模糊在透镜激活时置 0，模糊全部由透镜层 `backdrop-filter` 承担（避免双重模糊开销）。默认跟随**鼠标**（精确、零延迟）。
- **任务自适应浓度**：专注开启时面板浓度不再听滑块，而按当前是否有任务在跑取两套预设——进行中 `20% / 9px / 75%`，空闲 `9% / 6px / 40%`；注视点圆内再按透镜参数加浓。
- **眼动追踪（可选）**：在专注基础上开启后，惰性从 CDN 加载 [WebGazer.js](https://webgazer.cs.brown.edu)（GPL-3.0，与本项目许可兼容；内含 MediaPipe FaceMesh，首次约下载 ~12MB，不进基础包），用摄像头推断屏幕注视点跟随视线；无脸 / 离开座位（> 1.2s）自动回落鼠标。关闭专注会一并关闭眼动并释放摄像头。
- **校准视线**：9 点引导序列；摄像头画面仅在校准期间投影到页面，平时不显示。训练数据只来自校准点击（追踪时关闭 WebGazer 的鼠标采样，避免"鼠标移动"污染回归拟合）；样本持久化，校准一次即复用。
- **文字吸附**（默认开，UI 按钮文字「文字吸附」）：注视点 Y 锁到最近的文字行中心（用 `Range.getClientRects` 取块内每一视觉行），X 仍跟随滑动，带滞回避免相邻行横跳——读哪行、圆圈稳在哪行。
- **抗抖动**：死区 + EMA，小幅高频抖动忽略、大幅移动才缓动跟随。
- **隐私**：全程本地推理、画面不出设备；关闭时显式 `stopVideo()` 释放摄像头；仅在 `http://127.0.0.1`（安全上下文）可用。

## 🌌 沉浸模式与任务指示

侧边栏**收纳**时，左缘出现一个 34px 圆形指示灯（展开时自动隐藏，不占版面）。它同时是状态灯和沉浸模式的开关：

- **颜色即状态**：黄 `#eab308` 等待授权 > 蓝 `#3b82f6` 有任务在跑 > 绿 `#22c55e` 空闲。授权状态由审批面板是否在屏判定，任务状态订阅宿主的会话列表快照（跨工作区任一会话 running 即为进行中）。
- **点击进入沉浸**：若当前不是新会话，先向宿主请求开一个新会话（`uiWorkspace.startSession()`），再把会话 UI 隐去——头部（标题 / 面包屑 / 标签页）、正文滚动区与输入栏一并淡出，壁纸独占视野。
- **沉浸下壁纸可交互**：网页 / 应用类壁纸的 iframe 被提到最前并接收鼠标事件，左缘保留 56px 给侧边栏 rail，因此侧边栏与圆灯仍可点。
- **退出方式**：再点圆灯、按 `Esc`、或点击侧边栏内任意按钮。沉浸是临时视图态，**不写入持久化**——刷新后回到正常布局，不会"醒来发现聊天框不见了"。

## 🚀 安装

> 前置：兼容 DSH Web `0.1.0-rc.6` 及以上（已在 `0.1.2-rc.1` 验证，0.1.2 的破坏性变更已适配，剩余限制见下方「已知问题」），以 `dsh --profile web` 运行。

### 🎯 分档安装（按需选择）

| 档位 | 适合谁 | 安装命令 |
| --- | --- | --- |
| 🟢 **小白** | 不纠结版本，直接拉当前主流 Harness 环境的推荐版 | `dsh plugin --profile web add dsh-wallpaper_share` |
| 🔵 **rc（稳定版本）** | 适配 harness 为 rc 架构的推荐版本，新功能适配较慢 | `dsh plugin --profile web add dsh-wallpaper_share@rc` |
| 🟣 **alpha（新版本）** | 适配 harness 为 alpha 架构的推荐版本 | `dsh plugin --profile web add dsh-wallpaper_share@alpha` |
| 🟡 **test（测试版本）** | 用于测试的版本，可能有未完成功能 | `dsh plugin --profile web add dsh-wallpaper_share@test` |

### 🔧 其他安装方式

```bash
# 从 Git 克隆（仓库自带预构建 lib/，克隆后无需构建）：
git clone https://github.com/YRN-playmaker/dsh-wallpaper_share.git
cd dsh-wallpaper_share
pnpm pack                                        # 打包为 dsh-wallpaper_share-<version>.tgz
dsh plugin --profile web add ./dsh-wallpaper_share-<version>.tgz
```

```bash
# 作为 npm 依赖引入（可选）：
pnpm add dsh-wallpaper_share
```

```bash
# 任选其一：
dsh plugin --profile web add github:YRN-playmaker/dsh-wallpaper_share
#   从 GitHub 安装（仓库自带预构建 lib/，不需要构建许可；main = 最新档）
dsh plugin --profile web add dsh-wallpaper_share
#   从 npm 安装（默认 = latest 最新档）
dsh plugin --profile web add ./dsh-wallpaper_share-26.9.4.tgz
#   本地 tarball 安装（26.9.4）
dsh plugin --profile web add github:YRN-playmaker/dsh-wallpaper_share#test
#   从 GitHub 安装 test 分支（测试档，含壁纸特效优化、页面功能更新等）
```

```bash
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
> 面板标题行的版本号在构建期由 `tsdown` 的 `define` 从 `package.json` 注入，改版本号后**必须重新构建**才会反映到 UI。
> 原生捕获器：`cd native/we-capture && cargo build --release`（需 `x86_64-pc-windows-gnu` 或 `-msvc` 工具链），产物拷到 `bin/we-capture.exe`。

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
- 专注透镜激活时壁纸全局模糊置 0，模糊由透镜层承担，避免双重模糊开销。

**已知限制与边界**

- **平台**：原生捕获器为 Windows-only（依赖 Windows Graphics Capture）；非 Windows 或捕获不可用时 scene 自动回退浏览器子集渲染器。
- **桌面图标**：捕获镜像整个桌面壁纸层，会把桌面图标一并抓入（建议隐藏桌面图标）。
- **全屏应用**：WE 在全屏应用时默认暂停渲染，捕获画面随之定格。
- **眼动精度**：webcam + 线性回归的原生精度约 ±50–150px，行距较小时偶尔可能锁到相邻行；靠大圆 + 滞回缓解。需摄像头 + 联网加载模型；首次开眼动需校准一次。
- **浏览器子集渲染器**：是 WE 渲染引擎的子集复刻，个别复杂 shader / 特效可能不完美；需要 100% 覆盖时用捕获档（原生捕获）。

## 📦 项目结构

- `src/index.ts` — Node 半：WE 状态轮询、HTTP 路由、scene renderer 子进程管理、壁纸库扫描
- `src/scene/` — SceneAdapter 模块（协议 / 能力探测 / renderer 进程 / WebSocket / 回退 / PKGV0001 解析 / SceneModel 图层模型 / .tex 解码 / puppet mdl 解析）
- `src/client/` — 浏览器半（主题覆盖 / 背景层 / SceneCanvas / SceneModelRenderer 子集渲染器 / ParticleRuntime / GazeLens 眼动 / 专注透镜 / 沉浸模式 / wallpaper_share 面板）
- `native/we-capture/` — Rust 原生捕获器源码（Windows Graphics Capture → JPEG）
- `bin/we-capture.exe` — 随包发布的原生捕获器（Windows-only）
- `docs/` — 格式规范与技术文档（`scene-format.md` / `scene-fallback.md` / `tex-format-findings.md` / `mdl-skinning-findings.md`）
- `tools/scene-renderer/` — 内置参考 renderer（实现协议契约；真·原生 renderer 以同协议替换之）
- `lib/` — 预构建产物（用户侧零构建）
- `install.ps1` — 可选一键安装脚本（走官方 `dsh plugin add`）
- `CHANGELOG.md` — 版本历史

## 🆕 已知问题

> 适用版本：插件 `v26.9.4` / Harness `0.1.2-rc.1`。

### 兼容性（Harness 0.1.2 破坏性变更 · 已适配）

`0.1.2-alpha.2` 曾打破的四项已在 `v26.9.4` 修复，并已对照 `0.1.2-rc.1` 的宿主实现核对：

- **新建会话**：`workspaces.startSession` 已移除，改走 `ctx.get('uiWorkspace')?.startSession()`，老宿主回退 `workspaces`。
- **orb 任务色**：`sessions` 改由 `ctx.inject(['sessions'], …)` 等宿主提供后再订阅，不再因 apply 期取空而卡在空闲绿。
- **沉浸模式**：会话头部按 `[data-slot="conversation.session.header"]` 命中（插槽渲染多包了一层，旧的 `[data-phase] > header` 静默失配），正文与输入栏按 `[data-conversation-scroll]` 一并隐藏。
- **⏻ 字形**：`.wesync-btn` 字体栈在宿主 `--dsw-font-family` 之后补 `'Segoe UI Symbol'` / `'Segoe UI Emoji'`，中英文仍走宿主字体，只有 U+23FB 落到符号字体。

服务查找一律改为"用到时再取"，`0.1.0-rc.6` ~ `0.1.2-alpha.1` 的行为不受影响。

### 环境限制

- **预览图不显示**：市场卡片缩略图指向 `raw.githubusercontent.com`，当前环境不可达。图片加载失败后 `onError` 隐藏显示。
- **WE 安装目录不存在**：自动检测到目录但不存在时壁纸同步不可用（市场功能不受影响），可在 `CONFIG.wallpaperEngineDir` 手动指定。

### 构建与维护（不影响已发布包）

- **`dwp-runtime-web/` 未纳入版本控制**：DWP 渲染运行时（`@dwp/web`）通过 `tsdown` 的本地路径 alias 在构建时内联进 `lib/client.js`，而该目录被 `.gitignore` 忽略、也不是 npm 依赖。**终端用户从 GitHub / npm 装的是已内联的预构建 `lib/`，不受影响、DWP 正常可用**；但**干净 clone 后 `pnpm build` 会因缺该目录而构建失败或静默产出坏包**——即"重新构建"目前只在存有 `dwp-runtime-web/` 的机器上可复现。计划：多人维护 / 上 CI 前，将其纳入 pnpm workspace 或改为 git-tag 依赖，并把 alias 兜底改为"缺目录即报错"。

## 📄 License

GPL-3.0
