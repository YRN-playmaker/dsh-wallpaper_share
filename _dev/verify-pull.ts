// 端到端验证：真实 MarketClient 打线上 dwp-registry catalog + dwp-releases 包。
// 证明 R4 后端拉取闭环（fetch catalog → download → sha512 verify → 落盘 → installed）对真数据可用。
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MarketClient } from '../src/market/pull.ts';

const dir = mkdtempSync(join(tmpdir(), 'dwp-e2e-'));
const m = new MarketClient({ dir });
const cat = await m.catalog('https://raw.githubusercontent.com/YRN-playmaker/dwp-registry/main/data/catalog.json');
console.log('catalog:', cat.entries.length, 'entries →', cat.entries.map((e) => e.id).join(', '));

const cd = cat.entries.find((e) => e.id === 'yrn.clock-desk');
if (!cd) { console.error('FAIL: catalog 无 clock-desk'); process.exit(1); }
console.log('clock-desk url:', cd.dwp.package.url);
console.log('clock-desk integrity:', cd.dwp.package.integrity.slice(0, 24) + '…', 'size:', cd.dwp.package.size);

const rec = await m.install(cd);   // 下载 + 校验 sha512 + 写盘
const file = join(dir, rec.path);
const bytes = readFileSync(file);
console.log('installed:', rec.id, 'v' + rec.version);
console.log('file on disk:', existsSync(file), 'bytes:', bytes.length, '(zip magic ' + bytes.slice(0, 4).toString('hex') + ')');
console.log('installed list:', m.installed().map((r) => r.id).join(', '));

// 付费项应被拒装（本轮 free-only 护栏）
const paid = cat.entries.find((e) => e.id === 'studio.aurora-paid');
try { await m.install(paid!); console.error('FAIL: 付费包竟被装了'); process.exit(1); }
catch (e) { console.log('paid install correctly refused:', (e as Error).name); }

console.log('\n✅ 端到端拉取闭环对线上真数据全部通过');
