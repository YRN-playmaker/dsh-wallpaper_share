# dsh-wallpaper_share

<div align="center">
  <a href="https://www.npmjs.com/package/dsh-wallpaper_share"><img alt="npm version" src="https://img.shields.io/npm/v/dsh-wallpaper_share" /></a>
  <a href="LICENSE"><img alt="GPL-3.0 license" src="https://img.shields.io/badge/License-GPL--3.0-blue.svg" /></a>
  <a href="https://github.com/YRN-playmaker/dsh-wallpaper_share"><img alt="GitHub version 26.10.6-D" src="https://img.shields.io/badge/GitHub-26.10.6--D-4d6bfe" /></a>
</div>

[English](README.md#english) · [双语 README](README.md)

<div align="center">
  <video src="https://github.com/user-attachments/assets/4461d385-de62-42be-8420-7edce5606f44"
         muted autoplay loop playsinline controls width="100%"></video>
</div>

<a id="中文"></a>
## 中文

把 Wallpaper Engine（WE）当前壁纸同步为 DeepSeek Harness（DSH）Web 界面的背景，在 `wallpaper_share` 标签页调整渲染模式、透明度、模糊、阴影、专注透镜与壁纸库。已适配 harness `0.1.5`。

同步功能读取 WE 状态，不更改桌面壁纸。安装目录会自动检测；眼动追踪在本机推理，摄像头画面不上传。

- [26.10.3 更新](#zh-update)
- [安装与升级](#zh-install)
- [渲染模式与窗口跟随](#zh-render)
- [功能与操作](#zh-features)
- [配置](#zh-config)
- [限制与排查](#zh-troubleshooting)
- [开发与验证](#zh-development)

<a id="zh-update"></a>
### 26.10.3 更新

- **捕获模式跟随窗口位置**：小窗口显示其在所选显示器上对应的壁纸区域，移动或调整大小时保持桌面比例；WE 暂停出帧时仍能查看最后一帧的对应区域。处理标题栏偏移、网页缩放与模糊留边。
- **完整模式人物形变修复**：修正 Ayanami Rei-凌波丽『night』等壁纸的方向场解码与多次 shake 效果串联，恢复局部毛发摆动，解决人物异常平移、动画停滞及部分画面翻转。
- **Rainy Day 雨滴优化**：修复俄文素材名加载、雨滴与法线图集错位、拖尾方向、旋转折射和透明度；跳过隐藏雨层，并减少无用轨迹记录与背景纹理分配。
- **捕获器与发布检查**：随包原生产物已重建；清单编码、入口文件与原生源码指纹在打包前检查，避免发出过期程序。

完整记录见 [CHANGELOG.md](CHANGELOG.md)。本仓库版本为 **26.10.6-D**；npm 的实际可用版本以页面徽章和注册表为准。

<a id="zh-install"></a>
### 安装与升级

需要 DSH Web profile。使用原生场景捕获时，还需要在同一台 Windows 电脑上运行 WE 并应用场景壁纸。

从 GitHub 安装本仓库版本：

```bash
dsh plugin --profile web add github:YRN-playmaker/dsh-wallpaper_share
```

其他来源：

```bash
# npm 当前版本
dsh plugin --profile web add dsh-wallpaper_share

# 自行打包的本地安装包
dsh plugin --profile web add ./dsh-wallpaper_share-26.10.6-D.tgz
```

安装或升级后，**重启 DSH Web profile 并刷新浏览器页面**。默认地址为 `http://127.0.0.1:3080`，实际端口以启动日志为准。仅刷新页面不会更新已加载的后端程序。

新会话的会话区会出现 `wallpaper_share` 标签页；在其中开启同步并选择渲染模式。多显示器可通过「背景显示器」锁定来源。安装包包含前后端及 Windows 原生程序，用户无需自行构建；`cordis.patch.yml` 会随插件安装接入 profile。

<a id="zh-render"></a>
### 渲染模式与窗口跟随

| 模式 | 场景壁纸（scene） | 适用情况 |
| --- | --- | --- |
| **预览**（eco） | 显示静态预览图 | 节省资源 |
| **捕获**（perf，默认） | 镜像 WE 正在渲染的桌面壁纸；不可用时回退浏览器渲染 | 使用 WE 自身的粒子、脚本和 shader 效果 |
| **完整**（enhanced） | 解析 `.pkg`，在浏览器中重绘图层、粒子与骨骼动画 | 不依赖 WE 持续运行；部分复杂效果仍有差异 |

「完整」是模式名称，浏览器渲染器仍是 WE 引擎的子集。

| 壁纸类型 | 预览 | 捕获 / 完整 |
| --- | --- | --- |
| `scene` | 静态预览 | 按上表选择原生捕获或浏览器渲染 |
| `video` | 静态预览 | 播放源视频，支持 HTTP Range |
| `web` | 静态预览 | 在 iframe 中加载源页面 |
| `image` | 静态预览 | 显示源图 |
| `application` / `other` | 静态预览 | 背景回退预览；应用可在壁纸库中管理 |

**窗口跟随仅用于原生 scene 捕获**，在运行 WE 的同一台电脑上生效。小窗口位于屏幕左侧就显示左侧区域，移到右侧就显示右侧区域。鼠标移入页面后自动校准标题栏偏移；全屏时显示整屏。跟随范围由「背景显示器」决定，跨屏使用时请选择对应显示器，窗口超出所选屏幕的部分不会拉伸补齐。

需要新版本捕获器和前后端同时更新。旧捕获器、静态预览及浏览器回退仍居中铺满。原生捕获失败时，场景背景依次回退为浏览器渲染、提取纹理、预览图；当前通路显示在面板副标题。

<a id="zh-features"></a>
### 功能与操作

- **视觉效果**：调整面板透明度、壁纸模糊和阴影；同步开关与渲染偏好会保存到本地。
- **专注透镜**：圆心清晰、圆外模糊，默认跟随鼠标；开启专注后，视觉浓度随任务状态调整。
- **眼动追踪**：可选摄像头推断视线，提供 9 点校准、文字吸附与抗抖动；首次使用需要联网加载模型并授予摄像头权限。关闭眼动或专注时释放摄像头。
- **沉浸模式**：快捷键切换（默认 `F11`，可在面板「快捷键设置」里改成任意按键）。开启时先切到新会话并隐藏会话界面、只留壁纸；再按一次、按 `Esc`，或点侧边栏任意按钮退出。
- **专注模式快捷键**：同样可自定义（默认 `F10`），与面板里的「专注模式」按钮等效。
- **壁纸库**：管理本地 DWP、WE 应用与启动器应用；市场支持搜索、筛选、安装与更新。管理模式支持多选卸载 DWP 和启动器应用，Steam 工坊内容不参与批量删除。
- **应用启动器**：支持 HTTP(S) 直链及 139 分享链接，导入 `.zip`、`.7z` 或 `.exe`；智能粘贴可从分享文本识别链接、提取码、解压密码和启动文件。应用在「本地 → 应用」启动，列表显示名称、位置与下载时间。
- **DWP 背景**：挂载自定义壁纸包后由 WebGL2 渲染，低配时回退 Canvas2D；挂载期间暂停 WE 同步。内置工作区脉搏可展示近期文件变化，支持昼夜变量与纹理档位。

**壁纸同步界面**

![壁纸同步界面](https://github.com/user-attachments/assets/6f147644-6283-456b-a9eb-c9c6d9925079)

**专注模式演示**

<img width="426" height="240" alt="专注模式演示" src="https://github.com/user-attachments/assets/57daf64c-ff2b-40c7-aeef-73cac46c4c2b" />

**壁纸库界面**

![壁纸库界面](https://github.com/user-attachments/assets/7567c226-7ea4-4fcb-a3b7-11190ee681ff)

**设置面板**

![设置面板](https://github.com/user-attachments/assets/7d652c07-8344-4de3-abbd-75620375c0b6)

截图用于介绍界面，具体布局以当前版本为准。

<a id="zh-config"></a>
### 配置

常用设置在 `wallpaper_share` 面板中调整。开发或自定义部署可修改 `src/index.ts` 顶部 `CONFIG` 后重新构建：

| 配置项 | 默认值 | 用途 |
| --- | --- | --- |
| `wallpaperEngineDir` | `''` | 自动检测 WE 安装目录，失败时手动指定 |
| `workshopContentDir` | `''` | 自动推导工坊目录 |
| `pollIntervalMs` | `2000` | WE 状态轮询间隔，毫秒 |
| `sceneRendererPath` | `''` | 自动发现随包捕获器，或指定外部 renderer |
| `wallpaperEngineAssetsDir` | `''` | 默认使用 `<weDir>/assets` |
| `sceneRenderWidth` / `sceneRenderHeight` | `1920` / `1080` | 捕获输出分辨率，低于原生尺寸时降采样 |
| `sceneRenderFps` / `sceneRenderQuality` | `30` / `80` | 目标帧率与 JPEG 质量 |
| `sceneRenderMode` | `'auto'` | 后端通路选择：`auto` / `browser` / `external` |
| `particleRateScale` / `particleSizeScale` | `1` / `1` | 浏览器粒子发射率与尺寸倍率 |
| `effectStrengthScale` | `0.6` | 浏览器图层效果强度倍率 |
| `puppetMeshRender` | `true` | 骨骼网格渲染 |
| `workspaceDir` | `''` | 工作区脉搏扫描根，默认插件进程工作目录 |
| `workspacePulseWindowMs` | `90000` | 工作区变化保留时长，毫秒 |
| `workspacePulseAutoInstall` | `true` | 自动安装内置工作区脉搏包 |

后端 `sceneRenderMode` 与面板的三档渲染按钮是不同设置。其余开发配置见源码。

<a id="zh-troubleshooting"></a>
### 限制与排查

- 原生捕获仅支持 Windows；捕获取的是桌面壁纸层，可能包含桌面图标。
- WE 暂停渲染时，捕获动画也暂停；窗口移动仍可重绘最后一帧。实际帧率受 WE 自身帧率、输出分辨率和编码耗时影响。
- 浏览器「完整」模式对复杂 shader、SceneScript 或特定效果的支持仍有限；需要匹配 WE 原始效果时优先选择捕获。
- DWP 挂载期间会暂停 WE 背景同步；眼动追踪依赖摄像头及浏览器安全上下文（localhost 或 HTTPS）。
- 市场和模型资源的网络加载可能失败；本地已安装内容不依赖市场缩略图加载。

出现背景空白、版本未更新或标签页缺失时：

1. 安装或升级后重启 DSH，并刷新页面。
2. 确认 `wallpaper_share` 标签页出现，检查浏览器控制台有无插件加载错误。
3. 查看 `/we-sync/diag` 的显示器、捕获器版本和当前渲染状态；捕获模式下确认 WE 已运行。
4. 安装目录检测失败时配置 `wallpaperEngineDir`；反馈问题时附上插件版本、harness 版本和错误信息。

<a id="zh-development"></a>
### 开发与验证

```bash
pnpm install --frozen-lockfile
npm run typecheck
npm test
npm run build
npm run check:package
npm run test:package
npm pack
```

修改原生源码后，在 Windows 上先运行 `npm run build:native`。原生版本与源码指纹必须和 `bin/` 程序一致；含非 ASCII 字符的工具链路径可能导致 GNU 链接器失败，可使用 ASCII 路径并配置 `RUSTUP_HOME` / `CARGO_HOME`。

Chrome 像素回归：

```bash
node tools/test-shake-browser.mjs
node tools/test-particle-browser.mjs
node tools/test-capture-browser.mjs
# Windows + WE 运行时：验证真实捕获帧
node tools/test-capture-browser.mjs --native
```

`lib/index.js` 和 `lib/client.js` 是随包预构建入口。面板版本由 `package.json` 在构建时注入，因此更新版本后必须重新构建。

- `src/scene/`：场景协议、捕获中继、素材解析与骨骼模型。
- `src/client/`：面板、背景层、图层效果、粒子与窗口裁切。
- `native/we-capture/`：Windows 捕获器源码；`bin/` 是随包程序。
- `vendor/dwp/`：DWP 运行时快照；`src/market/`、`src/launcher/` 管理壁纸库与应用。
- `docs/`：格式与实现记录，包括 [scene-fallback.md](docs/scene-fallback.md) 和 [effect-shake.md](docs/effect-shake.md)。

提交与打包前遵守 [AGENTS.md](AGENTS.md) 和 [编码与发布规范](docs/encoding-and-release.md)。`package.json` 必须为 UTF-8 无 BOM；发布验证应使用实际安装包，并确认新会话的前端标签可见。


## 许可

[GPL-3.0](LICENSE)
