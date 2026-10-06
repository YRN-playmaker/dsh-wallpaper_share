import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname, join, relative, sep } from 'node:path';

// Deliberately reject BOM rather than hiding a broken published manifest.
export function validatePackageBytes(bytes) {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    throw new Error('package.json must be UTF-8 without BOM. See docs/encoding-and-release.md');
  }
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const pkg = JSON.parse(text);
  if (!pkg || typeof pkg !== 'object' || typeof pkg.name !== 'string' || typeof pkg.version !== 'string') {
    throw new Error('package.json requires name and version');
  }
  return pkg;
}

/* ── 原生二进制同步校验 ────────────────────────────────────────────────
 * bin/ 里的 exe 由仓库提交、发布 CI 直接打包（CI 不重编原生程序），所以「改了 native 源码
 * 却忘了 cargo build / 忘了把产物拷进 bin/」会把旧二进制静默发出去：
 * 26.9.12 ~ 26.9.29 的 we-capture.exe 一直停在 0.3.0（每次唤醒只捡一帧 + 100ms 轮询），
 * 而源码早就是 0.4.0 的 FreeThreaded 事件驱动出帧 —— 用户实测壁纸只有 ~8fps，
 * 分辨率/画质/可见性全都救不回来（与像素量无关的 ~95ms 固定开销就是这个 100ms 轮询）。
 *
 * 下面两项校验都不执行 Windows 产物，纯字节扫描，Linux CI 同样生效：
 *   1. 版本三方一致：Cargo.toml 的 package.version = 源码 VERSION 常量 = 产物内嵌版本；
 *   2. 源码指纹一致：产物内嵌的 src 指纹 = 现算 native/we-capture/src/**\/*.rs 指纹。
 * 指纹算法与 native/we-capture/build.rs 必须逐字节一致（FNV-1a 64）。
 */

/** 随包发布的原生产物：exe 名 → 版本常量所在源码 / 标记前缀 */
export const NATIVE_BINARIES = [
  { exe: 'we-capture.exe', rs: 'src/main.rs', prefix: 'we-capture' },
];

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK64 = 0xffffffffffffffffn;

/** FNV-1a 64（与 native/we-capture/build.rs 的实现一致） */
export function fnv1a64(bytes, seed = FNV_OFFSET) {
  let h = seed & MASK64;
  for (const b of bytes) h = ((h ^ BigInt(b)) * FNV_PRIME) & MASK64;
  return h;
}

/** native crate 根目录 */
export function nativeRoot(root) {
  return join(root, 'native', 'we-capture');
}

/** src 下所有 .rs 的相对路径（正斜杠、升序）——与 build.rs 的 collect + sort 结果一致 */
export function nativeSourceFiles(root) {
  const base = nativeRoot(root);
  const out = [];
  const walk = (dir) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.rs')) out.push(relative(base, p).split(sep).join('/'));
    }
  };
  walk(join(base, 'src'));
  return out.sort();
}

/** native 源码指纹：16 位十六进制；CRLF 规范为 LF（与 build.rs 一致） */
export function nativeSourceFingerprint(root) {
  const base = nativeRoot(root);
  let h = FNV_OFFSET;
  for (const rel of nativeSourceFiles(root)) {
    h = fnv1a64(Buffer.from(rel, 'utf8'), h);
    h = fnv1a64(Buffer.from([0x00]), h);
    const bytes = readFileSync(join(base, rel));
    const normalized = Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
    h = fnv1a64(normalized, h);
    h = fnv1a64(Buffer.from([0xff]), h);
  }
  return h.toString(16).padStart(16, '0');
}

/** 取 Rust 源码里的 `const VERSION: &str = "..."` */
export function sourceVersionConst(text) {
  const m = /const\s+VERSION:\s*&str\s*=\s*"([^"]+)"/.exec(text);
  return m === null ? null : m[1];
}

/** 取 Cargo.toml 的 package.version（文件里第一处 version = 即 [package] 的） */
export function cargoPackageVersion(text) {
  const m = /^\s*version\s*=\s*"([^"]+)"/m.exec(text);
  return m === null ? null : m[1];
}

/** 在产物里搜内嵌的构建标记前缀（PE 里是明文 ASCII） */
export function binaryBuildFingerprint(bytes, prefix) {
  const m = new RegExp(prefix + '-build src=([0-9a-f]{16})').exec(bytes.toString('latin1'));
  return m === null ? null : m[1];
}

/** 在产物里搜内嵌的版本串（如 we-capture-0.4.1） */
export function binaryVersionTag(bytes, prefix) {
  const m = new RegExp(prefix + '-(\\d+\\.\\d+\\.\\d+)').exec(bytes.toString('latin1'));
  return m === null ? null : m[0];
}

/** 校验 bin/ 里的原生产物与 native 源码同步；不一致直接抛错（构建 / 发布门禁） */
export function checkNativeArtifacts(root) {
  const base = nativeRoot(root);
  const cargo = cargoPackageVersion(readFileSync(join(base, 'Cargo.toml'), 'utf8'));
  const fingerprint = nativeSourceFingerprint(root);
  const problems = [];
  for (const spec of NATIVE_BINARIES) {
    const srcVer = sourceVersionConst(readFileSync(join(base, spec.rs), 'utf8'));
    if (srcVer === null) {
      problems.push(spec.rs + ' 里找不到 `const VERSION: &str = "..."`');
      continue;
    }
    // VERSION 常量带二进制名前缀（we-capture-0.4.1），Cargo.toml 只有数字（0.4.1）
    const srcSemver = srcVer.startsWith(spec.prefix + '-') ? srcVer.slice(spec.prefix.length + 1) : srcVer;
    if (cargo !== srcSemver) {
      problems.push('Cargo.toml 的 package.version (' + String(cargo) + ') ≠ ' + spec.rs + ' 的 VERSION (' + srcVer + ')');
    }
    const exePath = join(root, 'bin', spec.exe);
    if (!existsSync(exePath)) {
      problems.push('缺少 bin/' + spec.exe);
      continue;
    }
    const bytes = readFileSync(exePath);
    if (bytes.length < 4096 || bytes[0] !== 0x4d || bytes[1] !== 0x5a) {
      problems.push('bin/' + spec.exe + ' 不是有效的 Windows 可执行文件（' + bytes.length + ' 字节）');
      continue;
    }
    const exeVer = binaryVersionTag(bytes, spec.prefix);
    if (exeVer !== srcVer) {
      problems.push('bin/' + spec.exe + ' 内嵌版本 ' + String(exeVer) + ' ≠ 源码 ' + srcVer);
    }
    const exeFp = binaryBuildFingerprint(bytes, spec.prefix);
    if (exeFp !== fingerprint) {
      problems.push(
        'bin/' + spec.exe + ' 与 native 源码不同步（内嵌指纹 ' + String(exeFp) + ' ≠ 现算 ' + fingerprint + '）' +
        '——即改过 native/we-capture/src 但没重建或没把产物拷进 bin/',
      );
    }
  }
  if (problems.length > 0) {
    throw new Error(
      '原生二进制与 native 源码不一致：\n  - ' + problems.join('\n  - ') +
      '\n修复：npm run build:native（cargo build --release --bins + 拷进 bin/）',
    );
  }
  return { version: cargo, fingerprint };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const pkg = validatePackageBytes(readFileSync(resolve(root, 'package.json')));
  for (const key of ['.', './client']) {
    const entry = pkg.exports?.[key];
    if (typeof entry !== 'string' || !entry.startsWith('./') || !existsSync(resolve(root, entry))) {
      throw new Error('Missing package export: ' + key);
    }
  }
  const native = checkNativeArtifacts(root);
  console.log('Package encoding, JSON and host/client entry files OK');
  console.log('Native binaries in sync with native/we-capture source (v' + native.version + ', src ' + native.fingerprint + ')');
}
