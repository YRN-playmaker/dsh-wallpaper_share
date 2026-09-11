# AI 开发规则

修改本仓库前先阅读 [编码与发布规范](docs/encoding-and-release.md)。该规则适用于所有 AI 代理及自动化脚本。

- package.json 必须是 UTF-8 无 BOM。不要用 Windows PowerShell 5.1 的 Set-Content -Encoding UTF8 或 Out-File 改写 JSON。
- 修改版本号使用 npm version <版本号> --no-git-tag-version，或 Node.js 的 fs.writeFileSync(path, text, 'utf8')。不要自动提交、打标签或发布。
- 不要全仓库删除 BOM；含中文的 Windows PowerShell 5.1 脚本可能有不同编码要求。
- 修改清单后运行 npm run check:package 和 npm run test:package。构建后、打包前再次检查。
- 后端挂载成功不能代替前端验证；发布前确认 wallpaper_share 标签页出现、浏览器没有插件加载错误。
- 保留用户已有改动，勿覆盖无关工作。
