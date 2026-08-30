# dsh-wallpaper_edit — DSH 壁纸制作插件 & DWP 协议

> **状态：v0.4.1 协议草案（2026-08）· 实现设计定稿（`docs/`）· R1（`@dwp/core`）+ R2（`@dwp/gl` WebGL2 执行器）+ R3（`@dwp/web` 组装层：mount/Handle + Canvas2D 降级）完成，运行时工作区 104 测试全绿；`dwp-registry` 收录地基就绪（分片 YAML→catalog + 商业模型硬校验，25 测试）；GL 视觉路径待浏览器 demo 验收** · 规范文本 © CC-BY-4.0 · schemas 与 examples © MIT
>
> 本仓库是 **DSH 壁纸制作插件**的主仓库，同时是 **DWP（DSH Wallpaper Package）格式的唯一事实源**：
> 协议文档（README 正文）、JSON Schema（`schemas/`）、参考壁纸包（`examples/`）、一致性判据（`conformance/`）、实现设计（`docs/design-runtime.md` 工具层 · `docs/design-editor.md` 编辑器）。
> 设计立场：**编辑器产出什么，规范就定义什么**——格式只收录制作端可编辑、渲染端已实现的能力，WYSIWYG 由协议保证。
> 编辑器代码（图层树 / 骨骼编辑 / 粒子参数 / 导出发布）将落在本仓库 `src/`，预览复用 `dwp-runtime-web` 参考实现（其 API/算法级设计见 `docs/design-runtime.md`）。

**生态分工**：

| 仓库 | 角色 |
| --- | --- |
| `dsh-wallpaper_edit`（本仓库） | 壁纸制作 + 协议事实源（规范/schema/示例/一致性） |
| `dsh-wallpaper_share` | 渲染消费端：WE 实时同步 + dwp 渲染 + **内置 market 拉取**（浏览/安装/更新） |
| `dwp-runtime-web` | 参考运行时（core/gl/web，MIT），编辑器与渲染器共用解算 |
| `dwp-registry` | 纯数据注册表：分片 entries + 构建 catalog.json + PR 校验 Action + TAKEDOWN + 许可模板 |

---

