# vendor/dwp — DWP 参考运行时（构建期内联源码）

本目录是 **`dwp-runtime-web` 三包运行时的源码快照**，供本仓库构建时通过 tsdown 的
`resolve.alias` 直接内联进 `lib/client.js`。它不是 npm 依赖，也不参与运行时解析 ——
打包后 `dwp-core` / `dwp-gl` / `dwp-web` 全部消失为内联代码。

## 为什么放进版本库

此前 `dwp-runtime-web/` 只是本机的一个独立 git 仓克隆，且被 `.gitignore` 忽略：
终端用户从 npm / GitHub 装到的是已内联的预构建 `lib/`，不受影响；但**干净 clone 后
`pnpm build` 拿不到源码**，旧配置在目录缺失时会把 alias 置空，从而静默产出带着
无法解析的 `require('dwp-web')` 的坏包。把源码快照纳入版本控制后，
`git clone → pnpm install → pnpm build` 在任意机器上都能复现。

## 来源与版本

| 项 | 值 |
| --- | --- |
| 上游仓库 | `dwp-runtime-web`（单仓三包） |
| 上游 commit | `83e9c26095da37fbb5a89277d4fd5f8a95d7ae65`（2026-08-30） |
| 快照范围 | `packages/{dwp-core,dwp-gl,dwp-web}/src/**` + 各自 `package.json` |
| 各包版本 | 均为 `0.1.0` |
| 许可证 | MIT（见各包 `package.json` 的 `license` 字段；上游未附 LICENSE 文件） |

三包均为 `"main": "src/index.ts"`、`"type": "module"` 的纯 TypeScript 源码，
**无需编译**即可被 tsdown 直接消费，因此快照只需 `src/`。包间依赖只有
`dwp-core` / `dwp-gl` 两个裸模块名，正好由构建配置里的三个 alias 覆盖。

## 构建如何消费

三包在构建期由 **两处**配置指向本目录，两者都指向 `vendor/dwp`，缺一不可：

1. `tsconfig.json` 的 `compilerOptions.paths` —— rolldown 实际优先使用的解析入口，
   同时供 `pnpm typecheck` 与编辑器使用
2. `tsdown.config.ts` 的**顶层** `alias` —— 由 `resolveDwpRoot()` 计算

> 历史坑：该 `alias` 原先写在 `resolve.alias` 下，而 tsdown 0.22 只从 Vite 配置里读
> `resolve.alias`（见其 `options-*.mjs`），那段配置从未生效；当时的解析全靠
> `tsconfig.json` 的 `paths` 指向被 gitignore 的克隆目录，所以干净 clone 必然失败。

`resolveDwpRoot()` 按以下优先级解析运行时根目录，任一路径缺少
`packages/{dwp-core,dwp-gl,dwp-web}/src/index.ts` 就**直接报错终止构建**
（不再静默降级成带未解析 `require('dwp-web')` 的坏包）：

1. 环境变量 `DSH_WESYNC_DWP_DIR`（显式指定，用于改运行时源码时的联调）
2. `vendor/dwp`（本目录，默认，保证可复现）

改运行时并想让构建用你的实时克隆：

```bash
DSH_WESYNC_DWP_DIR=../dwp-runtime-web pnpm build   # Windows PowerShell: $env:DSH_WESYNC_DWP_DIR='..\dwp-runtime-web'; pnpm build
```

注意：`DSH_WESYNC_DWP_DIR` 只影响打包，`tsconfig.json` 的 `paths` 是静态的，
类型检查仍解析到本目录的快照。

## 如何更新快照

在上游仓 `dwp-runtime-web` 检出目标 commit 后：

```bash
# 以仓库根为工作目录
for p in dwp-core dwp-gl dwp-web; do
  rm -rf vendor/dwp/packages/$p/src
  cp -r ../dwp-runtime-web/packages/$p/src vendor/dwp/packages/$p/src
  cp ../dwp-runtime-web/packages/$p/package.json vendor/dwp/packages/$p/package.json
done
```

随后同步更新本文件「上游 commit」一行，并重新构建核对 `lib/client.js` 的
内联结果（`grep -c 'collectAssetRefs' lib/client.js` 应 ≥ 1，且产物内不应出现
`require("dwp-web")`）。

## 本地补丁（更新快照时需重新套用）

快照在本仓内有两处附加式小补丁（上游合并/更新快照后需重新检查）：

1. **dwp-core `eval.ts`：文本层 `$var` 替换** — 新增并导出 `formatVars(value, vars)`，
   text 层求值时先 `formatPlaceholders` 再做子串级 `$name` 替换（未定义变量原样保留）。
   协议 §2 的 `$var` 本是整串替换（数值/颜色字段）；文本组合文案（如 `"近期改动 ● $ws_count"`）
   需要子串语义。整串 `$name` 仍被 collectVarRefs 收录、受编译期孤儿检查约束。
2. **dwp-web `mount.ts`：`Handle.setParams(map)` 批量参数覆写** — 等价逐个 `setParam`，
   但对 `doc.overrides` 做等值短路，只在表实际变化时重绘一次（实时数据源轮询喂食用）。

## 后续演进

多人维护 / 上 CI 时，可把本目录改为 pnpm workspace 成员或改为 git-tag / npm 依赖
（三包发布后 alias 即可删除）。届时删掉本目录与 `tsdown.config.ts` 的 alias 分支即可，
其余构建配置无需改动。
