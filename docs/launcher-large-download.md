# 启动器大文件下载

下载使用 Node 流管道，将 HTTP 响应直接写入安装盘上的独立暂存目录。管道按磁盘写入速度施加背压，逐块计数和计算 SHA-512；不调用 `response.arrayBuffer()`，也不拼接整包 Buffer。文件名、实收大小和校验值仍用于原来的安装记录。

安装过程直接使用下载文件。单个可执行文件在同盘改名落位；ZIP、7z 和嵌套包使用文件路径处理。压缩体积加声明展开体积不超过 32 MiB 的普通 ZIP 使用原有内置密码读取器，其余 ZIP 和所有 7z 使用本机 7-Zip 或 Bandizip。ZIP64 使用外部解压器。视频后追加的 7z 使用固定大小缓冲区扫描签名，再流式复制压缩段。

ZIP 原始中央目录在解压前从磁盘读取并检查，目录本身最多 16 MiB，支持标准 ZIP64 目录。外部解压器异步运行，先列文件清单检查路径、链接、条目数量和展开总量，再解压到独立暂存目录，检查产物后移入安装暂存。密码错误仍返回原有错误码。安装成功或失败都会释放本次下载和解压暂存，正式应用仍按原来的暂存替换流程更新。

当前限制：下载最多 64 GiB、每层压缩包最多 20,000 项和 128 GiB 展开数据、嵌套最多三层。传输压缩后的响应按实际解码字节数计数。明确声明超限会取消响应流；传输中实际超限会关闭管道；空内容、截断和不完整的 HTTP 206 响应会拒绝安装。中途网络失败需重新下载，尚未实现断点续传。

安装盘需要同时容纳下载包和展开数据；媒体追加的 7z 还会暂存压缩段。流式下载消除了整包内存分配，但外部解压器自身的内存需求仍取决于压缩算法和字典大小。

## 验证

常规回归：`npm test`、`npm run typecheck`、`npm run check:package`、`npm run test:package`。真实解压测试在未安装外部解压器时跳过。

Windows PowerShell 大文件压力验证（生成并自动清理约 10 GiB 临时数据）：

```powershell
$env:WESYNC_LARGE_DOWNLOAD_TEST = '1'
node --max-old-space-size=96 --test src/launcher/test/stream-download.test.ts
Remove-Item Env:WESYNC_LARGE_DOWNLOAD_TEST
```

该测试通过本机 HTTP 下载包含 5 GiB 文件的 ZIP64，核对实收长度及 SHA-512，再调用真实解压器从磁盘解压，验证产物尺寸和暂存清理，并检查 Node 进程峰值内存小于 384 MiB。压力测试单独运行，避免其他测试的内存影响测量。

2026-10-12 验证环境：Windows、Node v24.19.0、Bandizip bz 7.40 Beta。96 MiB JavaScript 堆限制下，3 GiB ZIP 下载、校验和解压全部通过，Node 峰值 RSS 约 123 MiB。此结果不包含解压器子进程的内存。此项为此前的 3 GiB 验证记录。

2026-10-13：同一 Windows / Node v24.19.0 / Bandizip 7.40 环境，真实 HTTP 5 GiB ZIP64 下载、SHA-512 校验与磁盘解压全部通过，96 MiB JS 堆限制下 Node 峰值 RSS 118 MiB（不包含解压器子进程）。超过 4 GiB 的文件不会再触发原来的下载上限。

发布验证：插件 26.10.13-D 的 Windows / Linux GitHub 包检查与常规回归通过；独立 Harness 0.1.0-rc.6 安装实际 tgz 后前端标签可见且无加载错误。5 GiB 压力测试在 Windows 独立运行，Linux CI 不重复该磁盘压力测试。[发布记录](../_dev/PUBLISH-daynight.md)。
