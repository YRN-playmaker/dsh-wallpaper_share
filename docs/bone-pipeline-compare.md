# 骨骼渲染管线对比：dsh-wallpaper-engine（上游参考）vs 本项目完整模式

> 参考对象：`elysia395/dsh-wallpaper-engine`（本地克隆 `_compare/dsh-wallpaper-engine`，基线 ff363e2 → 最新 6034868）。
> 其"更新后的管线"核心 = 2026-08-24/25 的 WE 跨平台渲染引擎复刻（PR #47）：
> `lib/we-renderer/`（puppet.js 骨骼蒙皮 + core.js 锚点绑定），配套逆向记录 `docs/WE-REVERSE.md`。
> 本文聚焦**骨骼部分的渲染与绑定**；粒子、GLSL 效果解释器等不在本次范围。
> 本地代码核对结论（初稿）：PuppetSkin.ts ✓；ScenePuppet.ts ①⑨；SceneModel.ts ②⑥⑦⑧；SceneModelRenderer.ts ③④⑤⑩。

## 0. 两侧架构差异（为什么不能整块照搬）

| | 对方（we-renderer） | 我方（完整模式） |
| --- | --- | --- |
| 运行环境 | Node 离屏/worker：CPU 解析 + CPU 蒙皮 + CPU 光栅化（逐像素重心坐标 + 双线性采样） | 浏览器：Canvas2D 逐三角形仿射贴图；同一路径也能输出 GPU 蒙皮 |
| puppet 定位 | `origin + rawBounds × scale + viewShift`，用 skinned bbox 每帧重算 | 原点 = 图片中心，MeshCanvas 原点参与场景变换 |
| attachment | **骨骼最终世界位姿 + 锚点矩阵旋转平移**（每帧跟随动画） | **MDAT 静态平移**（不随动画动） |
| 动画数据 | 新格式 MDLA0006：9 列交错 f32，固定 30fps | 新格式按 `[t:3B][8×f32]` 帧表；老 0013 按 9×f32 逐骨骼 |
| 动画层 | 多 visible 层合成（mix / additive） | 单动画（animationIds 第一个命中） |
| 蒙皮数学 | 行主序 4×4，行向量右乘 | 列主序 4×4，列向量左乘 |
| 骨骼头 | 变长头（u8/u16 tmp 变体探测） | 固定 76B（0004）/ 13B 头 + json（0003） |

矩阵约定差异不影响数学等价性（完整 4×4 + 求逆两种主序互逆结果一致）；
但**骨骼局部矩阵语义**（对方纯平移+旋转、我方 bind 平移+层旋转）和**动画数据布局**必须先统一结论，才能吸收实现。

## 1. 动画数据布局：9 列交错 f32（对方已逆向定案，我方待验证采纳）

**对方结论**（puppet.js `_sampleAnimRT`，逆向自 32 骨骼与 6 骨骼模型）：

- MDLA 每骨骼一段（`segBytes`），段内帧循环交错排列，**9 列循环**：
  - 骨骼 b 的 pos = 段 b 帧 `floor(2b/9)` 列 `(2b)%9,(2b+1)%9`（第 9 列跨入下一段帧）
  - 骨骼 b 的 rot = 段 b 帧 `floor(2b/9)+floor((2b+5)/9)` 列 `(2b+5)%9`
  - 每帧 36B = 9×f32；rot 为弧度；段帧循环 `frameCount+1` 帧
- 采样伪代码：
  ```js
  b2 = 2*b
  posShift = floor(b2/9)          // 跨段帧数
  posCol = b2 % 9                  // 起始列
  o = segStart + ((frame + posShift) % totalFrames) * 36 + posCol * 4
  rotShift = floor((b2+5)/9)
  rotCol = (b2+5) % 9
  o2 = segStart + ((frame + posShift + rotShift) % totalFrames) * 36 + rotCol * 4
  ```
- **帧率固定 30fps**（官方骨骼动画），层 `rate` 只做倍速；帧循环 = `floor(t*30*rate) % frameCount`。

**我方验证修正（2026，3465215190 抽动/形变修复后定案）**：对方的行/列公式在**帧 0** 与实测一致
（帧0≈bind 校验全模型通过），但其 `% frameCount` 把读取锁死在单骨骼段内——与它自己的注释
"段帧循环 frameCount+1 帧"矛盾。实测（3465215190 47 骨骼、fc=66、segBytes=2412=67×36）：

- 整个动画数据是**一块连续 f32 流**，按 `segRows = segBytes/36 行 × 9 列` 视图切分；
  骨骼 b 的数据窗口起点 = 全局行 `segRows·b + floor(2b/9)`（每骨骼 +2 浮点漂移，
  等价平坦索引 `pxFlat = (9·segRows + 2)·b + 9f`，已实测验证 bone6/8/41/46 起点）；
- px = 平坦 `9·R0 + 9f + (2b)%9`；py = px+1（物理连续，跨行/跨段）；rot = 平坦 `9·R0 + 9f + (2b+5)`
  （列 (2b+5)%9、行再顺延 floor((2b+5)/9)，与对方公式一致，只是不再受段边界约束）；
- 每骨骼窗口 = frameCount 帧 + 1 闭合行（fc+1 = segRows），帧 0 读取与对方公式相同；
- **末尾骨骼的 +2b 漂移会把最后若干帧推出块外**（构建器截断，文件确实没有这些帧）：
  越界帧必须钳制到该骨骼最后一个有效帧（保持末帧姿态）。回绕到块头会读到占位值
  (0,0,1.0)——这正是全模型库 20 个"最后一根骨骼"抽动/形变异常的唯一根因；
- 动画头校验：垃圾条目（如 3465215190 anim[1] id=1065353216=1.0f、fc=0/bc=0）需按
  标记存在性 + fc/bc/segRows 合理性拒绝；标记（f32 30.0）之前可能有大段旧格式轨道
  数据（实测偏移 611KB），只能按文件边界扫描，不可用固定步数守卫。

落地：`ScenePuppet.ts` MDLA0006 解码改为全局平坦寻址 + 尾部钳制（见
`_dev/diag10-validate.mjs` 端到端校验：47 模型全通过，帧0≈bind + 闭环最大跳变 <30px/<20°）。

**我方现状**（ScenePuppet.ts `parseKeyframes`）：
把 36B 读成 `[t:3B][8×f32]` 帧表，t 取 3B LE，帧值 8×f32，带偏移探测
（0..8 尝试 + 单调性/合理性打分）。**两套解读不可能同时正确**——36B = 9×f32 时，
"t = 3B LE" 实为某 f32 的低 3 字节，"8×f32" 错位 1 字节，探测打分也区分不出"均匀 f32"
和"递增 3B 时间戳"。

**收敛建议（先验证再采纳）**：
1. 用现有 `_dev/mdl-skin-render.mjs` 对已知样本（Kirito/Miku）跑两版解析：
   对方版（9 列交错 + 30fps）与我方版（t:3B + 8×f32）。
   判定标准：帧0 世界姿势 ≈ MDLS bind 世界（对方经验：多数模型帧0=bind）；帧值有限且量级合理；逐帧动画目测平滑。
2. 若两版同时"合理"，加判别：9 列交错解读下 pos 列值分布应集中（平移量级），
   rot 列值在 ±π 内且量级小；t:3B 解读下 t 应单调递增、间隔均匀。
3. 验证通过后落地：`parseKeyframes` 保留（兜底），新格式走 9 列交错 + 固定 30fps +
   逐骨骼段（`animations[i] = { name, frameCount, boneCount, segBytes, segs[] }`）。
4. 落地时同步改渲染消费（buildMeshCanvas + updatePuppetAnims）：全骨骼位姿数组（`Array<{angle,tx,ty}>`），替代骨骼0 启发式。

## 2. 全骨骼层级动画 vs 骨骼0 启发式（最大的效果差距）

**对方**：采样得到**全部骨骼**的世界位姿 `{angle, tx, ty}`（按 parent 链逐骨骼 2D 链乘），
直接作为蒙皮的 final 世界姿势参与多层合成。

**我方**（新格式动画）：`updatePuppetAnims` 只产出 `{dx, dy, rot}`，渲染侧把旋转绕
"骨骼 0 bind 位置"做旋转修正 + 平移。等价于"所有顶点跟一根骨骼刚体运动"。

**吸收路径**：
- `_sampleAnimRT` 的逐骨骼 2D 链乘（`out[b] = { angle: pa + rotZ, tx: 父tx + R(pa)·[px,py] }`）直接移植；
- `PuppetSkin.computeSkinMatrices` 已支持全骨骼矩阵蒙皮，只需喂"每骨骼 final 世界矩阵"；
  换算：对方 `{angle,tx,ty}`（行主序世界）→ 我方列主序 `mat4TRS(tx, ty, 0, angle, 1,1,1)`，
  再 `computeSkinMatrices(binds, finalMats)`；
- 注意：对方的 final 是**世界姿势**（含父链），不是局部 TRS——喂给 `computeSkinMatrices` 时
  不要再乘 bind，直接 `M_global = TRS(final)`，`M_skin = M_global × bindInv`。
- 蒙皮数据校验：权重 ∈ [0,1] 且骨骼索引 < boneCount，不通过回退绑定姿态（防炸）。

## 3. animationlayers 多层合成（普通层 mix + additive 层帧0 参考）

**对方语义**（puppet.js `_skinPuppet` + WE-REVERSE.md §6，官方数学推导）：
- 全部 `visible=true` 层按序合成：
  - 普通层：`final = mix(final, layerWorld, blend)`（blend=1 → 替换）
  - additive 层：`final += (layerWorld − refWorld) × blend`
- **additive 参考姿势 = 层动画自己的帧0 世界**（不是 bind！）：
  帧0 处 additive 贡献 = 0。多数模型帧0 = bind，等价；
  少数模型帧0 ≠ bind（差数十单位）→ 用 bind 当 ref 会让角色蒙皮整体飞走数百单位。
- **层名→动画映射**：MDLA 动画名匹配 → 数字后缀"动画 N" → 第 N 个动画 →
  层索引回退 → 最后兜底动画 0。名字不匹配按索引回退会选错动画（角色蒙皮飞走的另一根因）。
- **帧率**：30fps × 层 rate（倍速）。
- 角度合成必须走**最短弧**（`while (da > π) da -= 2π`），不能直接 lerp 角度。

**我方现状**：`parseAnimationIds` 只取动画 id 列表，`updatePuppetAnims` 播第一个命中的；
无 blend/additive/rate 概念。

**吸收路径**：
- `SceneModel.ts`：把 `animationlayers` 原样带进模型（`{name, blend, rate, additive, visible, animation}` 数组）；
- 渲染侧按对方语义合成全骨骼位姿（§2 的产出），blend/rate/additive/ref=帧0 全套移植；
- 单动画无 layers 时默认 `[{animIdx:0, blend:1, rate:1, additive:false}]`（保持现行为）。

## 4. attachment 锚点 = 骨骼最终世界位姿 + 锚点矩阵（静态 → 动态）

**对方**（core.js `_attachmentOffset` + WE-REVERSE.md §8，官方 exe 字符串 MDAT0001/attachment 确认）：
- MDAT 锚点条目 = `[u16 骨骼索引][名字\0][64B 矩阵]`——**锚点矩阵相对骨骼局部**；
- 子对象有效原点 = 父原点 + **骨骼最终世界位姿（动画合成后）** + R(骨骼角)·锚点平移 + 自身 origin；
- 与父链 scale/rotation 正确复合（先加锚点偏移，再叠加祖先 scale/rot）；
- 门控：与 renderPuppet 严格一致（仅"多动画 + 有 animationlayers"才层合成），
  否则单动画 + layers 的壁纸锚点跟随错动画 → 子对象挂载错位（sf39c 修复）。

**我方现状**：MDAT 解析丢骨骼索引（条目头 2B），只取矩阵平移（列主序 @48/52/56）当静态偏移。

**吸收路径**：
1. `ScenePuppet.ts`：MDAT 条目解析改为 `[u16 boneIdx @+0][name\0][64B 矩阵]`，产出
   `{ name, boneIdx, tx, ty, m }[]`（保留旧 `bonePositions` 兼容或直接替换，同步改 SceneModel）；
2. `SceneModelRenderer.computeWorldTransforms`：attachment 分支改为
   `bp = R(final[boneIdx].angle) · [tx, ty] + final[boneIdx] 平移`，其中 `final` 来自 §3 的合成结果；
3. 保持门控一致（锚点跟随与网格蒙皮用同一套 layers/时间），避免 sf39c 同款错位。

## 5. 蒙皮数据健全性防线（对方踩坑总结，零成本吸收）

对方在 `_parseMdl`/`_skinPuppet` 加的防线，全部直接可用：

1. **顶点块合理性**：前 64 顶点 pos 有限且 |v| < 1e6；索引 ≥98% < 顶点数。
   我方 ScenePuppet 已有（有限性 + 索引范围），对齐细节即可（我方逐顶点、对方采样 64 个）。
2. **蒙皮数据兼容性**：逐顶点权重 ∈ [-0.001, 1.001] 且骨骼索引 < nb，
   任一违规 → 整网格回退绑定姿态（部分 MDL 顶点布局不同，蒙皮数据不可靠，
   垃圾权重会把顶点炸到 1e28）。**我方 skinVertex 缺这道校验**。
3. **动画采样合理性**：读出的 px/py 有限且量级 < 10000，rot 有限；
   异常骨骼回退 MDLS bind 局部矩阵（继续链乘，不炸）。
4. **网格块选择**：`vertexBytes % 80` 的多个候选块按"顶点有限 + 索引范围"逐个验证选第一个通过的
   （对方把判定条件内联在扫描循环里；我方已同款）。

## 6. MDLE0002 骨骼扩展矩阵（解析已齐，消费未定）

两侧都解析了 MDLE0002（每骨骼 64B 矩阵，IK/约束相关）：
- 对方：挂到 `bones[b].extend`，**蒙皮路径未使用**（TODO 标注"消费未定"）；
- 我方：作为 `bone.pose`（动画壁纸 = 当前姿势；静态壁纸 = bind），bind 缺失时的回退（`b.bind ?? b.pose`）。

**结论**：无需照搬（对方也没有把它接入蒙皮）。我方"bind 缺失回退 pose"保留；
若未来官方确认 MDLE 语义，再按对方注释的 IK/约束方向跟进。

## 7. 性能与工程化细节（可顺手吸收）

- **MDL 解析缓存**（`_mdlCache`，按模型路径）：多帧渲染避免每帧重解析。
  我方 `parsePuppetMdl` 在模型构建时一次，天然满足；MeshCanvas 重建键用
  `rot.toFixed(4)` 量化 + 帧 key，已有意识控制重建频率，保持即可。
- **additive ref 缓存**（`refCache` 按动画对象）：每动画帧0 位姿只采样一次。
- **帧0=bind 校验技巧**：验证新解析时，先断言"帧0 世界 ≈ bind 世界"（多数模型成立），
  不成立时优先怀疑布局解读错了，而不是调参数。
- **三角形直接 CPU 光栅化**（对方逐像素重心坐标 + 预乘 alpha 双线性）：
  我方 Canvas2D 逐三角形 clip+drawImage 在三角形数量大时更慢，但有 GPU 蒙皮可用
  （buildMeshCanvas 同构 posArr 输出），本次不引入对方 CPU 光栅化，仅保留对照。

## 8. 我方已有、无需跟进的差异

- **矩阵主序**：行主序（对方）vs 列主序（我方）——数学等价，不改。
- **定位公式**：对方 `origin + rawBounds×scale + viewShift` vs 我方"原点=图片中心"：
  定位基准不同但都被实测校准过，吸收§4 锚点动态化时注意保持我方坐标系（模型 y-up、场景 y-up → 屏幕 y 翻转）。
- **光栅化方式**：Canvas2D 仿射贴图 vs CPU 重心坐标：等价输出，保留我方路径。
- **旧 0013 老格式逐骨骼动画**：我方独有支持（对方只处理新格式 MDLA0006），保留。
- **bloom/camera/effects/GSL 解释器**：与骨骼无关，本次不评。

## 9. 落地顺序建议（依赖驱动）

1. **验证层**：`_dev/mdl-skin-render.mjs` 加 A/B——同一 MDL 分别用 9 列交错 + t:3B 解读，
   输出"帧0 世界 vs bind 世界"偏差与帧值分布 → 定案 §1。
2. **解析层**（ScenePuppet.ts）：9 列交错定案后改 MDLA 解析 + MDAT 骨骼索引（§1/§4）。
3. **蒙皮层**：SceneModelRenderer.updatePuppetAnims → 全骨骼位姿 + 多层合成（§2/§3），
   PuppetSkin.computeSkinMatrices 喂全骨骼 final 矩阵；加权重/索引健全性校验（§5.2）。
4. **绑定层**：computeWorldTransforms attachment 动态锚点（§4），门控与网格蒙皮一致。
5. **回归**：_dev 渲染对照脚本 + 现有完整模式样本（Kirito/Miku）逐壁纸目测：
   眨眼/呼吸/摇头是否平滑、五官是否跟头（锚点）、多 visible 层壁纸是否不再缺层。

## 附：对方实现索引（本地路径）

- `_compare/dsh-wallpaper-engine/lib/we-renderer/puppet.js` —— `_skinPuppet`（多层合成 + 蒙皮）、
  `_sampleAnimRT`（9 列交错采样 + 合理性回退）、`_parseMdl`（骨骼头变体 + MDLA/MDLE 解析）、`_rasterizeMesh`
- `_compare/dsh-wallpaper-engine/lib/we-renderer/core.js` —— `_puppetBoneFinal`（锚点用最终位姿）、
  `_attachmentOffset`（锚点跟随 + 门控）、`resolveTransform`（锚点偏移进父链复合）
- `_compare/dsh-wallpaper-engine/docs/WE-REVERSE.md` —— 官方引擎逆向基准（矩阵链、origin 骨骼链、
  MDAT 锚点语义、动画层合成、官方 shader 蒙皮约定）
- `_compare/dsh-wallpaper-engine/TODO.md` —— sf39c/d/f 等踩坑与门控一致性要求
