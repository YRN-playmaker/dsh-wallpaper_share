## 插件信息

| 项 | 值 |
|---|---|
| 插件名 | dsh-wallpaper_share |
| 仓库 | https://github.com/YRN-playmaker/dsh-wallpaper_share |
| **分类** | 🎨 主题皮肤（关键词命中「壁纸 / 外观」；插件主线是把当前壁纸同步为 Web 界面背景） |
| 一句话说明 | 把 Wallpaper Engine 当前应用的壁纸经本地桥接同步为 DSH Web 界面背景，并提供壁纸库面板、专注透镜/眼动追踪、沉浸模式与 Windows 应用启动器。 |

## 自检清单（提交前逐项确认）

- [x] 未占用 `@deepseek-ai/*` 保留命名空间 —— 发布名为 npm 上的 `dsh-wallpaper_share`（未加 scope；已在 npm 稳定发布至 26.9.10）
- [x] 仓库已打 `dsh-plugin` topic（同时带 `dsh`、`deepseek-harness`）
- [x] 已勾选 **Allow edits from maintainers**（PR 创建时已开启 maintainer_can_modify）
- [x] 所有运行时依赖已声明 —— `dependencies` 为空：host 侧只用 node 内置模块（`node:http`/`node:fs`/`node:crypto`/`node:child_process`），client 侧依赖宿主提供的 `@deepseek-ai/dsh-client-runtime` 与 `@deepseek-ai/dsh-client-ui-theme`（写进 `dsh.client.inject`）
- [x] 自检结果：

```text
$ dsh plugin --profile web ls
├── @deepseek-ai/dsh-root@link:../../../deepseek-harness/deepseek-harness
├── dsh-wallpaper_edit@link:D:/dsh/dsh-wallpaper_edit
└── dsh-wallpaper_share@link:D:/SteamLibrary/steamapps/common/wallpaper_engine/we-sync-github
3 packages

# 该 profile 中插件面板 wallpaper_share 正常工作（同步开关 / 三档渲染 / 壁纸库 / 启动器均可用）
$ pnpm test
tests 102 · pass 102 · fail 0
```

## 改动内容

`PLUGINS.md` → `## 🔌 单插件` 表格末尾追加一行：

```markdown
| dsh-wallpaper_share | [YRN-playmaker/dsh-wallpaper_share](https://github.com/YRN-playmaker/dsh-wallpaper_share) | Wallpaper Engine 壁纸同步为 DSH Web 背景（本地桥接）：预览/捕获/完整三档渲染、显示器锁定、本地与市场壁纸库（标题搜索、分页）、专注透镜与眼动追踪、沉浸模式、DWP 挂载；Windows 应用启动器支持直链与 139 网盘分享、加密 zip/7z 解包与一键启动（每次弹确认） | 待测 |
```

（未改动其他文件。）