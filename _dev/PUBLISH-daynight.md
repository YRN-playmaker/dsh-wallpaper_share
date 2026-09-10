# 「DeepSeek 日夜」DWP 壁纸：状态与再发布

## 当前状态：**1.1.0 已发布到市场 ✓**（2026-09-10）

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
