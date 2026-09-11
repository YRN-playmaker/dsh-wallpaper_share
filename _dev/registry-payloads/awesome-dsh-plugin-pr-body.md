Adds one entry file for **dsh-wallpaper_share**, a Wallpaper Engine → DSH Web background bridge.

```yaml
url: https://github.com/YRN-playmaker/dsh-wallpaper_share
name: YRN-playmaker/dsh-wallpaper_share
category: theme
description:
  en: 'Syncs the wallpaper currently applied in Wallpaper Engine to the DSH Web UI background through a local bridge: preview/capture/full render modes, monitor lock, a wallpaper library panel for local and market content, focus lens with eye tracking, immersive mode, and a Windows app launcher that installs software from direct links or a cloud-drive share link and starts it with one click.'
  zh: '把 Wallpaper Engine 当前应用的壁纸经本地桥接同步为 DSH Web 界面背景：预览/捕获/完整三档渲染、显示器锁定、本地与市场壁纸库面板、专注透镜与眼动追踪、沉浸模式，以及支持直链与网盘分享链接安装、一键启动的 Windows 应用启动器。'
```

Requirements from contributing.md:

- [x] `package.json` declares a `dsh.bundle` manifest (`dsh.bundle.patch: ./cordis.patch.yml`) alongside `dsh.client`
- [x] `cordis.patch.yml` ships in the repo and installs a row (`id: we-sync`, `name: dsh-wallpaper_share`)
- [x] Repo carries the `dsh-plugin` topic (also `dsh`, `deepseek-harness`)
- [x] Real, working code — published on npm as `dsh-wallpaper_share` (latest 26.9.10), GPL-3.0
- [x] Repo older than 1 day

Category `theme` — the plugin's headline effect is the Web UI background/wallpaper surface (it also powers the panel for library, render modes and the app launcher).

Single entry file added; no other files touched. Thanks!