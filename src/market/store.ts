/**
 * 已安装壁纸本地存储（R4 market）：dir/installed.json 记录状态，dir/packages/<id>.dwp 存包。
 * 纯 fs + JSON，注入 dir 便于测试用临时目录。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

export interface InstalledRecord {
  id: string;
  version: string;
  integrity: string;
  sourceUrl: string;
  path: string;            // 相对 dir 的包路径（packages/<id>.dwp）
  installedAt: string;
  commercial: boolean;
}

export class InstalledStore {
  readonly dir: string;
  private readonly file: string;
  readonly packagesDir: string;

  constructor(dir: string) {
    this.dir = dir;
    this.file = join(dir, 'installed.json');
    this.packagesDir = join(dir, 'packages');
  }

  private ensureDir(): void {
    if (!existsSync(this.packagesDir)) mkdirSync(this.packagesDir, { recursive: true });
  }

  load(): InstalledRecord[] {
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as unknown;
      return Array.isArray(parsed) ? parsed as InstalledRecord[] : [];
    } catch { return []; }
  }

  private save(list: InstalledRecord[]): void {
    this.ensureDir();
    writeFileSync(this.file, JSON.stringify(list, null, 2) + '\n', 'utf8');
  }

  get(id: string): InstalledRecord | undefined { return this.load().find((r) => r.id === id); }
  list(): InstalledRecord[] { return this.load(); }
  has(id: string): boolean { return this.get(id) !== undefined; }

  upsert(rec: InstalledRecord): void {
    const list = this.load().filter((r) => r.id !== rec.id);
    list.push(rec);
    this.save(list);
  }

  remove(id: string): void {
    const rec = this.get(id);
    this.save(this.load().filter((r) => r.id !== id));
    if (rec) { try { rmSync(join(this.dir, rec.path), { force: true }); } catch { /* 文件已不在 */ } }
  }

  packagePath(id: string): string { return join(this.packagesDir, id + '.dwp'); }
  ensurePackagesDir(): void { this.ensureDir(); }
}
