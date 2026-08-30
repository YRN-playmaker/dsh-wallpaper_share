# DWP 参考运行时（dwp-runtime-web）— Web 解算架构

> 定位：DWP 1.0 的**参考实现**，独立仓库、**MIT 许可**（share 的 GPL 与 engine 的 MIT 都能直接消费）。
> 本文为架构备忘；**实现级详细设计（API 签名、数据结构、算法、验收）已移至 `dsh-wallpaper_edit/docs/design-runtime.md`**，编辑器设计见同目录 `design-editor.md`。
> `dsh-wallpaper_edit` 编辑器、share 的市场渲染路径、未来任何第三方插件，共用这一套解算——WYSIWYG 的物理保证。
> 与 share 现有 `SceneModelRenderer`（WE 逆向专用）的关系：**不改造、不复用代码，只复用经验**。WE 的像素坐标/父链矩阵/DXT 解码包袱不进新运行时；share 两条管线并存。

---

## 1. 为什么这样解算才"适合 web"

| WE 逆向渲染器的包袱（share 现状） | DWP 运行时的对应解法 |
| --- | --- |
| Canvas2D 主合成 + WebGL 粒子"贴饼"（`drawImage(glCanvas)` 拼接，z 序要分段切合成时机） | **单一 WebGL2 管线**：所有图层 = 纹理四边形，粒子 = 实例化四边形，效果 = RTT pass，z 序天然统一 |
| puppet 逐三角形 clip + 仿射 drawImage（CPU 光栅，离屏 canvas 堆） | **rigid 部件**：core 侧合成骨骼全局矩阵（2D 仿射父链复合，纯函数），部件 quad 直接进普通批处理——**运行时零新增代码路径**；skinned 部件走 GPU 顶点蒙皮（骨骼矩阵纹理，v1.0 可选实现） |
| Node 半解析 pkg/DXT/mipmap → HTTP 传纹理字节 → 浏览器再解码 | **资源即 web 原生格式**（png/webp/mp4）：`createImageBitmap` / `<video>` 直接上纹理，Node 半零参与 |
| WE 语义（orthographicprojection、projScale、父链累积）逐字段翻译 | 格式字段 1:1 映射 DOMMatrix / globalCompositeOperation / CSS easing，**没有翻译层** |
| 帧率驱动模拟，掉帧画面变快/变慢 | 固定 60 Hz 累加器 + 确定性 RNG（规范 §5），掉帧只掉画面不掉时间 |

## 2. 包分层（三层，边界即测试边界）

```
dwp-core      纯 TS，零 DOM/零 GL：文档类型 + schema 校验 + 时间求值 + 粒子模拟 + 布局解算
              └─ 输出：RenderPlan（每帧的扁平绘制指令）
dwp-gl        WebGL2 执行器：消费 RenderPlan → 画布。四边形批处理 + 实例化粒子 + RTT 效果链
dwp-web       组装层：资源加载（ImageBitmap/video）、时钟、RAF 循环、Canvas2D 降级、生命周期
```

- **core 是纯函数**：`evaluate(doc, t, viewport, overrides) → RenderPlan`。可单测、可跑 golden-frame 一致性测试（Node 里就能跑，不需要浏览器）；
- `dsh-wallpaper_edit` 只依赖 core + gl + 一个交互层；share 只依赖 dwp-web（渲染 + 内置 market 拉取）；engine（若采纳）同样三件套——**这就是"技术手册可被任何插件适配"的工程形态**；
- RenderPlan 是稳定契约：将来加 WebGPU 执行器只换 dwp-gl。

## 3. RenderPlan（core ↔ 执行器的帧契约）

```ts
interface RenderPlan {
  clear: { color: string }
  steps: RenderStep[]            // 已按 z 序展开（图层 + 效果 pass 交织）
  resources: PlanResource[]      // 本帧引用的纹理/视频句柄 id（执行器做 LRU 驻留）
}
type RenderStep =
  | { op: 'quad';  tex: string; verts: Float32Array; uv: Float32Array;
      blend: BlendName; alpha: number; matrix: DOMMatrixInit; tint?: string }
  | { op: 'particles'; tex: string; buffer: ParticleBuffer; count: number;
      blend: BlendName; colorA: string; colorB: string }        // 实例化绘制，属性来自 core 的 TypedArray
  | { op: 'pass';  effect: EffectName; params: UniformValues;
      inputs: TargetId[]; target: TargetId }                     // RTT：读 src → shader → 写 dst
  | { op: 'blit';  src: TargetId; dst: TargetId; blend: BlendName }
```

core 每帧产出 plan（对象池复用，编辑态 60 fps 无 GC 压力）；执行器无脑顺序执行。
效果链在 core 里被展开成 pass 序列（如 `blur` = downsample→gaussX→gaussY→combine 4 个 pass），执行器只需实现 ~6 个通用 shader 模板。

## 4. WebGL2 管线要点

1. **四边形批处理**：同 blend 的连续 quad 合批（一次 draw call）；变换在 core 侧乘进顶点（无 uniform 切换）；
2. **粒子**：每发射器一次 instanced draw，实例属性（pos/rot/size/color/alpha）由 core 的 `Float32Array` 直接 `bufferSubData`——share 的 `ParticleGL.ts` 已验证此路（预乘 alpha + `lighter`），移植语义、重写接口；
3. **效果 = shader 模板 + uniform 表**：UV 扰动族共用一个模板（waterwaves/ripple/shake 是参数差异）；颜色族一个模板；blur 是 4-pass 模板。全部 GLSL ES 3.0，**不解释第三方 shader**（那是 engine 的 GLSL 解释器路线，DWP 明确不做——白名单效果 + 版本演进代替任意代码）；
4. **视频层**：`<video>` → `texImage2D` 每帧上传（浏览器硬解，成本可接受；同分辨率多实例共享解码器）；
5. **文本**：Canvas2D 渲染到小纹理 → 上传（标准做法；`{time:HH:mm}` 占位符每秒更新一次纹理）；
6. **puppet**：rigid = core 已把骨骼矩阵乘进 quad（执行器无感知）；skinned = 骨骼矩阵打包进 float 纹理（2D 仿射每骨 2×vec2），顶点属性带 `boneIndices/weights`，顶点着色器加权复合——一次 instanced/常规 draw call；
7. **目标管理**：全屏效果用 1 张屏幕尺寸 RTT + 半分辨率链（blur/glow），按视口尺寸重建，上限 4K；
8. **降级**：无 WebGL2 → Canvas2D 执行器（消费同一 plan：quad→drawImage，pass→跳过并上报 `degraded`）。share 现有 Canvas2D 经验直接指导这层。

## 5. 编辑器（dsh-wallpaper_edit）在解算栈上的位置

```
┌─ dsh-wallpaper_edit 插件（DSH client tab）─────────────┐
│ 文档模型(JSON) ←→ 命令栈(JSON Patch，undo/redo)        │
│ 图层树 / 属性面板(params 表单自动生成) / 资源导入(转换) │
│ puppet：骨骼树面板 + 画布拖骨定 bind + 部件挂骨(拖拽)   │
│         clip 时间轴(3 种 kind 的表单化编辑)             │
│ 画布 = dwp-core + dwp-gl（与消费端同一实例路径）        │
│ 交互层：hit-test(plan 四边形逆仿射 + alpha 采样)        │
│         gizmo 覆盖层(独立 2D canvas：选择框/锚点/拖拽)  │
│ 多视口：设计分辨率 + cover/contain 目标比例预览          │
│ 导出：打包 zip + 从 GL 画布 toBlob 生成 preview.jpg     │
│ 试装：写入 storages/dwp/staging/ → share 实时预览       │
└───────────────────────────────────────────────────────┘
```

- **编辑器不内嵌私有渲染逻辑**：预览、hit-test、导出缩略图全部走 core+gl，与 share 消费端逐像素同源；
- 文档是纯 JSON → undo/redo = JSON Patch 栈、diff 可视化、git 友好（源工程文件夹直接进版本库）；
- 资源导入即转换：拖入 psd 导出的 png / 任意 mp4；（v1.1 加 WE 工程导入器：scene.json → dwp scene.json 单向映射，只转换渲染子集支持的部件）。

## 6. 明确不做的（协议护栏）

| 不做 | 理由 |
| --- | --- |
| 自定义 shader / GLSL 解释 | 安全（市场内容=任意代码执行面）+ 一致性不可证 + engine 已占此路线 |
| SceneScript / 表达式脚本 | 用 params + 3 种动画 kind 覆盖 95% 需求；确定性不可保的字段一律不进 |
| 3D 相机 / 透视 | WE 场景实际使用率极低，2.5D 视差字段够用 |
| 二进制包格式 | JSON 可读可 diff 可 git；性能瓶颈在 GPU 不在解析 |
| 外链资源 / CDN 引用 | 包必须自包含（离线、审计、防失效） |

## 7. 落地顺序

| 步骤 | 交付 | 验收 |
| --- | --- | --- |
| R1 | `dwp-core`：类型 + schema + 时间求值 + 粒子模拟 + **骨骼链复合（rigid puppet）** + plan 产出 | Node 单测：golden 帧序列（确定性） |
| R2 | `dwp-gl`：quad/particles/pass 三类 step + skinned 蒙皮 + Canvas2D 降级 | 浏览器 demo 页跑通 examples/ 4 包 |
| R3 | `dwp-web` 组装 + `dsh-wallpaper_edit` 仓库规范区定稿（schema/examples/基准帧） | 一致性测试脚本（SSIM ≤ 阈值） |
| R4 | share 接入：market 拉取内置（浏览/安装/更新）+ 目录扫描 + `/dwp/capabilities` + params UI | 装包→显示→调参→持久化闭环 |
| R5 | `dsh-wallpaper_edit` 插件本体：图层树/属性面板/画布交互/**骨骼编辑（拖骨+挂部件）**/导出/试装 | 从零做一张 puppet 呼吸壁纸并发布 |

> R1–R3 是编辑器的硬依赖；R4 可与 R3 并行（接口已定）。仓库布局：`dsh-wallpaper_edit`（规范 + 编辑器插件同仓）、`dwp-runtime-web`（core/gl/web 单仓三包）、`dsh-wallpaper_share`（渲染 + market 拉取）、注册表为纯数据仓库（`dwp-registry`，索引 + validate Action）。
