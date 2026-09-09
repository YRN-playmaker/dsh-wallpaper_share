// 工作区脉搏内置 DWP：生成 .dwp 并（可选）安装到本地市场库。
// 用法：
//   node _dev/make-workspace-pulse.mjs out.dwp            # 仅生成包
//   node _dev/make-workspace-pulse.mjs --install          # 生成并装到 ~/.dsh-dwp-market（覆盖已有）
// 纯 src 组装（buildPulsePackage），与插件启动时的自动入库完全同字节。
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { buildPulsePackage, PULSE_ID, PULSE_VERSION } from '../src/workspace/pack.ts';

const zip = buildPulsePackage();
const integrity = 'sha512-' + createHash('sha512').update(zip).digest('base64');

if (process.argv[2] === '--install') {
  const dir = join(homedir(), '.dsh-dwp-market');
  mkdirSync(join(dir, 'packages'), { recursive: true });
  writeFileSync(join(dir, 'packages', PULSE_ID + '.dwp'), zip);
  // 更新 installed.json（读改写，保留其它已装条目）
  const recFile = join(dir, 'installed.json');
  let list = [];
  try { list = JSON.parse(readFileSync(recFile, 'utf8')); } catch { /* 首次 */ }
  list = list.filter((r) => r.id !== PULSE_ID);
  list.push({
    id: PULSE_ID, version: PULSE_VERSION, integrity,
    sourceUrl: 'builtin:workspace-pulse', path: 'packages/' + PULSE_ID + '.dwp',
    installedAt: new Date().toISOString(), commercial: false,
  });
  writeFileSync(recFile, JSON.stringify(list, null, 2) + '\n');
  console.log(JSON.stringify({ installed: join(dir, 'packages', PULSE_ID + '.dwp'), size: zip.length, integrity }));
} else {
  const out = process.argv[2] ?? PULSE_ID + '.dwp';
  writeFileSync(out, zip);
  console.log(JSON.stringify({ out, size: zip.length, integrity }));
}
