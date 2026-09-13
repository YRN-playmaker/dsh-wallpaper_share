# dsh-wallpaper_share
已适配 harness 0.1.5
<!-- Hero -->
<div align="center">
  <b style="font-size: 1.15em;">把 Wallpaper Engine 的壁纸实时同步为 DSH Web 界面背景，并支持应用挂载和自定义壁纸导入</b><br /><br />
  <a href="https://www.npmjs.com/package/dsh-wallpaper_share"><img alt="npm version" src="https://img.shields.io/npm/v/dsh-wallpaper_share" /></a>
  <a href="https://www.npmjs.com/package/dsh-wallpaper_share"><img alt="npm downloads" src="https://img.shields.io/npm/dm/dsh-wallpaper_share" /></a>
  <a href="https://github.com/YRN-playmaker/dsh-wallpaper_share/stargazers"><img alt="GitHub stars" src="https://img.shields.io/github/stars/YRN-playmaker/dsh-wallpaper_share" /></a>
  <a href="https://opensource.org/licenses/GPL-3.0"><img alt="License: GPL-3.0" src="https://img.shields.io/badge/License-GPL--3.0-blue.svg" /></a>
  <a href="https://github.com/YRN-playmaker/dsh-wallpaper_share/releases"><img alt="插件版本 v26.9.13" src="https://img.shields.io/badge/v26.9.13-4d6bfe" /></a><br /><br />
  <img alt="壁纸同步" src="https://img.shields.io/badge/-%E5%A3%81%E7%BA%B8%E5%90%8C%E6%AD%A5-4d6bfe" /> <img alt="场景渲染" src="https://img.shields.io/badge/-%E5%9C%BA%E6%99%AF%E6%B8%B2%E6%9F%93-4d6bfe" /> <img alt="DWP 市场" src="https://img.shields.io/badge/-DWP%20%E5%B8%82%E5%9C%BA-4d6bfe" /> <img alt="眼动追踪" src="https://img.shields.io/badge/-%E7%9C%BC%E5%8A%A8%E8%BF%BD%E8%B8%AA-4d6bfe" /> <img alt="专注模式" src="https://img.shields.io/badge/-%E4%B8%93%E6%B3%A8%E6%A8%A1%E5%BC%8F-4d6bfe" /> <img alt="多显示器" src="https://img.shields.io/badge/-%E5%A4%9A%E6%98%BE%E7%A4%BA%E5%99%A8-4d6bfe" /><br /><br />
</div>

<div align="center">
  🌏 <a href="#中文"><b>中文</b></a> · <a href="#english">English</a> · 
</div>


把 Wallpaper Engine 的壁纸同步为 DeepSeek Harness Web 界面的背景，并支持调整渲染模式、视觉效果、专注模式与壁纸库外挂壁纸与直链应用下载。

> **纯显示同步**：只读取 WE 状态，不控制 / 不修改桌面壁纸。
> **无敏感信息**：代码不含 Steam 用户名 / SteamID / 令牌；WE 安装目录运行时自动检测（注册表 `HKCU\Software\WallpaperEngine\installPath` → 常见 Steam 路径），检测不到时才需要手动配置。眼动追踪全程本地推理，摄像头画面不出设备。

---

<a name="中文"></a>
# 中文

## 📑 目录

- [⚡ 30 秒上手](#-30-秒上手)
- [✨ 功能一览](#-功能一览)
- [🎨 渲染模式与兼容矩阵](#-渲染模式与兼容矩阵)
- [🖼️ Scene 渲染与回退](#-scene-渲染与回退)
- [🔍 专注模式与眼动追踪](#-专注模式与眼动追踪)
- [🌌 沉浸模式与任务指示](#-沉浸模式与任务指示)
- [🪟 桌面悬浮球](#-桌面悬浮球)
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

- **实时同步**：在 WE 切换壁纸后，harness页面背景会自动跟随为最新变化的壁纸，复数显示器时可手动锁定某台作为背景来源。支持三档渲染模式以调节能效表现：详见 [渲染模式与兼容矩阵](#-渲染模式与兼容矩阵)
<img width="1917" height="1018" alt="image" src="https://github.com/user-attachments/assets/6f147644-6283-456b-a9eb-c9c6d9925079" />

- **侧边栏沉浸模式**：一键隐去会话头部、正文与输入栏，让壁纸独占视野；网页 / 应用类壁纸在沉浸下可直接鼠标交互（详见[沉浸模式](#-沉浸模式与任务指示)）

- **桌面悬浮球**（Windows，默认关）：开启后，当你切走页签 / 最小化浏览器 / 切到别的应用时，桌面出现一个与侧边栏状态灯同款的环形按钮（颜色同步：绿空闲 / 蓝进行中 / 黄待授权），**单击即把 `http://127.0.0.1:3080/` 页面带回前台**（同窗口切到别的页签也能精确切回该页签）；可拖动记忆位置，右键 / 双击临时收起（详见[桌面悬浮球](#-桌面悬浮球)）

- **专注模式**：叠加一个圆心清晰、圆外模糊的阅读窗,以专注于任务，提升文字可读性；默认跟随鼠标，也可用摄像头推断注视点让透镜跟随视线；9 点校准、文字吸附、抗抖动
<img width="426" height="240" alt="Video Project 29" src="https://github.com/user-attachments/assets/57daf64c-ff2b-40c7-aeef-73cac46c4c2b" />

- **壁纸库**：按**本地**/**市场**/**应用启动器**分类。本地一栏管理已装内容——`dwp壁纸`（点击即挂载为全局背景，已挂载再点取消）与 `应用`（**大类**，下分 `we应用` 与 `应用`；点击卡片即启动，每次启动弹确认），带标题搜索、缩略图与计数；搜索框右侧的**「管理」**开关进入管理模式：卡片整体轻微晃动，**点卡片即多选**（选中项停住晃动、背景转蓝并打勾），选择条给出「已选 N / 卸载选中 / 清空选择」，可跨 `dwp壁纸` 与 `应用` 一次选完再统一卸载（确认弹层列出全部将被删除的项）；每张卡仍保留「打开源文件 / 卸载」单项操作，dwp 的「打开源文件」会在资源管理器里定位包文件——**卸载只对 dwp 壁纸与启动器装的应用开放**，WE 工坊内容点了只给提示、不参与多选（绝不删 Steam 内容）；市场一栏浏览 `dwp-registry` 目录，支持名称 / 作者搜索、标签筛选与安装 / 更新 / 卸载；**应用启动器**：支持用户粘贴 `http(s)` 直链（`.zip`/`.7z`/`.exe`，**加密压缩包填解压密码**）或部分**云盘分享链接**（如`yun.139.com/shareweb/#/w/i/…`，提取码填在提取码框），唤醒DSH 自动下载，解包并封装成**类 app 格式**（自动生成 `project.json` + 预览图卡片）入库；卡片只留「详细」按钮（安装时间 / 地址 / exe 文件，另含来源、SHA512、更新预览与多入口切换）——启动与卸载统一到「本地 → 应用」里做。不依赖 WE 运行、不受新版 WE 取消应用类壁纸影响。、
<img width="737" height="675" alt="image" src="https://github.com/user-attachments/assets/7567c226-7ea4-4fcb-a3b7-11190ee681ff" />


-**设置页面介绍↓**

| 卡片 | 内容 |
| --- | --- |
| **壁纸状态** | 壁纸名（标题行**右缘为插件版本号**，点击直达 GitHub 仓库）；下方副标题只承载诊断信息——scene 壁纸显示当前渲染通路（`场景 · 预览图 / 捕获 live 30fps / 浏览器模型渲染 / 回退：<原因>`），未应用壁纸时显示引导文案，其余类型整行不占；多显示器时出现「背景显示器」下拉；`⏻ 同步开启 / 关闭 / 暂停（DWP）` 三态按钮 |
| **视觉效果** | 三档渲染模式分段按钮；「桌面悬浮球」开关（在专注模式左侧，默认关；非 Windows 或缺 `bin/we-floater.exe` 时置灰）；「专注模式」及其展开条（眼动追踪 / 校准视线 / 文字吸附 / 实时状态）；透明度 · 模糊 · 阴影三个滑块（**专注开启时滑块隐藏**，改由任务态与透镜接管） |

<img width="841" height="667" alt="image" src="https://github.com/user-attachments/assets/7d652c07-8344-4de3-abbd-75620375c0b6" />

其他功能：
- **工作区脉搏（内置 DWP）**：新内置动态壁纸 `workspace-pulse`——把**当前工作区近期改动的文件**以最多 3 个浮动气泡呈现在背景上，右上角绿 `+` / 红 `−` 徽章标示该文件体积在增加还是减少（含新增 / 删除）。不依赖 git（未保存、二进制文件也能捕获）；点击挂载后实时更新，空闲时显示呼吸提示。首次启动自动入库，出现在 壁纸库→本地→dwp壁纸
- **DWP 壁纸与全局背景渲染**：`dwp/1.0` 协议包（纯文本 / solid / 粒子 / mesh 图层 + 12 种混合模式 + 3 种动画 + 11 种效果，确定性渲染）；挂载后经 WebGL2 真实渲染为 DSH 全局背景（低配 Canvas2D 降级），同时暂停 WE 同步避免冲突，刷新后自动恢复
- **设置持久化**：同步开关、渲染模式、显示器锁、三档渲染模式、专注 / 眼动等偏好写入 `localStorage`（键 `we-sync.settings`），刷新或重启 DSH 后自动恢复；沉浸模式等临时视图态与任务状态一律不落盘
- **自诊断路由** `/we-sync/diag`（仅本机可访问，含 scene renderer 状态与纹理提取结果）

## 🎨 渲染模式与兼容矩阵

面板顶部的三档切换决定壁纸如何呈现（按钮文字为 **预览 / 捕获 / 完整**，概念名 eco / perf / enhanced 用于 flash 提示与配置，默认 **捕获**）：

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

当前走的是哪一层，直接显示在面板副标题上；更细的状态在 `/we-sync/diag`。

**原生捕获器原理**：WE 的 DX11 渲染窗口是 Progman 子窗口、WGC 不接受子窗口，故捕获其顶层根 Progman / WorkerW，BGRA→JPEG 按外部渲染器协议输出到 stdout。因为镜像的是 **WE 自身的渲染结果**，无需在 JS 端复刻那套 ~500KB 软渲染引擎，效果 100% 覆盖。多显示器下顶层根窗横跨整个虚拟桌面，捕获器按锁定的那块 WPE 子窗矩形用 `CopySubresourceRegion` + `D3D11_BOX` 只回读目标屏区域再编码（换算经 `ClientToScreen` / `GetClientRect` 归一化，DPI 缩放非 100% 同样正确）→ 输出严格是单块屏。`bin/we-capture.exe`（约 540KB，Windows-only）随包发布，Rust 源码在 `native/we-capture/`（`cargo build --release` 可重建，含 `--selftest` 诊断模式）；DSH 侧 `probeRenderer` 自动发现，`sceneRenderMode='auto'` 检测到原生渲染器即走 external，否则回退 browser。

完整链路与各层实现见 **[docs/scene-fallback.md](docs/scene-fallback.md)**；pkg / 纹理 / puppet 格式见 **[docs/scene-format.md](docs/scene-format.md)**、**[docs/tex-format-findings.md](docs/tex-format-findings.md)**、**[docs/mdl-skinning-findings.md](docs/mdl-skinning-findings.md)**、**[docs/bone-pipeline-compare.md](docs/bone-pipeline-compare.md)**。

**骨骼动画（完整档）**：puppet 部件按 MDLS 绑定 + MDLA 逐骨骼动画做全骨骼链乘蒙皮，`animationlayers` 多层合成（普通层 mix / additive 层以自身帧 0 为参考 / rate 倍速 / 30fps），MDAT 具名锚点（含中文名）跟随骨骼最终世界位姿。26.9.8 定案 MDLA0006 连续流布局（骨骼窗口跨段延伸、每骨骼 +2 浮点漂移、fc+1 行含闭合行），并钳制末骨越界帧——修复人物每循环抽动一次与蒙皮异常形变（如 3465215190）；58 个本地 MDL 端到端校验（帧0≈bind + 闭环平滑度）全部通过。

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

## 🪟 桌面悬浮球

「视觉效果」卡片里的 **桌面悬浮球** 开关（Windows 专属，默认关，位于专注模式按钮左侧）。开启后，当 3080 页面不在前台时，桌面出现一个环形按钮：

- **外观与侧边栏状态灯一致**：深色圆盘 + 3px 状态色环（绿 `#22c55e` 空闲 / 蓝 `#3b82f6` 有任务在跑 / 黄 `#eab308` 等待授权），随任务状态实时变色；尺寸随系统 DPI 缩放（100% 缩放下 40px，与侧边栏球同款观感）。
- **单击即切回页面**：原生层用 UI Automation 在浏览器窗口里按标题匹配页签并 `SelectionItemPattern.Select()`，因此**同一个窗口里切到了别的页签**也能精确切回该页签，再把窗口带回前台。最小化的窗口会还原，**最大化的窗口保持最大化**（不会把窗口"强行窗口化"）。
- **不打扰**：`WS_EX_TOOLWINDOW`（不进任务栏 / Alt+Tab 列表）、圆形 region + 分层透明、显示用 `SW_SHOWNOACTIVATE`（不抢焦点）、指针为手型。
- **拖动记忆位置**：拖到哪存到哪（`~/.dsh/storages/we-sync-floater-pos.json`），下次直接出现在原位。
- **主动收起**：右键或双击 = 临时收起，直到你下次回到 3080 页面才会重新出现（离开期间不会反复弹）。

**实现方式**：新增原生程序 `bin/we-floater.exe`（约 310KB，Windows-only，Rust 源码 `native/we-capture/src/bin/we-floater.rs`，可用 `cargo build --release --bin we-floater` 重建）。进程由 node 半边**按需拉起**：页面隐藏才起进程挂球，回到前台 / 关闭页面立即收球并停进程（不常驻、不留桌面痕迹）；通信走 stdin 行协议（`show` / `hide` / `color` / `title` / `quit`），父进程退出即自毁，不留孤儿窗。页面侧经 `/we-sync/floater` 上报「开关 / 前后台 / 标题 / 状态色」，服务端按**页签 id 记账**（同一浏览器开多个 3080 页签时各自上报互不踩踏，有任一页签在前台就不挂球）。

**「切到后台」的判定**：页签被切走或浏览器最小化（`visibilitychange`），以及整个窗口被其他应用压住 / Alt+Tab 走开（`window blur`，400ms 防抖以避免系统小提示条抢焦点时闪一下）；回到前台（页签转可见 / 窗口重新获得焦点）即时收球。

**已知限制**：仅 Windows；依赖浏览器窗口类与页签标题可被 UIA 读到（Chrome / Edge / Firefox 实测可用）。

## 🚀 安装

> 前置：兼容 DSH Web `0.1.0-rc.6` 及以上（已在 `0.1.5` 验证，0.1.2 的破坏性变更已适配，剩余限制见下方「已知问题」），以 `dsh --profile web` 运行。

### 🎯 分档安装（按需选择）

| 档位 | 适合谁 | 安装命令 |
| --- | --- | --- |
| 🟢 **小白** | 不纠结版本，直接拉当前主流 Harness 环境的推荐版 | `dsh plugin --profile web add dsh-wallpaper_share` |
| 🔵 **rc（稳定版本）** | 适配 harness 为 rc 架构的推荐版本，新功能适配较慢 | `dsh plugin --profile web add dsh-wallpaper_share@rc010` |
| 🟡 **test（测试版本）** | 用于测试的版本，可能有未完成功能 | `dsh plugin --profile web add dsh-wallpaper_share@test` |

> 当前版本：**`26.9.13`**（GitHub `main` 分支）。本次带来 **桌面悬浮球**（Windows：页面切到后台 / 浏览器最小化时，桌面出现一个与侧边栏状态灯同款的环形按钮，单击即切回 3080 页面，可拖动记忆位置）；近期版本还带来：壁纸库「管理」多选批量卸载、应用启动器卡片化简为「详细」、面板三页滚动（含占位的「dwp创作」）、宿主输入框按页显隐、**DWP 时钟变量**与**纹理分档**（预览/捕获用低清、增强/完整用高清）；`26.9.12-rc` 移除百度网盘分享链接支持（云盘分享仅保留 139）并适配 harness `0.1.5`。

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
dsh plugin --profile web add ./dsh-wallpaper_share-26.9.13.tgz
#   本地 tarball 安装（26.9.13）
dsh plugin --profile web add github:YRN-playmaker/dsh-wallpaper_share#test
#   从 GitHub 安装 test 分支（测试档，功能最新但不稳定；正式取 main）
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
| `workspaceDir` | `''`（= 插件进程工作目录） | 工作区脉搏的扫描根目录 |
| `workspacePulseWindowMs` | `90000` | 工作区脉搏改动保留窗口（更早的改动从气泡流淘汰） |
| `workspacePulseAutoInstall` | `true` | 工作区脉搏内置包自动入库（卸载后重启会重装） |

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
- `src/client/` — 浏览器半（主题覆盖 / 背景层 / SceneCanvas / SceneModelRenderer 子集渲染器 / ParticleRuntime / GazeLens 眼动 / 专注透镜 / 沉浸模式 / wallpaper_share 面板 / library-model.ts 壁纸库分类与详情格式化 / floater-report.ts 桌面悬浮球上报）
- `src/workspace/` — 工作区脉搏（文件系统快照差分 + 内置 DWP 组包器；`_dev/make-workspace-pulse.mjs` 为手动打包脚本）
- `src/daynight/` — 「DeepSeek 日夜」组包器（两张全画布 PNG + `$night_alpha` 分层；`_dev/make-daynight-dwp.mjs` 打包并装入本地市场，`_dev/verify-daynight-dwp.mjs` 静态校验 + 昼夜链路自检）
- `src/floater/` — 桌面悬浮球 Node 半（`hub.ts` 多页签状态机 / `manager.ts` 子进程管理 / `routes.ts` `/we-sync/floater`）
- `native/we-capture/` — Rust 原生源码（`main.rs` Windows Graphics Capture → JPEG；`src/bin/we-floater.rs` 桌面悬浮球窗口）
- `bin/we-capture.exe` — 随包发布的原生捕获器（Windows-only）
- `bin/we-floater.exe` — 随包发布的桌面悬浮球（Windows-only，按需拉起）
- `docs/` — 格式规范与技术文档（`scene-format.md` / `scene-fallback.md` / `tex-format-findings.md` / `mdl-skinning-findings.md`）
- `tools/scene-renderer/` — 内置参考 renderer（实现协议契约；真·原生 renderer 以同协议替换之）
- `lib/` — 预构建产物（用户侧零构建）
- `install.ps1` — 可选一键安装脚本（走官方 `dsh plugin add`）
- `CHANGELOG.md` — 版本历史

## 🆕 已知问题

### 环境限制

- **预览图不显示**：市场卡片缩略图指向 `raw.githubusercontent.com`，当前环境不可达。图片加载失败后 `onError` 隐藏显示。
- **桌面悬浮球仅 Windows**：需要 Windows 宿主且随包携带 `bin/we-floater.exe`（非 Windows 或缺文件时面板开关自动置灰）。
- **WE 安装目录不存在**：自动检测到目录但不存在时壁纸同步不可用（市场功能不受影响），可在 `CONFIG.wallpaperEngineDir` 手动指定。

## 📄 License

GPL-3.0

---

<a name="english"></a>
# English

## 📑 Table of Contents

- [⚡ Quick Start](#-quick-start)
- [✨ Features](#-features)
- [🎨 Render Modes & Compatibility Matrix](#-render-modes--compatibility-matrix)
- [🖼️ Scene Rendering & Fallback](#-scene-rendering--fallback)
- [🔍 Focus Mode & Eye Tracking](#-focus-mode--eye-tracking)
- [🌌 Immersive Mode & Task Indicator](#-immersive-mode--task-indicator)
- [🪟 Desktop Orb](#-desktop-orb)
- [🚀 Installation](#-installation)
- [⚙️ Configuration](#-configuration)
- [📈 Performance & Known Limitations](#-performance--known-limitations)
- [📦 Project Structure](#-project-structure)
- [🆕 Known Issues](#-known-issues)
- [📄 License](#-license-1)

Syncs the wallpaper Wallpaper Engine is currently showing into the DeepSeek Harness Web UI background, and supports tuning render mode, visual effects, focus mode, plus external wallpapers for the library and direct-link app downloads.

> **Display-only sync**: it only reads WE state; it never controls or changes your desktop wallpaper.
> **No sensitive data**: the code contains no Steam username / SteamID / token; the WE install dir is auto-detected at runtime (registry `HKCU\Software\WallpaperEngine\installPath` → common Steam paths), manual config only if detection fails. Eye tracking runs fully locally — camera frames never leave the device.

## ⚡ Quick Start

```bash
dsh plugin --profile web add dsh-wallpaper_share   # or pick a tier in "Installation" below
# restart dsh (web profile), then open http://127.0.0.1:3080
```

You get three things:

1. the **page background** becomes WE's current wallpaper (follows switches within ~2s), with panels and cards floating on top;
2. a **`wallpaper_share` tab** above the conversation (next to Chat and Trajectory) holding every toggle;
3. a round status light on the left edge **when the sidebar is collapsed** (green / blue / yellow) — click it to enter immersive mode.

WE must be running with a wallpaper applied; otherwise the background stays empty and the panel shows "no wallpaper applied". Diagnostics: `http://127.0.0.1:3080/we-sync/diag` (localhost only; use the port printed at startup — 3080 by default).

> **Zero-config**: no API Key, no signup, no extra setup of any kind — install and go. (Note: the no-sensitive-data notice at the top is a privacy statement — the code contains no Steam username or token; you are never asked to provide one.)

## ✨ Features

- **Real-time sync**: after you switch wallpapers in WE, the harness page background follows the latest changed wallpaper automatically; with multiple monitors you can lock one as the background source. Three render modes are available to tune power draw — see [Render Modes & Compatibility Matrix](#-render-modes--compatibility-matrix)
<img width="1917" height="1018" alt="image" src="https://github.com/user-attachments/assets/6f147644-6283-456b-a9eb-c9c6d9925079" />

- **Sidebar immersive mode**: one click hides the session header, transcript and composer so the wallpaper owns the view; web / app wallpapers become directly mouse-interactive under immersion (see [Immersive Mode](#-immersive-mode--task-indicator))

- **Desktop orb** (Windows, off by default): when enabled, a ring button matching the sidebar status light appears on the desktop whenever you switch away from the tab, minimize the browser, or move to another app (colour synced: green idle / blue running / yellow awaiting approval); **a single click brings the `http://127.0.0.1:3080/` page back to the front** (it even selects the exact tab when you switched tabs inside the same window); drag to move it and the position is remembered, right-click / double-click to dismiss temporarily (see [Desktop Orb](#-desktop-orb))

- **Focus mode**: overlays a center-clear, edge-blurred reading window on the wallpaper to focus on the task and improve text readability; follows the mouse by default, or uses the webcam to infer the gaze point so the lens follows your eyes; 9-point calibration, text-line snap, anti-jitter
<img width="426" height="240" alt="Video Project 29" src="https://github.com/user-attachments/assets/57daf64c-ff2b-40c7-aeef-73cac46c4c2b" />

- **Wallpaper library**: grouped into **Local** / **Market** / **App Launcher**. Local manages what's installed — `dwp wallpapers` (click to mount as the global background, click again to unmount) and `apps` (a top category split into `WE app` and `App`; click a card to launch, with a confirm dialog each time), with title search, thumbnails and counts; the **Manage** toggle next to the search box puts the cards into an edit state — they jiggle, **clicking a card multi-selects it** (selected cards stop jiggling, turn blue and get a check mark), and the selection bar offers "selected N / uninstall selected / clear" so you can pick across `dwp wallpapers` and `apps` and uninstall them in one go (the confirm dialog lists everything that will be deleted); each card also keeps a per-item "open source file / uninstall" row — **uninstall is only offered for DWP wallpapers and launcher-installed apps**, WE Workshop content just shows a hint and cannot be selected (Steam content is never deleted); Market browses the `dwp-registry` catalog with name / author search, tag filters and **install / update / uninstall**; **App Launcher** only installs: it accepts pasted `http(s)` direct links (`.zip` / `.7z` / `.exe`, **fill the archive password for encrypted archives**) or some **cloud-drive share links** (e.g. `yun.139.com/shareweb/#/w/i/…`, passcode in the passcode field), wakes DSH to download automatically, unpacks and wraps them into **WE-app-style entries** (auto-generated `project.json` + preview card) in the library; each card keeps a "Details" button (install time / location / executable, plus source, SHA512, update preview and entry switching) — launching and uninstalling happen in Local → Apps. It does not require WE to run and is unaffected by newer WE versions dropping application wallpapers.
<img width="737" height="675" alt="image" src="https://github.com/user-attachments/assets/7567c226-7ea4-4fcb-a3b7-11190ee681ff" />

**Settings page↓**

| Card | Contents |
| --- | --- |
| **Wallpaper status** | Wallpaper name (the **plugin version sits at the right edge of the title row** and links to the GitHub repo); the subtitle below carries diagnostics only — for scene wallpapers it shows the active render path (`Scene · preview image / capture live 30fps / browser model render / fallback: <reason>`), a hint when no wallpaper is applied, and takes no row at all for other types; a "background monitor" dropdown appears with multiple monitors; the `⏻` button has three states — sync on / off / paused (DWP) |
| **Visual effects** | The 3-mode segmented control; the **Desktop orb** toggle (left of the focus button, off by default; greyed out on non-Windows or when `bin/we-floater.exe` is missing); the focus-mode button with its flyout (eye tracking / calibrate gaze / text-line snap / live status); opacity · blur · shadow sliders (**hidden while focus mode is on** — task state and the lens take over) |

<img width="841" height="667" alt="image" src="https://github.com/user-attachments/assets/7d652c07-8344-4de3-abbd-75620375c0b6" />

Other features:

- **Workspace Pulse (built-in DWP)**: a new built-in dynamic wallpaper `workspace-pulse` — shows **recently changed files in your workspace** as up to 3 floating bubbles on the background, each with a green `+` / red `−` badge at its top-right marking whether the file is growing or shrinking (covers additions / deletions too). No git dependency (unsaved and binary files are caught as well); updates live once mounted, with a breathing hint when idle. Auto-installed into the library on first startup — see Wallpaper library → Local → dwp wallpapers
- **DWP wallpapers & global-background rendering**: `dwp/1.0` protocol packages (text / solid / particle / mesh layers + 12 blend modes + 3 animations + 11 effects, deterministic rendering); mounting renders them as the DSH global background via WebGL2 (Canvas2D fallback on weak GPUs) while pausing WE sync to avoid conflicts, auto-restored after a refresh
- **DWP clock variables (a generic capability for wallpaper authors)**: every 2.5s the plugin feeds `hour` / `night_alpha` / `night_on` / `day_on` into **whatever scene is mounted** (`Handle.setParams` overwrites key by key, so it never clashes with the built-in Workspace Pulse variables); declare them in `variables` and reference them — the market package **"DeepSeek Day & Night"** uses `$night_alpha` to swap in a night image from 18:00 to 06:00 and back, with a 10-minute linear crossfade at both boundaries
- **DWP texture tiers (one wallpaper, two resolutions)**: `hd_on` / `night_sd` / `night_hd` are fed too, and the render mode picks the tier — **Eco / Perf = low, Enhanced = high**; a package lists what only the high tier needs in the scene-level extension field `dsh.hdAssets`, and the consumer stubs those with a 1×1 placeholder in the low tier, so the high-res textures are **never fetched or decoded** there ("DeepSeek Day & Night" 1.1.0 ships 1920×1080 / 7680×4320 tiers; switching tiers remounts with the new asset set)
- **Settings persistence**: sync toggle, render mode, monitor lock, the three visual sliders, focus / eye-tracking preferences are written to `localStorage` (key `we-sync.settings`) and restored after a refresh or DSH restart; transient view state such as immersive mode and task flags are deliberately not persisted
- **Self-diagnostic route** `/we-sync/diag` (localhost only; scene renderer status & texture extraction results)

## 🎨 Render Modes & Compatibility Matrix

The segmented control at the top of the panel decides how the wallpaper is presented (button labels **Preview / Capture / Full**; the conceptual names eco / perf / enhanced are used in flash messages and config; default is **Capture**):

| Mode | Meaning | Notes |
| --- | --- | --- |
| **Preview** (eco) | Static preview | Only WE's preview image; lowest cost; no animation |
| **Capture** (perf) | Capture WE desktop | scene uses the **native `we-capture.exe`**, mirroring WE's own rendered desktop → full effect coverage; falls back to browser rendering when WE isn't running |
| **Full** (enhanced) | Browser pkg render | scene uses the **browser subset renderer**, parsing `.pkg` and redrawing in-browser, independent of WE |

The matrix per wallpaper type (the three modes only truly differ for **scene**; for video / web / image, Capture and Full behave the same and both load the source):

| Type | Preview | Capture | Full |
| --- | --- | --- | --- |
| `video` | static preview | plays source video (HTTP Range, seekable) | plays source video |
| `web` | static preview | iframe loads source page | iframe loads source page |
| `image` | static preview | shows source image | shows source image |
| `scene` | static preview | **native WE desktop capture** (full coverage; falls back to browser when WE not running) | **browser pkg render** (WE-independent, subset) |
| `application` / `other` | static preview | static preview (viewable in the library) | static preview |

## 🖼️ Scene Rendering & Fallback

Priority and fallback chain for scene wallpapers under Capture / Full:

1. **Native capture (external)**: `we-capture.exe` detected and WE actively rendering → WS frame-stream live canvas (full coverage).
2. **Browser subset render (browser)**: parse `scene.json` layer tree + transform + decoded textures / particles / puppet into a canvas.
3. **Static textures**: extracted pkg textures as a base layer.
4. **Preview image**: if none of the above → WE preview.

Which layer is live is shown in the panel subtitle; finer state lives in `/we-sync/diag`.

**How the capture renderer works**: WE's DX11 window is a child of Progman and WGC rejects child windows, so it captures the top-level Progman / WorkerW root, converts BGRA→JPEG and emits frames over stdout via the external-renderer protocol. Because it mirrors **WE's own rendering**, no ~500KB JS reimplementation is needed and effects are 100% covered. With multiple monitors the top-level root window spans the whole virtual desktop, so the capture renderer crops to the locked WPE child-window rect via `CopySubresourceRegion` + `D3D11_BOX` before encoding (normalized through `ClientToScreen` / `GetClientRect`, correct under non-100% DPI scaling) → the output is strictly one display. `bin/we-capture.exe` (~540KB, Windows-only) ships in the package; Rust source in `native/we-capture/` (`cargo build --release`, with a `--selftest` mode); DSH's `probeRenderer` auto-discovers it and `sceneRenderMode='auto'` prefers external when found, else browser.

Full chain & per-layer implementation in **[docs/scene-fallback.md](docs/scene-fallback.md)**; pkg / texture / puppet formats in **[docs/scene-format.md](docs/scene-format.md)**, **[docs/tex-format-findings.md](docs/tex-format-findings.md)**, **[docs/mdl-skinning-findings.md](docs/mdl-skinning-findings.md)**, **[docs/bone-pipeline-compare.md](docs/bone-pipeline-compare.md)**.

**Bone animation (Full mode)**: puppet parts are skinned with full-bone chain multiplication from MDLS binds + per-bone MDLA animation; `animationlayers` composite (normal layers mix / additive layers reference their own frame 0 / rate multiplier / 30fps); MDAT named anchors (Chinese names included) follow the bone's final world pose. Version 26.9.8 pins down the MDLA0006 continuous-stream layout (bone windows span segment boundaries, +2-float drift per bone, fc+1 rows incl. a closing row) and clamps out-of-range tail frames — fixing the once-per-cycle twitch and skin deformation (e.g. wallpaper 3465215190); all 58 local MDLs pass the end-to-end check (frame 0 ≈ bind + closed-loop smoothness).

## 🔍 Focus Mode & Eye Tracking

- **Focus = lens master switch**: turning it on overlays a gaze-following lens (center clear, edges blurred). Global wallpaper blur is set to 0 while the lens is active; all blur is done by the lens layer's `backdrop-filter` (no double-blur cost). Follows the **mouse** by default (precise, zero latency).
- **Task-adaptive density**: while focus is on, the sliders are replaced by two presets — working `20% / 9px / 75%`, idle `9% / 6px / 40%` — with the lens circle further thickened per its own parameters.
- **Eye tracking (optional)**: lazily loads [WebGazer.js](https://webgazer.cs.brown.edu) (GPL-3.0, compatible with this project; bundles MediaPipe FaceMesh, ~12MB from CDN on first use, not in the base package) and follows your gaze via the webcam; no face / away (> 1.2s) falls back to the mouse. Turning off focus also stops tracking and releases the camera.
- **Calibration**: a 9-point guided sequence; the camera preview is shown only during calibration. Training data comes solely from calibration clicks (WebGazer's mouse sampling is disabled during tracking so mouse movement can't pollute the regression); samples persist, so you calibrate once.
- **Text-line snap** (on by default): the lens Y snaps to the nearest text line (via `Range.getClientRects`), X still follows, with hysteresis to avoid flapping between adjacent lines.
- **Anti-jitter**: deadzone + EMA — small high-frequency jitter is ignored, only large moves ease the lens.
- **Privacy**: fully local inference, frames never leave the device; `stopVideo()` releases the camera on off; only available on `http://127.0.0.1` (secure context).

## 🌌 Immersive Mode & Task Indicator

When the sidebar is **collapsed**, a 34px round light appears on the left edge (hidden while expanded, so it never takes space). It is both the status lamp and the immersive switch:

- **Color is state**: yellow `#eab308` awaiting approval > blue `#3b82f6` a task is running > green `#22c55e` idle. Approval is inferred from whether the approval panel is on screen; task state subscribes to the host's session-list snapshot (any session running, across workspaces, counts as busy).
- **Click to go immersive**: if the current session isn't a new one, it first asks the host to start one (`uiWorkspace.startSession()`), then fades out the session UI — header (title / breadcrumbs / tabs), the transcript scroll area and the composer — so the wallpaper owns the view.
- **The wallpaper becomes interactive**: web / app wallpaper iframes are raised and take pointer events, while the leftmost 56px stays free for the sidebar rail, so the sidebar and the lamp remain clickable.
- **Exiting**: click the lamp again, press `Esc`, or click any button inside the sidebar. Immersive is transient view state and is **never persisted** — a refresh returns to a normal layout instead of hiding your chat box.

## 🪟 Desktop Orb

The **Desktop orb** toggle in the "Visual effects" card (Windows only, off by default, sitting to the left of the focus-mode button). Once enabled, a ring button shows up on the desktop whenever the 3080 page is not in the foreground:

- **Looks like the sidebar status light**: a dark disc plus a 3px status ring (green `#22c55e` idle / blue `#3b82f6` running / yellow `#eab308` awaiting approval) that recolours live with task state; it scales with the system DPI (40px at 100%).
- **One click returns to the page**: natively it matches the tab by title through UI Automation and calls `SelectionItemPattern.Select()`, so it lands on the right tab **even when you switched to another tab in the same window**, then raises the window. A minimized window is restored; **a maximized window stays maximized** (it never forces the browser back into windowed mode).
- **Unobtrusive**: `WS_EX_TOOLWINDOW` (no taskbar / Alt+Tab entry), circular region with layered alpha, shown via `SW_SHOWNOACTIVATE` so it never steals focus, hand cursor on hover.
- **Remembers where you dragged it** (`~/.dsh/storages/we-sync-floater-pos.json`).
- **Dismiss on purpose**: right-click or double-click hides it until you next return to the 3080 page (it will not keep popping up while you are away).

**How it works**: a native helper `bin/we-floater.exe` (~310KB, Windows-only; Rust source in `native/we-capture/src/bin/we-floater.rs`, rebuildable with `cargo build --release --bin we-floater`). The node half spawns it **on demand**: the process only exists while the page is in the background — it starts, shows the orb, and is torn down as soon as you come back or close the page (nothing resident, no desktop leftovers). They talk over a stdin line protocol (`show` / `hide` / `color` / `title` / `quit`), and the helper self-destructs when its parent exits, so no orphan windows are left behind. The page reports "toggle / foreground state / title / status colour" to `/we-sync/floater`, and the server keeps **one record per tab id** — multiple 3080 tabs report independently without stomping on each other, and the orb only appears when *every* tab is in the background.

**"Went to the background" means**: the tab was switched away or the browser was minimized (`visibilitychange`), or the whole window was covered by another app / you Alt-Tabbed away (`window blur`, debounced by 400ms so a transient focus steal does not flash the orb). Coming back (tab visible again, or the window regains focus) retracts it immediately.

**Known limits**: Windows only; requires the browser window class and tab titles to be readable via UIA (verified with Chrome / Edge / Firefox).

## 🚀 Installation

> Requires DSH Web `0.1.0-rc.6` or newer (verified on `0.1.5`; the 0.1.2 breaking changes are adapted — remaining limits are listed in the "Known Issues" section below), run with `dsh --profile web`.

### 🎯 Pick your tier (install by need)

| Tier | Who it's for | Install command |
| --- | --- | --- |
| 🟢 **Beginner** | Don't fuss over versions — just grab the recommended build for the current mainstream Harness | `dsh plugin --profile web add dsh-wallpaper_share` |
| 🔵 **rc (stable)** | Recommended build for a Harness on the rc architecture; new features are adapted more slowly | `dsh plugin --profile web add dsh-wallpaper_share@rc010` |
| 🟡 **test (testing)** | For testing only; may contain unfinished features | `dsh plugin --profile web add dsh-wallpaper_share@test` |

> Current version: **`26.9.13`** (GitHub `main` branch). This release adds the **Desktop orb** (Windows: a ring button matching the sidebar status light appears when the page goes to the background or the browser is minimized — one click returns to the 3080 page, drag to move and it is remembered). Recent releases also brought: library "Manage" multi-select bulk uninstall, launcher cards reduced to a "Details" button, a third scrolling page (a placeholder "DWP Studio"), the host composer hidden per page, plus **DWP clock variables** and **texture tiers** (Eco/Perf = low-res, Enhanced = high-res). `26.9.12-rc` removed Baidu Netdisk share-link support (cloud-drive shares are 139-only) and adapted to harness `0.1.5`.

### 🔧 Other install methods

```bash
# From a Git clone (repo ships prebuilt lib/, no build needed):
git clone https://github.com/YRN-playmaker/dsh-wallpaper_share.git
cd dsh-wallpaper_share
pnpm pack                                        # → dsh-wallpaper_share-<version>.tgz
dsh plugin --profile web add ./dsh-wallpaper_share-<version>.tgz
```

```bash
# As an npm dependency (optional):
pnpm add dsh-wallpaper_share
```

```bash
# pick one:
dsh plugin --profile web add github:YRN-playmaker/dsh-wallpaper_share
#   install from GitHub (repo ships prebuilt lib/, no build permission needed; main = latest tier)
dsh plugin --profile web add dsh-wallpaper_share
#   install from npm (default = latest tier)
dsh plugin --profile web add ./dsh-wallpaper_share-26.9.13.tgz
#   install from a local tarball (26.9.13)
dsh plugin --profile web add github:YRN-playmaker/dsh-wallpaper_share#test
#   install the test branch from GitHub (test tier — newest features, may be unstable; use main for the release)
```

```bash
# restart dsh (web profile); the wallpaper_share tab appears
```

**No manual config editing**: the `cordis.patch.yml` referenced by `dsh.bundle.patch` is auto-added to the profile's bundle layer on install; one line is both the host line (node half: polling + HTTP routes) and the `dsh.client` roster line (the prebuilt `lib/client.js` browser half is auto-injected). The package ships prebuilt artifacts — zero build for users.

### Building from source (developers)

1. Copy this repo root (`package.json` / `src/` / `tsconfig.json` / `tsdown.config.ts`) into your DSH checkout at `packages/client/we-sync/`;
2. `pnpm install`
3. `pnpm --filter dsh-wallpaper_share exec tsc -b`
4. `pnpm --filter dsh-wallpaper_share bundle`
5. Artifacts land in `packages/client/we-sync/lib/` (`index.js` node half + `client.js` browser half); copy back to this repo's `lib/` and `pnpm pack`.

> You can also run `pnpm install && pnpm build` at this repo root (`tsdown` builds standalone, no DSH checkout needed).
> The version shown in the panel title row is injected at build time from `package.json` via a `tsdown` `define` — bump the version and **rebuild**, or the UI keeps showing the old one.
> Native capture: `cd native/we-capture && cargo build --release` (needs an `x86_64-pc-windows-gnu` or `-msvc` toolchain); copy the output to `bin/we-capture.exe`.

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
| `workspaceDir` | `''` (= plugin process cwd) | workspace root scanned by Workspace Pulse |
| `workspacePulseWindowMs` | `90000` | Workspace Pulse retention window (older changes drop out of the bubbles) |
| `workspacePulseAutoInstall` | `true` | auto-install the built-in Workspace Pulse package into the library (reinstalled after uninstall + restart) |

> The panel's 3-mode switch (Preview / Capture / Full) is a runtime UI setting, distinct from `sceneRenderMode` (backend browser / external selection).

## 📈 Performance & Known Limitations

**Performance**

- Native capture: SIMD `jpeg-encoder`, ~11ms per 1080p frame; defaults to 1920×1080@30fps, tunable in `CONFIG`.
- Preview only pastes a static preview (lowest cost); Capture / Full load animation.
- While the focus lens is active, global wallpaper blur is set to 0 (the lens layer does the blur), avoiding double-blur cost.

**Known limitations & boundaries**

- **Platform**: the native capture renderer is Windows-only (uses Windows Graphics Capture); elsewhere or when capture is unavailable, scene falls back to the browser subset renderer.
- **Desktop icons**: capture mirrors the desktop wallpaper layer, so icons are included (hide them for a clean background).
- **Fullscreen apps**: WE pauses rendering behind fullscreen apps, so the captured frame freezes.
- **Eye-tracking accuracy**: webcam + linear regression is ~±50–150px natively; with tight line spacing it may occasionally lock an adjacent line — mitigated by a large lens + hysteresis. Needs a camera + network to load the model; first use requires one calibration.
- **Browser subset renderer**: a subset reimplementation of WE's engine; some complex shaders/effects may be imperfect — use Capture (native capture) for 100% coverage.

## 📦 Project Structure

- `src/index.ts` — node half: WE polling, HTTP routes, scene renderer subprocess, library scan
- `src/scene/` — SceneAdapter modules (protocol / capability probe / renderer process / WebSocket / fallback / PKGV0001 parsing / SceneModel layer model / .tex decoding / puppet mdl parsing)
- `src/client/` — browser half (theme overrides / background layers / SceneCanvas / SceneModelRenderer / ParticleRuntime / GazeLens / focus lens / immersive mode / wallpaper_share panel / library-model.ts library categories & detail formatting / floater-report.ts desktop-orb reporting)
- `src/workspace/` — Workspace Pulse (filesystem snapshot diffing + built-in DWP packer; `_dev/make-workspace-pulse.mjs` is the manual packing script)
- `src/daynight/` — "DeepSeek Day & Night" packer (two full-canvas PNGs layered by `$night_alpha`; `_dev/make-daynight-dwp.mjs` packs + installs into the local market, `_dev/verify-daynight-dwp.mjs` static validation + day/night chain self-check)
- `src/floater/` — desktop orb node half (`hub.ts` multi-tab state machine / `manager.ts` subprocess management / `routes.ts` `/we-sync/floater`)
- `native/we-capture/` — Rust native source (`main.rs` Windows Graphics Capture → JPEG; `src/bin/we-floater.rs` desktop orb window)
- `bin/we-capture.exe` — shipped native capture renderer (Windows-only)
- `bin/we-floater.exe` — shipped desktop orb (Windows-only, spawned on demand)
- `docs/` — format & implementation docs (`scene-format.md` / `scene-fallback.md` / `tex-format-findings.md` / `mdl-skinning-findings.md`)
- `tools/scene-renderer/` — built-in reference renderer (implements the protocol contract; real renderers replace it)
- `lib/` — prebuilt artifacts (zero build for users)
- `install.ps1` — optional one-shot installer (official `dsh plugin add`)
- `CHANGELOG.md` — release notes

## 🆕 Known Issues

### Environment limits

- **Market thumbnails do not load**: catalog thumbnails point at `raw.githubusercontent.com`, unreachable in some environments; the `onError` handler hides them.
- **Wallpaper Engine directory missing**: when auto-detection resolves to a non-existent directory, wallpaper sync is unavailable (the market is unaffected) — set `CONFIG.wallpaperEngineDir` manually.
- **Desktop orb is Windows-only**: it needs a Windows host plus the bundled `bin/we-floater.exe`; elsewhere (or when the file is missing) the panel toggle greys itself out.

## 📄 License

GPL-3.0

## Development encoding rules / 开发编码规范

AI agents and contributors must follow [AGENTS.md](AGENTS.md) and [编码与发布规范](docs/encoding-and-release.md). Run `npm run check:package` before packaging.
