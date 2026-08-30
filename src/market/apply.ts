/**
 * "当前应用的 DWP 壁纸"状态（R4 渲染面）：dir/applied.json 记录哪个已装包被设为壁纸。
 * 与 InstalledStore 同目录；纯 fs + JSON，Node 可测。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

export interface AppliedState { id: string; version: string; appliedAt: string }

export class ApplyState {
  private readonly file: string;
  constructor(dir: string) { this.file = join(dir, 'applied.json'); }

  get(): AppliedState | null {
    try {
      const v = JSON.parse(readFileSync(this.file, 'utf8')) as AppliedState;
      return v && typeof v.id === 'string' ? v : null;
    } catch { return null; }
  }

  set(id: string, version: string, now = new Date().toISOString()): AppliedState {
    const s: AppliedState = { id, version, appliedAt: now };
    const dir = dirname(this.file);
    if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(this.file, JSON.stringify(s, null, 2) + '\n', 'utf8');
    return s;
  }

  clear(): void {
    if (existsSync(this.file)) { try { writeFileSync(this.file, '', 'utf8'); } catch { /* ignore */ } }
  }
}
