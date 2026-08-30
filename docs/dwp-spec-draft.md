# DWP — DSH Wallpaper Package 技术规范（草案 v0.4）

> v0.4.1 修订（实现期发现，R1.4/R1.5）：clip 轨道 keyframes 允许**单属性直写形态**（`frames/easing/loop` 直接挂在 track 上，property 由 track key 提供——与 §4.5 示例一致）；动画属性白名单补 **`scale.x`/`scale.y`**（规则 5"眨眼 = scale.y 关键帧"此前在 track 模式中不可表达）；示例 `puppet-breath` 眨眼改用 `scale.y`；**发射器盒参照系澄清为设计画布**（原"视口比例"与确定性模拟矛盾）；§5.2 RNG 派生式精确到出生序号。
> v0.4 变更：新增 **§8.2 商业化拓扑**（付费包经售卖平台托管与资格验证；内容许可与代码许可分离，**付费内容禁用 GPL**；壁纸包禁止存入代码仓库分支）；manifest 新增可选 `commercial` 字段。
> v0.3 变更：**puppet（mesh 图层）升入 v1.0**——以"刚性部件 + 骨骼链"为主格式（运行时零额外 GPU 成本、编辑器无需权重刷），加权蒙皮（skinned）作为 v1.0 可选高级项；新增 §4.5。
> v0.2 变更：坐标模型改为**设计像素 + 视口锚点**（对齐 CSS 心智）；混合模式改用 **CSS/canvas 原生名**；动画收敛为 **3 种枚举**（无脚本）；粒子语义收敛 + **确定性模拟**入规范；资源限定 **web 安全格式**（编辑器导入时转换，运行时零解码负担）；新增 **一致性（Conformance）** 章节。
>
> 设计原则：
> 1. **格式说浏览器的语言**——每个字段都能 1:1 映射到 DOMMatrix / globalCompositeOperation / <video> 纹理，运行时薄、编辑器易做；
> 2. **能力即格式边界**——只收录参考渲染器已实现的能力，WYSIWYG 由规范保证；
> 3. **确定性**——同 (文档, t, seed) 必须产出同一帧，支撑缩略图生成、回归测试与跨实现一致；
> 4. **无代码执行**——禁止可执行体；web 类型仅静态 HTML 且在隔离源沙箱渲染。

---

## 1. 包结构

壁纸包 = zip，扩展名 `.dwp`；**源工程 = 同结构的普通文件夹**（编辑器直接编辑源工程，导出即打包）：

```
my-wallpaper.dwp / my-wallpaper/
├── wallpaper.json          # 清单（必需）
├── scene.json              # type=scene 时的场景描述（v0.2 起在根目录，与清单平级）
├── preview.jpg             # 预览图（必需，≤2 MB，建议 1280×720）
├── preview.gif             # 动态预览（可选，≤5 MB）
└── assets/                 # 资源（禁止路径穿越/绝对路径/符号链接）
    ├── *.png|jpg|webp      # 纹理
    ├── *.mp4|webm          # 视频
    └── index.html + ...    # type=web
```

硬性限制（注册表 CI 强制）：

| 项 | 限制 |
| --- | --- |
| 包体积 | video ≤ 200 MB；scene/web ≤ 50 MB；image ≤ 20 MB |
| 单文件 | ≤ 100 MB |
| 场景规模（建议预算，超出仅警告） | ≤ 200 图层；粒子总数 ≤ 50 000；纹理总像素 ≤ 64 MP |
| 禁止 | 一切可执行体；`application` 类型；`..` 路径；外链资源（`http(s)://` 引用一律拒绝——包必须自包含） |

## 2. 清单 `wallpaper.json`

```jsonc
{
  "format": "dwp/1.0",
  "id": "yrn.aurora-rain",              // 全局唯一：作者前缀.slug
  "version": "1.0.0",                   // semver
  "name": { "zh-CN": "极光雨", "en": "Aurora Rain" },
  "author": { "name": "YRN", "github": "YRN-playmaker" },
  "license": "CC-BY-NC-4.0",            // SPDX 或 "proprietary"
  "rating": "general",                  // general | mature（市场默认隐藏 mature）
  "type": "scene",                      // image | video | web | scene
  "entry": "scene.json",                // scene/web 必填；video/image 指向资源文件
  "preview": "preview.jpg",
  "tags": ["nature", "rain", "loop"],
  "requires": { "features": ["particles", "waterwaves", "params"] },  // 能力协商，见 §7
  "params": [ ... ],                    // 用户可调参数，见 §6
  "commercial": {                       // 可选；缺省 = 免费包（§8.2）
    "sale": "itchio",                   // itchio | afdian | gumroad | …
    "slug": "yrn/aurora-rain",          // 平台商品定位符
    "price": { "CNY": 12 },
    "licenseText": "dwp-personal-use-1.0"  // 引用 registry 仓库的标准个人使用许可模板
  }
}
```

> `license` 字段是**内容许可**（CC 系列或 proprietary），与仓库**代码许可**（GPL/MIT）互不相干；带 `commercial` 的包 `license` 必须为 `proprietary`——GPL/CC-BY 类许可授予再分发权，与付费排他性法律冲突。

## 3. 坐标与变换模型（v0.2 核心决策）

**设计像素 + 视口锚点**，心智模型 = CSS 的 `position: absolute; left: 50%; top: 50%`：

- 场景在 `canvas.width × canvas.height` 的**设计分辨率**下创作（编辑器工作区即此画布）；
- 运行时把设计画布按 `fit` 策略映射到实际视口：`cover`（默认，等比铺满裁切）| `contain`（留边）| `stretch`；
- 每个图层用 **anchor（0..1 视口相对）+ offset（设计像素）** 定位 → 超宽屏/多分辨率下构图不塌：背景 `anchor:[0.5,0.5]`，角标水印 `anchor:[1,1] + offset:[-80,-60]`；
- 变换 = 2D 仿射（DOMMatrix 兼容）：`origin`（变换原点，size 相对 0..1）→ `rotation`（度）→ `scale` → `alpha`。**无 3D、无透视相机**（WE 场景本质是 2.5D 分层，鼠标视差用 `parallax` 字段表达）。

## 4. 场景 `scene.json`（dwp-scene 1.0）

```jsonc
{
  "canvas": { "width": 1920, "height": 1080, "fit": "cover", "background": "#0a0e1a" },
  "loop": 60,                            // 全局循环秒数（可选；省略 = 各动画自循环）
  "variables": { "speed": 1.0, "tint": "#88aaff" },   // 可被 params 覆写；效果/动画里用 "$speed" 引用
  "layers": [
    {
      "id": "bg", "type": "image", "src": "assets/bg.png",
      "anchor": [0.5, 0.5], "offset": [0, 0],
      "size": [1920, 1080],              // null = 纹理自然尺寸
      "origin": [0.5, 0.5], "rotation": 0, "scale": 1, "alpha": 1,
      "blend": "normal",                 // CSS mix-blend-mode 名（见下表）
      "parallax": 0.02,                  // -1..1 鼠标视差深度（可选）
      "visible": true,
      "animation": {
        "kind": "keyframes",
        "tracks": {
          "offset.y": { "easing": "cubic-bezier(.4,0,.2,1)", "loop": true,
                        "frames": [[0, 0], [6, -40], [12, 0]] }   // [秒, 值]，线性/贝塞尔插值
        }
      }
    },
    { "id": "moon", "type": "solid", "color": "#fff8dc", "size": [120, 120], "anchor": [0.8, 0.2],
      "animation": { "kind": "oscillate", "property": "alpha", "amplitude": 0.3, "period": 4, "phase": 0 } },
    { "id": "clock", "type": "text", "value": "{time:HH:mm}", "font": "48px 'Segoe UI', sans-serif",
      "color": "#ffffff", "anchor": [0.5, 0.9] },
    {
      "id": "rain", "type": "particle", "texture": "assets/rain.png",
      "emitter": { "shape": "box", "size": [1.0, 0.05], "rate": 120, "burst": 0 },   // size 归一化设计画布比例（模拟空间=设计px，与视口无关；v0.4.1 澄清）
      "life": [1.2, 2.0],
      "velocity": { "direction": 90, "spread": 5, "speed": [400, 600] },              // 度 / 设计像素每秒
      "rotation": { "spin": [0, 0], "alignToVelocity": false },
      "sizeOverLife":  [[0, 1], [1, 0.6]],     // [寿命比例, 倍率]
      "alphaOverLife": [[0, 0], [0.1, 1], [1, 0]],
      "colorOverLife": ["#ffffff", "#88aaff"],
      "gravity": 0, "drag": 0,
      "blend": "lighter", "maxCount": 2000, "seed": 1234
    },
    { "id": "clip", "type": "video", "src": "assets/loop.mp4", "anchor": [0.5, 0.5],
      "size": [960, 540], "loop": true, "muted": true }     // <video> 逐帧上传为纹理，web 原生能力
  ],
  "effects": [
    { "type": "waterwaves", "target": "puddle", "params": { "speed": "$speed", "strength": 0.6, "scale": 24 } },
    { "type": "vignette", "target": "scene", "params": { "intensity": 0.4, "color": "#000000" } }
  ]
}
```

### 4.1 图层类型（v1.0）

`image`（纹理/视频静帧）· `video`（循环视频层）· `solid`（纯色矩形，可圆角 `radius`）· `text`（系统字体栈，支持 `{time:…}` `{date:…}` 时钟占位符）· `particle` · `mesh`（puppet 角色，见 §4.5）。

### 4.2 混合模式（= canvas globalCompositeOperation，运行时零翻译）

`normal(source-over)` · `lighter` · `multiply` · `screen` · `overlay` · `darken` · `lighten` · `color-dodge` · `soft-light` · `hard-light` · `difference` · `exclusion` · `destination-in`(内部用，遮罩)

### 4.3 动画（仅 3 种 kind，无脚本）

| kind | 语义 | 可动画属性（白名单） |
| --- | --- | --- |
| `keyframes` | 帧表 `[秒,值]` + easing（`linear` / CSS cubic-bezier 串），贝塞尔求值 | `offset.x/y` `scale` `scale.x/y` `rotation` `alpha` `color` `size.w/h` `uvOffset` `params.*` |
| `oscillate` | `value + amplitude · sin(2π t/period + phase)` | 同上 |
| `scroll` | `value + perSecond · t`，模 `wrap` 循环（无缝滚动纹理/UV） | `uvOffset` `offset.x/y` |

### 4.4 效果白名单（v1.0，每个 = 运行时一个命名 shader pass）

UV 扰动族（共用参数化模板）：`waterwaves` `waterripple` `shake` `scroll`(UV)；
颜色族：`tint` `pulse` `filmgrain` `opacity` `vignette` `chromatic`(色差)；
多 pass：`blur`(4-pass 高斯)。
`target` = 图层 id 或 `"scene"`（全屏后处理）。参数值支持 `"$变量"` 引用。
（第三方自定义 shader → 永不进格式；那是 engine 的路线，见 §9。）

### 4.5 puppet：`mesh` 图层（v0.3 升入 v1.0）

设计立场：**2D puppet = 骨骼链 + 部件**，不是 3D 蒙皮的降维。WE 的 puppet 壁纸 95% 是"若干 PNG 部件绑到骨骼上刚体跟随"（呼吸/眨眼/发丝摆动），因此：

- **v1.0 基线 = rigid**：部件是绑到单根骨骼的矩形（运行时 = core 侧合成骨骼全局矩阵后当普通 quad 画，**零额外 GPU 成本**；编辑器 = 拖部件挂骨骼，无需权重工具）；
- **v1.0 可选 = skinned**：部件带显式顶点/权重（GPU 蒙皮），能力协商 feature 分列（`mesh-rigid` / `mesh-skinned`），渲染器可先实现 rigid；加权编辑工具 → v1.1 编辑器。

```jsonc
{
  "id": "girl", "type": "mesh",
  "anchor": [0.5, 1.0], "offset": [0, 0], "scale": 1, "alpha": 1, "blend": "normal",
  "bones": [
    { "name": "root", "parent": null, "bind": { "offset": [0, 0],    "rotation": 0 } },
    { "name": "hips", "parent": "root", "bind": { "offset": [0, -40],  "rotation": 0 } },
    { "name": "head", "parent": "hips", "bind": { "offset": [0, -180], "rotation": 0 } },
    { "name": "eyeL", "parent": "head", "bind": { "offset": [-22, -18], "rotation": 0 } }
  ],
  "parts": [
    { "src": "assets/body.png",  "bone": "hips" },
    { "src": "assets/head.png",  "bone": "head" },
    { "src": "assets/bangs.png", "bone": "head", "order": 10 },
    { "src": "assets/eyeL.png",  "bone": "eyeL", "order": 11 }
    // skinned 部件（可选高级）：
    // { "src": "assets/hair.png", "mesh": {
    //     "positions": [x,y,...], "uvs": [u,v,...], "indices": [..],
    //     "weights": [[boneIdx, w], ...]  // 每顶点 ≤4 骨，自动归一
    // }}
  ],
  "clips": [
    { "name": "idle", "active": true, "loop": true,
      "tracks": {
        "hips.offset.y": { "kind": "oscillate", "amplitude": 3, "period": 4 },
        "head.rotation": { "kind": "keyframes", "easing": "ease-in-out",
                           "frames": [[0, 0], [2, -2], [4, 0]] },
        "eyeL.scale.y":   { "kind": "keyframes", "frames": [[0, 1], [3.7, 1], [3.85, 0.1], [4, 1], [8, 1]], "loop": true }
      } }
  ]
}
```

规则：
1. `bind.offset` 为**父骨骼局部坐标系设计像素**，`bind.rotation` 度；骨骼全局矩阵 = 父链 2D 仿射复合（纯函数，确定性天然成立）；
2. clip 的 track 属性 = 骨骼的 `offset.x/y` `rotation` `scale`（等比）`scale.x/y`（分轴），复用 §4.3 三种动画 kind 与同一求值器——**core 里没有第二套动画系统**；track 值为单属性直写形态（property 由 track key 提供）；
3. v1.0 每 mesh 图层同时只有一个 `active` clip（多 clip 混合 → v1.1）；
4. `parts[].order` 决定 mesh 内部 z 序；mesh 图层整体在场景 z 序中位置不变；
5. 眨眼 = `scale.y` 关键帧（上表 eyeL 示例），呼吸 = `offset.y` oscillate——WE 观感的主体这两条就覆盖。

## 5. 确定性规范（一致性测试的依据）

1. **时间**：t = (渲染时刻 − 文档装载时刻) 秒，浮点；`loop` 存在时 t = t mod loop；
2. **粒子模拟**：固定 60 Hz 步长累加器（渲染帧率无关）；RNG = **mulberry32**，第 s 个出生粒子取 `mulberry32(mix(seed, emitter.seed ?? 0, emitterId, 模拟步序号 k, s))` 的连续输出（`mix` = FNV-1a 逐值混合；出生序 s 每发射器独立递增）——同 (文档, t, seed) 任意实现产出感知一致的画面；
3. **混合数学**：预乘 alpha 空间（与 WebGL 默认一致）；
4. **插值**：关键帧 cubic-bezier 与 CSS 定义一致（x 由时间线性定位，牛顿迭代求解）；
5. 纹理采样：双线性、无 mipmap 要求（实现可自选 mipmap 优化）。

## 6. 用户参数 `params`（一张壁纸 = 一个小产品）

```jsonc
"params": [
  { "key": "speed", "label": { "zh-CN": "雨速", "en": "Rain speed" }, "kind": "slider", "min": 0.2, "max": 3, "step": 0.1, "default": 1 },
  { "key": "tint",  "label": { "zh-CN": "色调" }, "kind": "color", "default": "#88aaff" },
  { "key": "night", "label": { "zh-CN": "夜间模式" }, "kind": "toggle", "default": false },
  { "key": "preset", "kind": "select", "options": ["柔和", "浓烈"], "default": "柔和" }
]
```

覆写值写入 `variables` 的命名空间（`$speed` 等），供动画/效果/粒子表达式引用。
渲染器插件自动生成参数 UI；**持久化到宿主端** `$DSH_HOME/storages/dwp/settings/<id>.json`。

## 7. 能力协商

渲染器插件暴露 `GET /dwp/capabilities → { "formats": ["dwp/1.0"], "features": [...] }`。
安装前，share 的 market 模块比对 `requires.features ⊆ capabilities.features`，缺失则警告"可装但降级"。
feature 名单与 §4.4 效果/§4.1 图层类型一一对应，随规范版本增补。

## 8. 约定目录与注册表（同 v0.1，摘要）

```
$DSH_HOME/storages/dwp/packages/<id>/<version>/   # 安装位（share 的 market 模块写入，渲染路径扫描）
$DSH_HOME/storages/dwp/settings/<id>.json         # params 覆写
$DSH_HOME/storages/dwp/staging/                   # 编辑器"试装"目录
```

注册表 = 独立**纯数据仓库**，采用**分片源 + 构建索引**结构（借鉴 dsh-skin-market 228 条目验证过的模式，PR 互不冲突）：

```
dwp-registry/
├── entries/<id>.yml            # 一壁纸一文件（提交源，人编辑）
├── catalog/v1/catalog.json     # Action 构建产物（消费端只拉这个）
├── licenses/dwp-personal-use-1.0.md   # 标准内容许可模板
├── .github/workflows/validate.yml     # schema/sha256/体积/禁项/license×commercial 一致性
└── TAKEDOWN.md
```
包文件挂**发布者自己的 GitHub Release**，注册表只存索引——托管责任在发布者，GitHub DMCA 框架兜底。
**market 拉取功能内置于 share**（浏览/搜索/安装/更新），不做独立市场插件：share 已有目录扫描、隔离媒体服务器与面板基建，复用成本最低。

### 8.1 分发拓扑（存储决策，2026-08 定稿）

**账号系统 = GitHub 本身**（身份=用户名，认证=PAT/OAuth device flow），不自建账号。

| 数据 | 主存储 | 国内加速路径 |
| --- | --- | --- |
| `.dwp` 包本体 | **发布者自己的 GitHub Release**（takedown=发布者删 Release，注册表不背托管责任） | 下载双源竞速：GitHub 直连 vs `DSH_DWP_MIRROR` 公共镜像前缀（用户可配） |
| `catalog.json` + 预览图 | registry 仓库（构建产物） | **同步发布为 npm 包 `@dwp/registry`**，npmmirror 自动镜像，浏览/搜索/缩略图墙走国内快源 |
| 已安装壁纸 | 本机 `$DSH_HOME/storages/dwp/packages/` | — |

发布流程（edit 内置，全自动）：点「发布」→ 用发布者凭据上传 `.dwp` 到发布者仓库 Release → 向 registry 提 PR（index 条目+预览）→ Action 校验（schema/sha256/体积/禁项）合并。

**体积纪律**：scene ≤50MB 为协议硬上限，编辑器导出时报告体积并建议 ≤30MB；video ≤200MB。

**升级触发线**（到点才做，不提前建设）：
1. GitHub 流量警告/限流 → 加 Cloudflare R2 镜像（出口免费；镜像上线前置条件：发布者协议勾选 + takedown 自动化脚本）；
2. 月活安装 >1k 且出现评分/求更运营需求 → 自建站点（仍用 GitHub OAuth 登录）；
3. 付费/分成 → 见 §8.2。

### 8.2 商业化拓扑（付费壁纸）

原则：**平台管钱和购买资格，创作者管托管，协议与市场页管体验**——注册表与 share 全程不经手内容字节、不经手买家清单。

1. **托管**：付费 `.dwp` 挂**创作者自己的售卖页**（itch.io / 爱发电 / Gumroad 等），平台在交易后签发下载链接；禁止把壁纸包存入任何代码仓库的分支/标签（git 无分支级 ACL，公开仓库的"付费分支"= 零保护；二进制进 git 历史不可删）；
2. **资格验证**：share market 通过售卖平台 API 校验购买（如 itch.io collectibles），平台 OAuth 即买家身份——**生态全程不自建账号与支付**（国内收款合规需营业主体，平台代扛）；
3. **索引**：registry 条目透传 manifest 的 `commercial` 字段，market 页显示价格/渠道/已购状态；免费条目不变；
4. **许可**：`commercial.licenseText` 统一引用 registry 仓库维护的 **DWP 个人使用许可模板**（一人授权、可多机自用、禁再分发、商用另议），创作者不得私改条款（保证 takedown 与纠纷处理可预期）；
5. **准入协议**：registry 提交条款 = 内容权属声明 + license 字段自证 + takedown 接受——**不是 GPL 授权**（代码与内容许可分离，见 §2 注）；
6. **防盗版预期管理**：`.dwp` 落地后无 DRM，保护=许可声明+平台下架+社区声誉（与 WE 工坊同构）；协议明确不设计加密层，避免虚假安全感；
7. **升级线**：付费流水稳定后，若需自有资格服务（摆脱平台抽成/费率），再做 GitHub OAuth + R2 签名 URL 的轻量 entitlement——商户记录（收款/退款/税务）仍建议留在平台。

## 9. 一致性（Conformance）与生态

- **协议事实源 = `dsh-wallpaper_edit` 仓库**（制作插件与其规范同仓：README 正文 + `schemas/` + `examples/` + `conformance/`）：编辑器产出什么，规范就定义什么；
- 该仓库附 **4 个参考壁纸包**（`examples/`：粒子雨 / 水波湖 / 参数化时钟 / **puppet 呼吸角色**）+ 每个的**基准帧 PNG**（t = 0 / 2 / 8 s，由参考实现生成后提交）；
- 任何自称支持 `dwp/1.0` 的渲染器，参考帧感知差 ≤ 2%（SSIM 或像素均差）即为一致——这是"和任何符合技术手册的插件适配"的硬判据；
- 参考实现 `dwp-runtime-web`（**MIT**，见 `docs/dwp-runtime-web.md`）：share（GPL）与 engine（MIT）均可直接消费，规范文本建议 CC-BY-4.0；
- 与 engine 的分工从此清晰：**engine 路线 = 逆向复刻 WE 全保真（读别人的内容）；DWP 路线 = 正向定义简单协议（读自己市场的内容）**。两条路线在 share 内并存：WE 实时同步走现有逆向渲染器，市场内容走 dwp 参考运行时。

## 10. 版本策略

`format` 主版本 = 破坏性；次版本 = 向后兼容新增（新效果枚举/新图层类型/新 param kind）。
渲染器声明支持区间；编辑器按目标区间导出降级。
v1.1 预留：`audio`（音频响应 g_AudioSpectrum 简化版）、`group`（图层分组+父变换）、`mask`（遮罩图层）、多 clip 混合、编辑器权重刷工具（skinned 部件的可视化编辑）。
