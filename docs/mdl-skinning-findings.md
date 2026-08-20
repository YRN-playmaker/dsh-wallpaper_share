# mdl 蒙皮格式破解记录（Puppet 精细化绑定 / 蒙皮动画）

> 目标：解析 `_puppet.mdl` 的顶点网格 + 骨骼 + 动画，实现部件蒙皮动画（眨眼/呼吸/摇手）。
> 参考：`_dev/reference/MDL_FILES.md`（Almamu/linux-wallpaperengine 文档，格式事实）。
> 场景样本：`3463520581`（Kirito/Asuna 部件）、`3409595232`（Miku）。

## 已确认结论（确定性，可固化为代码）

### 0. 顶点 stride = 80B（2026 修正，推翻旧 40B 结论）

**决定性证据**（3463520581 全 6 个 mdl）：stride=40 时恰好一半三角形退化（面积 0），
stride=80 时 **100% 非退化**（asuna body 1827/1827、bottom 1501/1501 等）。
旧 40B 结论是把每 2 个 80B 顶点合并成 1 个 40B 顶点造成的假象
（第二个 40B 顶点读到的 pos = 第一个顶点的 slot5-7 = 1,1,±0 → 伪三角形）。
与 linux-wallpaperengine（vertexStride=80, uvOffset=72）交叉验证一致。

```
VERTEX 80B = 20 × f32：
  [0..2]   pos（bind 姿势，模型空间，y-up，原点=图片中心）
  [3..13]  未知（3-4 全 0，5-6 全 1，7 = ±0，9 = 1，10-13 = 0 —— 疑似 normal/tangent 填充）
  [14..17] 4 个骨骼权重（0..1，隐含骨骼 0..3；asuna body 460 顶点权重 (1,0,0,0)，
           少数 (0.0005,0.9994,0,0) 等双骨骼混合，权重和=1）
  [18..19] UV（模型 v-up；渲染需 v' = 1-v —— 三角形方向统计 0% 一致=100% 反向验证）
```

网格块扫描（linux findPuppetMeshBlock 同款）：从魔数后逐字节找
`[4B ?][4B vertexBytes][verts][4B indexBytes][indices]`，
要求 vertexBytes % 80 == 0、indexBytes % 6 == 0、边界 < MDLS。

### 1. MDLV 头部（顶点网格）
```
"0023\0"                          （魔数，5B 含 null）
DWORD first = 0x01800009
DWORD second = 1
DWORD third = 1
CHAR json[] \0                     （材质引用，如 "materials/kirito face.json"）
DWORD fourth = 0
DWORD marker = 0x0180000F          （25165839，标记，非长度）
DWORD vertexByteLength             （如 face = 38960）
VERTEX vertices[vertexByteLength / 80]
DWORD indicesByteLength            （如 face = 5082，索引 uint16 数 × 2）
WORD indices[indicesByteLength / 2]
```

### 2. VERTEX 布局 = **80 字节 = 20 × f32**（见 §0，旧 40B 结论作废）
```
[pos3 @0][44B 其他 @12..55][weights4 @56..68][uv2 @72..79]
```
实测 asuna body v0：pos + 权重 (1,0,0,0) + uv。
face（3409595232？）：974 顶点、5082B 索引（2541 uint16 = 847 三角形）、7 骨骼。

### 3. MDLS 骨骼段（bind 矩阵 + 父子层次）— 2026 定案
```
"MDLS0004\0"（9B）
u32 @+9                        （下一块数据偏移）
u32 @+13 boneCount             （asuna body = 15）
u8  @+17 = 0
骨骼定义 × boneCount（76B each）：
  u32  u0（骨骼名偏移/ID？）
  i32  parent                  （-1 = root；asuna b0=-1, b1=0）
  f32  f0                      （root = 2.0，子骨骼 = 0）
  f32  bind[16]（4×4 列主序矩阵 @+12，平移 = 骨骼模型空间位置）
```
实测：asuna bind[0] t = (-17.62, -414.55)（= MDLE[0]，静态壁纸 bind=姿势）；
hair back big chunk bind[0] t = (598.71, 234.05)；puppet bind[0] = (-0.66, -1.58)。

### 4. MDLA 动画（36B/帧）— 2026 布局修正
```
"MDLA0006\0"（9B）
u32 @+9
u32 @+13 animCount
每动画目录项：
  u32 id
  u32 （=0）
  CHAR name\0                  （"eyes" / "Animation 1"）
  CHAR loop\0                  （"loop"）
  f32  （=20.0）
  u32  （=60：骨骼数×4？asuna 15 骨骼→60；puppet 1 骨骼→?）
  u32  （=0）
  u32  （=15：骨骼数，asuna 15 / puppet 1）
  u32  （=0）
  u32  dataLen                 （如 2196 = 61 帧 × 36）
  u8   extra（=2）
  [帧数据 dataLen]：帧 = [t: 3B LE][8 × f32][1B pad]（36B）
```
实测：asuna "eyes"(id=264) 61 帧、anim[1](id=2385) 451 帧；puppet "Animation 1" 61 帧。
帧 v0 = 骨骼位置 y（asuna eyes 帧 v0=-414.55 = root y）。

### 5. MDAT0001 = 具名骨骼矩阵表（attachment 锚点）— 2026 定案
```
"MDAT0001\0"（9B）
u32 @+9
u16 @+13 count                 （asuna = 1 "head"；puppet = 2 "Attachment"+"hair back"）
u16 @+15
条目 × count：
  CHAR name\0
  [pad 1B 存在]
  f32 matrix[16]（4×4 列主序 @名字+strlen+1（跳过 pad），平移 = 骨骼模型空间位置）
```
实测：asuna "head" = (-32.51, 116.41)（图片中心上方 116px）；puppet "Attachment" = (-0.15, -0.10)、"hair back" = (8.7, 677.0)。
**用途**：`setParent(parent, attachment)` 的附件点 = 骨骼，`getAttachmentMatrix` = 世界矩阵 →
子部件位置 = 父锚点 + 父scale × (子origin + MDAT平移)。**条目间有 pad 0x00，需跳过**。

### 6. MDLE0002 = 骨骼姿势矩阵数组 — 2026 修正（byteCount@+13）
```
"MDLE0002\0"（9B）
u32 @+9
u32 @+13 byteCount              （如 960 = 15 × 64）
f32 matrix[16] × (byteCount/64) @+17（列主序，平移 = 骨骼模型空间位置）
```
实测 asuna：mat[0] = (-17.62, -414.55)（root）、mat[1] = (30.19, 229.42)、mat[2] = (64.90, 437.70)……
**注意**：MDLE = 动画姿势矩阵（非 bind）；静态壁纸姿势 = bind（与 MDLS bind[0] 一致）。
**蒙皮语义（linux 参考一致）**：静态渲染用 **raw 顶点**（bind 姿势，不乘矩阵）；
动画蒙皮 = Σ weight_i × poseMatrix_i × bindInv_i × pos（M=bind 时恒等 → raw）。

### 7. 模型空间参考系（决定 attachment 与网格对齐）
- 模型空间原点 = **图片中心**（linux updatePuppetPositionBuffer：size.x/2 + x，y 翻转）
- 骨骼矩阵平移 / MDAT 位置 = 相对图片中心（y-up，单位 = 场景像素）
- 渲染：网格画布模型原点对齐图层锚点（图片中心），与纹理 drawImage(-dw/2,-dh/2) 一致

## 待逆向（后续轮次）

1. **MDLS 子骨骼结构**（骨骼 1-6 的父子关系 + 相对变换矩阵）—— 眨眼/摇手动画驱动子骨骼
2. **动画帧旋转分量布局**（v3..v6 是 quat(x,y,z,w) 还是欧拉，root 非单位 → 需确认）
3. **蒙皮渲染器**（WebGL 顶点着色器蒙皮；Canvas2D 847 三角形性能不足）
4. **纹理**：部件纹理（kirito face.tex 等）为 pkg 内 DXT5 raw，已有解码路由

## 新增发现（asuna body 完整结构）

`models/asuna body_puppet.mdl`（171734B）段布局（2026 修正）：
```
MDLV（顶点网格 985 顶点 / 1827 三角形，stride=80）
MDLS0004 @0x18e23    （骨骼层次，骨骼数 = 15，定义表 @+18 起 76B/骨骼）
MDAT0001 @0x197c0    （具名骨骼 "head" = (-32.51, 116.41)）
MDLA0006 @0x19816    （动画 "eyes"(id=264) 61 帧 + id=2385 451 帧）
MDLE0002 @0x29b00    （15 × 姿势矩阵，byteCount @+13 = 960，矩阵 @+17）
TEXV     @0x29ed2    （内嵌 .tex 纹理）
```

### MDLE0002 = 骨骼 bind 矩阵数组（关键确认）
```
"MDLE0002\0"（9B）
DWORD fileOffset
DWORD matrixCount = 15        （与 MDLS 骨骼数一致）
15 × 4×4 列主序仿射矩阵（64B each，平移在末列）
```
实测（asuna body）：矩阵 0 = 单位矩阵（根骨骼），矩阵 1 平移 (-17.62, -414.55)，矩阵 2 平移 (30.19, 229.42) —— **即各骨骼的 bind 位置**。

### 动画头字段（MDLA，连续读取不 4 对齐）
```
"MDLA0006\0" / fileSize / animCount
每动画：id / f2 / name\0 / loop\0 / f5 / dur / f7 / bones / f9 / dataLen / extra(1B) / 数据(dataLen)
```
实测：root bones=1 动画1949；asuna bones=15 动画264(eyes)；face bones=7 动画374。

### 关键结论（方向修正）：部件动画数据 = 静态姿势表，非逐帧关键帧
- **root（1 骨骼装配根）动画 = 真实逐帧动画**（t 单调 12592543→...，v4 正弦呼吸）
- **多骨骼部件（face 7 骨骼 / asuna 15 骨骼）动画数据 = 静态姿势表**：
  - face 374 数据 61 帧全部 t=4362813 常量，v0=-172.12（骨骼 0 位置）
  - asuna eyes 264 数据 61 帧全同 v0=-414.55（骨骼 1 位置）；后续段 "jeC"(183帧 v7=30.19)、"WYB"(737帧 v0=-86.03) 均全同
  - 即：**部件动画数据是各骨骼 bind 姿势的冗余副本，不含随时间变化的关键帧**
- 动画帧 v0 值精确对应 MDLE 骨骼矩阵平移（-414.55 = 骨骼 1 平移 y，30.19 = 骨骼 2 平移 x）

### 2026 动画调查最终结论（3463520581 + 3409595232 全部 mdl 验证）
- **所有部件的 MDLA 动画 = 静态姿势表**（骨骼状态冗余副本，值全同）：
  - asuna body：eyes(264) 61 帧全同 v0=-414.55；Animation 2(2385) 61 帧全同（目录 @mdla+33146，数据 @+33196）
  - Miku：动画 1(463) 151 帧、动画 2(1054) 271 帧、动画 3(377) 361 帧——全部静态（v3/v4 = -29/-365 常量）
- **唯一的真实逐帧动画 = 装配根**（1 骨骼，alpha=0）：
  - puppet_puppet(1953)/puppet - Copy(1949)：61 帧，t 先降后升/先升后降（ping-pong 呼吸），
    v4 = rotZ 摆动 ±0.009 rad（±0.5°），v5-7 = scale 1,1,1，v0 = bind y（常量）
  - **呼吸 = 装配根绕锚点微摆**（已实现：sampleAnimation 帧号插值 + updatePuppetAnims period≤0 按帧号）
- **部件动画（眨眼/摇手）在这些壁纸中不存在于 MDLA 数据**——若需实现需 effects/纹理序列机制
- MDLA 帧布局定案：`[t:3B LE][8×f32][1B]`；8 floats = [pos3][rotZ?][scale3]（装配根实测 v4=摆动）
- MDLA 目录项（Miku UTF-8 名字）：id(4)+u32(4)+name\0+loop\0+f32(4)+4×u32(4)+dataLen(4)+extra(1)+数据
  —— 目录项**不连续**（数据区含大量静态姿势冗余，目录头散布）；解析器顺序读取仅对装配根可靠
- **parseKeyframes 偏移探测**：质量 = t 单调分 − NaN/巨大值惩罚；t 全等（平铺）时按值合理性区分；
  t 常量/递减（ping-pong）动画按帧号线性播放

### 待调查：部件"眨眼/呼吸/摇手"动画的真实机制
多骨骼部件的逐帧动画**不在 MDLA 关键帧里**。候选机制：
1. scene.json 图层的 **effects**（如 #122 kirito body 有 waterwaves/shake/foliagesway effect，可能是骨骼形变动画）
2. **sequence 纹理帧动画**（animationmode=sequence，像 Gusts 粒子）
3. WE 引擎内置动画（按 animationlayers 名字"呼吸/眨眼/摇手"播放）

## 最终结论（决定性，已验证 3 个场景）

**WE puppet 动画分两类**：
1. **装配根 puppet（1 骨骼，alpha=0 锚点）**：MDLA = 真实逐帧动画（t 单调，呼吸摆动）→ 已实现整体摆动 ✓
   - 例：KIRITO PUPPET 动画 1949、ASUNA PUPPET 动画 1953
2. **蒙皮部件（多骨骼）**：MDLA = 静态姿势表（bind 姿势冗余副本，每骨骼 × N 帧重复，t 全常量）→ **不含逐帧动画**
   - 例：face 7 骨骼（61帧×7）、asuna body 15 骨骼（61帧×15）、Miku 38 骨骼（151帧×38）
   - 帧 v0 值精确对应 MDLE 骨骼矩阵平移（face -172.12、asuna -414.55/30.19、Miku -365.7）

**因此**：
- "呼吸" = 装配根逐帧动画 → 已实现
- "眨眼/摇手" = 部件局部动画 → **不在 mdl 骨骼关键帧里**，是 effects/sequence/内置动画等别的机制
- "精细化绑定"（静态蒙皮）= 顶点 + MDLE 骨骼矩阵 + WebGL，是**静态渲染**（bind 姿势，不产生动画）

## 蒙皮渲染管线（设计草案）
```
MDLV 顶点（pos/骨骼索引/权重/uv）
  → 每帧采样 MDLA 动画（每骨骼 pos+rot）
  → 计算骨骼世界矩阵（MDLE bind 矩阵 × 动画变换，含父子层次）
  → 顶点蒙皮：skinPos = Σ weight × boneMatrix × bindPos
  → 三角形光栅化（WebGL）+ 内嵌/pk g 纹理采样
```
**cropoffset**：部件模型 json 的 cropoffset（如 asuna body "233 241"）是纹理图集裁剪起点，绑定需按此裁剪。

## 技术选型建议
- 蒙皮渲染用 **WebGL**（Canvas2D 逐三角形 clip+drawImage 性能不够）
- 格式逆向（顶点/骨骼/动画矩阵）是**确定性工作**，可继续由代码实现
- 骨骼姿势**视觉对齐**（蒙皮后角色姿势是否正确）属视觉调校，建议换模型或人工验证
