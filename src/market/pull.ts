/**
 * MarketClient（R4 market 拉取核心）：catalog → 下载 → 校验 → 安装 → 已装状态 → 更新检测。
 * 依赖注入 fetchFn/dir/now，Node 测试用假 fetch + 临时目录跑通全流程。
 * 付费包（commercial=true）拒绝自动下载，抛 NeedsPurchase（客户端据此打开销售页）。
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fetchCatalog, canAutoInstall, type Catalog, type CatalogEntry, type FetchFn } from './catalog.ts';
import { verifyIntegrity } from './integrity.ts';
import { InstalledStore, type InstalledRecord } from './store.ts';

export class NeedsPurchaseError extends Error {
  readonly salesUrl: string;
  readonly platform: string;
  constructor(salesUrl: string, platform: string) {
    super(`付费壁纸需经销售平台获取（${platform}）：${salesUrl}`);
    this.name = 'NeedsPurchaseError';
    this.salesUrl = salesUrl;
    this.platform = platform;
  }
}

export interface MarketDeps {
  dir: string;                 // 存储根（installed.json + packages/）
  fetchFn?: FetchFn;
  now?: () => string;
}

export class MarketClient {
  readonly store: InstalledStore;
  private fetchFn: FetchFn;
  private now: () => string;

  constructor(deps: MarketDeps) {
    this.store = new InstalledStore(deps.dir);
    this.fetchFn = deps.fetchFn ?? ((url) => fetch(url));
    this.now = deps.now ?? (() => new Date().toISOString());
  }

  catalog(url: string): Promise<Catalog> { return fetchCatalog(url, this.fetchFn); }

  /** 下载并校验一个免费包字节（size + sha512 integrity）。付费抛 NeedsPurchase。 */
  async download(entry: CatalogEntry): Promise<Uint8Array> {
    if (!canAutoInstall(entry)) {
      throw new NeedsPurchaseError(entry.sales?.url ?? entry.dwp.package.url, entry.sales?.platform ?? 'other');
    }
    const res = await this.fetchFn(entry.dwp.package.url);
    if (!res.ok) throw new Error(`下载失败 ${entry.id}: HTTP ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length !== entry.dwp.package.size) {
      throw new Error(`大小不符 ${entry.id}: 期望 ${entry.dwp.package.size} 实得 ${bytes.length}`);
    }
    if (!verifyIntegrity(bytes, entry.dwp.package.integrity)) {
      throw new Error(`完整性校验失败 ${entry.id}: sha512 不匹配（包被篡改或损坏）`);
    }
    return bytes;
  }

  /** 安装：下载校验 → 写 packages/<id>.dwp → 记 installed.json。幂等（覆盖同 id）。 */
  async install(entry: CatalogEntry): Promise<InstalledRecord> {
    const bytes = await this.download(entry);
    this.store.ensurePackagesDir();
    const rel = 'packages/' + entry.id + '.dwp';
    writeFileSync(join(this.store.dir, rel), bytes);
    const rec: InstalledRecord = {
      id: entry.id, version: entry.dwp.package.version, integrity: entry.dwp.package.integrity,
      sourceUrl: entry.dwp.package.url, path: rel, installedAt: this.now(), commercial: entry.license.commercial,
    };
    this.store.upsert(rec);
    return rec;
  }

  uninstall(id: string): void { this.store.remove(id); }
  installed(): InstalledRecord[] { return this.store.list(); }
  isInstalled(id: string): boolean { return this.store.has(id); }

  /** catalog 中比已装版本新的条目（更新检测；版本串不等即视为可更新）。 */
  updates(catalog: Catalog): CatalogEntry[] {
    const byId = new Map(this.installed().map((r) => [r.id, r]));
    return catalog.entries.filter((e) => {
      const rec = byId.get(e.id);
      return rec !== undefined && rec.version !== e.dwp.package.version && canAutoInstall(e);
    });
  }
}
