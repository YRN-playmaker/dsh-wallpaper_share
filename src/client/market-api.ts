/**
 * 市场前端的纯逻辑层（client 半，浏览器安全：只用 fetch，零 node 依赖）。
 * 与 node 半 src/market/* 解耦——这里只重声明 UI 需要的类型子集，
 * 避免把 node:crypto / node:fs 拖进 lib/client.js 浏览器包。
 * 全部函数注入 fetch，Node 测试喂假响应即可跑通（无需浏览器）。
 *
 * 范围（本轮锁定）：只做免费。付费条目在 buildCards 里直接过滤掉，
 * 不渲染、不提供购买/授权流程（付费系统暂缓实装）。
 */

export interface MarketEntry {
  id: string;
  name: { zh: string; en: string };
  author: string;
  description?: string;
  tags?: string[];
  license: { commercial: boolean; content: string };
  dwp: { thumbnail: string; width?: number; height?: number; package: { version: string } };
  sales?: null | { platform: string; url: string };
}

export interface InstalledItem {
  id: string;
  version: string;
  commercial: boolean;
  installedAt: string;
}

export type InstallState = 'absent' | 'installed' | 'update';

export interface MarketCard {
  entry: MarketEntry;
  state: InstallState;
  installedVersion?: string;
}

export type Fetch = (url: string, init?: { cache?: 'no-store' }) => Promise<{
  ok: boolean; status: number; json(): Promise<unknown>;
}>;

const defaultFetch: Fetch = (url, init) => fetch(url, init);

/** 拉 catalog（node 半已缓存），返回条目数组。 */
export async function fetchCatalog(fetchFn: Fetch = defaultFetch, url = '/we-sync/dwp/market/catalog'): Promise<MarketEntry[]> {
  const res = await fetchFn(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`catalog ${res.status}`);
  const body = await res.json() as { entries?: MarketEntry[] };
  return Array.isArray(body.entries) ? body.entries : [];
}

/** 拉已装列表。 */
export async function fetchInstalled(fetchFn: Fetch = defaultFetch, url = '/we-sync/dwp/market/installed'): Promise<InstalledItem[]> {
  const res = await fetchFn(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`installed ${res.status}`);
  const body = await res.json() as { installed?: InstalledItem[] };
  return Array.isArray(body.installed) ? body.installed : [];
}

/** 合并 catalog + installed → 卡片视图模型。免费 only（commercial 过滤掉）。 */
export function buildCards(catalog: MarketEntry[], installed: InstalledItem[]): MarketCard[] {
  const byId = new Map(installed.map((i) => [i.id, i]));
  const cards: MarketCard[] = [];
  for (const entry of catalog) {
    if (entry.license.commercial !== false) continue;   // 本轮：跳过付费
    const rec = byId.get(entry.id);
    const state: InstallState = rec === undefined ? 'absent'
      : rec.version !== entry.dwp.package.version ? 'update' : 'installed';
    cards.push({ entry, state, installedVersion: rec?.version });
  }
  return cards;
}

/** 关键词（名称/作者/描述）+ 标签筛选。 */
export function searchCards(cards: MarketCard[], keyword: string, tag = ''): MarketCard[] {
  const kw = keyword.trim().toLowerCase();
  return cards.filter((c) => {
    if (tag !== '' && !(c.entry.tags ?? []).includes(tag)) return false;
    if (kw === '') return true;
    const hay = [c.entry.name.zh, c.entry.name.en, c.entry.author, c.entry.description ?? ''].join(' ').toLowerCase();
    return hay.includes(kw);
  });
}

/** 从卡片集合收集全部标签（供筛选下拉）。 */
export function collectTags(cards: MarketCard[]): string[] {
  const s = new Set<string>();
  for (const c of cards) for (const tg of c.entry.tags ?? []) s.add(tg);
  return [...s].sort();
}

export interface InstallResult { ok: boolean; error?: string; needsPurchase?: boolean; salesUrl?: string }

/** 安装（GET /install?id=）。402 → needsPurchase（本轮 UI 不发起，防御性保留）。 */
export async function install(fetchFn: Fetch = defaultFetch, id: string): Promise<InstallResult> {
  const res = await fetchFn('/we-sync/dwp/market/install?id=' + encodeURIComponent(id), { cache: 'no-store' });
  const body = await res.json().catch(() => ({})) as { error?: string; salesUrl?: string };
  if (res.status === 402) return { ok: false, needsPurchase: true, salesUrl: body.salesUrl };
  if (!res.ok) return { ok: false, error: body.error ?? `HTTP ${res.status}` };
  return { ok: true };
}

export async function uninstall(fetchFn: Fetch = defaultFetch, id: string): Promise<InstallResult> {
  const res = await fetchFn('/we-sync/dwp/market/uninstall?id=' + encodeURIComponent(id), { cache: 'no-store' });
  if (!res.ok) { const b = await res.json().catch(() => ({})) as { error?: string }; return { ok: false, error: b.error ?? `HTTP ${res.status}` }; }
  return { ok: true };
}

/** "当前应用的 DWP"（渲染面）。 */
export interface AppliedInfo { id: string; version: string; appliedAt: string }

/** 应用某个已装 DWP 为壁纸（GET /apply?id=）。 */
export async function applyDwp(fetchFn: Fetch = defaultFetch, id: string): Promise<InstallResult> {
  const res = await fetchFn('/we-sync/dwp/apply?id=' + encodeURIComponent(id), { cache: 'no-store' });
  const body = await res.json().catch(() => ({})) as { error?: string };
  if (!res.ok) return { ok: false, error: body.error ?? `HTTP ${res.status}` };
  return { ok: true };
}

/** 取消应用（GET /unapply）。 */
export async function unapplyDwp(fetchFn: Fetch = defaultFetch): Promise<InstallResult> {
  const res = await fetchFn('/we-sync/dwp/unapply', { cache: 'no-store' });
  if (!res.ok) { const b = await res.json().catch(() => ({})) as { error?: string }; return { ok: false, error: b.error ?? `HTTP ${res.status}` }; }
  return { ok: true };
}

/** 查询当前应用的 DWP（GET /applied）。 */
export async function fetchApplied(fetchFn: Fetch = defaultFetch): Promise<AppliedInfo | null> {
  const res = await fetchFn('/we-sync/dwp/applied', { cache: 'no-store' });
  if (!res.ok) return null;
  const body = await res.json() as { applied?: AppliedInfo | null };
  return body.applied ?? null;
}
