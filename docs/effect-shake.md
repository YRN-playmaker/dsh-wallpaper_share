# 图层效果：shake（眨眼/抖动）语义记录

> 来源：壁纸包内随附的官方效果文件（`effects/shake/effect.json`、
> `materials/effects/shake.json`、`shaders/effects/shake.frag|vert`）实测与逐行对照。
> 实现：`src/client/shake-math.ts`（波形）、`src/client/ShakeGL.ts`（WebGL 逐像素）、
> `src/client/Shake2D.ts`（CPU 回退）。解析：`src/scene/SceneModel.ts` 的 `parseLayerEffects`。

## 1. 官方 fragment shader 的完整语义

```glsl
float flowPhase = 0.0;
#if TIMEOFFSET
  flowPhase = texSample2D(g_Texture2, v_TexCoord.zw).r * M_PI_2;
#endif
vec2 flowColors = texSample2D(g_Texture1, v_TexCoord.zw).rg;   // 方向场（flowmask）
vec2 flowMask   = (flowColors.rg - vec2(0.498, 0.498)) * 2.0;

float time = g_Speed * g_Time + flowPhase;
offset = sin(frac(time / M_PI_2) * M_PI_2);
offset = offset * 0.498 + 0.5;
float base = step(0.0, cos(time));
offset = mix(1.0 - pow(1.0 - offset, g_Friction.x), pow(offset, g_Friction.y), base);
offset = saturate((offset - v_Bounds.x) * v_Bounds.y);          // v_Bounds.y = 1/(bounds.y-bounds.x)

vec2 texCoordOffset = offset * g_Amp * g_Amp * flowMask;        // g_Amp = strength
gl_FragColor = texSample2D(g_Texture0, texCoordOffset + v_TexCoord.xy);
#if MASK
  float mask = texSample2D(g_Texture3, texCoordOffset * v_TexCoordMask.zw + v_TexCoordMask.xy).r;
  gl_FragColor = mix(texSample2D(g_Texture0, v_TexCoord.xy), gl_FragColor, mask);
#endif
```

要点（每条都踩过坑）：

1. **`M_PI_2 = 2π`**（`assets/shaders/common.h`：`#define M_PI_2 6.28318530718`）。
   名字误导，实际基频周期是 `2π / speed` 秒，不是 π/2。
2. **`bounds` 是脉冲阈值**，不是位移范围。默认 `0 1` → 相当于连续摆动（offset ∈ [-1,1] 需配合
   `DIRECTION center`）；形如 `0.992 0.998` → 每个周期只在正弦峰值附近出现一个窄脉冲
   （达妮娅实测宽度 ≈0.22s），其余时间位移为 0。**"眨眼"就是这么做的**：
   用一个几乎处处为 0 的脉冲，把眼睛纹理沿方向场推开一帧，看起来就是闭眼。
3. **`DIRECTION` 是 combo**（编辑器选项）：`0 center → offset*2-1`、`1 left → 原样`、
   `2 right → offset-1`。
4. **`AUDIOPROCESSING` 打开时完全取代计时脉冲**：`offset` 初值为 0，然后
   `DIRECTION 0: += pulse`、`1: = 1-pulse`、`2: -= pulse`。本渲染器不做音频分析，
   按"有声音"（pulse=1）处理，即 DIRECTION=1 时位移 0（静止睁眼），避免永久闭眼。
5. **两个纹理槽位**：`g_Texture1` = 方向场（`mode:"flowmask"`，RG88），
   `g_Texture3` = 不透明度 mask（`mode:"opacitymask"`，R8，MASK combo）。
   **不透明度 mask 要按"位移后"的 UV 采样**（官方如此），否则边缘会出现硬切。
6. **RG88 解码语义**：`rgb = 第一通道 / alpha = 第二通道`（`_sample.rrrg`）。
   所以方向场 `x = .r`、`y = .a`（不是 `.g`）。R8 解码为 `rgb=255 / a=值` → mask 取 `.a`。
7. **纹理内容区域**：`.tex` 画布常大于图像（如 256×384 画布 / 201×355 图像），
   UV 必须按 image 尺寸比例映射；mask 纹理实测都是 image == 画布（无内边距）。

## 3. 实现注意：**不要依赖 `UNPACK_FLIP_Y_WEBGL` 处理 ImageBitmap**

WebGL 的 `gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1)` **对 `HTMLCanvasElement` 源生效、
对本渲染器实际使用的 `ImageBitmap` 源（`createImageBitmap(blob)`）在 Chrome 里被忽略**。
四色方向探针（8×8 图：左上红/右上绿/左下蓝/右下黄，走 GL 往返后读角点）实测：

| 源 | 输出角点 | 结论 |
| --- | --- | --- |
| 参考（Canvas2D 直接绘制） | TL 红 TR 绿 BL 蓝 BR 黄 | — |
| `ShakeGL` + canvas 源 | TL 红 TR 绿 BL 蓝 BR 黄 | 与参考一致（FLIP_Y 生效） |
| `ShakeGL` + ImageBitmap 源（修复前） | TL 蓝 TR 黄 BL 红 BR 绿 | **上下翻转（FLIP_Y 被忽略）** |
| `ShakeGL` + ImageBitmap 源（修复后） | TL 红 TR 绿 BL 蓝 BR 黄 | 一致 |

因此 `ShakeGL` 统一 **`UNPACK_FLIP_Y_WEBGL = 0`** 上传，方向换算写进着色器：
先把画布 UV（y 向上）转成**图像 UV（y 向下）**，再乘内容区域比例得到纹理 UV；
位移量在图像空间叠加（等价于官方 `v_TexCoord.xy + texCoordOffset`）。
这样与源类型及其行为差异无关。

**方向场解码还必须关闭 alpha 预乘与颜色转换**：`createImageBitmap(blob,
{ premultiplyAlpha: 'none', colorSpaceConversion: 'none' })`。`ImageBitmap` 上传也会
忽略 `UNPACK_PREMULTIPLY_ALPHA_WEBGL`，只在 GL 上传时设置 0 无法撤销默认预乘。
RG88 的 A 保存 y 数据；将中性 R≈0.498 乘上 A≈0.498 后变成 R≈0.248，
导致本应为零的 x 方向场变成约 −0.5。8 次 pass 累加会把整个人物横向推走。

**串联输入每帧更新**：静态 ImageBitmap 可缓存上传结果，上一 pass 输出的 canvas
则每帧重新上传到已有 GL 纹理，否则后续 pass 只看见第一帧。4K UV 使用高精度计算。
Canvas2D 超过像素预算时按比例降低采样分辨率，仍逐点采样方向场，再恢复原尺寸；
不使用平均方向代替局部形变。两条路径都裁掉方向场和 mask 的未用边距。

> `WaterwavesGL` / `NitroGL` 仍是 FLIP_Y=1 的旧约定；本机探针里
> `WaterwavesGL.render` 直接返回 null（实际走 Canvas2D 回退），所以这个隐患尚未爆发。
> 若后续启用这些 GL 通路，需按同样方式改造。

7. **同一图层可以有多个 shake，必须逐个 pass 串联**：官方把 `scene.json` 里列出的
   每个 effect 当成一次独立 pass，**上一个 pass 的输出是下一个 pass 的输入**。
   典型例子：`Ayanami Rei-凌波丽『night』`（3258032485）是**单张 4K 立绘 + 8 个 shake**
   （8 个方向场各覆盖一处头发/衣摆），只应用第一个就会丢掉大部分"毛发拉伸"。
   实现上 WebGL 需两个实例乒乓（同一张画布不能同时读+写），CPU 回退天然可串联。
   `bounds "0 1" + DIRECTION center` 时 offset 在 `[-1,1]` 连续摆动，所以这类壁纸
   看起来是"各处毛发随时间轻微拉伸/摆动"。

## 2. 观感量级与"看不到效果"的排查

位移量 = `offset × strength² × flowMask`（UV 比例）。以 `Ayanami Rei-凌波丽『night』`
（3258032485，单张 4K 立绘 + 8 个 shake）为例：方向场是 1920×1080 RG88，像素值集中在
127±(0–37) → `|flowMask|` 峰值 ≈ 0.29；`strength = 0.1` → `strength² = 0.01`，
所以**满位移 ≈ 0.29% 图层宽** = 3840 × 0.0029 ≈ **11 场景 px**（4K 屏约 11px、
1250px 宽预览约 3–4px）。8 个 pass 各自覆盖不同区域，观感是"整幅画面缓慢揉动、头发最明显"，
而不是大幅摆动；`t = 0` 时 offset 恰为 0，所以刚加载瞬间是静止的。

排查顺序（都能从浏览器控制台一行看出）：

| 控制台输出 | 含义 | 处理 |
| --- | --- | --- |
| `[scene:effect] 图层 #16 …：shake 生效 8/8 pass（方向场 flow…）` | 客户端与 node 半都是新版，效果已应用 | 正常 |
| `… 的 8 个 shake 都没有方向场字段（flow）——node 半是旧产物` | **只刷新了浏览器，没有重启 DSH**：旧模型 JSON 里 shake 只有 `mask`（= 方向场），没有 `flow`，客户端拿不到方向场 → 位移恒为 0 | 重启 DSH 进程后刷新 |
| `…：shake 方向场加载失败（N 个 pass 全部不可用）` | 纹理路由取不到方向场条目 | 查 `/we-sync/scene/texture?name=materials/masks/…tex` |

## 3. 达妮娅 Denia（3791428510）实测参数

场景 `objects[16]`（`09眼睛`）上挂了一个名为 **眨眼** 的 `effects/shake`：

```json
{"file":"effects/shake/effect.json","name":"眨眼","visible":true,
 "passes":[{"combos":{"DIRECTION":1},
            "constantshadervalues":{"bounds":"0.992 0.998","friction":"1 1","speed":1,"strength":0.4},
            "textures":[null,"masks/shake_mask_73999545",null,"masks/shake_mask_5bdd3707"]}]}
```

- 方向场 `shake_mask_73999545`：RG88，201×355；眼睛区域内 x≈+1（满量级）、y≈0 → 位移主要沿眼睛"闭合方向"。
- 不透明度 mask `shake_mask_5bdd3707`：R8，201×355；眼睛可见像素上均值 ≈0.86（大部分参与位移）。
- 满脉冲位移 = `offset(1) × 0.4² × flowMask` ≈ 0.16 UV ≈ **32 纹理像素**（场景 0.5 倍 → 屏幕 16px）。
- 节奏：周期 2π ≈ **6.28s**；脉冲宽度（offset>0.5）≈ **0.22s** → "每 6.28 秒眨一次眼"。
  用 `_dev/denia-compare.mjs` 可复现"修复前＝整层滑动 / 修复后＝闭眼眨眼"的对比图。

## 3. 验证手段（本次新增）

- 单测：`src/client/test/shake-math.test.ts`（波形/脉冲/摩擦/DIRECTION/音频/flowMask）、
  `src/client/test/shake-2d.test.ts`（局部方向场形变、mask 混合与大图缩小回退）。
- Chrome 像素回归：`node tools/test-shake-browser.mjs`（需要本机 Chrome，可传可执行文件路径），
  检查连续帧的串联输入、RG88 中性场不平移、4K CPU 回退的相反局部形变、alpha mask、
  内容区域裁剪、ImageBitmap 上下方向和 1 像素图层。
- 浏览器内 GLSL 对照：`node _dev/denia-gl-verify.mjs` 生成
  `_dev/denia-out/gl-verify.html`（把 `ShakeGL` 的 GLSL 与"官方公式的独立 JS 参考实现"
  逐像素对比，结果打印在 DOM 里，可用
  `chrome --headless=new --dump-dom --allow-file-access-from-files` 读回）。
  实测：offset=0 时 maxDiff=1（纯直通），offset 0.25~1 时 meanDiff ≤0.5/通道，
  差异只出现在抗锯齿边缘像素（参考实现走 canvas 读回、存在预乘往返损失）。
- 参考渲染对拍：`bin/we-capture.exe --selftest <秒> <out.bin> 0 0 0` 抓 WE 桌面帧
  （协议：`[4B len][1B format][4B w][4B h][payload]`，format=0 为 JPEG），
  再按矩形区域逐帧做差分/位移估计。注意 **WE 在"壁纸不可见/被最大化窗口遮挡"时会把
  场景时间冻住**（水波、粒子、眨眼全部静止，只有文字对象仍按系统时间更新），
  这种状态下抓到的帧只能验证静态合成，不能验证动画——对拍动画必须让桌面可见。
