#!/usr/bin/env node
/**
 * 重建随包发布的原生产物，并把结果拷进 bin/：
 *   cargo build --release --bins                （在 native/we-capture 下）
 *   target/release/{we-capture,we-floater}.exe  → bin/
 * 结束后用 check-package 的同一套校验确认「版本 + 源码指纹」都对得上，不同步即非零退出。
 *
 * 为什么要有这个脚本：bin/ 里的 exe 是提交进仓库、由发布 CI 直接打包的（CI 不重编原生程序），
 * 「手工 cargo build + 手工拷贝」漏任何一步都会静默发出旧二进制 ——
 * 26.9.12 ~ 26.9.29 就是这样漏了三版：源码 0.4.0（事件驱动出帧），包内 0.3.0（100ms 轮询捡帧），
 * 用户侧表现为壁纸只有 ~6–8fps。
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { checkNativeArtifacts, NATIVE_BINARIES } from './check-package.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const nativeDir = join(root, 'native', 'we-capture');

if (process.platform !== 'win32') {
  console.error('原生产物是 Windows 二进制，只能在 Windows 上重建（当前 ' + process.platform + '）');
  process.exit(1);
}

// Rust 工具链装在含非 ASCII 字符的用户目录时，mingw 链接器会因路径编码找不到 sysroot 库
// （`ld: cannot find ...\crt2.o`；目录联接没用，rustc 会把联接解析回真实路径）。
// 仓库里若已备好 ASCII 路径的工具链副本（.build-junc/rt，见 README「原生捕获器」），默认用它。
if (process.env.RUSTUP_HOME === undefined) {
  const alt = join(root, '.build-junc', 'rt');
  if (existsSync(join(alt, 'settings.toml'))) {
    process.env.RUSTUP_HOME = alt;
    console.log('RUSTUP_HOME ← ' + alt + '（检测到 ASCII 路径的工具链副本）');
  }
}
if (process.env.CARGO_HOME === undefined) {
  const alt = join(root, '.build-junc', 'cargo');
  if (existsSync(alt)) {
    process.env.CARGO_HOME = alt;
    console.log('CARGO_HOME ← ' + alt);
  }
}

console.log('$ cargo build --release --bins  (cwd ' + nativeDir + ')');
const cargo = process.platform === 'win32' ? 'cargo.exe' : 'cargo';
const build = spawnSync(cargo, ['build', '--release', '--bins'], { cwd: nativeDir, stdio: 'inherit' });
if (build.error) {
  console.error('无法执行 ' + cargo + '：' + build.error.message + '（需要 Rust 工具链）');
  process.exit(1);
}
if (build.status !== 0) {
  console.error('cargo build 失败（exit ' + String(build.status) + '）');
  process.exit(build.status ?? 1);
}

for (const spec of NATIVE_BINARIES) {
  const from = join(nativeDir, 'target', 'release', spec.exe);
  if (!existsSync(from)) {
    console.error('缺少构建产物 ' + from);
    process.exit(1);
  }
  copyFileSync(from, join(root, 'bin', spec.exe));
  console.log('bin/' + spec.exe + '  ←  ' + from);
}

const info = checkNativeArtifacts(root);
console.log('原生产物已与 native 源码同步（v' + info.version + ', src ' + info.fingerprint + '）');
