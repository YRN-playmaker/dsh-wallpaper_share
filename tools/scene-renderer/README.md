# scene-renderer（参考 renderer / 协议契约）

`scene-renderer.mjs` 是 `dsh-wallpaper_share` 的 **参考 renderer**：它实现
`SceneAdapter` 约定的进程协议，用于端到端验证「scene.pkg → renderer 子进程 →
offscreen 帧 → Node 中继 → WebSocket → 浏览器 canvas」这条管线能稳定跑 30fps。

> ⚠️ **它不是真正的 Wallpaper Engine Scene renderer**。它输出的是按场景配色
> 生成的 RGBA 诊断动画，不是 `scene.pkg` 的真实渲染画面。真实 scene 渲染需要你
> 提供 renderer（见下文「如何接入真 renderer」）。

## 协议（与 `src/scene/SceneProtocol.ts` 一致）

**控制（stdin，换行分隔 JSON）**

```json
{"cmd":"load","scene":"C:\\...\\scene.pkg","assets":"C:\\...\\wallpaper_engine\\assets","width":1920,"height":1080,"fps":30,"quality":80}
{"cmd":"pause"}
{"cmd":"resume"}
{"cmd":"resize","width":2560,"height":1440}
{"cmd":"ping"}
{"cmd":"stop"}
```

**帧（stdout，二进制）**

```
[4B LE uint32 payloadLen][payload]
payload = [1B format][4B LE width][4B LE height][编码/像素字节]
  format: 0=JPEG  1=WebP  2=RGBA  3=BGRA
```

本参考 renderer 使用 `format=2`（RGBA）。真 renderer 建议输出 `format=0`（JPEG）
或 `1`（WebP）以降低带宽。

**状态（stderr）**

- `[VERSION]reference-0.1.0` — 启动时自报版本
- `[STATUS]{"fps":29.8,"frame":893}` — 每秒心跳
- 其余行 = 人类日志

## 运行方式

`dsh-wallpaper_share` 会用它**当前宿主 node 进程**直接执行本脚本
（`process.execPath` + 本文件），无需额外安装。也可手动测试：

```bash
node tools/scene-renderer/scene-renderer.mjs
# 然后粘贴一行 load 命令并回车
```

## 如何接入真 renderer

把 `CONFIG.sceneRendererPath` 指向一个实现了上述协议的独立可执行文件即可
（例如 WSL2 里封装的 linux-wallpaperengine 离屏渲染封装）。真 renderer 需要：

1. 读取 `scene`（scene.pkg）与 `assets`（WE engine assets 目录）；
2. 离屏渲染（不弹窗）到 framebuffer；
3. 把每帧按上面格式写到 **stdout**；
4. 响应 `pause/resume/resize/stop/ping`；
5. stderr 输出 `[VERSION]` 与（可选）`[STATUS]` 心跳。

只要遵守协议，`SceneAdapter` / 帧传输 / 浏览器 canvas / fallback / diag 全部无需改动。

## 许可证

本参考 renderer 为 MIT，可随 `dsh-wallpaper_share` 一起发布。真 renderer 若是
GPL，请作为**独立组件**由用户自行提供（`CONFIG.sceneRendererPath`），不要复制其
源码进本仓库，以保持主项目 MIT。
