# DeepSeek 日夜 1.3.1 页面动画

1.3.1 的侧边栏和主题切换修复需要本仓库追加源码或 [1.3.1 Release](https://github.com/YRN-playmaker/dwp-releases/releases/tag/deepseek-day-night-1.3.1) 附带的 `dsh-wallpaper_share-26.10.12-D-daynight-1.3.1.tgz`。早先 v26.10.12-D 安装包保留且不含修复，版本号相同也需重装本次配套包并重启。

配套插件最低版本为 **dsh-wallpaper_share 26.10.12-D**。DWP 保留原有日夜切换和两档纹理，并在 `scene.json → dsh.tabScene` 保存页面动画参数。人物与十张水花 PNG 都随 DWP 分发；客户端提供通用 `dsh/tab-scene/1` 渲染器。标准 DWP 播放器会忽略此扩展，继续显示日夜背景。

- 进入 `wallpaper_share` 后水体沿 U 型前沿展开；人物从水花第一帧开始下移并淡入，以先快后慢的速度到达目标。人物始终裁剪在已经展开的水体内，水花保持居中。
- 滚轮使人物略微下移、水色加深并扩大剪影范围。剪影不透明度为 75%，靠近屏幕上方的暖色渐变为 `#F7F4D4`，最高 30%。
- **水面光斑固定在屏幕顶端**，随滚轮下滑淡出，到滚动范围的 65% 完全消失；回到顶部恢复。`surfaceLight.scrollFadeEnd` 可在 DWP 中调整，合法范围为 `(0,1]`。水体颜色渐变仍保留小幅位移。
- 「完整」模式显示折射焦散和泡泡发光；泡泡经过人物时局部恢复原图细节。其它档位保留普通泡泡。焦散以移动水波的斜率折射光线，纹理以 24fps 缓存。
- 接近滚动底部时，屏幕下方显示圆点行列渐变。离开页面时水体回收并淡出，快速重新进入不会留下重复画布。
- 专注模式与「完整」同时开启时，页面背景以 1–4px 模糊呼吸。其它状态沿用背景模糊设置。减少动态效果时显示静态场景并继续响应模式切换。
- 主题补偿只在该页面生效；页面底色保持轻薄，卡片保留阅读对比。侧边栏使用人物剪影的同色系、单层且向页面边缘渐隐的遮罩；进入和退出时，侧边栏、页面底色与文字在 `exit.duration` 指定的时间内同步过渡。减少动态效果时立即切换。

构建与验证：`node _dev/make-daynight-dwp.mjs --no-install`、`node _dev/verify-daynight-dwp.mjs`、`node _dev/preview-daynight-dive.mjs`。浏览器回归用 `_dev/verify-daynight-dive.mjs`，可通过 `PLAYWRIGHT_MODULE` 指定 Playwright。

光学参考：[NVIDIA GPU Gems：Rendering Water Caustics](https://developer.nvidia.com/gpugems/gpugems/part-i-natural-effects/chapter-2-rendering-water-caustics)、[Evan Wallace：WebGL Water](https://madebyevan.com/webgl-water/)。实现使用项目自身代码。
