import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validatePackageBytes,
  fnv1a64,
  sourceVersionConst,
  cargoPackageVersion,
  binaryVersionTag,
  binaryBuildFingerprint,
  nativeSourceFiles,
  nativeSourceFingerprint,
  checkNativeArtifacts,
} from './check-package.mjs';
const valid = Buffer.from(JSON.stringify({ name: 'fixture', version: '1.0.0', description: '中文' }));
test('accepts BOM-free UTF-8 including Chinese', () => assert.equal(validatePackageBytes(valid).description, '中文'));
test('rejects PowerShell 5.1 UTF-8 BOM', () => assert.throws(() => validatePackageBytes(Buffer.concat([Buffer.from([239,187,191]), valid])), /without BOM/));
test('rejects invalid UTF-8 and malformed JSON', () => {
  assert.throws(() => validatePackageBytes(Buffer.from([255])));
  assert.throws(() => validatePackageBytes(Buffer.from('{')));
});

// 交叉验证 FNV-1a 64 实现（build.rs 用同样的常量与顺序）：用公开发布的测试向量，
// 否则 JS 与 Rust 两侧「各自自洽但互不相容」会让发布门禁永远失败或永远通过。
test('fnv1a64 matches the published FNV-1a 64 test vectors', () => {
  assert.equal(fnv1a64(Buffer.from('')).toString(16), 'cbf29ce484222325');
  assert.equal(fnv1a64(Buffer.from('a')).toString(16), 'af63dc4c8601ec8c');
  assert.equal(fnv1a64(Buffer.from('foobar')).toString(16), '85944171f73967e8');
});

test('parses native version constants', () => {
  assert.equal(sourceVersionConst('const VERSION: &str = "we-capture-0.4.1";'), 'we-capture-0.4.1');
  assert.equal(sourceVersionConst('// 没有版本常量'), null);
  assert.equal(
    cargoPackageVersion('[package]\nname = "we-capture"\nversion = "0.4.1"\n\n[dependencies]\nwindows = { version = "0.58" }'),
    '0.4.1',
  );
});

test('finds embedded build markers in binary bytes', () => {
  const bin = Buffer.concat([
    Buffer.from([0x4d, 0x5a]),
    Buffer.from('....we-capture-0.3.0....we-capture-build src=0123456789abcdef....'),
  ]);
  assert.equal(binaryVersionTag(bin, 'we-capture'), 'we-capture-0.3.0');
  assert.equal(binaryBuildFingerprint(bin, 'we-capture'), '0123456789abcdef');
  assert.equal(binaryBuildFingerprint(bin, 'we-floater'), null);
});

test('repository native binaries are in sync with the native source', () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  assert.ok(nativeSourceFiles(root).includes('src/main.rs'));
  assert.match(nativeSourceFingerprint(root), /^[0-9a-f]{16}$/);
  const info = checkNativeArtifacts(root);
  assert.equal(info.fingerprint, nativeSourceFingerprint(root));
});

test('rejects a stale native binary (version and source fingerprint mismatch)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wesync-check-'));
  try {
    mkdirSync(join(dir, 'native', 'we-capture', 'src', 'bin'), { recursive: true });
    mkdirSync(join(dir, 'bin'), { recursive: true });
    writeFileSync(join(dir, 'native', 'we-capture', 'Cargo.toml'), '[package]\nname = "we-capture"\nversion = "0.4.1"\n');
    writeFileSync(join(dir, 'native', 'we-capture', 'src', 'main.rs'), 'const VERSION: &str = "we-capture-0.4.1";\n');
    writeFileSync(join(dir, 'native', 'we-capture', 'src', 'bin', 'we-floater.rs'), 'const VERSION: &str = "we-floater-0.4.1";\n');
    // 伪造「源码已 0.4.1、bin/ 里还是 0.3.0」的过期产物（正是本次 issue 的真实形态）
    const stale = Buffer.concat([
      Buffer.from([0x4d, 0x5a]),
      Buffer.alloc(5000, 0x20),
      Buffer.from('we-capture-0.3.0 we-capture-build src=0000000000000000'),
    ]);
    writeFileSync(join(dir, 'bin', 'we-capture.exe'), stale);
    writeFileSync(join(dir, 'bin', 'we-floater.exe'), stale);
    assert.throws(() => checkNativeArtifacts(dir), /不一致/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
