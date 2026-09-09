import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkspacePulse, type PulseChange } from '../pulse.ts';

function tmpRoot(): string {
  return mkdtempSync(join(tmpdir(), 'ws-pulse-'));
}

/** 把文件 mtime 拨到指定时间（ms）——快照差分依赖 mtime/size，测试里手动控时。 */
function touchAt(file: string, ms: number): void {
  const d = new Date(ms);
  utimesSync(file, d, d);
}

test('首扫=基线：不产生改动', () => {
  const root = tmpRoot();
  try {
    writeFileSync(join(root, 'a.txt'), 'hello');
    const p = new WorkspacePulse(root, { ttlMs: 0 });
    p.scan();
    assert.equal(p.changes().length, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('新增文件 → sign + / kind add', async () => {
  const root = tmpRoot();
  try {
    const p = new WorkspacePulse(root, { ttlMs: 0 });
    p.scan();
    writeFileSync(join(root, 'new.ts'), 'export {}');
    const changes = p.scan();
    assert.equal(changes.length, 1);
    assert.equal(changes[0]!.name, 'new.ts');
    assert.equal(changes[0]!.sign, '+');
    assert.equal(changes[0]!.kind, 'add');
    assert.equal(changes[0]!.delta, changes[0]!.size);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('修改文件：变大 +，缩小 −', async () => {
  const root = tmpRoot();
  try {
    const f = join(root, 'doc.md');
    writeFileSync(f, '0123456789');
    const p = new WorkspacePulse(root, { ttlMs: 0 });
    p.scan();
    const t0 = Date.now();
    writeFileSync(f, '0123456789abcdef');
    touchAt(f, t0 + 50);
    let changes = p.scan();
    assert.equal(changes.length, 1);
    assert.equal(changes[0]!.sign, '+');
    assert.equal(changes[0]!.delta, 6);
    writeFileSync(f, 'ab');
    touchAt(f, t0 + 100);
    changes = p.scan();
    assert.equal(changes[0]!.sign, '-');
    assert.equal(changes[0]!.delta, -14);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('删除文件 → sign − / kind del', async () => {
  const root = tmpRoot();
  try {
    const f = join(root, 'gone.log');
    writeFileSync(f, 'x'.repeat(42));
    const p = new WorkspacePulse(root, { ttlMs: 0 });
    p.scan();
    rmSync(f);
    const changes = p.scan();
    assert.equal(changes.length, 1);
    assert.equal(changes[0]!.sign, '-');
    assert.equal(changes[0]!.kind, 'del');
    assert.equal(changes[0]!.delta, -42);
    assert.equal(changes[0]!.size, 42);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('跳过 node_modules/.git/dist；mtime 未变不报', () => {
  const root = tmpRoot();
  try {
    mkdirSync(join(root, 'node_modules/pkg'), { recursive: true });
    mkdirSync(join(root, '.git'));
    mkdirSync(join(root, 'dist'));
    writeFileSync(join(root, 'node_modules/pkg/x.js'), 'x');
    writeFileSync(join(root, '.git/HEAD'), 'ref');
    writeFileSync(join(root, 'dist/bundle.js'), 'b');
    writeFileSync(join(root, 'keep.txt'), 'k');
    const p = new WorkspacePulse(root, { ttlMs: 0 });
    p.scan();
    writeFileSync(join(root, 'keep.txt'), 'k2');
    const changes = p.scan();
    assert.equal(changes.length, 1);
    assert.equal(changes[0]!.rel, 'keep.txt');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('窗口淘汰：过期的改动不再出现', async () => {
  const root = tmpRoot();
  try {
    const p = new WorkspacePulse(root, { ttlMs: 0, windowMs: 30 });
    p.scan();
    writeFileSync(join(root, 'f.txt'), 'a');
    assert.equal(p.scan().length, 1);
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(p.scan().length, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('同路径多次改动去重保最新；最新在前', async () => {
  const root = tmpRoot();
  try {
    const p = new WorkspacePulse(root, { ttlMs: 0 });
    p.scan();
    writeFileSync(join(root, 'a.txt'), '1');
    p.scan();
    writeFileSync(join(root, 'b.txt'), '2');
    await new Promise((r) => setTimeout(r, 5));
    p.scan();
    writeFileSync(join(root, 'a.txt'), '333');
    const changes: PulseChange[] = p.scan();
    assert.equal(changes.length, 2);
    assert.equal(changes[0]!.rel, 'a.txt');       // 最新改动在前
    assert.equal(changes[0]!.kind, 'mod');
    assert.equal(changes[1]!.rel, 'b.txt');
    assert.equal(changes[1]!.kind, 'add');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('根目录不存在 → 不抛错', () => {
  const p = new WorkspacePulse(join(tmpdir(), 'no-such-dir-' + Date.now()));
  assert.doesNotThrow(() => p.scan());
  assert.equal(p.changes().length, 0);
});

test('深度/条目上限不失控', () => {
  const root = tmpRoot();
  try {
    let dir = root;
    for (let i = 0; i < 15; i++) { dir = join(dir, 'd'); mkdirSync(dir); }
    writeFileSync(join(dir, 'deep.txt'), 'x');
    const p = new WorkspacePulse(root, { ttlMs: 0, maxDepth: 5 });
    p.scan();
    writeFileSync(join(root, 'top.txt'), 'y');
    const changes = p.scan();
    // deep.txt 超深度不出现；top.txt 正常
    assert.ok(changes.every((c) => c.rel !== 'd/d/d/d/d/d/deep.txt'));
    assert.ok(changes.some((c) => c.rel === 'top.txt'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
