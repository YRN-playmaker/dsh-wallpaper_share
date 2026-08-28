# Changelog

## Unreleased

### ✨ 新增功能

- **"应用启动器"扩展为"壁纸库"**：原来只列出 `type=application` 的壁纸（新版 WE 不再支持应用类壁纸），现改为读取**全部类型**——场景（scene）/ 视频（video）/ 图片（slideshow）/ 应用（application）/ 网页（web），来源仍为 workshop + myprojects + defaultprojects + 自定义壁纸目录。
  - 后端：`/we-sync/apps` 每条记录新增 `type` 字段（归一化分类），响应新增 `counts`（各分类计数）；列表按标题排序。
  - 前端：新增类型筛选 chips（全部 / 场景 / 视频 / 图片 / 应用 恒显示，网页 / 其他 有内容时出现）、标题搜索框、缩略图左上角类型徽标、"共 N 个 · 匹配 M 个"计数与"显示更多 (+60)"分页；点击卡片仍在资源管理器中打开所在文件夹（保持只读，不执行任何程序）。
  - 生效方式：后端（`lib/index.js`）需重启 DSH；前端（`lib/client.js`）硬刷新页面即可。
- **原生 scene 渲染器 `we-capture.exe`（真·GPU 捕获，效果 100% 覆盖）**：新增 Rust 编写的原生捕获器，通过 Windows Graphics Capture 抓取 Wallpaper Engine 正在渲染的桌面窗口（WE 的 DX11 渲染窗口是 Progman 子窗口、WGC 不接受子窗口，故捕获其顶层根 Progman/WorkerW），BGRA→JPEG 按外部渲染器协议输出到 stdout。因为镜像的是 **WE 自身的渲染结果**，GLSL / SceneScript / 关键帧 / 粒子等**所有 WE 效果天然全覆盖**，无需在 JS 端复刻对面那套 ~500KB 软渲染引擎。DSH 侧 `probeRenderer` 自动发现随包 `bin/we-capture.exe`（或本地 `native/we-capture/target/release/`），`resolveSceneMode('auto')` 检测到原生渲染器即走 external、否则回退 browser。
  - 打包：`bin/we-capture.exe`（约 470KB，Windows-only）已加入 npm `files`；Rust 源码在 `native/we-capture/`（`cargo build --release` 可重建，含 `--selftest <秒> <输出文件>` 诊断模式）。
  - 边界：捕获会把**桌面图标**一并抓入（若显示图标，建议隐藏以获得干净背景）；WE 在全屏应用时默认暂停渲染→画面随之定格；镜像的是**当前激活显示器的壁纸**（正符合协议 `sceneTargetFor` 语义），浏览库内其它 scene 仍走 browser 预览；WE 未运行 / 找不到窗口时自动回退 browser。

### ⚡ 性能

- **原生捕获器编码器换成 SIMD 的 `jpeg-encoder`（1080p 编码 47→11ms）**：原先 `image` crate 纯软编 JPEG 在 1920×1080 下 ≈47ms/帧（占单帧耗时 ~90%，仅 ~6fps 且单核打满）。改用 `jpeg-encoder`（启用 `simd` / AVX2）后 1080p 编码降到 **11ms**、帧体积 322→164KB，整帧约 15ms（含回读 + 转换），默认恢复**原生 1920×1080 全清晰度**输出。同时保留按 `load` 请求分辨率的**盒式降采样**能力（4K 等高刷屏可下调省 CPU，经 `CONFIG.sceneRenderWidth/Height` 调节）。`[STATUS]` 心跳新增 `map_ms/conv_ms/enc_ms` 分阶段耗时画像，便于诊断。

### 🐛 修复

- **原生捕获器 stdin 关闭后单核 100% 空转**：控制命令内层循环的 `Disconnected` 分支只置 `running=false` 而未 `break`，`stdin_reader` 线程结束丢弃发送端后 `try_recv` 会永远返回 `Disconnected`，导致主循环死转、协议路径卡死。补 `break`（生产环境父进程关管道 / 发完 `stop` 时同样受益）。
- **静态 / 暂停壁纸被误判 stalled 反复重启**：`SceneAdapter.checkHealth` 原以「最近一帧」计时，静态或暂停的壁纸只发 `[STATUS]` 心跳、长时间无新帧，会被 4s 超时反复重启。改为取「最近帧 or 最近心跳」较大者判活（新增 `SceneRendererProcess.lastBeatAt`）。
- **切换壁纸泄漏 renderer 进程（卡顿主因）**：`setTarget` 先 `stopProcess()` kill 旧进程并置 `this.process=null`，紧接着 `start()` 把 `this.process` 指向新进程；但旧进程的 `'exit'` 事件是**异步稍后**才触发的，`onExit` 里无条件 `this.process = null` 会把**新进程**的引用清空，使新进程沦为无人跟踪的孤儿（仍在后台满负荷编码）。每切换一次壁纸泄漏一个 → 实测累积 11 个 `we-capture.exe` 同时跑、单核全被占满 → 整个壁纸与浏览器一起卡。修复：`onExit` 绑定退出的进程实例，仅当 `this.process === proc` 时才清理 / 重启；重启 `setTimeout` 亦加 `this.process === null` 守卫。
- **面板语言切换异常（首次打开 / 切换对话或轨迹后弹回英语）**：`useDshLocale` 读的 `ctx?.locale?.current` 不是 DSH locale 服务的真实 API（正确入口是 `ctx.get('locale').getLocale().active`），永远 undefined；兜底探测又只认 `<html lang>` 的 `en` 前缀，`zh-CN` 直接漏到 `navigator.language`（浏览器为 en-US 时）→ 每次挂载判成英语。而 `conversation.view` 是 session 作用域插槽，切会话 / 轨迹会重挂载面板，语言状态存在组件内部，于是"弹回英语"，只有在设置里切换语言触发 `<html lang>` mutation 才恢复。修复：apply 阶段软依赖 `ctx.get('locale')`，把 `getLocale().active` 同步进模块级 `store.locale` 并订阅变化（`store.notify()` 驱动已挂载面板即时重渲染）；面板改为渲染期 `resolveLang()` 直读 `store.locale`——重挂载读的是模块级权威值，不再重新探测。locale 服务不可用时兜底识别 `<html lang>` 的 zh / en 双向前缀。

## v26.08.29 — 2026-08-29

Wallpaper Engine scene 真实渲染适配的又一轮打磨：新增**昼夜自动切换（auto 模式）**与 **TEXS 序列帧动画解析**，并把骨骼动画修复推广到全部格式；同时修复了 spritesheet 频闪 / 丢帧、scene 图层渲染崩塌、以及雾/烟粒子浓度过浓等一系列共性问题。

### ✨ 新增功能

- **昼夜自动切换（auto 模式）**：识别 scene 图层 alpha 里的 SceneScript `engine.timeOfDay` + `smoothStep(START_HOUR, END_HOUR)`，按本地真实时钟 / 日出日落小时计算昼夜 alpha——夜间夜空层 alpha=1、白天隐藏（非昼夜脚本图层保持静态 alpha）。覆盖 2164591875 / 2785951913 / 3151551777 / 3774904326 等 4 个用真实时钟驱动昼夜的壁纸，跨午夜（日出 > 日落）同样支持。
- **TEXS 动画段解析（序列帧 / GIF 网格）**：`decodeTex` 完整解析 TEXS0001/0002/0003 帧表（每帧的纹理内像素矩形 + 时长），`DecodedTex.frames` 返回帧表；`/we-sync/scene/texture` 返回 `X-Sprite-Frames/Width/Height/Duration/Rects` 头，渲染端按时间取帧裁剪绘制。全库 8 个 spritesheet 材质纹理（2164591875 的 12/4 帧瀑布、2325500626 的 16 帧篝火、2022733184 的 32 帧星光、1438064333 的 64 帧、3774904326 的 3 帧昼夜切换等）全部验证可解析。

### 🐛 修复

- **烟雾 / 粒子浓度过浓（2804379697 雾等，共性问题）**：`ParticleRuntime.updateParticles` 里 `let a = hasAlpharandom ? 1 : p.spawnAlpha`——凡带 `alpharandom` 初始化器的粒子（雾 / 烟 / 雪等绝大多数），其随机不透明度（官方语义 "Alpha random: Defines the opacity of the particles"）被直接丢弃、顶成满 alpha=1。fog1 的 `alpharandom 0.15–0.2 × override.alpha 0.5 = 0.075–0.1` 被顶成 1，浓 **10 倍以上**，表现为浓白团块而非轻薄雾霭。修复：`a = p.spawnAlpha`（保留出生随机 alpha，fade / oscillate 仅在其上调制）。
- **alphafade 淡入淡出单位错误（粒子早期偏薄 / 上升沿错）**：`fadeintime/fadeouttime` 在 WE 中单位为**秒**（与粒子年龄 / 剩余寿命秒数比较），但代码拿 0-1 的寿命比例 `frac` 直接比较，把 `0.5s` 当成"50% 寿命"——雾寿命 3–5s 时淡入被拉长到 1.5–2.5s，远慢于 WE 的 0.5s，导致粒子长期停留在低 alpha、平均浓度偏低。修复：按每粒子 `maxLife` 把秒换算成比例（`fadeIn / p.maxLife`）再比较。
- **昼夜壁纸"白天 / 黑夜快速频闪"（2164591875 等）**：根因是**序列帧动画里混入了"空帧"**。夜空图层是 4 帧 spritesheet，其中一帧的 TEXS 矩形越界且采样区域全透明（alpha≈0）——播放到该帧时夜空图层瞬间变透明，底下的白天图层透出，于是每 0.4s（动画循环）闪一次"白天"，表现为"白天 / 黑夜快速衔接"。修复：`decodeTex` 解析 TEXS 帧表后，**通用剔除**矩形越界或不透明像素占比 < 5% 的空帧（不针对具体壁纸 ID），坏帧不再让图层闪空。
- **多页序列帧"丢帧"（2164591875 夜空只剩两帧循环）**：剔除空帧后夜空动画仍只有前两帧循环。根因是该纹理是**多 image 页（GIF 式）结构**（`imageCount=2`：image0 1024×1024 + image1 1024×512），TEXS 帧表的 `frameNumber` 字段指明每帧所属页——夜空第 4 帧 `frameNumber=1` 指向 image1。但解码器**只解码 image0 且忽略 frameNumber**，导致该帧被错误采样回 image0 的 (0,0)，与首帧完全重复 → 视觉上"只有前两帧循环"。修复：`decodeTex` 读取**所有 image 页**的 mip0，当帧引用多页时把各 raw 页**纵向拼成一张图集**并按 `frameNumber` 重映射每帧矩形 y 偏移，使渲染端"单图裁剪"模型可用。夜空图现输出 1024×1536 图集、3 个互不相同的有效帧（像素差实测 2.4–2.8）。
- **scene 非序列帧图层整层跳过（渲染崩塌）**：`renderScene` 里 `this.layerSprite.get(layer.id)` 对无 sprite 的普通 image 层返回 `undefined`，旧判断 `spr !== null` 未排除 `undefined`（`undefined !== null` 为 true），导致每个非 sprite 图层访问 `spr.frames` 抛 `TypeError`，被 draw() 的 try/catch 捕获后整层不绘制——表现为"背景 / 普通图层不显示，只剩先画的 puppet 层"。改为 `spr != null`（同时排除 null 与 undefined）。此 bug 影响大量无 sprite 的 scene 壁纸（2587542891、2804379697 等），是"只显示眉毛瞳孔而背景缺失"的根因。
- **scene 纹理序列帧动画（GIF / 切分图片网格）不播放**：`decodeTex` 此前只解析第一个 image 的 mip0，完全忽略 TEXS 动画段——切分图片动画壁纸只显示第一帧（静态）。现完整解析 TEXS 帧表并驱动渲染端按时间取帧裁剪（见"新增功能"）。
- **spritesheet 静态缓存排除**：带序列帧动画的图层不再进入静态背景离屏缓存（否则永远只画第一帧）。
- **骨骼旋转统一为欧拉角（全部格式）**：扫描 52 个 scene 壁纸中全部 47 个带 puppet 的壁纸，确认 MDLA0001（0013 格式）与 MDLA0006（0021/0023 格式）动画帧的旋转分量均可能 > 1（0023 最高 98.855，0021 有 28.199）——四元数 z 分量被限制在 [-1,1]，>1 证明**所有格式都是欧拉角**。老格式（0013）逐骨骼蒙皮已改为 `mat4TRSEuler`（T×R×S，R=Rz·Ry·Rx），睫毛弯曲等骨骼动画不再出现 180° 翻转与人物上下抖动。
- **动画检测覆盖所有骨骼（0013 老格式）**：此前只检查骨骼 0 的帧跨度，而骨骼 0 常为静态绑定姿势（跨度=0），导致整个动画被跳过；现遍历全部骨骼的关键帧，任一骨骼有变化即播放（瞳孔收缩 / 眼睑旋转等依赖骨骼 1+ 的动画恢复正常）。

### 📦 发布说明

- 包：`dsh-wallpaper_share-v26.08.29.tgz`（`pnpm pack` 生成，含 `lib/index.js`、`lib/client.js`、`lib/client.js.map`、`cordis.patch.yml`、`README*.md`、`LICENSE`、`tools/scene-renderer/`）。
- 生效方式：**前端改动**（`lib/client.js`：粒子浓度、昼夜 alpha、序列帧裁剪）硬刷新浏览器即可；**后端改动**（`lib/index.js`：TEXS 多页拼接 / 空帧剔除、昼夜脚本解析）需重启 DSH 进程。

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
