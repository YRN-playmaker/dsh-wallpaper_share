/**
 * DWP market 的 HTTP 路由（R4 node 半）：注册到 share 的 WebServer。
 * 与 src/index.ts 的 Route/Req/Res 契约结构兼容（本地重声明避免拉入重依赖）。
 * 控制面 API（localhost）：
 *   GET  <base>/catalog[?refresh=1]        → 拉取并回传 catalog（缓存 5 分钟；refresh=1 强制重拉）
 *   GET  <base>/installed                  → 已装列表
 *   GET  <base>/install?id=<id>[&force=1]  → 从缓存 catalog 查条目并安装（付费 402 / 降级 409）
 *   GET  <base>/uninstall?id=<id>          → 卸载
 *   GET  <base>/updates                    → 可更新条目
 * 纯 handler，Node 用假 req/res 可测。
 */
import type { MarketClient } from './pull.ts';
import { NeedsPurchaseError } from './pull.ts';
import type { Catalog, CatalogEntry } from './catalog.ts';
import { compareVersion } from './version.ts';

export interface Req { url?: string; method?: string }
export interface Res { statusCode: number; setHeader(name: string, v: string): void; end(body?: unknown): void }
export interface Route { kind: 'exact' | 'prefix'; path: string; handler(req: Req, res: Res): void | Promise<void> }

export interface MarketRoutesDeps {
  market: MarketClient;
  catalogUrl: string;
  base?: string;   // 路由前缀，默认 /we-sync/dwp/market
  /** catalog 缓存时长（毫秒）；过期即重拉。默认 5 分钟（与 raw.githubusercontent 的 CDN 缓存同量级） */
  catalogTtlMs?: number;
  now?: () => number;
}

function query(req: Req): URLSearchParams {
  const u = new URL(req.url ?? '/', 'http://localhost');
  return u.searchParams;
}
function json(res: Res, code: number, body: unknown): void {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

export function createMarketRoutes(deps: MarketRoutesDeps): Route[] {
  const base = deps.base ?? '/we-sync/dwp/market';
  const ttlMs = deps.catalogTtlMs ?? 300_000;
  const now = deps.now ?? (() => Date.now());
  let cache: Catalog | null = null;
  let fetchedAt = 0;
  /**
   * 取 catalog：缓存过期或 refresh=true 时重拉。
   * refresh 必须**同时带 cache-buster**：catalog 挂在 raw.githubusercontent 上（CDN 约 5 分钟），
   * 不带这个查询参数时点"刷新"拿回来的还是同一份旧目录 —— 2026-09-10 就是这么把刚发布的 1.1.0
   * 又按目录里的 1.0.0 "更新"了回去。
   */
  const ensureCatalog = async (refresh: boolean): Promise<Catalog> => {
    if (!refresh && cache !== null && now() - fetchedAt < ttlMs) return cache;
    const url = refresh
      ? deps.catalogUrl + (deps.catalogUrl.includes('?') ? '&' : '?') + 't=' + String(now())
      : deps.catalogUrl;
    cache = await deps.market.catalog(url);
    fetchedAt = now();
    return cache;
  };

  const catalog: Route = { kind: 'exact', path: base + '/catalog', handler: async (req, res) => {
    try { json(res, 200, await ensureCatalog(query(req).get('refresh') === '1')); }
    catch (e) { json(res, 502, { error: String((e as Error).message ?? e) }); }
  } };

  const installed: Route = { kind: 'exact', path: base + '/installed', handler: (_req, res) => {
    json(res, 200, { installed: deps.market.installed() });
  } };

  const install: Route = { kind: 'exact', path: base + '/install', handler: async (req, res) => {
    const q = query(req);
    const id = q.get('id');
    if (!id) return json(res, 400, { error: '缺 id' });
    let entry: CatalogEntry | undefined;
    try { entry = (await ensureCatalog(false)).entries.find((e) => e.id === id); }
    catch (e) { return json(res, 502, { error: String((e as Error).message ?? e) }); }
    if (!entry) return json(res, 404, { error: `catalog 无此 id: ${id}` });
    // 降级护栏：目录里的版本比本机已装的旧时拒绝安装（除非显式 force=1）——
    // 目录是远端数据，延迟/缓存都可能让它暂时落后，而静默装回旧版本用户几乎察觉不到。
    const rec = deps.market.installed().find((r) => r.id === id);
    const next = entry.dwp.package.version;
    if (rec !== undefined && q.get('force') !== '1' && compareVersion(next, rec.version) < 0) {
      return json(res, 409, {
        error: `本地已装 ${rec.version}，目录里只有 ${next}（远端目录可能还没刷新）；确需回退请加 force=1`,
        installed: rec.version, catalog: next,
      });
    }
    try { json(res, 200, { ok: true, record: await deps.market.install(entry) }); }
    catch (e) {
      if (e instanceof NeedsPurchaseError) return json(res, 402, { error: 'needs-purchase', salesUrl: e.salesUrl, platform: e.platform });
      return json(res, 500, { error: String((e as Error).message ?? e) });
    }
  } };

  const uninstall: Route = { kind: 'exact', path: base + '/uninstall', handler: (req, res) => {
    const id = query(req).get('id');
    if (!id) return json(res, 400, { error: '缺 id' });
    deps.market.uninstall(id);
    json(res, 200, { ok: true });
  } };

  const updates: Route = { kind: 'exact', path: base + '/updates', handler: async (req, res) => {
    try { json(res, 200, { updates: deps.market.updates(await ensureCatalog(query(req).get('refresh') === '1')) }); }
    catch (e) { json(res, 502, { error: String((e as Error).message ?? e) }); }
  } };

  return [catalog, installed, install, uninstall, updates];
}
