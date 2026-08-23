# Changelog

## v26.0822T (0.2.0) — 2026-08-22

Wallpaper Engine 场景真实渲染适配（test 分支发布版）。本版聚焦 puppet 部件网格渲染的正确性，并修复粒子纹理、图层效果与骨骼动画的系列共性问题。

### 🐛 修复

- **puppet 部件"炸开"**：开启 `puppetMeshRender` 网格蒙皮渲染。此前带 puppet 的图层回退为整张立绘 image 显示，部件位置/形状错乱；现改为按部件顶点网格渲染（与参考渲染逐像素一致），部件各就各位。
- **网格 UV v 方向自适应**：按顶点 y 与 UV.v 的 Pearson 相关性自动判断是否翻转（Miku / asuna / 草等实测均为负相关 → 不翻转），替换原先硬编码的 `v' = 1 - v` 翻转，消除纹理上下错位。
- **buildMeshCanvas 三角形绘制**：修复 v 方向计算在"不翻转"分支产生负值的问题（仿射 UV→pos 变换现与参考重心法渲染 0 像素差异）。
- **粒子纹理解码语义**：RG88 按官方 `_sample.rrrg` 语义解码（rgb = R 灰度、alpha = G），R8 按 `vec4(1,1,1,r)`，粒子形状/透明度不再错乱（雾/风效果确认优化）。
- **粒子染色**：补齐官方 `color.rgb *= g_Overbright`（fog/wind 材质强度 1.8）；colorrandom 无 max 时固定为 min 色，不再随机乱色。
- **shake 效果**：按官方语义改为标量 `sin(speed×t)` 波形 × flow 方向场（direction map 平均方向）的单向位移，替换错误的圆周/利萨如平移。
- **图层效果 visible 过滤**：布尔 `false` / `{value:false}` 跳过；SceneScript 脚本条件（如 shownight）无法评估时保守跳过，避免误应用到无关图层。
- **骨骼动画**：动画周期改用 MDLA 真实时长（此前硬编码 3 秒导致幅度/节奏异常）；纹理版部件旋转锚点改为骨骼 0 bind 位置（绕骨骼原点而非图层中心）。

### ✨ 新增

- **waterwaves WebGL 逐像素扰动**：独立实现官方 shader 的数学语义（传播方向 `(-sinθ, cosθ)`、扰动方向 `(cosθ, sinθ)`、`sign(sin)^exp × |sin|^exp × strength²` 偏移、mask 限制），支持多个 waterwaves 叠加；WebGL 不可用时回退 Canvas2D 条带近似。
- **图层效果强度全局缩放**：新增 `effectStrengthScale` 配置（默认 0.6），统一校准 waterwaves / shake 等效果幅度。
- **Puppet 解析完整化**：支持 MDLV stride-80 顶点、MDLS0003（变长骨骼定义 + 属性块）/ MDLS0004、MDLA 动画时长、MDAT 具名骨骼锚点、MDLE 姿势矩阵。

### 🔧 其他

- 场景纹理接口返回 image 内容区域尺寸（X-WE-Image-W/H），浏览器端按内容区域正确裁剪。
- 粒子软边遮罩仅作用于 <128px 点状纹理（雪花/光点），不再破坏大片雾/风纹理的自带羽化形状。

### 📦 发布说明

- 包：`dsh-wallpaper_share-v26.0822T.tgz`（`pnpm pack` 生成，含 `lib/index.js`、`lib/client.js`、`lib/client.js.map`、`cordis.patch.yml`、`README.md`、`LICENSE`、`tools/scene-renderer/`）
- 安装方式：将 tgz 上传 Release 后通过 DSH 插件安装器 / `pnpm add` 安装；或直接替换已安装目录下的 `lib/` 产物。

## [0.2.0] - 2026-08-16

### Renamed

- 插件名由 `we-sync-dsh` 改为 `dsh-wallpaper_share`，与 GitHub 仓库名（`YRN-playmaker/dsh-wallpaper_share`）保持一致（`package.json` / `cordis.patch.yml` / 模块加载器 id / LICENSE / 安装脚本 / README）。
- The package was renamed from `we-sync-dsh` to `dsh-wallpaper_share` to match the GitHub repository name.

### Fixed

- **启动崩溃**：`execFileSync` 原先从 `node:fs` 导入（实际属于 `node:child_process`），ESM 实例化时直接抛 `SyntaxError`，导致整个 web profile 插件树加载失败。现拆分为两个独立 import。
  - `execFileSync` was imported from `node:fs` instead of `node:child_process`, crashing the web profile plugin tree at ESM instantiation. Split into two correct imports.
- **scene 壁纸增强模式黑屏**：回退逻辑要求 `sourceKind === ''` 才显示预览，scene 的 `sourceKind='scene'`（非空）既不显示预览也不走 video/web 分支，被 `setMedia(null)` 清空 → 纯黑屏。
  - Enhanced mode rendered a black screen for scene wallpapers: the fallback only showed the preview when `sourceKind === ''`, but scene reports a non-empty kind.
- **image 壁纸增强模式黑屏**：增强模式下 image 源未接入，同样落入空媒体分支。
  - Enhanced mode also black-screened image wallpapers for the same reason.

### Added

- **scene 纹理提取**：新增 `scanPkgImage()` 扫描 `scene.pkg`（WE 私有 PKGV 容器）内嵌 JPEG/PNG 纹理的 mipmap 链，取最大一张；新增 `/we-sync/scene` 路由用字节切片流式返回。
  - Added `scanPkgImage()` to scan the embedded JPEG/PNG mipmap chain inside `scene.pkg` and a `/we-sync/scene` route that streams the extracted texture by byte slice.
- **HTTP Range 支持**：`serveFile` 新增 `parseRange()` / `serveSlice()`，支持 `Accept-Ranges`、206 Partial Content（`Content-Range` / `Content-Length`）、416 越界、200 全量；视频（尤其 moov 在文件尾的 mp4）可正常 seek。
  - Added HTTP Range support (`parseRange()` / `serveSlice()`) so videos (especially mp4 with moov at the end) can seek normally.
- **自诊断增强**：`/we-sync/diag` 与 `/we-sync/state` 现在返回 scene 纹理提取结果（`sceneImage` 的尺寸 / MIME / 是否可用）。
  - `/we-sync/diag` and `/we-sync/state` now report scene-texture extraction results.

### Compatibility matrix (enhanced mode)

| Wallpaper type | Enhanced-mode behavior |
| --- | --- |
| `video` | plays the source video (Range supported) |
| `web` | loads the source page in an iframe |
| `image` | shows the source image |
| `scene` | shows the extracted pkg texture (falls back to preview only on extraction failure) |
| `application` / `other` | falls back to the static preview |

## [0.1.0] - 2026-08-16

- 首个发布版本（原名 `we-sync-dsh`）：实时同步、多显示器、视觉滑块、专注模式、渲染模式（性能/增强 video+web）、同步开关。
- Initial release (as `we-sync-dsh`): live sync, multi-monitor, visual sliders, focus mode, render-mode toggle, sync toggle.
