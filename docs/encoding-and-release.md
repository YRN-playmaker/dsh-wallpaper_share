# 编码与发布规范

## 事故来源

2026-09-11 06:10:00 的开发会话为升级到 26.9.11-T，使用 Get-Content / -replace / Set-Content -NoNewline -Encoding UTF8 改写 package.json。Windows PowerShell 5.1 的该编码选项会写入 UTF-8 BOM。06:10:36 的提交 4c98286 将版本号变化和 BOM 一起提交；前一个版本没有 BOM。

BOM 不是插件功能或中文支持的需要。harness 的部分清单读取直接使用 JSON.parse：后端可能启动失败，前端可能吞掉解析异常并跳过插件。显式 link 依赖解释了外部目录的加载，不应将问题误判为 SceneRenderer 污染模块路径。

## 文件写入规则

- package.json 和供 Node.js 直接解析的 JSON 必须保存为 UTF-8 无 BOM。
- 优先使用 Node.js fs.writeFileSync(path, text, 'utf8')；已有 BOM 可在明确修复流程中去除，但发布检查必须拒绝它，不能静默掩盖。
- 更新版本号：npm version <版本号> --no-git-tag-version。该操作可能同步更新 npm 锁文件；若存在 pnpm 锁文件，也需核对其一致性。
- PowerShell 5.1 必须写 JSON 时，使用 [IO.File]::WriteAllText(path, text, [Text.UTF8Encoding]::new($false))。读取 UTF-8 文件也应显式指定编码。
- PowerShell 7 可显式使用 utf8NoBOM；不能假定名为 pwsh 的工具实际运行的是 PowerShell 7。
- 不对 .ps1 执行批量去 BOM。Windows PowerShell 5.1 对含中文脚本的识别另有要求。
- .editorconfig 仅辅助编辑器；最终以自动检查结果为准。

## 检查与发布

1. 修改清单后运行 npm run check:package 和 npm run test:package。
2. npm run build / npm run bundle 会先检查清单。构建版本必须与清单一致。
3. npm pack / npm publish 的 prepack 会再次检查；发布工作流还会显式运行检查及回归测试，不需要安装依赖。
4. 打包后解开实际 tarball，核对 package/package.json 无 BOM 且 host/client 入口存在。不要仅检查开发目录。
5. 在干净 checkout、独立 DSH_HOME 中安装实际包，验证启动、新会话和 wallpaper_share 标签页。不得用开发机 link 安装成功代替发布包验证。
6. 记录测试使用的 harness 版本、Node 版本和操作系统；至少覆盖 Windows 与发布 CI 的 Linux。
7. 确认后再由维护者选择新版本发布。不要覆盖已发布版本，不要仅修本地而忘记提交。

## 故障排查

已挂载但不显示时，分别检查 host 与 client：清单编码、前端加载列表、浏览器错误、构建产物、插槽依赖。不要先要求用户重装 harness 或删除历史会话。会话序号损坏是独立问题；没有证据时不能归因于壁纸插件。

参考：https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_character_encoding
