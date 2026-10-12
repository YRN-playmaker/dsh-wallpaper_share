# 「DeepSeek 日夜」DWP 壁纸：状态与再发布

## 最新更新：1.3.1 已发布并收录（2026-10-12）

- 壁纸与修复后配套插件：https://github.com/YRN-playmaker/dwp-releases/releases/tag/deepseek-day-night-1.3.1
- 插件源码版本按要求保留 26.10.12-D，修复对应提交 47649f29b482c19e34f3ec5eb8b990e992a169bc；README.md / README.zh-CN.md 在该提交推送前已完善。
- 配套文件：dsh-wallpaper_share-26.10.12-D-daynight-1.3.1.tgz。旧 v26.10.12-D 的标签和资产保留且不含此次页面过渡修复；安装本次配套包后需重启 Harness，即使界面显示的版本相同也需重新安装。
- 市场更新已合并：https://github.com/YRN-playmaker/dwp-registry/pull/4；合并提交 98c65011c654acabc136f5e582c0f7f37ca0a18a。公开 catalog 已确认 1.3.1、下载地址、大小和校验值一致，其他两条市场记录保留。
- DWP：11,621,966 B；sha512-84b16e7QopjoucxlN95iJ78/hPBRrgYOdwVLLnGCYZkrDv4399jsXx8mTi/LpdZqadisqSXuIdGRJxBV7wHz0g==。
- 配套 tgz：897,236 B；sha512-8cdpWBzTEO1+pE2Dt1/MUi2EBUZz08Fjkt+36eErejyGLnKwmyT3vNPKegzTCmZLljWKKUKJmKEL3lPuTX8Z/A==。
- GitHub 上传和两个公开下载均校验成功。本地已安装日夜壁纸同步为 1.3.1，插件目录及构建产物为 26.10.12-D；未更新 npm 渠道。

1.3.1 调低 DWP 内侧边栏浓度，并配套修复通用渲染器：侧边栏同色渐隐、消除双重背景填充、深浅主题下维持标签可读；入水、退出、快速返回均逐帧混合主题颜色，新挂载的对话容器也继承过渡中的颜色。保留 1.3.0 的入水、水花、剪影、滚轮下潜、焦散、泡泡照明和专注呼吸。

验证环境：Windows、Node 24.19.0、独立 DSH_HOME 与独立用户目录内的 Harness 0.1.0-rc.6。实际安装上述 tgz 后确认插件 26.10.12-D、DWP 1.3.1、wallpaper_share 标签及真实 DWP 接口；深浅主题、侧边栏单层渐隐、入场中间帧、退出中间帧、对话返回、预览切完整、专注、滚轮光效淡出/恢复和退出清理均通过，无页面错误。216 项回归、9 项包检查、实际 tarball 和独立浏览器检查通过。

- Windows/Linux 源码 CI：https://github.com/YRN-playmaker/dsh-wallpaper_share/actions/runs/38233167814
- 市场 CI：https://github.com/YRN-playmaker/dwp-registry/actions/runs/38233321956

## 历史更新：1.3.0 已发布并收录（2026-10-12）

- 壁纸 Release：https://github.com/YRN-playmaker/dwp-releases/releases/tag/deepseek-day-night-1.3.0
- 配套插件 Release：https://github.com/YRN-playmaker/dsh-wallpaper_share/releases/tag/v26.10.12-D
- 源码已上传 main；发布包对应源码提交 `11aa7f9ddcce502b7acf1c4f3bab274f35e6bece`。
- 市场 PR #3 已更新为 1.3.0 并合并：https://github.com/YRN-playmaker/dwp-registry/pull/3；合并提交 `593bde40a62ef58d1fcb82e29fcd86c67f78322d`。公开 catalog 已回读确认版本、下载地址、大小与校验值一致，其他两条市场记录保留。
- DWP：11,621,528 B；`sha512-EsYjE+Sxzj8kHQXlCIUCOjEV3YnxIaITwFoNpNSNyKI+zkCUYlbGreDO1cIu0tUEby4xzhNY4rBGl4xkirjI3A==`。
- 插件 tgz：888,955 B；`sha512-a129Rfg2g3wO7a+O1lV4hyfe5CAau5hVHkGxjWZxW+FZb37972jSWdZ6btsptBLWTmtVRhlYuCSk3XfEUEegUg==`。
- 两个 Release 的所有公开下载均已回读并校验 SHA-512；未覆盖旧版本，未发布 npm。

页面动画需要插件 **26.10.12-D 或更新版本**。人物、水花与声明式参数位于 DWP 的 `dsh.tabScene` 扩展内，插件提供通用渲染器；旧版标准播放器继续显示日夜场景和 SD/8K 纹理。

本次包含 U 型水体展开、首帧人物入场与水阻减速、滚轮下潜、人物深度渐变、底部圆点和退出动画。「完整」状态开启水面折射焦散与泡泡局部照明；专注 + 完整启用 1–4px 呼吸模糊。水面光斑固定在顶端，下潜时淡出并在滚回顶部恢复。页面主题补偿覆盖宿主行内主题色，离开页面后恢复原主题。

验证环境为 Windows、Node 24.19.0、独立 `DSH_HOME` 中的 Harness 0.1.0-rc.6，安装的是实际 tgz。确认新会话的 wallpaper_share 标签、真实 DWP 接口、浅色/深色主题、返回对话再进入、预览切完整（含专注）、滚轮光效淡出/恢复、呼吸模糊和退出，无前端加载或渲染错误。216 项回归、9 项包检查、实际 tarball 检查通过；Windows/Linux CI 和市场 validate-and-build 均通过。

- 插件 CI：https://github.com/YRN-playmaker/dsh-wallpaper_share/actions/runs/38212830521
- 市场 CI：https://github.com/YRN-playmaker/dwp-registry/actions/runs/38212960883
- 重现真实安装验证：`node _dev/verify-installed-daynight.mjs http://127.0.0.1:4319`（先在独立 Harness 启动已安装包）。

## 历史更新：1.2.0（2026-10-09）

- Release 已上传并回读校验：https://github.com/YRN-playmaker/dwp-releases/releases/tag/deepseek-day-night-1.2.0
- 市场更新 PR：https://github.com/YRN-playmaker/dwp-registry/pull/3（后续更新为 1.3.0 并合并）
- 配套插件：dsh-wallpaper_share 26.10.9-D；选中侧边栏项显示缩小 10% 的深色游鱼，悬停仅蓝底，品牌按钮除外。效果在插件内嵌，升级 DWP 本身不会为旧插件增加侧边栏效果。
- 包内新增双语使用 / 升级说明，昼夜切换和两档纹理保持原样。
- integrity：sha512-6g+oF26Pey6vuLcJng+V0J1DrIcDwiM65H5fabS9jxUPcWC3QXajeSOBEFm0lhupf2li+faS4LBxrUKO860u4g==
- size：6,878,533 B
- 验证：DWP 编译、两档 × 9 时刻评估、7 项 DWP 测试、清单回归与市场校验通过；前端安装包生命周期测试使用模拟宿主接口，尚未完成真实 Harness 安装验收。npm 发布仍由维护者选择执行。

## 历史状态：**1.1.0 已发布到市场 ✓**（2026-09-10）

| 项 | 值 |
| --- | --- |
| 包（公开直链） | https://github.com/YRN-playmaker/dwp-releases/releases/download/deepseek-day-night-1.1.0/deepseek-day-night.dwp |
| Release | https://github.com/YRN-playmaker/dwp-releases/releases/tag/deepseek-day-night-1.1.0 |
| 预览图 | https://raw.githubusercontent.com/YRN-playmaker/dwp-releases/main/previews/deepseek-day-night.png |
| 收录条目 | `dwp-registry/entries/yrn.deepseek-day-night.yml`（PR #2 → squash 合并，main `aaa4f70`） |
| 线上 catalog | https://raw.githubusercontent.com/YRN-playmaker/dwp-registry/main/data/catalog.json（3 条，`version: 1.1.0`） |
| 本地安装 | `~/.dsh-dwp-market/packages/yrn.deepseek-day-night.dwp`（+ `installed.json`） |
| integrity | `sha512-plsStV35xLY2gsNtuENVvrj77X4UimWQdvFK0KqToD/jxP/NPi5WFK7HxctyFrnlPB325lNi0lDXHgcLudvWtw==`（上传后回读校验一致） |
| size | 6 877 667 B（6.9 MB：低档两张 2 张 + 8K 两张） |

内容：**同一张壁纸两档纹理**——渲染模式「预览 / 捕获」用 1920×1080（`assets/day.png` / `night.png`），
「增强 / 完整」用 7680×4320（`assets/day_hd.png` / `night_hd.png`）；昼夜仍是 18:00–06:00 夜景、
边界前后各 10 分钟过渡。低档位由消费端把 `dsh.hdAssets` 里的资源换成 1×1 占位图，**不下载也不解码 8K**。

历史版本：1.0.0（仅 1920 单档）→ Release `deepseek-day-night-1.0.0`，条目由 PR #1 合入（main `ec48719`）。

想在所有人的「壁纸库 → 市场」里撤下：`git -C dwp-registry revert aaa4f70` 后 push（本地已装的库不受影响）。

## 换图 / 改数据后重新发布

```bash
node _dev/make-daynight-dwp.mjs        # 低档默认 Downloads/deepseek212.png + deepseek221.png
                                       # 高档默认 Downloads/deepseek212 (1).png + deepseek221 (1).png
                                       # 可用 --day/--night/--day-hd/--night-hd 指定别的图
node _dev/verify-daynight-dwp.mjs      # 静态校验 + 「时刻 × 档位」四个 alpha 的链路自检
# 把新 sha512 / size 填回 dwp-registry/entries/yrn.deepseek-day-night.yml（打包脚本会打印这两个值）
cd dwp-registry && node src/cli.ts build     # 重建 catalog
pwsh -File _dev/publish-daynight.ps1         # 需要 GH_TOKEN；用 -Version/-Tag 覆盖默认的 1.1.0
```

`publish-daynight.ps1` 做了：传预览 → 建/复用 Release（同名资产先删再传）→ **回读下载校验 sha512** →
在 registry 建分支提交条目与 catalog → 开 PR。任一步失败都不会继续往下写，可重复执行。
（1.1.0 就是用它发的；PR 合并前等 CI `validate-and-build` 变绿。）

## 四个坑（已踩过）
1. **脚本必须保持纯 ASCII**：这台机器上 harness 的 shell 是 Windows PowerShell 5.1，它把无 BOM 的 UTF-8
   `.ps1` 当 GBK 读，中文会变成乱码并导致 `Unexpected token` 解析失败。所以说明文字都放在本 md 里。
2. **DSH 的文件沙箱 runner 会被卡巴斯基 PDM 误报**（`PDM:Exploit.Win32.Generic`，对象是
   `deepseek-harness\packages\sandbox\sandbox-windows-acl\lib\runner.js`）——它本职就是用受限令牌
   `CreateProcessAsUser`，属于行为启发式的典型误判。被拦期间 harness 里所有 shell 命令都会 `spawn EPERM`。
   可用的绕开方式（侵入性由低到高）：① GUI 里把会话权限从 `Workspace Write` 切成 `Full Access`
   （DSH 文档说明 full access 的调用不受限运行、不 spawn 该 runner）；② 给该路径加卡巴斯基排除项；
   ③ 自己在普通终端跑本目录脚本（完全不经过 DSH 沙箱）。
   另外在这个沙箱里 `workspace-write` 模式**不出网**，访问 GitHub API 需要 full access。
3. **顶替高档纹理的占位 PNG 必须是合法 PNG**：`@dwp/web` 的 `loadAssets` 对缺失资源直接抛错，
   低档位只能"给个 1×1 占位图"而不是"不给"。手抄的 base64 曾抄坏一次（zlib 校验和不过 →
   `createImageBitmap` 报 `The source image could not be decoded`）；现在字节由本仓库编码器生成，
   并由 `src/client/test/tiny-png.test.ts` 逐块校验 CRC 与可解压性。
4. **发新版后别急着在市场点"更新"**：catalog 挂在 `raw.githubusercontent.com` 上，CDN 约 5 分钟才刷新。
   2026-09-10 刚发布 1.1.0 时点了"更新"，目录里还是 1.0.0 的条目 → 按目录 URL 把 1.0.0 又装了回来，
   表现为"切到完整模式没反应"（旧场景只有两层，没有档位图层）。已加三道保护：目录缓存 5 分钟 TTL、
   「刷新」按钮强制重拉（带 cache-buster）、卡片在"目录比本机旧"时显示**本地更新**而非"更新"、
   node 半 `/install` 对降级返回 409（除非 `force=1`）。
   排障口诀：`GET /we-sync/dwp/manifest?id=<id>` 看 `version`，`GET /we-sync/dwp/scene?id=<id>` 看
   `layers` / `dsh.hdAssets` / `variables` —— 与包内实际内容对不上，就是装错版本了。

## 相关文件

- `src/daynight/pack.ts` — 组包（两档四层图 + `$hd_on` / `$night_sd` / `$night_hd`，scene 顶层声明 `dsh.hdAssets`）
- `src/client/clock-vars.ts` — 时钟 + 档位变量（含 ±10 分钟软过渡、四组合的 alpha 乘积）
- `src/client/index.ts` — 每 2.5s 喂变量（`feedClockVars`）+ 渲染模式 → 档位（`qualityOf`）
- `src/client/dwp-stage.ts` — 低档位把 `dsh.hdAssets` 换成占位图；`src/client/tiny-png.ts` — 占位图字节
- `_dev/make-daynight-dwp.mjs` / `_dev/verify-daynight-dwp.mjs` / `_dev/publish-daynight.ps1`
